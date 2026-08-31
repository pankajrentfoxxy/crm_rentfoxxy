import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ArrowDownToLine, ArrowUpFromLine, Building2, Users, Truck, X, Search, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import { normalizeTtsplSearchInput } from '../../../utils/ttspl';
import ExportButton from '../components/ExportButton';
import { exportReport } from '../reportingApi';
import usePermission from '../../../hooks/usePermission';

const pad2 = (n) => String(n).padStart(2, '0');
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const currentMonth = () => new Date().getMonth() + 1;
const currentYear = () => new Date().getFullYear();

const MONTHS = [
  { v: 1, l: 'January' }, { v: 2, l: 'February' }, { v: 3, l: 'March' },
  { v: 4, l: 'April' }, { v: 5, l: 'May' }, { v: 6, l: 'June' },
  { v: 7, l: 'July' }, { v: 8, l: 'August' }, { v: 9, l: 'September' },
  { v: 10, l: 'October' }, { v: 11, l: 'November' }, { v: 12, l: 'December' },
];
const YEARS = Array.from({ length: 6 }, (_, i) => 2024 + i);

const rangeForMonth = (month, year) => {
  const m = Number(month) || currentMonth();
  const y = Number(year) || currentYear();
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${y}-${pad2(m)}-01`,
    to: `${y}-${pad2(m)}-${pad2(last)}`,
  };
};

const DATE_PRESETS = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'month', label: 'Month' },
  { value: 'custom', label: 'Custom' },
];

const rangeForPreset = (preset, month, year) => {
  if (preset === 'today') return { from: today(), to: today() };
  if (preset === 'yesterday') return { from: yesterday(), to: yesterday() };
  if (preset === 'month') return rangeForMonth(month, year);
  return { from: '', to: '' };
};

const paramsForFilters = (f) => {
  const base = { customer: f.customer, vendor: f.vendor };
  if (f.preset === 'all') return { ...base, all_time: 1 };
  if (f.from && f.to) return { ...base, from: f.from, to: f.to };
  return { ...base, all_time: 1 };
};

function SearchSelect({ value, onChange, options, getValue, getLabel, placeholder, allLabel }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  const selected = options.find((o) => String(getValue(o)) === String(value));
  const label = selected ? getLabel(selected) : '';

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => getLabel(o).toLowerCase().includes(q)) : options;

  const choose = (val) => { onChange(val); setOpen(false); setQuery(''); };

  return (
    <div ref={ref} className="relative min-w-[180px] max-w-[240px]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={open ? query : label}
          placeholder={selected ? label : placeholder}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm"
        />
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg text-sm">
          <button
            type="button"
            onClick={() => choose('')}
            className={`block w-full text-left px-3 py-2 hover:bg-gray-50 ${!value ? 'bg-blue-50 text-blue-700' : 'text-gray-600'}`}
          >
            {allLabel}
          </button>
          {filtered.map((o) => (
            <button
              key={getValue(o)}
              type="button"
              onClick={() => choose(String(getValue(o)))}
              className={`block w-full text-left px-3 py-2 hover:bg-gray-50 ${String(getValue(o)) === String(value) ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
            >
              {getLabel(o)}
            </button>
          ))}
          {filtered.length === 0 && <p className="px-3 py-2 text-gray-400">No matches</p>}
        </div>
      )}
    </div>
  );
}

function downloadBlob(res, fileName) {
  const blob = new Blob([res.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function CategoryExportButton({ filters, type, title, compact = false, disabled = false, label }) {
  const [loading, setLoading] = useState(false);

  const handleExport = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || loading) return;
    setLoading(true);
    try {
      const res = await exportReport({
        report_type: 'inward_outward',
        filters: { ...filters, type, category_label: title },
      });
      const date = new Date().toISOString().slice(0, 10);
      const slug = String(title || type || 'list').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
      downloadBlob(res, `${slug || type}_${date}.xlsx`);
      toast.success('List exported');
    } catch {
      toast.error('Export failed');
    } finally {
      setLoading(false);
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleExport}
        disabled={disabled || loading}
        title={`Export ${title || 'list'}`}
        className="inline-flex items-center justify-center p-1.5 rounded-md text-green-700 hover:bg-green-50 disabled:opacity-40"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={disabled || loading}
      className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm inline-flex gap-2 items-center hover:bg-green-700 disabled:opacity-60"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
      {label || 'Export all listed'}
    </button>
  );
}

function PanelRow({ row, onOpen, onExport, accent, canExport }) {
  const hasActivity = (row.value ?? 0) > 0;
  return (
    <div
      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg ${
        hasActivity
          ? accent === 'success' ? 'bg-green-50' : 'bg-red-50'
          : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(row.type, row.title)}
        title={`View ${row.title}`}
        className={`min-w-0 flex-1 flex items-center justify-between gap-3 text-left rounded-md ${
          hasActivity
            ? accent === 'success' ? 'hover:bg-green-100' : 'hover:bg-red-100'
            : 'hover:bg-gray-50'
        }`}
      >
        <span className="min-w-0">
          <span className={`text-sm ${hasActivity ? 'text-gray-900' : 'text-gray-500'}`}>{row.label}</span>
          {row.sublabel ? <span className="block text-[11px] text-gray-400">{row.sublabel}</span> : null}
        </span>
        <span className={`shrink-0 text-sm font-semibold tabular-nums ${
          hasActivity
            ? accent === 'success' ? 'text-green-700' : 'text-red-600'
            : 'text-gray-400'
        }`}>
          {row.value ?? 0}
        </span>
      </button>
      {canExport ? (
        <CategoryExportButton
          compact
          filters={onExport}
          type={row.type}
          title={row.title}
          disabled={!hasActivity}
        />
      ) : null}
    </div>
  );
}

function DirectionPanel({ direction, total, groups, onOpen, exportFilters, canExport }) {
  const isInward = direction === 'inward';
  const totalTitle = `Total ${isInward ? 'Inward' : 'Outward'} Laptops`;
  return (
    <div className={`bg-white rounded-xl border border-gray-100 shadow-sm p-4 border-t-2 ${
      isInward ? 'border-t-green-500' : 'border-t-red-500'
    }`}>
      <div className="flex items-center justify-between mb-3 gap-2">
        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
          isInward ? 'text-green-700' : 'text-red-600'
        }`}>
          {isInward ? <ArrowDownToLine className="w-4 h-4" /> : <ArrowUpFromLine className="w-4 h-4" />}
          {isInward ? 'Inward' : 'Outward'}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onOpen(`${direction}_total`, totalTitle)}
            title={`View ${totalTitle}`}
            className="text-2xl font-bold text-gray-900 hover:text-blue-700 tabular-nums"
          >
            {total ?? 0}
          </button>
          {canExport ? (
            <CategoryExportButton
              compact
              filters={exportFilters}
              type={`${direction}_total`}
              title={totalTitle}
              disabled={!total}
            />
          ) : null}
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="mb-3 last:mb-0">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-1">
            <group.Icon className="w-3.5 h-3.5" /> {group.label}
          </p>
          <div className="space-y-0.5">
            {group.rows.map((row) => (
              <PanelRow
                key={row.type}
                row={row}
                onOpen={onOpen}
                onExport={exportFilters}
                canExport={canExport}
                accent={isInward ? 'success' : 'danger'}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const formatConfig = (r) => {
  const parts = [r.brand, r.model, r.processor, r.generation, r.ram, r.storage].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return r.config_text || '—';
};

const DETAIL_CAP = 5000;

const formatDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const PARTY_BADGE = {
  vendor: 'bg-blue-50 text-blue-700',
  customer: 'bg-amber-50 text-amber-700',
  direct: 'bg-purple-50 text-purple-700',
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function DetailModal({ open, title, type, loading, rows, onClose, onTtsplClick, canExport, exportFilters }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => { setPage(1); }, [rows, open]);

  if (!open) return null;

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {loading
                ? 'Loading…'
                : total === 0
                  ? 'No laptops'
                  : `${total.toLocaleString('en-IN')} laptop${total === 1 ? '' : 's'}`
                    + (total >= DETAIL_CAP ? ' (capped — refine filters)' : '')
                    + ` · showing ${(start + 1).toLocaleString('en-IN')}–${(start + pageRows.length).toLocaleString('en-IN')}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canExport && !loading && rows.length > 0 ? (
              <CategoryExportButton
                filters={exportFilters}
                type={type}
                title={title}
                label="Export all listed"
              />
            ) : null}
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="overflow-auto flex-1 min-h-0">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#534AB7]" /></div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">No records for this selection.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs sticky top-0">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">TTSPL</th>
                  <th className="text-left font-medium px-4 py-2.5">Serial</th>
                  <th className="text-left font-medium px-4 py-2.5">Configuration</th>
                  <th className="text-left font-medium px-4 py-2.5">Customer / Vendor</th>
                  <th className="text-left font-medium px-4 py-2.5">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pageRows.map((r, i) => (
                  <tr key={`${r.ttspl || r.serial_number || 'row'}-${start + i}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                      {r.ttspl ? (
                        <button
                          type="button"
                          onClick={() => onTtsplClick?.(r.ttspl)}
                          className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                          title="View TTSPL history"
                        >
                          {r.ttspl}
                        </button>
                      ) : <span className="text-gray-900">—</span>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {r.serial_number && r.ttspl ? (
                        <button
                          type="button"
                          onClick={() => onTtsplClick?.(r.ttspl)}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                          title="View TTSPL history"
                        >
                          {r.serial_number}
                        </button>
                      ) : <span className="text-gray-600">{r.serial_number || '—'}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">{formatConfig(r)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${PARTY_BADGE[r.party_type] || 'bg-gray-100 text-gray-600'}`}>
                          {r.party_type || '—'}
                        </span>
                        <span className="text-gray-700">{r.party_name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{formatDate(r.movement_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && total > 0 && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 text-sm">
            <div className="flex items-center gap-2 text-gray-500">
              <span>Rows per page</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
              >
                {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Page {safePage} of {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const DEFAULT_FILTERS = {
  preset: 'today',
  from: today(),
  to: today(),
  month: currentMonth(),
  year: currentYear(),
  customer: '',
  vendor: '',
};

export default function InwardOutwardSummaryPage() {
  const { canView } = usePermission();
  const canExport = canView('reports_export') || canView('report_inward_outward');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [options, setOptions] = useState({ vendors: [], customers: [] });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState({ open: false, title: '', type: '' });
  const [detailRows, setDetailRows] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [historyTtspl, setHistoryTtspl] = useState(null);

  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const openDetail = useCallback(async (type, title) => {
    setDetail({ open: true, title, type });
    setDetailRows([]);
    setDetailLoading(true);
    try {
      const res = await api.get('/reports/inward-outward-summary/details', {
        params: { ...paramsForFilters(filters), type },
      });
      setDetailRows(res.data.rows || []);
    } catch {
      setDetailRows([]);
    } finally {
      setDetailLoading(false);
    }
  }, [filters]);

  const setPreset = (preset) => {
    setFilters((f) => ({
      ...f,
      preset,
      customer: '',
      vendor: '',
      ...(preset === 'custom' ? {} : rangeForPreset(preset, f.month, f.year)),
    }));
  };

  const setDate = (key, value) => {
    setFilters((f) => ({ ...f, preset: 'custom', customer: '', vendor: '', [key]: value }));
  };

  const setMonthYear = (key, value) => {
    setFilters((f) => {
      const next = { ...f, preset: 'month', customer: '', vendor: '', [key]: value };
      return { ...next, ...rangeForMonth(next.month, next.year) };
    });
  };

  useEffect(() => {
    const params = paramsForFilters(filters);
    api.get('/reports/inward-outward-summary/filters', { params })
      .then((r) => {
        const customers = r.data.customers || [];
        const vendors = r.data.vendors || [];
        setOptions({ vendors, customers });
        setFilters((f) => {
          const customerOk = !f.customer || customers.some((c) => String(c.customer_id) === String(f.customer));
          const vendorOk = !f.vendor || vendors.some((v) => String(v.vendor_id) === String(f.vendor));
          if (customerOk && vendorOk) return f;
          return {
            ...f,
            customer: customerOk ? f.customer : '',
            vendor: vendorOk ? f.vendor : '',
          };
        });
      })
      .catch(() => {});
  }, [filters.from, filters.to, filters.preset]);

  const load = useCallback(async (f) => {
    setLoading(true);
    try {
      const res = await api.get('/reports/inward-outward-summary', { params: paramsForFilters(f) });
      setSummary(res.data.summary || null);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); }, [filters, load]);

  const reset = () => setFilters(DEFAULT_FILTERS);

  const inward = summary?.inward;
  const outward = summary?.outward;

  const inwardGroups = [
    {
      label: 'Vendor',
      Icon: Building2,
      rows: [
        { type: 'inward_vendor_purchase', title: 'Inward — Vendor purchase / GRN', label: 'Purchase / GRN', value: inward?.vendor_purchase },
        { type: 'inward_vendor_return', title: 'Inward — Vendor return (repaired)', label: 'Repair return', sublabel: 'Repair send-out · repaired receive-back', value: inward?.vendor_return },
        { type: 'inward_vendor_replacement', title: 'Inward — Vendor replacement', label: 'Replacement', sublabel: 'Replacement unit received from vendor', value: inward?.vendor_replacement },
      ],
    },
    {
      label: 'Customer',
      Icon: Users,
      rows: [
        { type: 'inward_customer_return', title: 'Inward — Customer return', label: 'Return', sublabel: 'Warehouse-received pickup / repair return', value: inward?.customer_return },
        { type: 'inward_customer_replacement', title: 'Inward — Customer replacement', label: 'Replacement', sublabel: 'Old unit in · new unit dispatch', value: inward?.customer_replacement },
      ],
    },
    {
      label: 'Direct',
      Icon: Truck,
      rows: [
        { type: 'inward_direct', title: 'Direct Inward', label: 'Courier / manual / ERP', value: inward?.direct },
      ],
    },
  ];

  const outwardGroups = [
    {
      label: 'Vendor',
      Icon: Building2,
      rows: [
        { type: 'outward_vendor_return', title: 'Outward — Vendor return (repair DC)', label: 'Repair return', value: outward?.vendor_return ?? outward?.vendor },
      ],
    },
    {
      label: 'Customer',
      Icon: Users,
      rows: [
        { type: 'outward_customer_service_return', title: 'Outward — Customer service return', label: 'Return', sublabel: 'Warehouse-received pickup / repair return', value: outward?.customer_service_return },
        { type: 'outward_customer_replacement', title: 'Outward — Customer replacement', label: 'Replacement', sublabel: 'Old unit in · new unit dispatch', value: outward?.customer_replacement },
        { type: 'outward_customer_standard', title: 'Outward — Customer standard', label: 'Standard dispatch', sublabel: 'Normal delivery challan', value: outward?.customer_standard },
      ],
    },
  ];

  const exportFilters = {
    from: filters.from,
    to: filters.to,
    customer: filters.customer,
    vendor: filters.vendor,
    preset: filters.preset,
    all_time: filters.preset === 'all' ? 1 : undefined,
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Inward &amp; Outward Summary</h1>
          <p className="text-sm text-gray-500 mt-1">Laptop movement — received into and dispatched from the warehouse</p>
        </div>
        {canExport ? (
          <ExportButton
            reportType="inward_outward"
            filters={exportFilters}
            label="Export Excel"
            fileNameBase="inward_outward"
          />
        ) : null}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPreset(p.value)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                filters.preset === p.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">Month</span>
            <select
              value={filters.month}
              onChange={(e) => setMonthYear('month', Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[140px]"
            >
              {MONTHS.map((m) => (
                <option key={m.v} value={m.v}>{m.l}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">Year</span>
            <select
              value={filters.year}
              onChange={(e) => setMonthYear('year', Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[100px]"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">From</span>
            <input type="date" value={filters.from} onChange={(e) => setDate('from', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">To</span>
            <input type="date" value={filters.to} onChange={(e) => setDate('to', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          <div className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">Customer</span>
            <SearchSelect
              value={filters.customer}
              onChange={(val) => set('customer', val)}
              options={options.customers}
              getValue={(c) => c.customer_id}
              getLabel={(c) => c.customer_name}
              placeholder="Search customer…"
              allLabel="All customers"
            />
          </div>
          <div className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">Vendor</span>
            <SearchSelect
              value={filters.vendor}
              onChange={(val) => set('vendor', val)}
              options={options.vendors}
              getValue={(v) => v.vendor_id}
              getLabel={(v) => v.business_name}
              placeholder="Search vendor…"
              allLabel="All vendors"
            />
          </div>
          <button type="button" onClick={reset}
            className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Clear</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DirectionPanel
              direction="inward"
              total={inward?.total}
              groups={inwardGroups}
              onOpen={openDetail}
              exportFilters={exportFilters}
              canExport={canExport}
            />
            <DirectionPanel
              direction="outward"
              total={outward?.total}
              groups={outwardGroups}
              onOpen={openDetail}
              exportFilters={exportFilters}
              canExport={canExport}
            />
          </div>

          <p className="text-[11px] text-gray-400">
            Inward: GRN purchase, vendor repaired/replacement receive-back, customer warehouse-received pickups (return vs replacement), and direct ledger.
            Outward: customer standard / replacement / service-return challans, and vendor repair DC dispatches.
            Click any count to view the laptops. Use the download icon to export that list.
          </p>
        </>
      )}

      <DetailModal
        open={detail.open}
        title={detail.title}
        type={detail.type}
        loading={detailLoading}
        rows={detailRows}
        canExport={canExport}
        exportFilters={exportFilters}
        onClose={() => setDetail({ open: false, title: '', type: '' })}
        onTtsplClick={(ttspl) => setHistoryTtspl(normalizeTtsplSearchInput(ttspl))}
      />

      <TtsplHistoryDrawer
        open={!!historyTtspl}
        ttsplId={historyTtspl}
        onClose={() => setHistoryTtspl(null)}
      />
    </div>
  );
}
