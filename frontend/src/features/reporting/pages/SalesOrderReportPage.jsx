import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Loader2, X, Cpu, Package, Link2, Truck, ClipboardList,
  Warehouse, ShieldCheck, ShoppingCart, RefreshCw, Calendar,
  ChevronRight, ChevronDown, FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getSalesOrderReport, getSalesOrderReportDrilldown } from '../reportingApi';
import ExportButton from '../components/ExportButton';
import { useUrlFilterPatch } from '../hooks/useReportFiltersFromUrl';
import { SO_SCOPES } from '../../sales-pipeline/salesOrderScope';

const C = {
  bg: '#F4F6F9',
  surface: '#FFFFFF',
  border: '#E3E8EF',
  text: '#111827',
  dim: '#5B6573',
  rental: '#E85D04',
  sale: '#0B9E6A',
  blue: '#2563EB',
  violet: '#7C3AED',
  amber: '#D97706',
  cyan: '#0891B2',
  emerald: '#059669',
  rose: '#E11D48',
};

const PRESETS = [
  { key: 'all', label: 'All (from 1 Jul 2026)' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 Days' },
  { key: 'custom', label: 'Custom Range' },
];

const KPI_META = [
  { key: 'ordered', label: 'Laptops Ordered', icon: ShoppingCart, color: C.blue },
  { key: 'attached', label: 'Attached (QC Pending)', icon: Link2, color: C.violet },
  { key: 'dispatch_qc', label: 'Dispatch QC Done', icon: ShieldCheck, color: C.emerald },
  { key: 'challan_generated', label: 'DC Generated', icon: FileText, color: C.amber },
  { key: 'in_transit', label: 'Dispatched / In Transit', icon: Truck, color: C.cyan },
  { key: 'delivered', label: 'Delivered', icon: Package, color: C.rose },
];

const TABLE_COLS = [
  { key: 'processor', label: 'Processor', sticky: true, isLabel: true },
  { key: 'generation', label: 'Generation', sticky: true, isLabel: true, childOnly: true },
  { key: 'ordered', label: 'Ordered', bucket: 'ordered', color: C.blue },
  { key: 'attached', label: 'Attached', sub: 'QC Pending', bucket: 'attached', color: C.violet },
  { key: 'dispatch_qc_done', label: 'Dispatch QC', sub: 'Done', bucket: 'dispatch_qc_done', color: C.emerald },
  { key: 'challan_generated', label: 'DC Generated', bucket: 'challan', color: C.amber },
  { key: 'dispatched', label: 'Dispatched', bucket: 'dispatched', color: C.cyan },
  { key: 'available', label: 'Ready Stock', bucket: 'available', color: C.emerald },
  { key: 'qc_process', label: 'QC1 / QC2', bucket: 'qc', color: '#9333EA' },
];

const DRILL_COLUMNS = {
  ordered: [
    { key: 'sales_order_number', label: 'Sales Order' },
    { key: 'sales_order_date', label: 'SO Date', format: 'date' },
    { key: 'config', label: 'Configuration' },
    { key: 'quantity', label: 'Qty' },
  ],
  attached: [
    { key: 'sales_order_number', label: 'Sales Order' },
    { key: 'ttspl_id', label: 'TTSPL' },
    { key: 'config', label: 'Configuration' },
    { key: 'qc_status', label: 'QC Status' },
    { key: 'attached_at', label: 'Attached', format: 'datetime' },
  ],
  dispatch_qc_done: [
    { key: 'sales_order_number', label: 'Sales Order' },
    { key: 'ttspl_id', label: 'TTSPL' },
    { key: 'config', label: 'Configuration' },
    { key: 'qc_passed_at', label: 'QC Passed', format: 'datetime' },
  ],
  challan: [
    { key: 'dc_number', label: 'DC Number' },
    { key: 'sales_order_number', label: 'Sales Order' },
    { key: 'config', label: 'Configuration' },
    { key: 'dispatch_mode', label: 'Transport' },
    { key: 'dc_created_at', label: 'DC Created', format: 'datetime' },
  ],
  dispatched: [
    { key: 'dc_number', label: 'DC Number' },
    { key: 'sales_order_number', label: 'Sales Order' },
    { key: 'config', label: 'Configuration' },
    { key: 'dispatch_mode', label: 'Transport' },
    { key: 'dispatched_at', label: 'Dispatched', format: 'datetime' },
  ],
  available: [
    { key: 'ttspl_id', label: 'TTSPL' },
    { key: 'serial_number', label: 'Serial' },
    { key: 'config', label: 'Configuration' },
  ],
  qc: [
    { key: 'ticket_id', label: 'Ticket' },
    { key: 'ttspl_id', label: 'TTSPL' },
    { key: 'config', label: 'Configuration' },
    { key: 'ticket_stage', label: 'Stage' },
  ],
};

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtDateOnly(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

function configStr(item) {
  return [
    item.brand || item.model_name || item.model,
    item.processor, item.generation, item.ram, item.storage, item.gpu, item.screen_size,
  ].filter(Boolean).join(' · ');
}

function drillValue(item, col) {
  if (col.key === 'config') return configStr(item);
  if (col.format === 'date') return fmtDateOnly(item[col.key]);
  if (col.format === 'datetime') return fmtDate(item[col.key]);
  return item[col.key] ?? '—';
}

function CountBtn({ value, color, onClick }) {
  if (!value) return <span style={{ color: C.dim }}>0</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontWeight: 700, fontSize: 14, color, background: `${color}14`,
        border: `1px solid ${color}33`, borderRadius: 8, padding: '4px 10px',
        cursor: 'pointer', minWidth: 36,
      }}
    >
      {value}
    </button>
  );
}

function KpiCard({ meta, value, loading }) {
  const Icon = meta.icon;
  return (
    <div style={{
      background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`,
      padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'center',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 12, background: `${meta.color}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: meta.color,
      }}
      >
        <Icon size={22} />
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 12, color: C.dim, fontWeight: 600 }}>{meta.label}</p>
        <p style={{ margin: '2px 0 0', fontSize: 26, fontWeight: 800, color: C.text }}>
          {loading ? '…' : value}
        </p>
      </div>
    </div>
  );
}

function DataRow({
  row, scope, isChild, expanded, onToggle, onCellClick,
}) {
  const bg = isChild ? '#FAFBFD' : C.surface;
  const metricCols = TABLE_COLS.filter((c) => c.bucket);
  const generation = isChild ? row.generation : 'all';

  return (
    <tr style={{ borderTop: `1px solid ${C.border}`, background: bg }}>
      <td
        colSpan={2}
        style={{
          padding: '11px 14px', fontWeight: isChild ? 500 : 700,
          position: 'sticky', left: 0, background: bg, zIndex: 1, minWidth: 200,
          paddingLeft: isChild ? 36 : 14,
          color: isChild ? C.dim : C.text,
        }}
      >
        {isChild ? (
          <span>{row.generation}</span>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontWeight: 800, fontSize: 14, color: C.text,
            }}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {row.processor}
            <span style={{ fontSize: 11, color: C.dim, fontWeight: 600 }}>
              ({row.generations?.length || 0} gen)
            </span>
          </button>
        )}
      </td>
      {metricCols.map((col) => (
        <td key={col.key} style={{ padding: '11px 10px', textAlign: 'center', background: bg }}>
          <CountBtn
            value={row[col.key]}
            color={col.color}
            onClick={() => row[col.key] > 0 && onCellClick({
              scope, bucket: col.bucket, processor: row.processor, generation,
            })}
          />
        </td>
      ))}
    </tr>
  );
}

function ConfigTable({ title, accent, processors, scope, onCellClick, headerAction }) {
  const [expanded, setExpanded] = useState({});

  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const metricCols = TABLE_COLS.filter((c) => c.bucket);

  return (
    <div style={{
      background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`,
      overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    }}
    >
      <div style={{
        padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 10,
        background: `linear-gradient(135deg, ${accent}12, transparent)`,
      }}
      >
        <Cpu size={20} color={accent} />
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.text }}>{title}</h3>
        <span style={{
          marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: accent,
          background: `${accent}18`, padding: '4px 10px', borderRadius: 20,
        }}
        >
          {processors.length} processor{processors.length !== 1 ? 's' : ''}
        </span>
        {headerAction}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              <th
                colSpan={2}
                style={{
                  textAlign: 'left', padding: '12px 14px', fontWeight: 700, color: C.dim,
                  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
                  position: 'sticky', left: 0, background: '#F8FAFC', zIndex: 2, minWidth: 200,
                }}
              >
                Processor / Generation
              </th>
              {metricCols.map((col) => (
                <th
                  key={col.key}
                  style={{
                    textAlign: 'center', padding: '12px 10px', fontWeight: 700, color: C.dim,
                    fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 88,
                  }}
                >
                  <div>{col.label}</div>
                  {col.sub && <div style={{ fontSize: 9, fontWeight: 500, textTransform: 'none' }}>{col.sub}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processors.length === 0 ? (
              <tr>
                <td colSpan={metricCols.length + 1} style={{ padding: 32, textAlign: 'center', color: C.dim }}>
                  No pending pipeline for this scope
                </td>
              </tr>
            ) : processors.map((group) => {
              const isOpen = !!expanded[group.key];
              return (
                <React.Fragment key={group.key}>
                  <DataRow
                    row={group}
                    scope={scope}
                    isChild={false}
                    expanded={isOpen}
                    onToggle={() => toggle(group.key)}
                    onCellClick={onCellClick}
                  />
                  {isOpen && (group.generations || []).map((child) => (
                    <DataRow
                      key={child.key}
                      row={child}
                      scope={scope}
                      isChild
                      onCellClick={onCellClick}
                    />
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function drillTitle({ scope, bucket, processor, generation }) {
  const col = TABLE_COLS.find((c) => c.bucket === bucket);
  const genLabel = generation === 'all' ? 'All generations' : generation;
  return `${col?.label || bucket} — ${processor} / ${genLabel} (${scope === 'sale' ? 'Sale' : 'Rental'})`;
}

function DrilldownModal({ open, onClose, title, loading, items, scope, bucket, returnTo }) {
  if (!open) return null;
  const scopeCfg = SO_SCOPES[scope] || SO_SCOPES.rental;
  const cols = DRILL_COLUMNS[bucket] || DRILL_COLUMNS.ordered;

  const linkFor = (item) => {
    if (item.link_type === 'sales_order' && item.sales_order_number) {
      return `${scopeCfg.listPath}/${encodeURIComponent(item.sales_order_number)}`;
    }
    if (item.link_type === 'delivery_challan' && item.dc_number) {
      return `/sales-pipeline/delivery-challans/${encodeURIComponent(item.dc_number)}`;
    }
    if (item.link_type === 'delivery_register' && item.dc_number) {
      return `/sales-pipeline/delivery-register?dc=${encodeURIComponent(item.dc_number)}`;
    }
    if (item.link_type === 'inventory' && item.ttspl_id) {
      return `/inventory-management/serial-number-status?serial=${encodeURIComponent(item.ttspl_id)}`;
    }
    if (item.link_type === 'floor_ticket' && item.ticket_id) {
      return `/floor-pipeline/tickets/${item.ticket_id}`;
    }
    return null;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}
    >
      <div style={{
        background: C.surface, borderRadius: 16, width: 'min(1100px, 100%)',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}
      >
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}
        >
          <ClipboardList size={20} color={C.blue} />
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X size={20} color={C.dim} />
          </button>
        </div>
        <div style={{ overflow: 'auto', padding: 16 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>
              <Loader2 className="animate-spin inline" size={24} /> Loading…
            </div>
          ) : items.length === 0 ? (
            <p style={{ textAlign: 'center', color: C.dim, padding: 32 }}>No items</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {cols.map((col) => (
                    <th key={col.key} style={{ textAlign: 'left', padding: '10px 12px', color: C.dim, fontSize: 11 }}>{col.label}</th>
                  ))}
                  <th style={{ textAlign: 'left', padding: '10px 12px', color: C.dim, fontSize: 11 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const href = linkFor(item);
                  return (
                    <tr key={idx} style={{ borderTop: `1px solid ${C.border}` }}>
                      {cols.map((col) => (
                        <td key={col.key} style={{ padding: '10px 12px', maxWidth: col.key === 'config' ? 300 : undefined }}>
                          {col.key === 'sales_order_number' || col.key === 'dc_number' || col.key === 'ttspl_id' || col.key === 'ticket_id' ? (
                            <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{drillValue(item, col)}</span>
                          ) : drillValue(item, col)}
                        </td>
                      ))}
                      <td style={{ padding: '10px 12px' }}>
                        {href ? (
                          <Link
                            to={href}
                            state={{ from: returnTo }}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              color: C.blue, fontWeight: 600, textDecoration: 'none', fontSize: 12,
                            }}
                          >
                            Open <ChevronRight size={14} />
                          </Link>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SalesOrderReportPage() {
  const location = useLocation();
  const { setFilter, get } = useUrlFilterPatch();
  const preset = get('preset', 'today');
  const from = get('from');
  const to = get('to');
  const drillScope = get('scope');
  const drillBucket = get('bucket');
  const drillProcessor = get('processor');
  const drillGeneration = get('generation', 'all');
  const drillOpen = Boolean(drillScope && drillBucket && drillProcessor);
  const returnTo = `${location.pathname}${location.search}`;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillItems, setDrillItems] = useState([]);

  const filters = useMemo(() => {
    const f = { preset };
    if (preset === 'custom') {
      f.from = from || '2026-07-01';
      f.to = to;
    }
    return f;
  }, [preset, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await getSalesOrderReport(filters);
      if (!res?.success) throw new Error(res?.message || 'Failed to load');
      setData(res);
    } catch (err) {
      toast.error(err.message || 'Could not load report');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!drillOpen) {
      setDrillItems([]);
      setDrillLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setDrillLoading(true);
      try {
        const { data: res } = await getSalesOrderReportDrilldown({
          ...filters,
          scope: drillScope,
          bucket: drillBucket,
          processor: drillProcessor,
          generation: drillGeneration || 'all',
        });
        if (!cancelled) setDrillItems(res?.items || []);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Could not load details');
      } finally {
        if (!cancelled) setDrillLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [drillOpen, drillScope, drillBucket, drillProcessor, drillGeneration, filters]);

  const openDrill = ({ scope, bucket, processor, generation }) => {
    setFilter({
      scope,
      bucket,
      processor,
      generation: generation || 'all',
    }, { replace: false });
  };

  const closeDrill = () => {
    setFilter({
      scope: null,
      bucket: null,
      processor: null,
      generation: null,
    }, { replace: true });
  };

  const drill = drillOpen ? {
    scope: drillScope,
    bucket: drillBucket,
    processor: drillProcessor,
    generation: drillGeneration || 'all',
    title: drillTitle({
      scope: drillScope,
      bucket: drillBucket,
      processor: drillProcessor,
      generation: drillGeneration || 'all',
    }),
  } : null;

  const summary = data?.summary?.combined || {};

  return (
    <div style={{ background: C.bg, minHeight: '100%', padding: '20px 24px 40px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', marginBottom: 20 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: C.text, letterSpacing: '-0.02em' }}>
              Sales Order Operations
            </h1>
            <p style={{ margin: '6px 0 0', color: C.dim, fontSize: 14, maxWidth: 600 }}>
              Live warehouse pipeline by processor. Data from 1 Jul 2026 only — legacy ERP migration excluded.
              Click a processor to expand generations.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px',
              borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface,
              fontWeight: 600, cursor: 'pointer', color: C.dim,
            }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        <div style={{
          background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`,
          padding: 16, marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        }}
        >
          <Calendar size={18} color={C.dim} />
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setFilter({ preset: p.key })}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                border: preset === p.key ? `2px solid ${C.blue}` : `1px solid ${C.border}`,
                background: preset === p.key ? `${C.blue}10` : C.surface,
                color: preset === p.key ? C.blue : C.dim, cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <>
              <input
                type="date"
                min="2026-07-01"
                value={from}
                onChange={(e) => setFilter({ from: e.target.value })}
                style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px' }}
              />
              <span style={{ color: C.dim }}>to</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setFilter({ to: e.target.value })}
                style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px' }}
              />
            </>
          )}
          {data?.generated_at && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.dim }}>
              CRM from {data.crm_start_date || '2026-07-01'} · Updated {fmtDate(data.generated_at)}
            </span>
          )}
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14, marginBottom: 24,
        }}
        >
          {KPI_META.map((meta) => (
            <KpiCard key={meta.key} meta={meta} value={summary[meta.key] ?? 0} loading={loading} />
          ))}
        </div>

        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, fontSize: 12, color: C.dim,
        }}
        >
          <span><Warehouse size={14} style={{ verticalAlign: -2 }} /> Delivered laptops excluded from pipeline</span>
          <span>·</span>
          <span><strong>Attached</strong> = Dispatch QC pending</span>
          <span>·</span>
          <span><strong>DC Generated</strong> = challan created, not yet in transit</span>
          <span>·</span>
          <span><strong>Dispatched</strong> = in transit / shipped</span>
        </div>

        <div style={{ display: 'grid', gap: 24 }}>
          <ConfigTable
            title="Rental Orders (Rentfoxxy)"
            accent={C.rental}
            processors={data?.rental?.processors || []}
            scope="rental"
            onCellClick={openDrill}
            headerAction={(
              <ExportButton
                reportType="sales_order_config"
                filters={{ ...filters, scope: 'rental' }}
                label="Export"
                fileNameBase="sales_order_rental"
              />
            )}
          />
          <ConfigTable
            title="Sale Orders (Gorefurbo)"
            accent={C.sale}
            processors={data?.sale?.processors || []}
            scope="sale"
            onCellClick={openDrill}
            headerAction={(
              <ExportButton
                reportType="sales_order_config"
                filters={{ ...filters, scope: 'sale' }}
                label="Export"
                fileNameBase="sales_order_sale"
              />
            )}
          />
        </div>
      </div>

      <DrilldownModal
        open={!!drill}
        onClose={closeDrill}
        title={drill?.title || ''}
        loading={drillLoading}
        items={drillItems}
        scope={drill?.scope || 'rental'}
        bucket={drill?.bucket || 'ordered'}
        returnTo={returnTo}
      />
    </div>
  );
}
