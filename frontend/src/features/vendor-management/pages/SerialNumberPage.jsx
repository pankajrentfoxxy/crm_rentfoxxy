import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { Clipboard, Download, Loader2, Printer, Search } from 'lucide-react';
import { fetchGrns, fetchPurchaseOrders, fetchSerials, updateSerial } from '../vendorManagementApi';

function parseExtra(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return typeof p === 'object' && p !== null && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Mirrors Laravel blade `unique_product_serial` / CRM `inventory_asset_code` */
function uniqueNumberFromSerialRow(row) {
  const ex = parseExtra(row.extra);
  if (row.inventory_asset_code) return String(row.inventory_asset_code);
  if (ex.unique_product_serial) return String(ex.unique_product_serial);
  if (ex.unique_number) return String(ex.unique_number);
  return '—';
}

function formatGrn(grn_id) {
  const n = Number(grn_id);
  if (!Number.isFinite(n)) return 'GRN—';
  return `GRN-${String(n).padStart(4, '0')}`;
}

function normalizePoDisplay(row) {
  return row.purchase_order_number || `PO-${row.po_id}`;
}

export default function SerialNumberPage() {
  const [searchParams] = useSearchParams();

  const [poSearchInput, setPoSearchInput] = useState('');
  const [poSearchDebounced, setPoSearchDebounced] = useState('');
  const [posLoading, setPosLoading] = useState(false);
  const [purchaseOrders, setPurchaseOrders] = useState([]);

  const [poId, setPoId] = useState('');
  const [grnId, setGrnId] = useState('');

  const [grnsLoading, setGrnsLoading] = useState(false);
  const [grns, setGrns] = useState([]);

  const [serialsLoading, setSerialsLoading] = useState(false);
  /** Row state for Laravel-style per-row editing */
  const [serialRows, setSerialRows] = useState([]);
  /** serial_id → busy */
  const [updatingId, setUpdatingId] = useState(null);

  const [tableSearch, setTableSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setPoSearchDebounced(poSearchInput.trim()), 320);
    return () => clearTimeout(t);
  }, [poSearchInput]);

  const loadPurchaseOrders = useCallback(async () => {
    setPosLoading(true);
    try {
      const { data } = await fetchPurchaseOrders({
        page: 1,
        limit: 200,
        search: poSearchDebounced || undefined
      });
      if (data.success) setPurchaseOrders(data.data || []);
      else toast.error(data.message || 'Failed to load purchase orders');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load purchase orders');
    } finally {
      setPosLoading(false);
    }
  }, [poSearchDebounced]);

  useEffect(() => {
    loadPurchaseOrders();
  }, [loadPurchaseOrders]);

  useEffect(() => {
    const fp = searchParams.get('focusPo');
    if (fp == null || fp === '') return;
    const n = Number(fp);
    if (!Number.isFinite(n)) return;
    setPoId(String(n));
  }, [searchParams]);

  /** Laravel getGrnInfo */
  const loadGrnsForPo = useCallback(async (nextPoId) => {
    const pid = Number(nextPoId);
    if (!Number.isFinite(pid) || pid < 1) {
      setGrns([]);
      setGrnId('');
      return;
    }
    setGrnsLoading(true);
    try {
      const { data } = await fetchGrns(pid);
      if (data.success) {
        setGrns(data.data || []);
        setGrnId('');
        setSerialRows([]);
      } else toast.error(data.message || 'No GRN data');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed loading GRN');
      setGrns([]);
    } finally {
      setGrnsLoading(false);
    }
  }, []);

  /** Laravel getAllSerialNumber */
  const loadSerials = useCallback(async (pid, gid) => {
    const p = Number(pid);
    const g = Number(gid);
    if (!Number.isFinite(p) || !Number.isFinite(g)) {
      setSerialRows([]);
      return;
    }
    setSerialsLoading(true);
    try {
      const { data } = await fetchSerials(g, p);
      if (!data.success) {
        toast.error(data.message || 'Failed loading serials');
        setSerialRows([]);
        return;
      }
      const list = data.data || [];
      setSerialRows(
        list.map((s) => ({
          serial_id: s.serial_id,
          baseline_serial: String(s.serial_number ?? ''),
          draft_serial: String(s.serial_number ?? ''),
          unique_display: uniqueNumberFromSerialRow(s)
        }))
      );
      setPage(1);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed loading serials');
      setSerialRows([]);
    } finally {
      setSerialsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!poId) {
      setGrns([]);
      setGrnId('');
      setSerialRows([]);
      return;
    }
    loadGrnsForPo(poId);
  }, [poId, loadGrnsForPo]);

  useEffect(() => {
    if (!poId || !grnId) {
      setSerialRows([]);
      return;
    }
    loadSerials(poId, grnId);
  }, [poId, grnId, loadSerials]);

  const filteredRows = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return serialRows;
    return serialRows.filter((r) => {
      const blob = `${r.draft_serial} ${r.baseline_serial} ${r.unique_display}`.toLowerCase();
      return blob.includes(q);
    });
  }, [serialRows, tableSearch]);

  useEffect(() => {
    const maxPg = Math.max(1, Math.ceil(filteredRows.length / pageSize) || 1);
    setPage((p) => Math.min(p, maxPg));
  }, [filteredRows.length, pageSize]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize) || 1);

  function patchDraft(serial_id, val) {
    setSerialRows((prev) =>
      prev.map((r) => (r.serial_id === serial_id ? { ...r, draft_serial: val } : r))
    );
  }

  /** Laravel checkSerialNumberAndUpdate */
  async function updateSerialRow(serial_id) {
    const row = serialRows.find((r) => r.serial_id === serial_id);
    if (!row) return;
    const pid = Number(poId);
    const gid = Number(grnId);
    const newSerial = row.draft_serial.trim();
    const oldSerial = row.baseline_serial.trim();

    if (!newSerial || !oldSerial || !pid || !gid) {
      toast.error('Serial, PO and GRN are required');
      return;
    }

    setUpdatingId(serial_id);
    try {
      const { data } = await updateSerial({
        old_serial: oldSerial,
        new_serial: newSerial,
        grn_id: gid,
        po_id: pid
      });
      if (data.success) {
        toast.success(data.message || 'Serial number updated');
        const saved = String(data.old_serial_number ?? newSerial).trim();
        setSerialRows((prev) =>
          prev.map((r) =>
            r.serial_id === serial_id ? { ...r, baseline_serial: saved, draft_serial: saved } : r
          )
        );
      } else {
        toast.error(data.message || 'Update failed');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.response?.data?.errors?.[0]?.msg || 'Update failed');
    } finally {
      setUpdatingId(null);
    }
  }

  async function copyTableTsv() {
    const header = ['SL', 'Serial Number', 'Unique Number'];
    const lines = [
      header.join('\t'),
      ...filteredRows.map((r, i) => [i + 1, r.draft_serial.replace(/\t/g, ' '), r.unique_display].join('\t'))
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Clipboard not available');
    }
  }

  function downloadCsv() {
    const esc = (s) =>
      `"${String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    const header = ['SL', 'Serial Number', 'Unique Number'];
    const rows = filteredRows.map((r, i) => [String(i + 1), r.draft_serial, r.unique_display]);
    const body = rows.map((row) => row.map(esc).join(',')).join('\r\n');
    const csv = `${header.join(',')}\r\n${body}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `serials_po${poId || 'unknown'}_${grnId || 'grn'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('CSV downloaded');
  }

  return (
    <div className="space-y-6 max-w-6xl print:max-w-none">
      <div className="print:hidden">
        <h1 className="text-xl font-bold text-slate-900 capitalize">Update serial number</h1>
        <p className="text-xs text-slate-500 mt-1">
          Same flow as Laravel admin: Select PO → Select GRN → edit serial inline → Update (duplicate serial check).
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden print:shadow-none print:border">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80 flex flex-wrap items-center gap-3 print:bg-white">
          <h2 className="text-lg font-bold text-slate-900 print:hidden">Update Serial Number</h2>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                PO search / filter{' '}
                <span className="text-[11px] font-normal text-slate-400">(optional)</span>
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm"
                  placeholder="Search PO#, vendor…"
                  value={poSearchInput}
                  onChange={(e) => setPoSearchInput(e.target.value)}
                />
              </div>
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1 mt-4">
                Select PO number <span className="text-red-500">*</span>
              </label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-60"
                value={poId}
                disabled={posLoading}
                onChange={(e) => setPoId(e.target.value)}
              >
                <option value="">
                  {posLoading ? 'Loading…' : 'Please select'}
                </option>
                {purchaseOrders.map((r) => (
                  <option key={r.po_id} value={String(r.po_id)}>
                    {normalizePoDisplay(r)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1 mt-10 lg:mt-[4.5rem]">
                Select GRN <span className="text-red-500">*</span>
              </label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-60"
                value={grnId}
                disabled={!poId || grnsLoading || !grns.length}
                onChange={(e) => setGrnId(e.target.value)}
              >
                <option value="">
                  {!poId ? 'Choose a PO first' : grnsLoading ? 'Loading…' : grns.length ? 'Select GRN' : 'No GRN found'}
                </option>
                {grns.map((g) => (
                  <option key={g.grn_id} value={String(g.grn_id)}>
                    {formatGrn(g.grn_id)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3 print:hidden">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-600 mr-2">Export</span>
              <button
                type="button"
                onClick={() => copyTableTsv()}
                disabled={!filteredRows.length}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-300 text-orange-700 text-xs font-semibold hover:bg-orange-50 disabled:opacity-40"
              >
                <Clipboard className="w-3.5 h-3.5" />
                Copy
              </button>
              <button
                type="button"
                onClick={() => downloadCsv()}
                disabled={!filteredRows.length || !poId || !grnId}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-300 text-orange-700 text-xs font-semibold hover:bg-orange-50 disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={!filteredRows.length}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-300 text-orange-700 text-xs font-semibold hover:bg-orange-50 disabled:opacity-40"
              >
                <Printer className="w-3.5 h-3.5" />
                Print
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-600 whitespace-nowrap">Show</label>
                <select
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-600">entries</span>
              </div>
              <div className="flex items-center gap-2 flex-1 min-w-[12rem] max-w-xs">
                <label className="text-xs font-semibold text-slate-600 shrink-0">Search</label>
                <input
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                  placeholder="Filter rows…"
                  value={tableSearch}
                  onChange={(e) => {
                    setTableSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-base font-bold text-slate-900 capitalize mb-3 print:mb-2">Update Serial Number</h3>

            {serialsLoading ? (
              <div className="flex items-center gap-2 py-16 text-slate-500 justify-center">
                <Loader2 className="w-6 h-6 animate-spin" />
                Loading serials…
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-slate-100 text-xs font-semibold text-slate-700 capitalize">
                    <tr>
                      <th className="px-3 py-3 w-12">SL</th>
                      <th className="px-3 py-3 min-w-[12rem]">Serial number</th>
                      <th className="px-3 py-3 min-w-[10rem]">Unique number</th>
                      <th className="px-3 py-3 whitespace-nowrap w-32 print:hidden">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {!poId || !grnId ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                          Select PO and GRN to load serial numbers.
                        </td>
                      </tr>
                    ) : paginatedRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                          No data found.
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((r, i) => (
                        <tr key={r.serial_id} className="hover:bg-slate-50/80">
                          <td className="px-3 py-3 tabular-nums text-slate-600">
                            {(page - 1) * pageSize + i + 1}
                          </td>
                          <td className="px-3 py-3">
                            <input
                              type="text"
                              className="w-full max-w-xs border border-slate-200 rounded-lg px-2 py-1.5 font-mono text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none disabled:opacity-50"
                              autoComplete="off"
                              disabled={updatingId === r.serial_id}
                              value={r.draft_serial}
                              onChange={(e) => patchDraft(r.serial_id, e.target.value)}
                              aria-label="Serial number"
                            />
                          </td>
                          <td className="px-3 py-3 font-mono text-xs sm:text-sm text-slate-800">
                            {r.unique_display}
                          </td>
                          <td className="px-3 py-3 print:hidden">
                            <button
                              type="button"
                              disabled={updatingId === r.serial_id}
                              onClick={() => updateSerialRow(r.serial_id)}
                              className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shadow-sm disabled:opacity-50 whitespace-nowrap"
                            >
                              {updatingId === r.serial_id ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Saving
                                </>
                              ) : (
                                'Update'
                              )}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {poId && grnId && !serialsLoading && filteredRows.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 mt-4 text-xs text-slate-600 print:hidden">
                <p className="m-0 tabular-nums">
                  Showing{' '}
                  {filteredRows.length === 0
                    ? 0
                    : (page - 1) * pageSize + 1}{' '}
                  to {(page - 1) * pageSize + paginatedRows.length} of {filteredRows.length}{' '}
                  entries
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    className="px-3 py-1.5 rounded border border-slate-200 disabled:opacity-40 font-semibold text-slate-700"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span className="min-w-[2rem] text-center tabular-nums font-bold text-teal-800">{page}</span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded border border-slate-200 disabled:opacity-40 font-semibold text-slate-700"
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
