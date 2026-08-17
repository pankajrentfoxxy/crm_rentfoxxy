import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, MonitorSmartphone, Inbox, Wrench, Layers, TestTube2,
  ShieldCheck, ShieldQuestion, PackageCheck, Warehouse, Recycle,
  ChevronLeft, ChevronRight, Loader2, CircuitBoard,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getWarehouseLaptopSummary,
  getWarehouseLaptopList,
  getWarehouseLaptopFilters,
} from '../reportingApi';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import MultiSelectFilter from '../../lead-crm/components/MultiSelectFilter';
import { parseSpecMultiUrl } from '../../inventory-management/inventorySpecFilters';

const C = {
  bg: '#F5F6F8',
  surface: '#FFFFFF',
  surface2: '#F1F3F6',
  border: '#E2E6EB',
  borderLite: '#CDD4DC',
  text: '#161B22',
  dim: '#5B6572',
  dim2: '#98A2AE',
  cyan: '#0E7C90',
  amber: '#B4650A',
  green: '#16803C',
  red: '#C4302B',
  violet: '#6D4CC7',
};

const KPI_TILES = [
  { key: 'total', label: 'Total Warehouse', icon: MonitorSmartphone, accent: C.cyan, filter: null },
  { key: 'qc1', label: 'QC1', icon: ShieldCheck, accent: C.violet, filter: { current_stage: 'qc1' } },
  { key: 'qc2', label: 'QC2', icon: ShieldQuestion, accent: C.violet, filter: { current_stage: 'qc2' } },
  { key: 'diagnosis', label: 'Diagnosis', icon: Wrench, accent: C.amber, filter: { current_stage: 'diagnosis' } },
  { key: 'hardware_software', label: 'Hardware & Software', icon: Layers, accent: C.cyan, filter: { current_stage: 'hardware_software' } },
  { key: 'final_testing', label: 'Final Testing', icon: TestTube2, accent: C.cyan, filter: { current_stage: 'final_testing' } },
  { key: 'ready_to_rent_sell', label: 'Ready to Rent/Sell', icon: PackageCheck, accent: C.green, filter: { current_stage: 'ready_to_rent_sell' } },
  { key: 'out_for_repair', label: 'Out for Repair', icon: CircuitBoard, accent: C.red, filter: { current_stage: 'out_for_repair' } },
  { key: 'dead_scrapped', label: 'Dead/Scrapped', icon: Recycle, accent: C.red, filter: { current_stage: 'dead_scrapped' } },
  { key: 'pending_inventory', label: 'Pending Inventory', icon: Inbox, accent: C.amber, filter: { current_stage: 'pending_inventory' } },
];

const PAGE_SIZE = 25;

function StatCard({ label, value, accent, icon: Icon, onClick, active, loading }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick?.(); }}
      style={{
        background: C.surface,
        border: `1.5px solid ${active ? accent : C.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        flex: '1 1 130px',
        minWidth: 130,
        cursor: 'pointer',
        boxShadow: active ? `0 0 0 2px ${accent}22` : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10.5, color: C.dim, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>{label}</span>
        {Icon ? <Icon size={14} color={accent} /> : null}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: C.text, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>
        {loading ? '—' : value}
      </div>
    </div>
  );
}

function ReportMultiFilter({ label, allLabel, options, value, onChange, minWidth = 120 }) {
  return (
    <div style={{ minWidth, flex: `1 1 ${minWidth}px`, maxWidth: 200 }}>
      <p style={{ fontSize: 10, fontWeight: 600, color: C.dim2, margin: '0 0 4px 2px' }}>{label}</p>
      <MultiSelectFilter
        options={options}
        value={parseSpecMultiUrl(value)}
        onChange={(vals) => onChange(Array.isArray(vals) && vals.length ? vals.join(',') : '')}
        allLabel={allLabel}
        className="w-full"
      />
    </div>
  );
}

/** Same layout as Inventory Management Item Description card (read-only). */
function ItemDescriptionCard({ item }) {
  if (!item) return <span style={{ color: C.dim2 }}>—</span>;
  const { brand, model, screen_size, processor, generation, ram, storage, gpu } = item;
  const title = [brand, model].filter(Boolean).join(' - ');
  const specs = [processor, generation, [ram, storage].filter(Boolean).join(' | '), gpu]
    .filter(Boolean)
    .join(' | ');
  return (
    <div style={{
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      background: '#fff',
      padding: '10px 12px',
      minWidth: 220,
      maxWidth: 360,
      boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
    }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.35 }}>
        {title || '—'}
        {screen_size ? (
          <span style={{ fontWeight: 400, color: C.dim }}> | {screen_size}</span>
        ) : null}
      </div>
      {specs ? (
        <div style={{ marginTop: 4, fontSize: 12, color: C.dim, lineHeight: 1.4 }}>{specs}</div>
      ) : null}
    </div>
  );
}

export default function WarehouseLaptopReportPage() {
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [summary, setSummary] = useState({});
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [filterOptions, setFilterOptions] = useState({});

  const [search, setSearch] = useState('');
  const [fBrand, setFBrand] = useState('');
  const [fModel, setFModel] = useState('');
  const [fProcessor, setFProcessor] = useState('');
  const [fGeneration, setFGeneration] = useState('');
  const [fRam, setFRam] = useState('');
  const [fStorage, setFStorage] = useState('');
  const [fStage, setFStage] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fTech, setFTech] = useState('');
  const [fVendor, setFVendor] = useState('');

  const debouncedSearch = useDebouncedValue(search.trim(), 320);

  // Spec / people filters narrow both KPIs and the table.
  const baseParams = useMemo(() => ({
    search: debouncedSearch || undefined,
    brand: fBrand || undefined,
    model: fModel || undefined,
    processor: fProcessor || undefined,
    generation: fGeneration || undefined,
    ram: fRam || undefined,
    storage: fStorage || undefined,
    current_status: fStatus || undefined,
    technician_id: fTech || undefined,
    vendor_id: fVendor || undefined,
  }), [debouncedSearch, fBrand, fModel, fProcessor, fGeneration, fRam, fStorage, fStatus, fTech, fVendor]);

  // Stage/KPI drill-down filters the table only — never the summary tiles.
  const listParams = useMemo(() => ({
    ...baseParams,
    current_stage: fStage || undefined,
  }), [baseParams, fStage]);

  useEffect(() => {
    getWarehouseLaptopFilters()
      .then((res) => setFilterOptions(res.data?.data || {}))
      .catch(() => setFilterOptions({}));
  }, []);

  useEffect(() => { setPage(1); }, [listParams]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getWarehouseLaptopSummary(baseParams);
      setSummary(res.data?.data || {});
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load warehouse summary');
      setSummary({});
    } finally {
      setLoading(false);
    }
  }, [baseParams]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await getWarehouseLaptopList({ ...listParams, page, limit: PAGE_SIZE });
      setRows(res.data?.data || []);
      setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load warehouse listing');
      setRows([]);
    } finally {
      setListLoading(false);
    }
  }, [listParams, page]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadList(); }, [loadList]);

  const clearFilters = () => {
    setSearch('');
    setFBrand('');
    setFModel('');
    setFProcessor('');
    setFGeneration('');
    setFRam('');
    setFStorage('');
    setFStage('');
    setFStatus('');
    setFTech('');
    setFVendor('');
  };

  const onTileClick = (tile) => {
    if (!tile.filter) {
      setFStage('');
      setFStatus('');
      return;
    }
    if (tile.filter.current_stage) {
      setFStage((prev) => (prev === tile.filter.current_stage ? '' : tile.filter.current_stage));
      setFStatus('');
    }
  };

  const techOptions = (filterOptions.technicians || []).map((t) => ({
    value: String(t.user_id),
    label: t.name,
  }));
  const vendorOptions = (filterOptions.vendors || []).map((v) => ({
    value: String(v.vendor_id),
    label: v.name,
  }));

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: "'Inter', -apple-system, sans-serif", color: C.text, padding: '22px 24px 60px' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');
        * { box-sizing: border-box; }
        table { border-collapse: collapse; width: 100%; }
        th, td { text-align: left; }
        tr:hover td { background: ${C.surface2} !important; }
      `}</style>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.dim2, fontWeight: 600, marginBottom: 4 }}>/reports/warehouse-laptops</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, displaySpacing: -0.3, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Warehouse size={22} color={C.cyan} /> Warehouse Laptop Report
        </h1>
        <p style={{ fontSize: 12.5, color: C.dim, margin: '4px 0 0' }}>
          Live warehouse snapshot — excludes customer-assigned units (rented, sold, demo, in transit, reserved)
        </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        {KPI_TILES.map((tile) => (
          <StatCard
            key={tile.key}
            label={tile.label}
            value={summary[tile.key] ?? 0}
            accent={tile.accent}
            icon={tile.icon}
            loading={loading}
            active={tile.filter?.current_stage ? fStage === tile.filter.current_stage : (!fStage && tile.key === 'total')}
            onClick={() => onTileClick(tile)}
          />
        ))}
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ minWidth: 180, flex: '1 1 180px', maxWidth: 280 }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: C.dim2, margin: '0 0 4px 2px' }}>Master Search</p>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: C.dim2 }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="TTSPL / serial / brand / model"
                style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px 8px 30px', fontSize: 13 }}
              />
            </div>
          </div>
          <ReportMultiFilter label="Brand" allLabel="All brands" options={filterOptions.brands || []} value={fBrand} onChange={setFBrand} />
          <ReportMultiFilter label="Model" allLabel="All models" options={filterOptions.models || []} value={fModel} onChange={setFModel} />
          <ReportMultiFilter label="Processor" allLabel="All processors" options={filterOptions.processors || []} value={fProcessor} onChange={setFProcessor} />
          <ReportMultiFilter label="Generation" allLabel="All gens" options={filterOptions.generations || []} value={fGeneration} onChange={setFGeneration} />
          <ReportMultiFilter label="RAM" allLabel="All RAM" options={filterOptions.rams || []} value={fRam} onChange={setFRam} />
          <ReportMultiFilter label="Storage" allLabel="All storage" options={filterOptions.storages || []} value={fStorage} onChange={setFStorage} />
          <div style={{ minWidth: 140 }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: C.dim2, margin: '0 0 4px 2px' }}>Current Stage</p>
            <select
              value={fStage}
              onChange={(e) => setFStage(e.target.value)}
              style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 13 }}
            >
              <option value="">All stages</option>
              {(filterOptions.stages || []).map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: C.dim2, margin: '0 0 4px 2px' }}>Current Status</p>
            <select
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
              style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 13 }}
            >
              <option value="">All statuses</option>
              {(filterOptions.statuses || []).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: C.dim2, margin: '0 0 4px 2px' }}>Technician</p>
            <select
              value={fTech}
              onChange={(e) => setFTech(e.target.value)}
              style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 13 }}
            >
              <option value="">All technicians</option>
              {techOptions.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: C.dim2, margin: '0 0 4px 2px' }}>Vendor</p>
            <select
              value={fVendor}
              onChange={(e) => setFVendor(e.target.value)}
              style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 13 }}
            >
              <option value="">All vendors</option>
              {vendorOptions.map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={clearFilters}
            style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, background: C.surface2, cursor: 'pointer' }}
          >
            Clear
          </button>
        </div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr style={{ background: C.surface2 }}>
                {['TTSPL Number', 'Serial Number', 'Item Description', 'Current Status', 'Current Stage', 'Technician', 'QC User', 'Vendor'].map((h) => (
                  <th key={h} style={{ padding: '10px 12px', fontSize: 11, color: C.dim, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: C.dim2 }}>
                    <Loader2 className="inline animate-spin" size={20} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: C.dim2, fontSize: 13 }}>No warehouse laptops for this filter</td>
                </tr>
              ) : rows.map((r) => (
                <tr key={r.serial_id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{r.ttspl_number || '—'}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{r.serial_number || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <ItemDescriptionCard item={r.item_description || {
                      brand: r.brand,
                      model: r.model,
                      screen_size: r.screen_size,
                      processor: r.processor,
                      generation: r.generation,
                      ram: r.ram,
                      storage: r.storage,
                      gpu: r.graphics,
                    }}
                    />
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12 }}>{r.current_status || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12 }}>{r.current_stage || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13 }}>{r.technician || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13 }}>{r.qc_user || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13 }}>{r.vendor || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderTop: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 12, color: C.dim }}>
            {pagination.total} unit{pagination.total === 1 ? '' : 's'}
            {fStage ? ` · filtered by stage` : ''}
          </span>
          {pagination.totalPages > 1 ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 6, background: '#fff', cursor: 'pointer' }}>
                <ChevronLeft size={16} />
              </button>
              <span style={{ fontSize: 12 }}>{page} / {pagination.totalPages}</span>
              <button type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 6, background: '#fff', cursor: 'pointer' }}>
                <ChevronRight size={16} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
