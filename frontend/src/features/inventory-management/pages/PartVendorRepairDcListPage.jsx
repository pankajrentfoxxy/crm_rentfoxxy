import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, Eye, FileText, Loader2, Search, Send } from 'lucide-react';
import { PageHeader, ListPagination, DateRangeFilter } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import {
  downloadPartVendorRepairPdf,
  fetchDefectiveEligibleForVendorReturn,
  fetchPartVendorRepairDcList,
} from '../partVendorRepairApi';
import CreateBulkPartVendorReturnModal from '../components/CreateBulkPartVendorReturnModal';

const PAGE_SIZE = 25;

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN');
}

export default function PartVendorRepairDcListPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pdfBusy, setPdfBusy] = useState(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 320);

  const [defectiveLoading, setDefectiveLoading] = useState(false);
  const [defectiveUnits, setDefectiveUnits] = useState([]);
  const [defectiveSearch, setDefectiveSearch] = useState('');
  const debouncedDefectiveSearch = useDebouncedValue(defectiveSearch.trim(), 320);
  const [selected, setSelected] = useState(() => new Set());
  const [showBulk, setShowBulk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchPartVendorRepairDcList({
        search: debouncedSearch || undefined,
        status: status || undefined,
        page,
        limit: PAGE_SIZE,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setRows(data.data || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load part vendor returns');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, page, dateFrom, dateTo]);

  const loadDefective = useCallback(async () => {
    setDefectiveLoading(true);
    try {
      const { data } = await fetchDefectiveEligibleForVendorReturn({
        search: debouncedDefectiveSearch || undefined,
        limit: 200,
      });
      setDefectiveUnits(data.data || []);
      setSelected(new Set());
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load defective parts');
      setDefectiveUnits([]);
    } finally {
      setDefectiveLoading(false);
    }
  }, [debouncedDefectiveSearch]);

  useEffect(() => { setPage(1); }, [debouncedSearch, status, dateFrom, dateTo]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDefective(); }, [loadDefective]);

  const selectedUnits = useMemo(
    () => defectiveUnits.filter((u) => selected.has(u.instance_id)),
    [defectiveUnits, selected]
  );

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === defectiveUnits.length) setSelected(new Set());
    else setSelected(new Set(defectiveUnits.map((u) => u.instance_id)));
  };

  const handlePdf = async (dcNumber) => {
    setPdfBusy(dcNumber);
    try {
      await downloadPartVendorRepairPdf(dcNumber);
      toast.success('DC PDF downloaded');
    } catch {
      toast.error('PDF download failed');
    } finally {
      setPdfBusy(null);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Part Vendor Repair DC"
        subtitle="Bulk-send defective spare parts for repair or replacement — receive back goes straight to stock"
        icon={FileText}
        actions={(
          <Link
            to="/inventory-management/parts"
            className="inline-flex items-center gap-1.5 h-9 px-3 border rounded-lg text-sm hover:bg-slate-50"
          >
            ← Parts Inventory
          </Link>
        )}
      />

      <div className="bg-white border rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Defective parts — send to vendor</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select multiple units (same vendor). On receive: repair or replacement per line → stock (no QC).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">{selected.size} selected</span>
            <button
              type="button"
              disabled={selected.size < 1}
              onClick={() => setShowBulk(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold bg-blue-600 text-white disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
              Bulk send ({selected.size})
            </button>
          </div>
        </div>
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm"
            placeholder="Search defective PRT / part / vendor…"
            value={defectiveSearch}
            onChange={(e) => setDefectiveSearch(e.target.value)}
          />
        </div>
        <div className="overflow-x-auto border rounded-lg max-h-72 overflow-y-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 sticky top-0">
              <tr>
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={defectiveUnits.length > 0 && selected.size === defectiveUnits.length}
                    onChange={toggleAll}
                    disabled={!defectiveUnits.length}
                  />
                </th>
                <th className="px-3 py-2">PRT</th>
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">SPO</th>
              </tr>
            </thead>
            <tbody>
              {defectiveLoading ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400"><Loader2 className="inline w-5 h-5 animate-spin" /></td></tr>
              ) : defectiveUnits.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No eligible defective parts (need SPO link, not already on a VRDC)</td></tr>
              ) : defectiveUnits.map((u) => (
                <tr key={u.instance_id} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(u.instance_id)}
                      onChange={() => toggle(u.instance_id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{u.prt_id}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{u.part_name}</div>
                    <div className="text-[11px] text-slate-400">{u.serial_number || '—'}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{u.vendor_name || '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{u.purchase_order_number || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div className="relative min-w-[12rem] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm"
            placeholder="Search DC / PRT / vendor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="border rounded-lg px-3 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="dispatched">Dispatched</option>
          <option value="partially_returned">Partially returned</option>
          <option value="returned">Returned</option>
        </select>
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onRangeChange={(range) => { setDateFrom(range.dateFrom || ''); setDateTo(range.dateTo || ''); }}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
        />
      </div>

      <div className="overflow-x-auto border rounded-xl bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">DC</th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2">Items</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400"><Loader2 className="inline w-5 h-5 animate-spin" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">No part vendor return DCs</td></tr>
            ) : rows.map((r) => (
              <tr key={r.dc_number} className="border-t hover:bg-slate-50">
                <td className="px-3 py-2 font-mono font-semibold text-blue-700">{r.dc_number}</td>
                <td className="px-3 py-2">{r.vendor_name || '—'}</td>
                <td className="px-3 py-2">{r.received_count || 0}/{r.item_count || 0}</td>
                <td className="px-3 py-2 capitalize">{String(r.status || '').replace(/_/g, ' ')}</td>
                <td className="px-3 py-2">{fmtDate(r.created_at)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/inventory-management/part-vendor-repair/${encodeURIComponent(r.dc_number)}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                    >
                      <Eye className="w-3.5 h-3.5" /> Open
                    </Link>
                    <button
                      type="button"
                      disabled={pdfBusy === r.dc_number}
                      onClick={() => handlePdf(r.dc_number)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline disabled:opacity-50"
                      title="Download DC PDF for technician"
                    >
                      {pdfBusy === r.dc_number
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Download className="w-3.5 h-3.5" />}
                      Print
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination.totalPages > 1 && (
        <ListPagination
          page={page}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          total={pagination.total}
        />
      )}

      {showBulk && (
        <CreateBulkPartVendorReturnModal
          units={selectedUnits}
          onClose={() => setShowBulk(false)}
          onCreated={() => { load(); loadDefective(); }}
        />
      )}
    </div>
  );
}
