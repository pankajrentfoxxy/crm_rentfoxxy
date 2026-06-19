import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Eye, Plus } from 'lucide-react';
import {
  fetchSpareOrders,
  fetchSparePartsOrder,
  patchSparePartsOrderStatus,
  uploadSparePartsOrderBills
} from '../vendorManagementApi';
import { getBackendOrigin } from '../../../utils/api';
import SparePartsPoFormModal from '../components/SparePartsPoFormModal';

const LIST_PAGE_SIZE = 25;

function parseLineItems(po) {
  const raw = po?.product_details ?? po?.line_items;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseBillFiles(row) {
  const raw = row?.bill_files;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function filePublicUrl(p) {
  if (!p) return '#';
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}${p.startsWith('/') ? p : `/${p}`}`;
}

function wordCount(str) {
  if (!str || !String(str).trim()) return 0;
  return String(str).trim().split(/\s+/).filter(Boolean).length;
}

function RemarkCell({ text }) {
  const [open, setOpen] = useState(false);
  const full = text || '';
  const preview = full.trim().split(/\s+/).slice(0, 4).join(' ');
  const long = wordCount(full) > 5;
  if (!full.trim()) return <span className="text-slate-400">—</span>;
  return (
    <div className="max-w-[14rem] text-slate-700 text-sm">
      <span>
        {open ? full : preview}
        {!open && long ? '…' : ''}
      </span>
      {long && (
        <button
          type="button"
          className="ml-1 text-orange-600 hover:underline text-xs font-semibold"
          onClick={() => setOpen(!open)}
        >
          {open ? 'Read less' : 'Read more'}
        </button>
      )}
    </div>
  );
}

/** Same locking rule as Laravel spare list + main CRM PO patch: pending/draft adjustable from grid. */
function statusRowEditable(status) {
  const s = String(status || '').toLowerCase();
  return s === 'pending' || s === 'draft' || s === '';
}

function formatPartLabel(line) {
  if (line.spare_part_name) return String(line.spare_part_name);
  if (line.part_name) return String(line.part_name);
  if (line.name) return String(line.name);
  if (line.part_id != null) return `Part #${line.part_id}`;
  return 'Part';
}

function formatBrandLabel(line) {
  if (line.brand_name) return String(line.brand_name);
  if (line.brand) return String(line.brand);
  if (line.brand_id != null) return `Brand #${line.brand_id}`;
  return '—';
}

export default function SparePartsPoPage() {
  const location = useLocation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [formPrefill, setFormPrefill] = useState(null);
  const [preview, setPreview] = useState({ open: false, loading: false, detail: null });
  const [billView, setBillView] = useState({ open: false, bill_name: '', files: [], spoId: null });
  const [billUpload, setBillUpload] = useState({ open: false, spo: null, bill_name: '' });

  const loadList = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await fetchSpareOrders({ page, limit: LIST_PAGE_SIZE, search });
      if (!data.success) throw new Error(data.message || 'Load failed');
      setRows(Array.isArray(data.data) ? data.data : []);
      const pag = data.pagination || {};
      setTotal(Number(pag.total) || 0);
      setTotalPages(Number(pag.totalPages) || 1);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed loading spare PO list');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // Open the form pre-filled when navigated here from the Parts Approval page.
  useEffect(() => {
    if (location.state?.openForm) {
      setFormPrefill(location.state.prefill || null);
      setModalOpen(true);
      window.history.replaceState({}, document.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applySearch(e) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  async function openPreview(spoId) {
    setPreview({ open: true, loading: true, detail: null });
    try {
      const { data } = await fetchSparePartsOrder(spoId);
      if (!data.success || !data.data) throw new Error(data.message || 'Not found');
      setPreview({ open: true, loading: false, detail: data.data });
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Could not load preview');
      setPreview({ open: false, loading: false, detail: null });
    }
  }

  function closePreview() {
    setPreview({ open: false, loading: false, detail: null });
  }

  async function onStatusChange(spo, next) {
    if (!next || next === spo.status) return;
    try {
      const { data } = await patchSparePartsOrderStatus(spo.spo_id, next);
      if (!data.success) throw new Error(data.message);
      toast.success(data.message || 'Status updated!');
      await loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Update failed');
      await loadList();
    }
  }

  function openBillUpload(spo) {
    setBillUpload({ open: true, spo, bill_name: spo.bill_name || '' });
  }

  async function submitBillUpload(e) {
    e.preventDefault();
    const { spo, bill_name } = billUpload;
    const input = document.getElementById('spo-bill-files-input');
    const files = input?.files;
    if (!spo) return;
    const name = bill_name.trim();
    if (!name) {
      toast.error('Bill number is required');
      return;
    }
    if (!files?.length) {
      toast.error('Select at least one file');
      return;
    }
    const fd = new FormData();
    fd.append('bill_name', name);
    for (let i = 0; i < files.length; i += 1) {
      fd.append('files', files[i]);
    }
    try {
      const { data } = await uploadSparePartsOrderBills(spo.spo_id, fd);
      if (!data.success) throw new Error(data.message);
      toast.success(data.message || 'Bill uploaded successfully');
      setBillUpload({ open: false, spo: null, bill_name: '' });
      if (input) input.value = '';
      await loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Upload failed');
    }
  }

  const previewLines = useMemo(() => parseLineItems(preview.detail), [preview.detail]);

  const previewGstFooter = useMemo(() => {
    const d = preview.detail;
    if (!d) return null;
    const sub = Number(d.sub_total_amount || 0);
    const same = !!d.is_same_state;
    if (!Number.isFinite(sub) || sub <= 0) return null;
    if (same) {
      const sgst = (sub * 9) / 100;
      const cgst = (sub * 9) / 100;
      const tot = sub + sgst + cgst;
      return { mode: 'intra', sub, sgst, cgst, tot };
    }
    const igst = (sub * 18) / 100;
    const tot = sub + igst;
    return { mode: 'inter', sub, igst, tot };
  }, [preview.detail]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Spare parts purchase orders</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormPrefill(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-600 text-white text-sm font-semibold shadow-sm hover:bg-orange-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Add spare parts PO
        </button>
      </header>

      <form onSubmit={applySearch} className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search PO #, remark, vendor…"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full max-w-md"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900"
        >
          Search
        </button>
        {search ? (
          <button
            type="button"
            className="text-sm text-slate-600 hover:text-slate-900 underline"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setPage(1);
            }}
          >
            Clear
          </button>
        ) : null}
      </form>

      {loading ? (
        <div className="p-8 rounded-lg border text-center text-slate-500 animate-pulse">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
              <tr>
                <th className="p-3">S No.</th>
                <th className="p-3">Purchase order details</th>
                <th className="p-3">Vendor name</th>
                <th className="p-3">Remark</th>
                <th className="p-3">Bill number</th>
                <th className="p-3">Upload / view</th>
                <th className="p-3">Status</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const editable = statusRowEditable(r.status);
                const st = String(r.status || '').toLowerCase();
                const vendorName =
                  r.vendor_display_name ||
                  r.vendor_business_name ||
                  r.vendor_first_name ||
                  `Vendor #${r.vendor_id}`;

                const showReceiveCue = st !== 'void' && st !== 'pending';

                return (
                  <tr key={r.spo_id} className="border-t hover:bg-slate-50/80">
                    <td className="p-3 text-slate-600">{(page - 1) * LIST_PAGE_SIZE + i + 1}</td>
                    <td className="p-3">
                      <button
                        type="button"
                        className="text-left text-orange-600 font-semibold hover:underline"
                        onClick={() => openPreview(r.spo_id)}
                      >
                        {r.purchase_order_number}
                      </button>
                      <p className="mt-1 text-xs text-slate-600">{r.purchase_order_date}</p>
                    </td>
                    <td className="p-3 text-slate-800">{vendorName}</td>
                    <td className="p-3">
                      <RemarkCell text={r.remarks} />
                    </td>
                    <td className="p-3">
                      {r.bill_name ? (
                        <button
                          type="button"
                          className="text-orange-600 font-medium hover:underline text-left"
                          onClick={() =>
                            setBillView({
                              open: true,
                              bill_name: r.bill_name,
                              files: parseBillFiles(r),
                              spoId: r.spo_id
                            })
                          }
                        >
                          {r.bill_name}
                        </button>
                      ) : (
                        <span className="text-slate-400">N/A</span>
                      )}
                    </td>
                    <td className="p-3">
                      {r.bill_name ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                          onClick={() =>
                            setBillView({
                              open: true,
                              bill_name: r.bill_name,
                              files: parseBillFiles(r),
                              spoId: r.spo_id
                            })
                          }
                        >
                          View bill
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-orange-500 text-orange-600 text-xs font-semibold hover:bg-orange-50"
                          onClick={() => openBillUpload(r)}
                        >
                          Upload bill
                        </button>
                      )}
                    </td>
                    <td className="p-3">
                      {editable ? (
                        <select
                          className="border border-slate-200 rounded-md px-2 py-1.5 text-sm bg-white max-w-[11rem]"
                          value={(() => {
                            const s = String(r.status || '').toLowerCase();
                            if (s === 'draft') return 'draft';
                            if (s === 'pending') return 'pending';
                            return '';
                          })()}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (!next || next === String(r.status || '').toLowerCase()) return;
                            if (next === 'draft') return;
                            onStatusChange(r, next);
                          }}
                        >
                          <option value="">Please take action</option>
                          {String(r.status || '').toLowerCase() === 'draft' ? (
                            <option value="draft">Draft</option>
                          ) : null}
                          <option value="pending">Pending</option>
                          <option value="approved">Approve</option>
                          <option value="completed" disabled>
                            Completed
                          </option>
                          <option value="processing" disabled>
                            Processing
                          </option>
                        </select>
                      ) : (
                        <span className="capitalize text-slate-800 font-medium">{r.status || '—'}</span>
                      )}
                    </td>
                    <td className="p-3">
                      {showReceiveCue ? (
                        <Link
                          to={`/vendor-management/spare-parts-po/${r.spo_id}/receive`}
                          className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-teal-600 text-teal-700 hover:bg-teal-50"
                          title="Receive spare parts (serials / GRN)"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                      ) : (
                        <button
                          type="button"
                          disabled
                          title="Receiving is unavailable while status is pending or void."
                          className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-slate-200 text-slate-300 cursor-not-allowed opacity-50"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No spare parts purchase orders match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <p>
            Page {page} of {totalPages}
            <span className="text-slate-400 mx-2">·</span>
            {total} total
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <SparePartsPoFormModal
        open={modalOpen}
        prefill={formPrefill}
        onClose={() => {
          setModalOpen(false);
          setFormPrefill(null);
        }}
        onSaved={() => {
          setFormPrefill(null);
          loadList();
        }}
      />

      {preview.open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePreview();
          }}
          role="presentation"
        >
          <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h3 className="font-bold text-slate-900">Spare PO preview</h3>
              <button type="button" className="text-sm text-slate-600 hover:text-slate-900" onClick={closePreview}>
                Close
              </button>
            </div>
            <div className="overflow-y-auto p-5 text-sm">
              {preview.loading ? (
                <div className="p-8 text-center text-slate-500 animate-pulse">Loading…</div>
              ) : preview.detail ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="font-semibold text-slate-900">{preview.detail.purchase_order_number}</p>
                    <p className="text-xs text-slate-600 mt-1">
                      {preview.detail.purchase_order_date}
                      <span className="mx-2">·</span>
                      {preview.detail.vendor_display_name || `Vendor #${preview.detail.vendor_id}`}
                    </p>
                    {preview.detail.remarks ? (
                      <p className="text-xs text-slate-700 mt-2 whitespace-pre-wrap">{preview.detail.remarks}</p>
                    ) : null}
                  </div>

                  <div className="overflow-x-auto rounded-lg border">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 text-left">
                        <tr>
                          <th className="p-2">#</th>
                          <th className="p-2">Brand</th>
                          <th className="p-2">Part</th>
                          <th className="p-2">Warranty (mo)</th>
                          <th className="p-2 text-right">Qty</th>
                          <th className="p-2 text-right">Rate</th>
                          <th className="p-2 text-right">Received</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewLines.map((ln, idx) => (
                          <tr key={`pv-${idx}`} className="border-t">
                            <td className="p-2">{idx + 1}</td>
                            <td className="p-2">{formatBrandLabel(ln)}</td>
                            <td className="p-2">{formatPartLabel(ln)}</td>
                            <td className="p-2">
                              {ln.warranty_months ?? ln.warranty ?? ln.warranty_in_month ?? '—'}
                            </td>
                            <td className="p-2 text-right">{ln.quantity}</td>
                            <td className="p-2 text-right">{Number(ln.rate).toFixed(2)}</td>
                            <td className="p-2 text-right">{Number(ln.receivedQty ?? 0) || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap justify-end gap-6 text-xs text-slate-700">
                    <div>
                      <span className="text-slate-500">Subtotal</span>
                      <p className="font-semibold">₹{Number(preview.detail.sub_total_amount || 0).toFixed(2)}</p>
                    </div>
                    {previewGstFooter?.mode === 'intra' ? (
                      <>
                        <div>
                          <span className="text-slate-500">SGST 9%</span>
                          <p className="font-semibold">₹{previewGstFooter.sgst.toFixed(2)}</p>
                        </div>
                        <div>
                          <span className="text-slate-500">CGST 9%</span>
                          <p className="font-semibold">₹{previewGstFooter.cgst.toFixed(2)}</p>
                        </div>
                      </>
                    ) : null}
                    {previewGstFooter?.mode === 'inter' ? (
                      <div>
                        <span className="text-slate-500">IGST 18%</span>
                        <p className="font-semibold">₹{previewGstFooter.igst.toFixed(2)}</p>
                      </div>
                    ) : null}
                    <div>
                      <span className="text-slate-500">Total</span>
                      <p className="font-bold text-slate-900">₹{Number(preview.detail.total_amount || 0).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {billView.open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBillView({ open: false, bill_name: '', files: [], spoId: null });
          }}
          role="presentation"
        >
          <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl p-5 space-y-3">
            <h3 className="font-bold text-slate-900">Bill #{billView.bill_name}</h3>
            <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
              {billView.files?.length ? (
                billView.files.map((href) => (
                  <li key={href}>
                    <a
                      href={filePublicUrl(href)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-600 font-medium hover:underline break-all text-sm"
                    >
                      {href.split('/').pop()}
                    </a>
                  </li>
                ))
              ) : (
                <li className="text-sm text-slate-500">No files on record.</li>
              )}
            </ul>
            <button
              type="button"
              className="w-full py-2 rounded-lg border border-slate-200 text-sm font-semibold"
              onClick={() => setBillView({ open: false, bill_name: '', files: [], spoId: null })}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {billUpload.open && billUpload.spo && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBillUpload({ open: false, spo: null, bill_name: '' });
          }}
          role="presentation"
        >
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 space-y-4">
            <h3 className="font-bold text-slate-900">Upload bill / invoice</h3>
            <p className="text-xs text-slate-600">PO {billUpload.spo.purchase_order_number}</p>
            <form onSubmit={submitBillUpload} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Bill number *</label>
                <input
                  required
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={billUpload.bill_name}
                  onChange={(e) => setBillUpload((b) => ({ ...b, bill_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Files *</label>
                <input
                  id="spo-bill-files-input"
                  type="file"
                  multiple
                  required
                  className="mt-1 w-full text-sm"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  className="flex-1 py-2 rounded-lg border border-slate-200 text-sm font-semibold"
                  onClick={() => setBillUpload({ open: false, spo: null, bill_name: '' })}
                >
                  Cancel
                </button>
                <button type="submit" className="flex-1 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold">
                  Upload
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
