import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Home,
  Layers,
  Loader2,
  Mail,
  Package,
  Phone,
  Upload,
  UserCircle,
  X
} from 'lucide-react';
import { fetchGeneratedGrnOverview, fetchGrnReceivedProducts, uploadGrnBill } from '../vendorManagementApi';

function formatPoType(t) {
  if (!t) return '—';
  return String(t)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateTime(po) {
  const raw = po?.updated_at ?? po?.purchase_order_date;
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 19);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatRowDate(raw) {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString();
}

export default function GeneratedGrnDetailPage() {
  const { poId } = useParams();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [modalGrnId, setModalGrnId] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalPayload, setModalPayload] = useState(null);
  const [uploadModal, setUploadModal] = useState({ open: false, grnId: null, grnNumber: '' });
  const [uploadBillName, setUploadBillName] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await fetchGeneratedGrnOverview(poId);
      if (res.success) setData(res.data);
      else toast.error(res.message || 'Failed to load');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load GRN overview');
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    load();
  }, [load]);

  function openUploadBill(row) {
    setUploadModal({ open: true, grnId: row.grn_id, grnNumber: row.grn_number || `GRN-${row.grn_id}` });
    setUploadBillName('');
  }

  async function submitBillUpload(e) {
    e.preventDefault();
    const { grnId } = uploadModal;
    const input = document.getElementById('grn-bill-file-input');
    const file = input?.files?.[0];
    const name = uploadBillName.trim();
    if (!name) {
      toast.error('Bill number is required');
      return;
    }
    const fd = new FormData();
    fd.append('bill_name', name);
    if (file) fd.append('files', file);
    setUploadBusy(true);
    try {
      const { data } = await uploadGrnBill(poId, grnId, fd);
      if (!data.success) throw new Error(data.message);
      toast.success(data.message || 'Bill uploaded');
      setUploadModal({ open: false, grnId: null, grnNumber: '' });
      if (input) input.value = '';
      await load();
      if (modalGrnId === grnId) await openGrnModal(grnId);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Upload failed');
    } finally {
      setUploadBusy(false);
    }
  }

  async function openGrnModal(grnId) {
    setModalGrnId(grnId);
    setModalPayload(null);
    setModalLoading(true);
    try {
      const { data: res } = await fetchGrnReceivedProducts(poId, grnId);
      if (res.success) setModalPayload(res.data);
      else {
        toast.error(res.message || 'No data');
        setModalGrnId(null);
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load GRN lines');
      setModalGrnId(null);
    } finally {
      setModalLoading(false);
    }
  }

  useEffect(() => {
    if (modalGrnId == null) return undefined;
    function onKey(e) {
      if (e.key === 'Escape' && !modalLoading) setModalGrnId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalGrnId, modalLoading]);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-slate-600 text-sm py-12">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading generated GRN…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-sm text-slate-600 py-8">
        <Link to="/vendor-management/purchase-orders" className="text-teal-700 font-medium">
          ← Purchase orders
        </Link>
        <p className="mt-4">Nothing to show.</p>
      </div>
    );
  }

  const po = data.purchase_order;
  const stats = data.stats || {};
  const grnRows = data.grn_rows || [];
  const vendorTitle = po?.vendor_business_name || po?.vendor_display_name || po?.vendor_first_name || 'Vendor';
  const rows = grnRows.length;

  return (
    <div className="space-y-6 min-w-0">
      <Link
        to="/vendor-management/purchase-orders"
        className="inline-flex items-center gap-2 text-sm font-medium text-teal-800 hover:text-teal-950"
      >
        <ArrowLeft className="w-4 h-4" />
        Purchase orders
      </Link>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <UserCircle className="w-7 h-7 text-teal-600 shrink-0" />
            <div>
              <h1 className="text-lg sm:text-xl font-semibold text-slate-900 capitalize tracking-tight">
                Generated GRN
              </h1>
              <p className="text-xs text-slate-500">Laravel «view_purchase_order_detail» — grouped GRNs for this PO.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/vendor-management/purchase-orders/${poId}/receive`}
              className="inline-flex items-center gap-2 rounded-md border border-teal-600 text-teal-700 hover:bg-teal-50 text-sm font-semibold px-4 py-2"
            >
              Product received
            </Link>
            <Link
              to="/vendor-management/purchase-orders"
              className="inline-flex items-center gap-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 shadow-sm"
            >
              View PO
            </Link>
          </div>
        </div>

        {po ? (
          <div className="px-4 sm:px-6 pb-6 space-y-4">
            <div className="rounded-lg border border-sky-200/80 bg-gradient-to-br from-sky-50/80 to-white p-4 sm:p-5">
              <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                <div className="shrink-0">
                  <span className="inline-block rounded bg-teal-600 text-white font-semibold text-sm px-4 py-2.5 shadow-sm capitalize">
                    {vendorTitle}
                  </span>
                </div>
                <div className="flex-1 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-slate-800">
                  <p className="flex items-start gap-2 m-0">
                    <Building2 className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
                    <span className="font-semibold">{po.vendor_business_name || po.vendor_display_name || '—'}</span>
                  </p>
                  {po.vendor_phone ? (
                    <p className="flex items-center gap-2 m-0">
                      <Phone className="w-4 h-4 text-teal-600 shrink-0" />
                      {po.vendor_phone}
                    </p>
                  ) : null}
                  {po.vendor_email ? (
                    <p className="flex items-start gap-2 m-0 sm:col-span-2 break-all">
                      <Mail className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
                      {po.vendor_email}
                    </p>
                  ) : null}
                  {po.vendor_address ? (
                    <p className="flex items-start gap-2 m-0 sm:col-span-2 text-slate-700">
                      <Home className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
                      {po.vendor_address}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-rose-200/90 overflow-hidden bg-white shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-stretch sm:justify-between gap-2 sm:gap-0 bg-gradient-to-r from-rose-100 via-rose-50 to-rose-100/90 border-b border-rose-100 px-3 py-3 sm:px-4">
                <div className="flex items-center">
                  <span className="rounded-md bg-white/95 border border-rose-100 px-4 py-2 text-sm font-bold text-slate-900 shadow-sm">
                    {po.purchase_order_number || `PO-${po.po_id}`}
                  </span>
                </div>
                <div className="flex items-center justify-center">
                  <span className="inline-flex rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 px-4 py-1.5 text-xs sm:text-sm font-semibold capitalize">
                    {formatPoType(po.purchase_order_type)}
                  </span>
                </div>
                <div className="flex items-center justify-end">
                  <span className="rounded-md bg-white/95 border border-rose-100 px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 tabular-nums shadow-sm">
                    {formatDateTime(po)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-white">
                <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-3 flex items-center gap-3">
                  <Layers className="w-8 h-8 text-sky-500 shrink-0" />
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Total Product</p>
                    <p className="text-xl font-bold text-sky-600 tabular-nums leading-tight">{stats.total_lines}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-3 flex items-center gap-3">
                  <Package className="w-8 h-8 text-sky-500 shrink-0" />
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Order Quantity</p>
                    <p className="text-xl font-bold text-sky-600 tabular-nums leading-tight">{stats.order_qty}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-3 flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Received Quantity</p>
                    <p className="text-xl font-bold text-emerald-600 tabular-nums leading-tight">{stats.received_qty}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-3 flex items-center gap-3">
                  <Clock className="w-8 h-8 text-rose-500 shrink-0" />
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Remaining Quantity</p>
                    <p className="text-xl font-bold text-rose-600 tabular-nums leading-tight">{stats.remaining_qty}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 pt-4 pb-2">
                <h2 className="text-base font-bold text-slate-900 tracking-tight">Generated GRN details</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 text-xs uppercase tracking-wide border-b border-slate-200">
                      <th className="text-left px-4 py-3 font-semibold">SL</th>
                      <th className="text-left px-4 py-3 font-semibold">GRN number</th>
                      <th className="text-left px-4 py-3 font-semibold">Date</th>
                      <th className="text-left px-4 py-3 font-semibold">Received product</th>
                      <th className="text-left px-4 py-3 font-semibold">Bill</th>
                      <th className="text-left px-4 py-3 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {grnRows.map((row, idx) => (
                      <tr key={row.grn_id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3 tabular-nums text-slate-600">{idx + 1}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{row.grn_number || `GRN-${row.grn_id}`}</td>
                        <td className="px-4 py-3 text-slate-700 tabular-nums text-xs">{formatRowDate(row.created_at)}</td>
                        <td className="px-4 py-3 tabular-nums font-semibold text-slate-900">{row.received_qty}</td>
                        <td className="px-4 py-3">
                          {String(row.bill_status || '').toLowerCase() === 'received' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                              <Check className="w-3.5 h-3.5" />
                              {row.bill_name || 'Bill Received'}
                            </span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                BILL PENDING
                              </span>
                              <button
                                type="button"
                                onClick={() => openUploadBill(row)}
                                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600"
                              >
                                <Upload className="w-3.5 h-3.5" />
                                Upload Bill
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            title="View received product info"
                            onClick={() => openGrnModal(row.grn_id)}
                            className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-teal-500 text-teal-700 hover:bg-teal-50"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows > 0 ? (
                <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-600 bg-slate-50/40">
                  Showing {rows} {rows === 1 ? 'entry' : 'entries'}
                </div>
              ) : (
                <div className="px-4 py-8 text-center text-slate-500 text-sm">No GRNs recorded for this PO yet.</div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {modalGrnId != null ? (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (modalLoading || e.target !== e.currentTarget) return;
            setModalGrnId(null);
          }}
        >
          <div
            className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50 z-10">
              <h2 className="text-base font-semibold text-slate-900">
                View received product info
                {modalPayload?.grn_number ? (
                  <span className="text-slate-500 font-normal"> · {modalPayload.grn_number}</span>
                ) : null}
              </h2>
              <button
                type="button"
                disabled={modalLoading}
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                onClick={() => setModalGrnId(null)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              {modalLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-600 py-12 justify-center">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Loading…
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {(modalPayload?.items || []).map((item) => {
                    const config = [item.processor, item.generation, item.ram, item.storage, item.gpu]
                      .filter(Boolean)
                      .join(' · ');
                    const ttspl = item.unique_product_serial || item.inventory_asset_code || item.ttspl_id;
                    const condition = item.condition || item.device_condition || 'Good';
                    const qcStatus =
                      item.qc_status ||
                      (item.qc_passed === true
                        ? 'QC Passed'
                        : item.qc_passed === false
                          ? 'QC Failed'
                          : 'Pending QC');

                    return (
                      <div
                        key={item.serial_id}
                        className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          {ttspl ? (
                            <span className="font-mono text-sm font-bold text-blue-600">{ttspl}</span>
                          ) : (
                            <span className="font-mono text-sm text-gray-400">No TTSPL</span>
                          )}
                          <div className="flex flex-wrap gap-1">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                              {condition}
                            </span>
                            <span
                              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                qcStatus === 'QC Passed'
                                  ? 'bg-green-50 text-green-700'
                                  : qcStatus === 'QC Failed'
                                    ? 'bg-red-50 text-red-700'
                                    : 'bg-amber-50 text-amber-800'
                              }`}
                            >
                              {qcStatus}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm font-semibold text-gray-900">
                          {[item.brand, item.model].filter(Boolean).join(' ') || 'Laptop'}
                        </p>
                        <p className="text-xs text-gray-600 mt-1 leading-relaxed">{config || '—'}</p>
                        <p className="text-xs font-mono text-gray-500 mt-2">S/N: {item.serial_number || '—'}</p>
                        {item.physical_damage_remark ? (
                          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2 mt-2 leading-relaxed">
                            <span className="font-semibold">Physical damage:</span> {item.physical_damage_remark}
                          </p>
                        ) : null}
                        {item.is_replaced || item.is_repaired ? (
                          <div className="flex gap-1 mt-2">
                            {item.is_replaced ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-50 text-pink-700">Replaced</span>
                            ) : null}
                            {item.is_repaired ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Repaired</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {modalPayload?.items?.length === 0 ? (
                    <p className="col-span-full text-center text-slate-500 text-sm py-8">No serials on this GRN.</p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {uploadModal.open ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-100">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-gray-900">Upload Bill</h3>
                <p className="text-xs text-gray-500 mt-1">{uploadModal.grnNumber}</p>
              </div>
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-gray-100"
                onClick={() => !uploadBusy && setUploadModal({ open: false, grnId: null, grnNumber: '' })}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitBillUpload} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Bill number *</label>
                <input
                  required
                  className="mt-1 w-full h-9 px-3 border border-gray-200 rounded-lg text-sm"
                  value={uploadBillName}
                  onChange={(e) => setUploadBillName(e.target.value)}
                  placeholder="Invoice / bill number"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Bill file</label>
                <input
                  id="grn-bill-file-input"
                  type="file"
                  accept=".pdf,image/*"
                  className="mt-1 w-full text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={uploadBusy}
                  className="h-9 px-4 rounded-lg border border-gray-200 text-sm"
                  onClick={() => setUploadModal({ open: false, grnId: null, grnNumber: '' })}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadBusy}
                  className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
                >
                  {uploadBusy ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
