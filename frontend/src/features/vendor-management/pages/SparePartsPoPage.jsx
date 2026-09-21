import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Eye, Plus, Trash2, X } from 'lucide-react';
import {
  fetchSpareOrders,
  fetchSparePartsOrder,
  patchSparePartsOrderStatus,
  uploadSparePartsOrderBills,
  deleteSparePartsOrderBillFile,
  removeSparePartsOrderBill,
} from '../vendorManagementApi';
import { useAuth } from '../../../context/AuthContext';
import SparePartsPoFormModal from '../components/SparePartsPoFormModal';
import SparePartsCatalogPanel from '../components/SparePartsCatalogPanel';
import {
  BillFilesTable,
  BillLightbox,
  PendingBillFileCard,
  filePublicUrl,
  hasBillOnRow,
  isImageBillFile,
  parseBillFiles,
} from '../components/BillFilesUi';

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

function formatModelLabel(line) {
  if (line.model_name) return String(line.model_name);
  if (line.model) return String(line.model);
  return '—';
}

const TABS = [
  { key: 'orders', label: 'Purchase Orders' },
  { key: 'catalog', label: 'Spare Parts Catalog' },
];

export default function SparePartsPoPage() {
  const location = useLocation();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin' || user?.is_superadmin === true;
  const [tab, setTab] = useState('orders');
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
  const [billView, setBillView] = useState({ open: false, bill_name: '', files: [], spoId: null, spo: null });
  const [billUpload, setBillUpload] = useState({ open: false, spo: null, bill_name: '' });
  const [pendingBillFiles, setPendingBillFiles] = useState([]);
  const [billRemovingIndex, setBillRemovingIndex] = useState(null);
  const [billRemovingAll, setBillRemovingAll] = useState(false);
  const [billLightbox, setBillLightbox] = useState({ open: false, items: [], index: 0 });

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

  // Live search: debounce the input into the server-side `search` term.
  useEffect(() => {
    const term = searchInput.trim();
    const id = setTimeout(() => {
      setSearch((prev) => {
        if (prev === term) return prev;
        setPage(1);
        return term;
      });
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Open the form pre-filled when navigated here from the Parts Approval page.
  useEffect(() => {
    if (location.state?.openForm) {
      setFormPrefill(location.state.prefill || null);
      setModalOpen(true);
      window.history.replaceState({}, document.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function closeBillUpload() {
    setBillUpload({ open: false, spo: null, bill_name: '' });
    setPendingBillFiles([]);
  }

  function openBillUpload(spo) {
    setPendingBillFiles([]);
    setBillUpload({ open: true, spo, bill_name: spo.bill_name || '' });
  }

  function openBillLightbox(files, startIndex = 0) {
    const items = (files || [])
      .filter((f) => isImageBillFile(f))
      .map((f) => ({ href: filePublicUrl(f), name: String(f).split('/').pop() }));
    if (!items.length) return;
    setBillLightbox({ open: true, items, index: Math.max(0, startIndex) });
  }

  async function submitBillUpload(e) {
    e.preventDefault();
    const { spo, bill_name } = billUpload;
    if (!spo) return;
    const name = bill_name.trim();
    if (!name) {
      toast.error('Bill number is required');
      return;
    }
    if (!pendingBillFiles.length) {
      toast.error('Select at least one file');
      return;
    }
    const fd = new FormData();
    fd.append('bill_name', name);
    pendingBillFiles.forEach((file) => fd.append('files', file));
    try {
      const { data } = await uploadSparePartsOrderBills(spo.spo_id, fd);
      if (!data.success) throw new Error(data.message);
      toast.success(data.message || 'Bill uploaded successfully');
      closeBillUpload();
      await loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Upload failed');
    }
  }

  async function handleRemoveBillFile(spoId, fileIndex) {
    if (!isSuperAdmin) return;
    if (!window.confirm('Remove this bill file?')) return;
    setBillRemovingIndex(fileIndex);
    try {
      const { data } = await deleteSparePartsOrderBillFile(spoId, fileIndex);
      if (!data.success) throw new Error(data.message);
      toast.success(data.message || 'Bill file removed');
      const nextFiles = data.bill_files || [];
      const nextName = data.bill_name || null;
      if (billView.open && billView.spoId === spoId) {
        if (!nextName && !nextFiles.length) {
          setBillView({ open: false, bill_name: '', files: [], spoId: null, spo: null });
        } else {
          setBillView((v) => ({
            ...v,
            bill_name: nextName || v.bill_name,
            files: nextFiles,
            spo: v.spo ? { ...v.spo, bill_name: nextName, bill_files: nextFiles } : v.spo,
          }));
        }
      }
      if (billUpload.open && billUpload.spo?.spo_id === spoId) {
        if (!nextName && !nextFiles.length) {
          closeBillUpload();
        } else {
          setBillUpload((b) => ({
            ...b,
            bill_name: nextName || b.bill_name,
            spo: { ...b.spo, bill_name: nextName, bill_files: nextFiles },
          }));
        }
      }
      await loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Remove failed');
    } finally {
      setBillRemovingIndex(null);
    }
  }

  async function handleRemoveEntireBill(spoId) {
    if (!isSuperAdmin) return;
    if (!window.confirm('Remove the entire bill (number + all files) from this SPO?')) return;
    setBillRemovingAll(true);
    try {
      const { data } = await removeSparePartsOrderBill(spoId);
      if (!data.success) throw new Error(data.message);
      toast.success(data.message || 'Bill removed');
      setBillView({ open: false, bill_name: '', files: [], spoId: null, spo: null });
      closeBillUpload();
      await loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Remove failed');
    } finally {
      setBillRemovingAll(false);
    }
  }

  const billUploadExistingFiles = billUpload.open && billUpload.spo ? parseBillFiles(billUpload.spo) : [];
  const billUploadHasExistingBill = billUpload.open && billUpload.spo && !!billUpload.spo.bill_name;

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
        {tab === 'orders' ? (
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
        ) : null}
      </header>

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
              tab === t.key
                ? 'border-orange-600 text-orange-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'catalog' ? <SparePartsCatalogPanel /> : null}

      {tab === 'orders' ? (
      <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search PO #, remark, vendor…"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full max-w-md"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        {searchInput ? (
          <button
            type="button"
            className="text-sm text-slate-600 hover:text-slate-900 underline"
            onClick={() => setSearchInput('')}
          >
            Clear
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="p-8 rounded-lg border text-center text-slate-500 animate-pulse">Loading…</div>
      ) : (
        <>
        {/* Mobile cards */}
        <div className="grid gap-3 md:hidden">
          {rows.length === 0 ? (
            <div className="p-8 rounded-lg border bg-white text-center text-slate-500">
              No spare parts purchase orders match your filters.
            </div>
          ) : rows.map((r) => {
            const editable = statusRowEditable(r.status);
            const st = String(r.status || '').toLowerCase();
            const vendorName =
              r.vendor_display_name || r.vendor_business_name || r.vendor_first_name || `Vendor #${r.vendor_id}`;
            const showReceiveCue = st !== 'void' && st !== 'pending';
            return (
              <div key={r.spo_id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="text-left text-orange-600 font-bold hover:underline"
                    onClick={() => openPreview(r.spo_id)}
                  >
                    {r.purchase_order_number}
                  </button>
                  {!editable && <span className="text-xs font-semibold capitalize text-slate-700">{r.status || '—'}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>{r.purchase_order_date}</span>
                  <span className="text-slate-800 font-medium">{vendorName}</span>
                </div>
                {r.remarks ? <div className="text-xs text-slate-600"><RemarkCell text={r.remarks} /></div> : null}

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {hasBillOnRow(r) ? (
                    <>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-slate-50 font-semibold text-slate-800"
                        onClick={() =>
                          setBillView({
                            open: true,
                            bill_name: r.bill_name,
                            files: parseBillFiles(r),
                            spoId: r.spo_id,
                            spo: r,
                          })
                        }
                      >
                        View bill
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-orange-500 text-orange-600 font-semibold"
                        onClick={() => openBillUpload(r)}
                      >
                        Add files
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-orange-500 text-orange-600 font-semibold"
                      onClick={() => openBillUpload(r)}
                    >
                      Upload bill
                    </button>
                  )}
                  {showReceiveCue ? (
                    <Link
                      to={`/vendor-management/spare-parts-po/${r.spo_id}/receive`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-teal-600 text-teal-700 font-semibold hover:bg-teal-50"
                    >
                      <Eye className="w-4 h-4" /> Receive
                    </Link>
                  ) : null}
                </div>

                {editable ? (
                  <div className="pt-2 border-t border-slate-100">
                    <select
                      className="w-full border border-slate-200 rounded-md px-2 py-2 text-sm bg-white"
                      value={st === 'draft' ? 'draft' : st === 'pending' ? 'pending' : ''}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (!next || next === st || next === 'draft') return;
                        onStatusChange(r, next);
                      }}
                    >
                      <option value="">Please take action</option>
                      {st === 'draft' ? <option value="draft">Draft</option> : null}
                      <option value="pending">Pending</option>
                      <option value="approved">Approve</option>
                    </select>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="hidden md:block overflow-x-auto rounded-lg border bg-white shadow-sm">
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
                              spoId: r.spo_id,
                              spo: r,
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
                      {hasBillOnRow(r) ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                            onClick={() =>
                              setBillView({
                                open: true,
                                bill_name: r.bill_name,
                                files: parseBillFiles(r),
                                spoId: r.spo_id,
                                spo: r,
                              })
                            }
                          >
                            View bill
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-orange-500 text-orange-600 text-xs font-semibold hover:bg-orange-50"
                            onClick={() => openBillUpload(r)}
                          >
                            Add files
                          </button>
                        </div>
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
        </>
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
      </>
      ) : null}

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
                          <th className="p-2">Model</th>
                          <th className="p-2">Part</th>
                          <th className="p-2">Type</th>
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
                            <td className="p-2">{formatModelLabel(ln)}</td>
                            <td className="p-2">{formatPartLabel(ln)}</td>
                            <td className="p-2">{ln.part_type || '—'}</td>
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
          className="fixed inset-0 z-[102] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setBillView({ open: false, bill_name: '', files: [], spoId: null, spo: null });
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-2">
              <div>
                <h3 className="font-bold text-slate-900">Bill #{billView.bill_name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {billView.files.length} file{billView.files.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {billView.spo ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-orange-500 text-orange-600 text-xs font-semibold hover:bg-orange-50"
                    onClick={() => {
                      setBillView((v) => ({ ...v, open: false }));
                      openBillUpload(billView.spo);
                    }}
                  >
                    Add files
                  </button>
                ) : null}
                {isSuperAdmin && billView.spoId ? (
                  <button
                    type="button"
                    disabled={billRemovingAll}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
                    onClick={() => handleRemoveEntireBill(billView.spoId)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {billRemovingAll ? 'Removing…' : 'Remove bill'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="p-1 rounded hover:bg-slate-100"
                  aria-label="Close"
                  onClick={() => setBillView({ open: false, bill_name: '', files: [], spoId: null, spo: null })}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="mt-4">
              <BillFilesTable
                billName={null}
                files={billView.files}
                canRemove={isSuperAdmin && !!billView.spoId}
                removingIndex={billRemovingIndex}
                onPreviewImage={openBillLightbox}
                onRemoveFile={(idx) => handleRemoveBillFile(billView.spoId, idx)}
              />
            </div>
          </div>
        </div>
      )}

      {billUpload.open && billUpload.spo && (
        <div
          className="fixed inset-0 z-[102] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeBillUpload();
          }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-900">
              {hasBillOnRow(billUpload.spo) ? 'Add bill files' : 'Upload bill / invoice'}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              PO {billUpload.spo.purchase_order_number} — images and PDFs, multiple allowed
            </p>
            {billUploadExistingFiles.length > 0 ? (
              <div className="mt-3">
                <p className="text-xs font-semibold text-slate-600 mb-2">Already uploaded</p>
                <BillFilesTable
                  billName={billUpload.spo.bill_name}
                  files={billUploadExistingFiles}
                  compact
                  canRemove={isSuperAdmin}
                  removingIndex={billRemovingIndex}
                  onPreviewImage={openBillLightbox}
                  onRemoveFile={(idx) => handleRemoveBillFile(billUpload.spo.spo_id, idx)}
                />
                {isSuperAdmin ? (
                  <button
                    type="button"
                    disabled={billRemovingAll}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                    onClick={() => handleRemoveEntireBill(billUpload.spo.spo_id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {billRemovingAll ? 'Removing bill…' : 'Remove entire bill'}
                  </button>
                ) : null}
              </div>
            ) : null}
            <form onSubmit={submitBillUpload} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Bill number</label>
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-600"
                  value={billUpload.bill_name}
                  onChange={(e) => setBillUpload((b) => ({ ...b, bill_name: e.target.value }))}
                  required
                  readOnly={billUploadHasExistingBill}
                  title={billUploadHasExistingBill ? 'Bill number is fixed for this PO. Remove the bill to change it.' : undefined}
                />
                {billUploadHasExistingBill ? (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Bill number is locked while files exist. Super admin can remove the bill to change it.
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Bill numbers must be unique across all POs, GRNs, and spare POs.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Add files (multiple images or PDF)</label>
                <input
                  id="spo-bill-files-input"
                  type="file"
                  multiple
                  accept="image/*,.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp"
                  className="mt-1 w-full text-sm"
                  onChange={(e) => {
                    const extra = Array.from(e.target.files || []);
                    if (extra.length) setPendingBillFiles((prev) => [...prev, ...extra]);
                    e.target.value = '';
                  }}
                />
              </div>
              {pendingBillFiles.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {pendingBillFiles.map((file, idx) => (
                    <PendingBillFileCard
                      key={`${file.name}-${file.size}-${idx}`}
                      file={file}
                      onRemove={() => setPendingBillFiles((prev) => prev.filter((_, i) => i !== idx))}
                      onPreview={(url, name) => setBillLightbox({ open: true, items: [{ href: url, name }], index: 0 })}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Select one or more images to preview them here before upload.</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={closeBillUpload}>
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold">
                  Upload
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <BillLightbox
        open={billLightbox.open}
        items={billLightbox.items}
        index={billLightbox.index}
        onClose={() => setBillLightbox({ open: false, items: [], index: 0 })}
        onIndexChange={(next) => setBillLightbox((lb) => ({ ...lb, index: next }))}
      />
    </div>
  );
}
