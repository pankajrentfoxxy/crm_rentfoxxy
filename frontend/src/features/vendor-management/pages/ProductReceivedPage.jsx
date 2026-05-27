import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
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
  Plus,
  UserCircle,
  X
} from 'lucide-react';
import { fetchProductReceivedContext, receivePoLineBulk } from '../vendorManagementApi';

function formatPoType(t) {
  if (!t) return '—';
  return String(t)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statsFromLines(lines) {
  let order_qty = 0;
  let received_qty = 0;
  if (!Array.isArray(lines)) {
    return { total_lines: 0, order_qty: 0, received_qty: 0, remaining_qty: 0 };
  }
  lines.forEach((l) => {
    order_qty += Number(l.quantity) || 0;
    received_qty += Number(l.receivedQty) || 0;
  });
  return {
    total_lines: lines.length,
    order_qty,
    received_qty,
    remaining_qty: Math.max(0, order_qty - received_qty)
  };
}

function normalizeDateInput(d) {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

function formatDateTime(po) {
  const raw = po?.updated_at || po?.purchase_order_date;
  if (!raw) return '—';
  const d = normalizeDateInput(raw);
  if (!d) return String(raw).slice(0, 19);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Title + spec line — mirrors blade card (brand - model | screen, then pipe-separated specs). */
function ItemDescriptionCard({ line }) {
  const brand = line.brand ?? line.brand_name ?? '';
  const model = line.model ?? '';
  const screen = line.screen_size ?? '';
  const titleLeft = [brand, model].filter(Boolean).join(' - ');
  const title =
    titleLeft && screen ? `${titleLeft} | ${screen}` : titleLeft || screen || 'Item';

  const specs = [line.processor, line.generation, line.ram, line.storage, line.gpu]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x).trim());

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/90 shadow-sm px-3 py-2.5 text-left max-w-md">
      <h3 className="text-sm font-semibold text-slate-900 leading-snug">{title}</h3>
      {specs.length > 0 ? (
        <p className="text-xs text-slate-600 mt-1 mb-0 leading-relaxed">{specs.join(' | ')}</p>
      ) : null}
    </div>
  );
}

/** Blade: warranty (months) for direct_purchase else vendor locking (months); expiry ≈ start + months×30 days. */
function PeriodBadge({ line, purchaseOrder }) {
  const poType = String(purchaseOrder?.purchase_order_type || '').toLowerCase();
  const isDirect = poType === 'direct_purchase';
  const periodMonths = Number(isDirect ? line.warranty : line.vendor_locking_period) || 0;

  const start =
    normalizeDateInput(line.created_at) ||
    normalizeDateInput(line.product_created_at) ||
    normalizeDateInput(purchaseOrder?.purchase_order_date) ||
    new Date();

  if (!periodMonths || periodMonths <= 0) {
    return <span className="text-sm text-slate-400 tabular-nums">—</span>;
  }

  const expiry = new Date(start);
  expiry.setDate(expiry.getDate() + Math.round(periodMonths * 30));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry);
  exp.setHours(0, 0, 0, 0);
  const remainingDays = Math.round((exp.getTime() - today.getTime()) / 86400000);

  if (remainingDays > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 px-3 py-1 text-xs font-semibold whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        {remainingDays} Days Left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-800 px-3 py-1 text-xs font-semibold whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 shrink-0" />
      Expired
    </span>
  );
}

function periodColumnLabel(purchaseOrder) {
  const poType = String(purchaseOrder?.purchase_order_type || '').toLowerCase();
  return poType === 'direct_purchase' ? (
    <>
      Warranty
      <br />
      Period
    </>
  ) : (
    <>
      Locking
      <br />
      Period
    </>
  );
}

export default function ProductReceivedPage() {
  const { poId } = useParams();
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [receiveLineIndex, setReceiveLineIndex] = useState(null);
  /** 'meta' = date + quantity; 'serials' = one input per unit */
  const [receiveStep, setReceiveStep] = useState('meta');
  const [rentalStartDate, setRentalStartDate] = useState('');
  const [bulkQtyStr, setBulkQtyStr] = useState('');
  const [bulkSerials, setBulkSerials] = useState([]);
  const [modalBusy, setModalBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(null);
    try {
      const { data } = await fetchProductReceivedContext(poId);
      if (data.success) {
        setCtx(data.data);
      } else {
        toast.error(data.message || 'Failed to load');
      }
    } catch (e) {
      const st = e.response?.status;
      const msg = e.response?.data?.message;
      if (st === 403) setForbidden(msg || 'Receiving is not allowed for this purchase order.');
      else if (st === 404) setForbidden(msg || 'Purchase order not found.');
      else toast.error(msg || 'Failed to load purchase order');
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    load();
  }, [load]);

  function resetReceiveWizardUi() {
    setReceiveLineIndex(null);
    setReceiveStep('meta');
    setRentalStartDate('');
    setBulkQtyStr('');
    setBulkSerials([]);
  }

  useEffect(() => {
    if (receiveLineIndex === null) return undefined;
    function onKey(e) {
      if (e.key === 'Escape' && !modalBusy) resetReceiveWizardUi();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [receiveLineIndex, modalBusy]);

  const po = ctx?.purchase_order;
  const lines = ctx?.lines || [];
  const stats = ctx?.stats || statsFromLines(lines);
  const n = lines.length;
  function remainingOnLine(idx) {
    const line = lines[idx];
    if (!line) return 0;
    const ordered = Number(line.quantity) || 0;
    const got = Number(line.receivedQty) || 0;
    return Math.max(0, ordered - got);
  }

  function openReceiveWizard(lineIndex) {
    setReceiveLineIndex(lineIndex);
    setReceiveStep('meta');
    setRentalStartDate(new Date().toISOString().slice(0, 10));
    setBulkQtyStr('');
    setBulkSerials([]);
  }

  function gotoSerialInputs() {
    if (receiveLineIndex === null) return;
    const rem = remainingOnLine(receiveLineIndex);
    if (!rentalStartDate || !rentalStartDate.trim()) {
      toast.error('Rental start date is required');
      return;
    }
    const q = parseInt(String(bulkQtyStr).trim(), 10);
    if (!Number.isFinite(q) || q < 1) {
      toast.error('Quantity must be at least 1');
      return;
    }
    if (q > rem) {
      toast.error(`You can receive at most ${rem} unit(s) on this line`);
      return;
    }
    if (q > 250) {
      toast.error('Maximum 250 units per submission');
      return;
    }
    setBulkSerials(Array.from({ length: q }, () => ''));
    setReceiveStep('serials');
  }

  function updateBulkSerialAt(i, value) {
    setBulkSerials((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  }

  async function submitBulkReceive() {
    if (receiveLineIndex === null) return;
    const q = bulkSerials.length;
    const trimmed = bulkSerials.map((s) => String(s ?? '').trim().toUpperCase());
    const emptyIdx = trimmed.findIndex((s) => !s);
    if (emptyIdx >= 0) {
      toast.error(`Enter serial number for row ${emptyIdx + 1}`);
      return;
    }
    const uniq = new Set(trimmed);
    if (uniq.size !== trimmed.length) {
      toast.error('Serial numbers must be unique within this batch');
      return;
    }

    setModalBusy(true);
    try {
      const body = {
        line_index: receiveLineIndex,
        rental_start_date: rentalStartDate.trim(),
        quantity: q,
        serial_numbers: trimmed
      };
      const { data } = await receivePoLineBulk(poId, body);
      if (data.success) {
        const created = data.data?.created || [];
        const example = created[0]?.inventory_asset_code;
        toast.success(
          data.message ||
            (example ? `Received ${created.length} unit(s). Codes include ${example}…` : 'Units received')
        );
        resetReceiveWizardUi();
        await load();
      }
    } catch (e) {
      const msg =
        e.response?.data?.message ||
        (e.response?.data?.errors?.[0]?.msg ? String(e.response.data.errors[0].msg) : null);
      toast.error(msg || 'Failed to save serials');
    } finally {
      setModalBusy(false);
    }
  }

  const viewGrnHref = `/vendor-management/purchase-orders/${encodeURIComponent(poId || '')}/grn-detail`;

  if (loading && !ctx) {
    return (
      <div className="flex items-center gap-2 text-slate-600 text-sm py-12">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading purchase order items…
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="max-w-xl space-y-4">
        <Link
          to="/vendor-management/purchase-orders"
          className="inline-flex items-center gap-2 text-sm font-medium text-orange-700 hover:text-orange-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to purchase orders
        </Link>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">{forbidden}</div>
      </div>
    );
  }

  const vendorTitle = po?.vendor_business_name || po?.vendor_display_name || po?.vendor_first_name || 'Vendor';

  return (
    <div className="space-y-6 min-w-0">
      <Link
        to="/vendor-management/purchase-orders"
        className="inline-flex items-center gap-2 text-sm font-medium text-teal-800 hover:text-teal-950"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to purchase orders
      </Link>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Title row — Laravel “Purchase Order list Items” */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-2">
            <UserCircle className="w-7 h-7 text-teal-600 shrink-0" />
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900 capitalize tracking-tight">
              Purchase Order list Items
            </h1>
          </div>
          <Link
            to={viewGrnHref}
            className="inline-flex items-center gap-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 shadow-sm transition-colors"
          >
            <Eye className="w-4 h-4" />
            View GRN
          </Link>
        </div>

        {po ? (
          <div className="px-4 sm:px-6 pb-6 space-y-4">
            {/* Vendor strip */}
            <div className="rounded-lg border border-sky-200/80 bg-gradient-to-br from-sky-50/80 to-white p-4 sm:p-5">
              <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                <div className="shrink-0">
                  <span className="inline-block rounded bg-teal-600 text-white font-semibold text-sm px-4 py-2.5 shadow-sm">
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

            {/* PO summary — pink/red bar + metrics */}
            <div className="rounded-lg border border-rose-200/90 overflow-hidden bg-white shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-stretch sm:justify-between gap-2 sm:gap-0 bg-gradient-to-r from-rose-100 via-rose-50 to-rose-100/90 border-b border-rose-100 px-3 py-3 sm:px-4">
                <div className="flex items-center">
                  <span className="rounded-md bg-white/95 border border-rose-100 px-4 py-2 text-sm font-bold text-slate-900 shadow-sm">
                    {po.purchase_order_number || `PO-${po.po_id}`}
                  </span>
                </div>
                <div className="flex items-center justify-center">
                  <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 px-4 py-1.5 text-xs sm:text-sm font-semibold capitalize">
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
            {/* Items table */}
            <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead>
                    <tr className="bg-slate-600 text-white text-left text-xs capitalize tracking-wide">
                      <th className="px-3 py-3 font-semibold whitespace-nowrap align-bottom">
                        <span className="inline-flex items-center gap-1">
                          S No. <ArrowUpDown className="w-3 h-3 opacity-70" aria-hidden />
                        </span>
                      </th>
                      <th className="px-3 py-3 font-semibold align-bottom">
                        <span className="inline-flex items-center gap-1">
                          Items Descriptions <ArrowUpDown className="w-3 h-3 opacity-70" aria-hidden />
                        </span>
                      </th>
                      <th className="px-3 py-3 font-semibold align-bottom leading-snug">{periodColumnLabel(po)}</th>
                      <th className="px-3 py-3 font-semibold tabular-nums align-bottom leading-snug">
                        <div className="inline-flex flex-col items-start gap-0">
                          <span className="inline-flex items-center gap-1">
                            ordered <ArrowUpDown className="w-3 h-3 opacity-70" aria-hidden />
                          </span>
                          <span>Qty</span>
                        </div>
                      </th>
                      <th className="px-3 py-3 font-semibold tabular-nums align-bottom leading-snug">
                        <div className="inline-flex flex-col items-start gap-0">
                          <span className="inline-flex items-center gap-1">
                            received <ArrowUpDown className="w-3 h-3 opacity-70" aria-hidden />
                          </span>
                          <span>Qty</span>
                        </div>
                      </th>
                      <th className="px-3 py-3 font-semibold tabular-nums align-bottom leading-snug">
                        <div className="inline-flex flex-col items-start gap-0">
                          <span className="inline-flex items-center gap-1">
                            Remaining <ArrowUpDown className="w-3 h-3 opacity-70" aria-hidden />
                          </span>
                          <span>Qty</span>
                        </div>
                      </th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap align-bottom">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((line, idx) => {
                      const ordered = Number(line.quantity) || 0;
                      const got = Number(line.receivedQty) || 0;
                      const left = Math.max(0, ordered - got);
                      const complete = left <= 0;
                      return (
                        <tr key={idx} className="bg-white hover:bg-slate-50/60">
                          <td className="px-3 py-3 tabular-nums text-slate-600 align-middle">{idx + 1}</td>
                          <td className="px-3 py-3 align-middle">
                            <ItemDescriptionCard line={line} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <PeriodBadge line={line} purchaseOrder={po} />
                          </td>
                          <td className="px-3 py-3 tabular-nums font-medium align-middle">{ordered}</td>
                          <td className="px-3 py-3 tabular-nums font-medium text-emerald-700 align-middle">{got}</td>
                          <td className="px-3 py-3 tabular-nums font-medium text-slate-800 align-middle">{left}</td>
                          <td className="px-3 py-3 align-middle">
                            <button
                              type="button"
                              disabled={complete}
                              onClick={() => openReceiveWizard(idx)}
                              className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-teal-700 hover:bg-teal-800 text-white"
                            >
                              {complete ? null : <Plus className="w-4 h-4" />}
                              {complete ? 'Received' : 'Receive'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {n === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                          No line items on this purchase order.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {n > 0 ? (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-600">
                  <p className="m-0 tabular-nums">
                    Showing 1 to {n} of {n} entries
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled
                      className="px-3 py-1.5 rounded border border-slate-200 bg-white text-slate-400 cursor-not-allowed text-xs font-medium"
                    >
                      Previous
                    </button>
                    <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 rounded border border-teal-600 bg-teal-600 text-white text-xs font-bold">
                      1
                    </span>
                    <button
                      type="button"
                      disabled
                      className="px-3 py-1.5 rounded border border-slate-200 bg-white text-slate-400 cursor-not-allowed text-xs font-medium"
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Receive wizard — rental date + quantity, then serials per unit (bulk API) */}
      {receiveLineIndex !== null ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
          role="dialog"
          aria-labelledby="receive-modal-title"
          aria-modal="true"
          onClick={(e) => {
            if (modalBusy || e.target !== e.currentTarget) return;
            resetReceiveWizardUi();
          }}
        >
          <div
            className="relative w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200 overflow-hidden my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
              <div>
                <p className="text-[11px] font-semibold text-teal-700 uppercase tracking-wide">
                  Step {receiveStep === 'meta' ? '1' : '2'} of 2
                </p>
                <h2 id="receive-modal-title" className="text-base font-semibold text-slate-900">
                  {receiveStep === 'meta' ? 'Receive — details' : 'Enter serial numbers'}
                </h2>
              </div>
              <button
                type="button"
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                onClick={() => !modalBusy && resetReceiveWizardUi()}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-sm">
              <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                <p className="text-xs text-slate-500 mb-2">Product {receiveLineIndex + 1}</p>
                {lines[receiveLineIndex] ? <ItemDescriptionCard line={lines[receiveLineIndex]} /> : null}
                <p className="text-xs text-slate-600 mt-2 tabular-nums">
                  Remaining to receive: <strong>{remainingOnLine(receiveLineIndex)}</strong>
                  {receiveStep === 'serials' && bulkSerials.length ? (
                    <span className="text-slate-500">
                      {' '}
                      · Receiving <strong>{bulkSerials.length}</strong> unit(s)
                    </span>
                  ) : null}
                </p>
              </div>

              {receiveStep === 'meta' ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5" htmlFor="receive-rental-start">
                      Rental start date <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="receive-rental-start"
                      type="date"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none disabled:opacity-50"
                      value={rentalStartDate}
                      disabled={modalBusy}
                      onChange={(e) => setRentalStartDate(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5" htmlFor="receive-qty">
                      Quantity <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="receive-qty"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={Math.min(remainingOnLine(receiveLineIndex), 250)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm tabular-nums focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none disabled:opacity-50"
                      placeholder={`1–${Math.min(remainingOnLine(receiveLineIndex), 250)}`}
                      value={bulkQtyStr}
                      disabled={modalBusy}
                      onChange={(e) => setBulkQtyStr(e.target.value)}
                    />
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      Each unit gets a permanent <strong className="font-mono text-slate-700">TTSPL####</strong> code on
                      save. Unique serial numbers are required for every row on the next step.
                    </p>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-600 m-0">
                      Rental starts <strong>{rentalStartDate || '—'}</strong>
                    </p>
                  </div>
                  <div
                    className="max-h-[min(26rem,calc(100vh-20rem))] overflow-y-auto pr-1 space-y-3 rounded-lg border border-slate-100 p-3 bg-slate-50/40"
                  >
                    {bulkSerials.map((val, si) => (
                      <div key={si}>
                        <label
                          className="block text-xs font-semibold text-slate-600 mb-1"
                          htmlFor={`receive-serial-${si}`}
                        >
                          Unit {si + 1} — serial number <span className="text-rose-600">*</span>
                        </label>
                        <input
                          id={`receive-serial-${si}`}
                          type="text"
                          autoComplete="off"
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none disabled:opacity-50"
                          placeholder="Manual serial"
                          value={val}
                          disabled={modalBusy}
                          onChange={(e) => updateBulkSerialAt(si, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 m-0">
                    Duplicate serials in this batch are not allowed; the server also rejects serials already in the database.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap justify-between gap-2 pt-1">
                <div>
                  {receiveStep === 'serials' ? (
                    <button
                      type="button"
                      disabled={modalBusy}
                      className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50"
                      onClick={() => setReceiveStep('meta')}
                    >
                      Back
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={modalBusy}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50"
                    onClick={() => resetReceiveWizardUi()}
                  >
                    Cancel
                  </button>
                  {receiveStep === 'meta' ? (
                    <button
                      type="button"
                      disabled={modalBusy || remainingOnLine(receiveLineIndex) <= 0}
                      onClick={() => gotoSerialInputs()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold disabled:opacity-40"
                    >
                      Next
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        modalBusy || bulkSerials.length === 0 || bulkSerials.some((s) => !String(s ?? '').trim())
                      }
                      onClick={() => submitBulkReceive()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold disabled:opacity-40"
                    >
                      {modalBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      Receive {bulkSerials.length || ''} unit(s)
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
