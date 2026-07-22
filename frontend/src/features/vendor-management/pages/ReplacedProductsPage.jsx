import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, RefreshCw, Search, RotateCcw } from 'lucide-react';
import { fetchReplacedInventorySerials, fetchVendors } from '../vendorManagementApi';
import { PageHeader } from '../../../components/ui/primitives';

const PAGE_SIZE_OPTIONS = [25, 50, 100];

function formatGrn(grnId) {
  const n = Number(grnId);
  if (!Number.isFinite(n)) return '—';
  return `GRN-${String(n).padStart(4, '0')}`;
}

function formatPoType(t) {
  if (!t) return '—';
  return String(t)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  } catch {
    return String(iso);
  }
}

export default function ReplacedProductsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [vendors, setVendors] = useState([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 320);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadVendors = useCallback(async () => {
    setVendorsLoading(true);
    try {
      const { data } = await fetchVendors({ page: 1, limit: 200 });
      if (data.success) setVendors(data.data || []);
    } catch {
      /* optional filter */
    } finally {
      setVendorsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page,
        limit,
        search: searchDebounced || undefined,
        vendor_id: vendorId ? Number(vendorId) : undefined
      };
      const { data } = await fetchReplacedInventorySerials(params);
      if (data.success) {
        setRows(data.data || []);
        const p = data.pagination || {};
        setTotal(Number(p.total) || 0);
        setTotalPages(Number(p.totalPages) || 1);
      } else {
        toast.error(data.message || 'Failed to load replaced inventory');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [page, limit, searchDebounced, vendorId]);

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  useEffect(() => {
    load();
  }, [load]);

  const emptyHint = useMemo(
    () =>
      'Rows appear when a PO serial is marked with inventory status “replace” (column or extra.status2), matching the Laravel inventory-list replace view.',
    []
  );

  return (
    <div className="space-y-6 max-w-[100rem]">
      <PageHeader title="Replaced Products (Inventory)" subtitle={emptyHint} icon={RotateCcw} />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold text-slate-800">Filters</h2>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        </div>
        <div className="p-5 flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[12rem] space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm"
                placeholder="Serial, asset code, PO#, vendor, remark…"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
          <div className="w-full sm:w-56 space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Vendor</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-60"
              value={vendorId}
              disabled={vendorsLoading}
              onChange={(e) => {
                setVendorId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{vendorsLoading ? 'Loading…' : 'All vendors'}</option>
              {vendors.map((v) => (
                <option key={v.vendor_id} value={String(v.vendor_id)}>
                  {[v.business_name, v.first_name].filter(Boolean).join(' · ') || `Vendor ${v.vendor_id}`}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-32 space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Page size</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={String(limit)}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="grid gap-3 md:hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-500"><Loader2 className="w-6 h-6 animate-spin" /> Loading…</div>
        ) : !rows.length ? (
          <p className="text-center text-sm text-slate-500 py-8">No replaced serial rows yet.</p>
        ) : rows.map((r) => (
          <div key={r.serial_id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-900">{r.purchase_order_number || `PO-${r.po_id}`}</span>
              <span className="inline-flex px-2 py-0.5 rounded-md bg-slate-900 text-white text-[11px] font-semibold">Replaced</span>
            </div>
            <p className="text-xs text-slate-600">{r.line_summary}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{formatGrn(r.grn_id)}</span>
              <span>{formatPoType(r.purchase_order_type)}</span>
              <span>{r.vendor_display}</span>
            </div>
            <div className="grid grid-cols-1 gap-0.5 text-[11px] font-mono text-slate-600">
              <span>Serial: {r.serial_number}</span>
              <span>Unique: {r.unique_display}</span>
              <span className="text-amber-900">Old: {r.old_serial_number}</span>
            </div>
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
              <span>{formatWhen(r.updated_at)}</span>
              <Link to={`/vendor-management/purchase-orders/${r.po_id}/receive`} className="inline-flex items-center gap-1 text-teal-700 font-semibold">
                Receive <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin" />
            Loading replaced serials…
          </div>
        ) : (
          <table className="min-w-full text-sm text-left">
            <thead className="bg-slate-100 text-xs font-semibold text-slate-700">
              <tr>
                <th className="px-3 py-3 w-12">#</th>
                <th className="px-3 py-3 min-w-[8rem]">PO / receive</th>
                <th className="px-3 py-3 whitespace-nowrap">GRN</th>
                <th className="px-3 py-3">PO type</th>
                <th className="px-3 py-3 min-w-[10rem]">Vendor</th>
                <th className="px-3 py-3 min-w-[14rem]">Item</th>
                <th className="px-3 py-3 font-mono text-xs">Serial</th>
                <th className="px-3 py-3 font-mono text-xs">Unique / TTSPL</th>
                <th className="px-3 py-3 font-mono text-xs">Old serial</th>
                <th className="px-3 py-3 min-w-[8rem]">Remark</th>
                <th className="px-3 py-3 whitespace-nowrap">Status</th>
                <th className="px-3 py-3 whitespace-nowrap">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!rows.length ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-slate-500 text-sm">
                    No replaced serial rows in CRM yet. Set <code className="text-[11px]">inventory_status</code> or{' '}
                    <code className="text-[11px]">extra.status2</code> to <code className="text-[11px]">replace</code> on a
                    received serial (migration <code className="text-[11px]">037</code> adds supporting columns).
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const sl = (page - 1) * limit + i + 1;
                  return (
                    <tr key={r.serial_id} className="hover:bg-slate-50/80">
                      <td className="px-3 py-3 tabular-nums text-slate-600">{sl}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-900">{r.purchase_order_number || `PO-${r.po_id}`}</div>
                        <Link
                          to={`/vendor-management/purchase-orders/${r.po_id}/receive`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900 mt-1"
                        >
                          Open receive / GRNs
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-800">{formatGrn(r.grn_id)}</td>
                      <td className="px-3 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded-md bg-orange-50 text-orange-900 text-[11px] font-semibold border border-orange-100">
                          {formatPoType(r.purchase_order_type)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-800">{r.vendor_display}</td>
                      <td className="px-3 py-3 text-slate-700 text-xs leading-snug max-w-[20rem]" title={r.line_summary}>
                        {r.line_summary}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">{r.serial_number}</td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-800">{r.unique_display}</td>
                      <td className="px-3 py-3 font-mono text-xs text-amber-900">{r.old_serial_number}</td>
                      <td className="px-3 py-3 text-xs text-slate-600 max-w-[12rem]" title={r.remark}>
                        {r.remark}
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded-md bg-slate-900 text-white text-[11px] font-semibold">
                          Replaced
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600 whitespace-nowrap">{formatWhen(r.updated_at)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <p className="m-0 tabular-nums">
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 rounded border border-slate-200 disabled:opacity-40 font-semibold text-slate-700"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="tabular-nums font-bold text-teal-800 min-w-[2rem] text-center">{page}</span>
            <span className="text-slate-400">/ {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              className="px-3 py-1.5 rounded border border-slate-200 disabled:opacity-40 font-semibold text-slate-700"
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
