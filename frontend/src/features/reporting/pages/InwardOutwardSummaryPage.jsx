import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ArrowDownToLine, ArrowUpFromLine, Building2, Users, Truck, X, Search } from 'lucide-react';
import api from '../../../utils/api';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import { normalizeTtsplSearchInput } from '../../../utils/ttspl';

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const DATE_PRESETS = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'custom', label: 'Custom' },
];

const rangeForPreset = (preset) => {
  if (preset === 'today') return { from: today(), to: today() };
  if (preset === 'yesterday') return { from: yesterday(), to: yesterday() };
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

function CountCell({ cell, onOpen, strong = false }) {
  if (!cell) {
    return <td className="px-4 py-3 text-center text-gray-300">—</td>;
  }
  return (
    <td className="px-4 py-3 text-center">
      <button
        type="button"
        onClick={() => onOpen(cell.type, cell.title)}
        title={`View ${cell.title}`}
        className={`inline-flex min-w-[3.5rem] justify-center rounded-lg px-3 py-1.5 font-bold text-gray-900 transition
          hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 ${strong ? 'text-2xl' : 'text-xl'}`}
      >
        {cell.value ?? 0}
      </button>
    </td>
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

function DetailModal({ open, title, loading, rows, onClose, onTtsplClick }) {
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
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <X className="w-5 h-5" />
          </button>
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

const DEFAULT_FILTERS = { preset: 'today', from: today(), to: today(), customer: '', vendor: '' };

export default function InwardOutwardSummaryPage() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [options, setOptions] = useState({ vendors: [], customers: [] });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState({ open: false, title: '' });
  const [detailRows, setDetailRows] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [historyTtspl, setHistoryTtspl] = useState(null);

  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const openDetail = useCallback(async (type, title) => {
    setDetail({ open: true, title });
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
    setFilters((f) => ({ ...f, preset, ...(preset === 'custom' ? {} : rangeForPreset(preset)) }));
  };

  const setDate = (key, value) => {
    setFilters((f) => ({ ...f, preset: 'custom', [key]: value }));
  };

  useEffect(() => {
    api.get('/reports/inward-outward-summary/filters')
      .then((r) => setOptions({
        vendors: r.data.vendors || [],
        customers: r.data.customers || [],
      }))
      .catch(() => {});
  }, []);

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

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Inward &amp; Outward Summary</h1>
        <p className="text-sm text-gray-500 mt-1">Laptop movement — received into and dispatched from the warehouse</p>
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
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Party</th>
                  <th className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1.5 text-green-700">
                      <ArrowDownToLine className="w-4 h-4" /> Inward
                    </span>
                  </th>
                  <th className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1.5 text-red-600">
                      <ArrowUpFromLine className="w-4 h-4" /> Outward
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                <tr className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 font-medium text-gray-800">
                      <Building2 className="w-4 h-4 text-blue-500" /> Vendor
                    </span>
                    <p className="text-[11px] text-gray-400 ml-6">GRN / purchase · purchase return</p>
                  </td>
                  <CountCell cell={{ value: inward?.vendor, type: 'inward_vendor', title: 'Inward from Vendor' }} onOpen={openDetail} />
                  <CountCell cell={{ value: outward?.vendor, type: 'outward_vendor', title: 'Outward to Vendor' }} onOpen={openDetail} />
                </tr>
                <tr className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 font-medium text-gray-800">
                      <Users className="w-4 h-4 text-amber-500" /> Customer
                    </span>
                    <p className="text-[11px] text-gray-400 ml-6">Support pickup / return · challan dispatch</p>
                  </td>
                  <CountCell cell={{ value: inward?.customer, type: 'inward_customer', title: 'Inward from Customer' }} onOpen={openDetail} />
                  <CountCell cell={{ value: outward?.customer, type: 'outward_customer', title: 'Outward to Customer' }} onOpen={openDetail} />
                </tr>
                <tr className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 font-medium text-gray-800">
                      <Truck className="w-4 h-4 text-purple-500" /> Direct
                    </span>
                    <p className="text-[11px] text-gray-400 ml-6">Courier / Bluedart / manual</p>
                  </td>
                  <CountCell cell={{ value: inward?.direct, type: 'inward_direct', title: 'Direct Inward' }} onOpen={openDetail} />
                  <CountCell cell={null} onOpen={openDetail} />
                </tr>
                <tr className="bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-900">Total</td>
                  <CountCell cell={{ value: inward?.total, type: 'inward_total', title: 'Total Inward Laptops' }} onOpen={openDetail} strong />
                  <CountCell cell={{ value: outward?.total, type: 'outward_total', title: 'Total Outward Laptops' }} onOpen={openDetail} strong />
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-gray-400">
            Inward counts use each source&apos;s receipt date (vendor GRN, warehouse-received pickups, inward ledger).
            Outward counts use the dispatch date on delivery challans and vendor repair DCs.
            The Vendor and Customer filters scope results to the matching movement type. Click any count to view the laptops.
          </p>
        </>
      )}

      <DetailModal
        open={detail.open}
        title={detail.title}
        loading={detailLoading}
        rows={detailRows}
        onClose={() => setDetail({ open: false, title: '' })}
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
