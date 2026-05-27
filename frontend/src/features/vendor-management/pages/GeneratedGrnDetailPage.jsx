import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  Eye,
  Home,
  Layers,
  Loader2,
  Mail,
  Package,
  Phone,
  UserCircle,
  X
} from 'lucide-react';
import { fetchGeneratedGrnOverview, fetchGrnReceivedProducts } from '../vendorManagementApi';

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
                    const title = [item.brand, item.model].filter(Boolean).join(' - ') || 'Product';
                    return (
                      <div
                        key={item.serial_id}
                        className="rounded-xl border border-slate-200 bg-white p-4 shadow-md hover:shadow-lg transition-shadow"
                      >
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <h3 className="text-sm font-bold text-slate-900 leading-snug">{title}</h3>
                          <span className="shrink-0 flex flex-wrap gap-1 justify-end">
                            {item.is_replaced ? (
                              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border border-pink-500 text-pink-600 bg-pink-50">
                                Replaced
                              </span>
                            ) : null}
                            {item.is_repaired ? (
                              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border border-emerald-600 text-emerald-700 bg-emerald-50">
                                Repaired
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 mb-3 leading-relaxed">
                          {[item.processor, item.generation ? `(${item.generation})` : null].filter(Boolean).join(' ')}
                          {item.ram || item.storage ? (
                            <>
                              {' '}
                              | {item.ram} | {item.storage}
                            </>
                          ) : null}
                          <br />
                          {[item.gpu, item.screen_size ? `${item.screen_size} display` : null].filter(Boolean).join(' | ')}
                        </p>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="rounded-md bg-slate-800 text-white px-2.5 py-1 font-mono">{item.serial_number}</span>
                          {item.unique_product_serial ? (
                            <span className="rounded-md bg-slate-100 text-slate-800 px-2.5 py-1 font-mono border border-slate-200">
                              {item.unique_product_serial}
                            </span>
                          ) : null}
                        </div>
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
    </div>
  );
}
