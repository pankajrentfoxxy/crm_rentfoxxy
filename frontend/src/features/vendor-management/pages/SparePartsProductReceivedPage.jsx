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
import { invalidateInventoryManagement } from '../../inventory-management/inventoryCountsEvents';
import { createSpareGrn, fetchSpareProductReceivedContext, receiveSpareLineBulk } from '../vendorManagementApi';

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

/** Laravel spare row: brand + spare part title */
function SpareItemCard({ line }) {
  const brand = line.brand_name ?? line.brand ?? '';
  const part = line.spare_part_name ?? line.part_name ?? line.name ?? '';
  const title = [brand, part].filter(Boolean).join(' — ') || 'Spare item';
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/90 shadow-sm px-3 py-2.5 text-left max-w-md">
      <h3 className="text-sm font-semibold text-slate-900 leading-snug">{title}</h3>
    </div>
  );
}

/** Warranty countdown from spare PO date (Laravel blade uses locking/warranty months × 30). */
function SpareWarrantyBadge({ line, spo }) {
  const periodMonths = Number(line.warranty_months ?? line.warranty ?? line.warranty_in_month) || 0;
  const start = normalizeDateInput(spo?.purchase_order_date) || normalizeDateInput(spo?.created_at) || new Date();

  if (!periodMonths || periodMonths <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-600 px-3 py-1 text-xs font-semibold whitespace-nowrap">
        N/A
      </span>
    );
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

export default function SparePartsProductReceivedPage() {
  const { spoId } = useParams();
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [grnChoice, setGrnChoice] = useState('');
  const [receiveLineIndex, setReceiveLineIndex] = useState(null);
  const [receiveStep, setReceiveStep] = useState('qty');
  const [bulkQtyStr, setBulkQtyStr] = useState('');
  const [bulkSerials, setBulkSerials] = useState([]);
  const [modalBusy, setModalBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(null);
    try {
      const { data } = await fetchSpareProductReceivedContext(spoId);
      if (data.success) setCtx(data.data);
      else toast.error(data.message || 'Failed to load');
    } catch (e) {
      const st = e.response?.status;
      const msg = e.response?.data?.message;
      if (st === 403) setForbidden(msg || 'Receiving is not allowed for this spare PO.');
      else if (st === 404) setForbidden(msg || 'Spare PO not found.');
      else toast.error(msg || 'Failed to load spare PO');
    } finally {
      setLoading(false);
    }
  }, [spoId]);

  useEffect(() => {
    load();
  }, [load]);

  const po = ctx?.spare_purchase_order;
  const lines = ctx?.lines || [];
  const stats = ctx?.stats || statsFromLines(lines);
  const grns = ctx?.grns || [];
  const n = lines.length;

  useEffect(() => {
    if (!grns.length) {
      setGrnChoice('');
      return;
    }
    setGrnChoice((c) => (c ? c : String(grns[grns.length - 1].grn_id)));
  }, [grns]);

  function resetReceiveWizardUi() {
    setReceiveLineIndex(null);
    setReceiveStep('qty');
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

  async function onNewGrn() {
    try {
      const { data } = await createSpareGrn(Number(spoId), {});
      if (data.success) {
        toast.success(`GRN #${data.data.grn_id} created`);
        setGrnChoice(String(data.data.grn_id));
        await load();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to create GRN');
    }
  }

  function remainingOnLine(idx) {
    const line = lines[idx];
    if (!line) return 0;
    const ordered = Number(line.quantity) || 0;
    const got = Number(line.receivedQty) || 0;
    return Math.max(0, ordered - got);
  }

  function openReceiveWizard(lineIndex) {
    setReceiveLineIndex(lineIndex);
    setReceiveStep('qty');
    setBulkQtyStr('');
    setBulkSerials([]);
  }

  function gotoSerialInputs() {
    if (receiveLineIndex === null) return;
    const rem = remainingOnLine(receiveLineIndex);
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
        quantity: q,
        serial_numbers: trimmed
      };
      if (grnChoice) body.grn_id = Number(grnChoice);
      const { data } = await receiveSpareLineBulk(spoId, body);
      if (data.success) {
        const created = data.data?.created || [];
        const example = created[0]?.inventory_asset_code;
        toast.success(
          data.message ||
            (example ? `Received ${created.length} unit(s). Codes include ${example}…` : 'Units received')
        );
        resetReceiveWizardUi();
        invalidateInventoryManagement();
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

  const viewGrnHref = `/vendor-management/spare-parts-po/${encodeURIComponent(spoId || '')}/grn-detail`;

  if (loading && !ctx) {
    return (
      <div className="flex items-center gap-2 text-slate-600 text-sm py-12">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading spare parts PO items…
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="max-w-xl space-y-4">
        <Link
          to="/vendor-management/spare-parts-po"
          className="inline-flex items-center gap-2 text-sm font-medium text-orange-700 hover:text-orange-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to spare parts PO
        </Link>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">{forbidden}</div>
      </div>
    );
  }

  const vendorTitle = po?.vendor_business_name || po?.vendor_display_name || po?.vendor_first_name || 'Vendor';

  return (
    <div className="space-y-6 min-w-0">
      <Link
        to="/vendor-management/spare-parts-po"
        className="inline-flex items-center gap-2 text-sm font-medium text-teal-800 hover:text-teal-950"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to spare parts PO
      </Link>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-2">
            <UserCircle className="w-7 h-7 text-teal-600 shrink-0" />
            <div>
              <h1 className="text-lg sm:text-xl font-semibold text-slate-900 capitalize tracking-tight">
                Purchase Order list Items
              </h1>
              <p className="text-[11px] text-slate-500">Spare parts receive — Laravel «add_product_received_spare» parity</p>
            </div>
          </div>
          <Link
            to={viewGrnHref}
            className="inline-flex items-center gap-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 shadow-sm transition-colors"
          >
            <Eye className="w-4 h-4" />
            View Parts GRN
          </Link>
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
                    {po.purchase_order_number || `SPO-${po.spo_id}`}
                  </span>
                </div>
                <div className="flex items-center justify-center">
                  <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 px-4 py-1.5 text-xs sm:text-sm font-semibold capitalize">
                    Spare parts
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

            {grns.length > 0 ? (
              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Post serials against GRN</label>
                  <select
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white min-w-[12rem]"
                    value={grnChoice}
                    onChange={(e) => setGrnChoice(e.target.value)}
                  >
                    {grns.map((g) => (
                      <option key={g.grn_id} value={String(g.grn_id)}>
                        GRN-{String(g.grn_id).padStart(4, '0')}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={onNewGrn}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900"
                >
                  <Plus className="w-4 h-4" />
                  New GRN
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-slate-600">
                  No GRN yet — the first receipt will auto-create one, or you can create manually.
                </p>
                <button
                  type="button"
                  onClick={onNewGrn}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  <Plus className="w-4 h-4" />
                  Create GRN
                </button>
              </div>
            )}

            <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {n === 0 ? (
                  <p className="px-4 py-10 text-center text-slate-500">No line items on this spare PO.</p>
                ) : lines.map((line, idx) => {
                  const ordered = Number(line.quantity) || 0;
                  const got = Number(line.receivedQty) || 0;
                  const left = Math.max(0, ordered - got);
                  const complete = left <= 0;
                  return (
                    <div key={idx} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-400 tabular-nums mt-1">#{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <SpareItemCard line={line} />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <SpareWarrantyBadge line={line} spo={po} />
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-slate-50 border border-slate-100 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-slate-500">Ordered</p>
                          <p className="text-base font-bold tabular-nums text-slate-800">{ordered}</p>
                        </div>
                        <div className="rounded-lg bg-emerald-50 border border-emerald-100 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-emerald-600">Received</p>
                          <p className="text-base font-bold tabular-nums text-emerald-700">{got}</p>
                        </div>
                        <div className="rounded-lg bg-rose-50 border border-rose-100 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-rose-600">Remaining</p>
                          <p className="text-base font-bold tabular-nums text-rose-700">{left}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={complete}
                        onClick={() => openReceiveWizard(idx)}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-teal-700 hover:bg-teal-800 text-white"
                      >
                        {complete ? null : <Plus className="w-4 h-4" />}
                        {complete ? 'Received' : 'Receive'}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block overflow-x-auto">
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
                          Items descriptions <ArrowUpDown className="w-3 h-3 opacity-70" aria-hidden />
                        </span>
                      </th>
                      <th className="px-3 py-3 font-semibold align-bottom leading-snug">
                        Warranty
                        <br />
                        Period
                      </th>
                      <th className="px-3 py-3 font-semibold tabular-nums align-bottom leading-snug">
                        <span className="inline-flex flex-col items-start gap-0">
                          <span className="inline-flex items-center gap-1">
                            ordered <ArrowUpDown className="w-3 h-3 opacity-70" aria-hidden />
                          </span>
                          <span>Qty</span>
                        </span>
                      </th>
                      <th className="px-3 py-3 font-semibold tabular-nums align-bottom leading-snug">
                        <span className="inline-flex flex-col items-start gap-0">
                          <span className="inline-flex items-center gap-1">
                            received <ArrowUpDown className="w-3 h-3 opacity-70" aria-hidden />
                          </span>
                          <span>Qty</span>
                        </span>
                      </th>
                      <th className="px-3 py-3 font-semibold tabular-nums align-bottom leading-snug">
                        <span className="inline-flex flex-col items-start gap-0">
                          <span className="inline-flex items-center gap-1">
                            Remaining <ArrowUpDown className="w-3 h-3 opacity-70" aria-hidden />
                          </span>
                          <span>Qty</span>
                        </span>
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
                            <SpareItemCard line={line} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <SpareWarrantyBadge line={line} spo={po} />
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
                          No line items on this spare PO.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {receiveLineIndex !== null ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
          role="dialog"
          aria-labelledby="spare-receive-modal-title"
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
                  Step {receiveStep === 'qty' ? '1' : '2'} of 2
                </p>
                <h2 id="spare-receive-modal-title" className="text-base font-semibold text-slate-900">
                  {receiveStep === 'qty' ? 'Receive — quantity' : 'Enter serial numbers'}
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
                <p className="text-xs text-slate-500 mb-2">Line {receiveLineIndex + 1}</p>
                {lines[receiveLineIndex] ? <SpareItemCard line={lines[receiveLineIndex]} /> : null}
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

              {receiveStep === 'qty' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5" htmlFor="spare-receive-qty">
                    Quantity <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="spare-receive-qty"
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
                    Each spare unit receives a permanent <strong className="font-mono text-slate-700">TTSPL####</strong>{' '}
                    inventory code from the server. Enter one physical serial per row on the next step (
                    <code className="text-[10px]">extra.line_index</code> + part id when present).
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div
                    className="max-h-[min(26rem,calc(100vh-20rem))] overflow-y-auto pr-1 space-y-3 rounded-lg border border-slate-100 p-3 bg-slate-50/40"
                  >
                    {bulkSerials.map((val, si) => (
                      <div key={si}>
                        <label
                          className="block text-xs font-semibold text-slate-600 mb-1"
                          htmlFor={`spare-receive-serial-${si}`}
                        >
                          Unit {si + 1} — serial number <span className="text-rose-600">*</span>
                        </label>
                        <input
                          id={`spare-receive-serial-${si}`}
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
                    Duplicates in this batch are not allowed; serials already in inventory are rejected.
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
                      onClick={() => setReceiveStep('qty')}
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
                  {receiveStep === 'qty' ? (
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
