import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, Loader2, PenLine, Printer, RotateCcw } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import usePermission from '../../../hooks/usePermission';
import { getBackendOrigin } from '../../../utils/api';
import {
  downloadVendorRepairPdf,
  downloadVendorRepairReceivePdf,
  fetchVendorRepairDc,
  markVendorRepairDeliveredToVendor,
  receiveVendorRepairBack,
  signVendorRepairDispatch,
  updateVendorRepairCommercialDetails,
  updateVendorRepairDispatchDetails,
} from '../vendorRepairApi';
import { ticketStatusLabel } from '../floorPipelineUi';
import {
  DEFAULT_BILLING_ADDRESS,
  fmtVendorRepairDate,
  fmtVendorRepairDateTimeIst,
  formatVrdcProductLines,
  parseVrdcItemConfig,
  vendorDeliveryStatusClass,
  vendorDeliveryStatusLabel,
  vendorRepairDispatchModeLabel,
} from '../vendorRepairUi';
import VrdcDispatchFields, { validateVrdcDispatch } from '../components/VrdcDispatchFields';
import VrdcEwayPanel from '../components/VrdcEwayPanel';
import { fetchDeliveryTechnicians } from '../../../utils/deliveryRegisterApi';
import { invalidateInventoryManagement } from '../../inventory-management/inventoryCountsEvents';

const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead']);

function uploadUrl(p) {
  if (!p) return null;
  if (p.startsWith('http')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/uploads/${p.replace(/^\/?uploads\//, '')}`;
}

function EsignBox({ label, url, previewUrl, onSign, canSign, disabled, signerName, onSignerNameChange, optional }) {
  const display = previewUrl || url;
  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase text-slate-500">
          {label}{optional ? ' (optional)' : ''}
        </h4>
        {canSign && !display ? (
          <button type="button" disabled={disabled} onClick={onSign} className="text-xs text-blue-600 inline-flex items-center gap-1">
            <PenLine className="w-3.5 h-3.5" /> Sign
          </button>
        ) : null}
      </div>
      {onSignerNameChange ? (
        <input
          className="w-full border rounded-lg px-2 py-1.5 text-xs"
          placeholder="Signer name *"
          value={signerName || ''}
          onChange={(e) => onSignerNameChange(e.target.value)}
          disabled={disabled}
        />
      ) : signerName ? (
        <p className="text-xs text-slate-600">Signed by: <strong>{signerName}</strong></p>
      ) : null}
      {display ? (
        <img src={display.startsWith('data:') ? display : uploadUrl(display)} alt={label} className="w-full max-h-24 object-contain border rounded bg-white" />
      ) : (
        <p className="text-xs text-slate-400 min-h-[60px] flex items-center justify-center border border-dashed rounded">Awaiting signature</p>
      )}
    </div>
  );
}

function SignatureModal({ title, onSave, onClose }) {
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let pad;
    import('signature_pad').then(({ default: SignaturePad }) => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext('2d').scale(ratio, ratio);
      pad = new SignaturePad(canvas, { backgroundColor: '#fff', penColor: '#1A1A2E' });
      padRef.current = pad;
    });
    return () => { if (pad) pad.off(); };
  }, []);

  const save = async () => {
    if (!padRef.current || padRef.current.isEmpty()) {
      toast.error('Please sign first');
      return;
    }
    setSaving(true);
    try {
      await onSave(padRef.current.toDataURL('image/png'));
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Sign failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-md p-4 space-y-3">
        <h3 className="font-semibold">{title}</h3>
        <canvas ref={canvasRef} className="w-full h-40 border rounded-lg touch-none" />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => padRef.current?.clear()} className="px-3 py-2 border rounded-lg text-sm">Clear</button>
          <button type="button" disabled={saving} onClick={save} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Save signature'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VendorRepairDcDetailPage() {
  const { dcNumber: rawDc } = useParams();
  const dcNumber = decodeURIComponent(rawDc || '');
  const { user } = useAuth();
  const { canCreate, canEdit } = usePermission();
  const canProcess = WAREHOUSE_ROLES.has(user?.role);
  const canDispatch = canCreate('vendor_repair_dc_dispatch') || canEdit('vendor_repair_dc_dispatch');
  const canOverrideHsn = user?.role === 'admin' || user?.role === 'super_admin';
  const [loading, setLoading] = useState(true);
  const [dc, setDc] = useState(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveTargetItem, setReceiveTargetItem] = useState(null);
  const [receiveForm, setReceiveForm] = useState({
    receive_mode: 'repaired',
    verified_serial: '',
    wh_signer_name: user?.name || user?.email || '',
    wh_esign: null,
    replacement_serial_number: '',
    replacement_brand: '',
    replacement_model: '',
    replacement_generation: '',
  });
  const [receiveBusy, setReceiveBusy] = useState(false);
  const [receivePdfBusy, setReceivePdfBusy] = useState(false);
  const [whDispatchSignerName, setWhDispatchSignerName] = useState(() => user?.name || user?.email || '');
  const [vendorDispatchSignerName, setVendorDispatchSignerName] = useState('');
  const [pendingWhDispatch, setPendingWhDispatch] = useState(null);
  const [pendingVendorDispatch, setPendingVendorDispatch] = useState(null);
  const [activeSign, setActiveSign] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [deliveryTechnicians, setDeliveryTechnicians] = useState([]);
  const [shipBy, setShipBy] = useState('');
  const [dispatchFields, setDispatchFields] = useState({});
  const [dispatchSaving, setDispatchSaving] = useState(false);
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [pendingDispatchPod, setPendingDispatchPod] = useState(null);
  const [deliverBusy, setDeliverBusy] = useState(false);
  const [itemPrices, setItemPrices] = useState({});
  const [itemHsnCodes, setItemHsnCodes] = useState({});
  const [commercialSaving, setCommercialSaving] = useState(false);
  const [ewayCompliance, setEwayCompliance] = useState(null);

  const canDownloadPdf = ewayCompliance?.can_download_pdf !== false && dc?.can_download_pdf !== false;

  const syncDispatchFromDc = useCallback((head) => {
    if (!head) return;
    const mode = head.ship_by
      || (head.dispatch_mode === 'inhouse' ? 'by_hand' : head.dispatch_mode === 'porter' ? 'by_porter' : head.dispatch_mode === 'courier' ? 'by_courier' : '');
    setShipBy(mode || '');
    setDispatchFields({
      courier_name: head.courier_name || '',
      awb_number: head.awb_number || '',
      courier_tracking_url: head.courier_tracking_url || '',
      porter_tracking_id: head.porter_tracking_id || '',
      porter_order_id: head.porter_order_id || '',
      porter_booking_url: head.porter_booking_url || '',
      delivery_person_id: head.delivery_person_id ? String(head.delivery_person_id) : '',
    });
  }, []);

  const handleDownloadReceivePdf = async () => {
    setReceivePdfBusy(true);
    try {
      await downloadVendorRepairReceivePdf(dcNumber);
      toast.success('Receive challan PDF downloaded');
    } catch {
      toast.error('Receive PDF download failed');
    } finally {
      setReceivePdfBusy(false);
    }
  };

  const itemStatusLabel = (item) => {
    const s = item.item_status || '';
    if (s === 'dispatched') return 'Out for repair';
    if (s === 'received') return 'Received (repaired)';
    if (s === 'replacement_received') return 'Replacement received';
    if (s === 'draft') return 'Pending dispatch';
    return s.replace(/_/g, ' ');
  };

  const handleDownloadPdf = async () => {
    if (!canDownloadPdf) {
      toast.error(ewayCompliance?.lock_message || 'E-way Bill is required before downloading this VRDC.');
      return;
    }
    setPdfBusy(true);
    try {
      await downloadVendorRepairPdf(dcNumber);
      toast.success('PDF downloaded');
    } catch (err) {
      toast.error(err?.message || 'PDF download failed');
    } finally {
      setPdfBusy(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchVendorRepairDc(dcNumber);
      setDc(data.data);
      setEwayCompliance(data.data.eway_compliance || null);
      syncDispatchFromDc(data.data);
      if (data.data.warehouse_dispatch_signer_name) setWhDispatchSignerName(data.data.warehouse_dispatch_signer_name);
      if (data.data.vendor_dispatch_signer_name) setVendorDispatchSignerName(data.data.vendor_dispatch_signer_name);
      const prices = {};
      const hsns = {};
      (data.data.items || []).forEach((it) => {
        prices[it.ticket_id] = it.price != null ? String(it.price) : '';
        hsns[it.ticket_id] = it.hsn_code || '';
      });
      setItemPrices(prices);
      setItemHsnCodes(hsns);
    } catch {
      toast.error('Vendor repair DC not found');
      setDc(null);
    } finally {
      setLoading(false);
    }
  }, [dcNumber, syncDispatchFromDc]);

  useEffect(() => {
    const loginName = user?.name || user?.email || '';
    if (!loginName) return;
    setWhDispatchSignerName((prev) => prev || loginName);
    setReceiveForm((prev) => ({ ...prev, wh_signer_name: prev.wh_signer_name || loginName }));
  }, [user?.name, user?.email]);

  const openReceiveForItem = (item) => {
    const cfg = parseVrdcItemConfig(item);
    setReceiveTargetItem(item);
    setReceiveForm({
      receive_mode: 'repaired',
      verified_serial: '',
      wh_signer_name: user?.name || user?.email || '',
      wh_esign: null,
      replacement_serial_number: '',
      replacement_brand: cfg.brand,
      replacement_model: cfg.model,
      replacement_generation: cfg.generation,
    });
    setReceiveOpen(true);
  };
  useEffect(() => {
    fetchDeliveryTechnicians({ limit: 200 })
      .then((data) => setDeliveryTechnicians(data?.data || data?.technicians || []))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const statusLabel = (s) => {
    if (s === 'draft') return 'Draft — pending e-sign';
    if (s === 'dispatched') return 'Dispatched to Vendor';
    if (s === 'partially_returned') return 'Partially returned';
    if (s === 'returned') return 'Returned';
    return s;
  };

  const dispatchedItems = useMemo(
    () => (dc?.items || []).filter((i) => (i.item_status || 'dispatched') === 'dispatched'),
    [dc]
  );

  const canEditCommercial = Boolean(canProcess && dc && dc.status !== 'returned');
  const canEditHsn = Boolean(canEditCommercial && canOverrideHsn);

  const declaredTotal = useMemo(() => {
    return (dc?.items || []).reduce((sum, it) => {
      const raw = itemPrices[it.ticket_id] ?? itemPrices[String(it.ticket_id)];
      const n = Number(raw !== undefined && raw !== '' ? raw : it.price);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [dc, itemPrices]);

  const saveCommercialDetails = async () => {
    if (!dc || !canEditCommercial) return;
    setCommercialSaving(true);
    try {
      const prices = {};
      const hsns = {};
      (dc.items || []).forEach((it) => {
        prices[it.ticket_id] = itemPrices[it.ticket_id] ?? '';
        hsns[it.ticket_id] = itemHsnCodes[it.ticket_id] ?? '';
      });
      await updateVendorRepairCommercialDetails(dcNumber, {
        item_prices: prices,
        item_hsn_codes: hsns,
      });
      toast.success('Price & HSN saved — PDF will refresh on download');
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to save commercial details');
    } finally {
      setCommercialSaving(false);
    }
  };

  const effectiveShipBy = useMemo(() => {
    if (shipBy) return shipBy;
    if (!dc) return '';
    if (dc.ship_by) return dc.ship_by;
    if (dc.dispatch_mode === 'inhouse') return 'by_hand';
    if (dc.dispatch_mode === 'porter') return 'by_porter';
    if (dc.dispatch_mode === 'courier') return 'by_courier';
    return '';
  }, [shipBy, dc]);

  const completeDispatchSign = async () => {
    const wh = pendingWhDispatch || dc?.warehouse_dispatch_esign_url;
    if (!wh) {
      toast.error('Warehouse dispatch signature is required');
      return;
    }
    if (!whDispatchSignerName?.trim()) {
      toast.error('Enter warehouse signer name');
      return;
    }
    const dispatchErr = validateVrdcDispatch(effectiveShipBy, dispatchFields);
    if (dispatchErr) {
      toast.error(dispatchErr);
      return;
    }
    setDispatchBusy(true);
    try {
      await signVendorRepairDispatch(dcNumber, {
        ship_by: effectiveShipBy,
        ...dispatchFields,
        warehouse_esign: pendingWhDispatch || undefined,
        vendor_esign: pendingVendorDispatch || undefined,
        warehouse_signer_name: whDispatchSignerName.trim(),
        vendor_signer_name: vendorDispatchSignerName.trim() || undefined,
        dispatch_pod: pendingDispatchPod || undefined,
      });
      toast.success('Dispatched to vendor');
      setPendingWhDispatch(null);
      setPendingVendorDispatch(null);
      setPendingDispatchPod(null);
      invalidateInventoryManagement();
      load();
    } catch (err) {
      const msg = err.code === 'ECONNABORTED'
        ? 'Dispatch timed out — check if status updated and retry if still draft'
        : (err.response?.data?.message || 'Dispatch failed');
      toast.error(msg);
    } finally {
      setDispatchBusy(false);
    }
  };

  const saveDispatchDetails = async () => {
    const dispatchErr = validateVrdcDispatch(shipBy, dispatchFields);
    if (dispatchErr) {
      toast.error(dispatchErr);
      return;
    }
    setDispatchSaving(true);
    try {
      await updateVendorRepairDispatchDetails(dcNumber, {
        ship_by: shipBy,
        ...dispatchFields,
      });
      toast.success('Send details saved');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setDispatchSaving(false);
    }
  };

  const handleMarkDeliveredToVendor = async () => {
    if (!window.confirm('Confirm laptops have been delivered to the vendor?')) return;
    setDeliverBusy(true);
    try {
      const { data } = await markVendorRepairDeliveredToVendor(dcNumber);
      toast.success(data.message || 'Marked delivered to vendor');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to mark delivered');
    } finally {
      setDeliverBusy(false);
    }
  };

  const submitReceiveOne = async () => {
    if (!receiveTargetItem) return;
    if (!receiveForm.wh_signer_name?.trim()) {
      toast.error('Enter receiver name');
      return;
    }
    if (!receiveForm.wh_esign) {
      toast.error('Warehouse signature is required');
      return;
    }
    if (receiveForm.receive_mode === 'repaired') {
      const expected = (receiveTargetItem.serial_number || '').trim().toUpperCase();
      const entered = receiveForm.verified_serial.trim().toUpperCase();
      if (!entered || entered !== expected) {
        toast.error(`Serial must match ${receiveTargetItem.serial_number || receiveTargetItem.ttspl_id}`);
        return;
      }
    } else {
      if (!receiveForm.replacement_serial_number?.trim()) {
        toast.error('Enter replacement serial number');
        return;
      }
      if (!receiveForm.replacement_brand?.trim() || !receiveForm.replacement_model?.trim()) {
        toast.error('Enter replacement brand and model');
        return;
      }
    }
    setReceiveBusy(true);
    try {
      const { data } = await receiveVendorRepairBack(dcNumber, {
        items: [{
          ticket_id: receiveTargetItem.ticket_id,
          receive_mode: receiveForm.receive_mode,
          verified_serial: receiveForm.verified_serial.trim(),
          wh_esign: receiveForm.wh_esign,
          wh_signer_name: receiveForm.wh_signer_name.trim(),
          replacement_serial_number: receiveForm.replacement_serial_number,
          replacement_brand: receiveForm.replacement_brand,
          replacement_model: receiveForm.replacement_model,
          replacement_generation: receiveForm.replacement_generation,
        }],
      });
      toast.success(data.message || 'Laptop received');
      setReceiveOpen(false);
      setReceiveTargetItem(null);
      invalidateInventoryManagement();
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Receive failed');
    } finally {
      setReceiveBusy(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }
  if (!dc) return <p className="p-6 text-red-600">Vendor repair DC not found.</p>;

  const dispatchReady = dc.status === 'draft'
    && (pendingWhDispatch || dc.warehouse_dispatch_esign_url)
    && whDispatchSignerName?.trim();

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/vendor-management/vendor-repair-dc" className="text-sm text-blue-600 hover:underline">← Vendor Repair DC</Link>
          <h1 className="text-xl font-bold mt-1">Vendor Repair DC</h1>
          <p className="font-mono text-purple-800">{dc.dc_number}</p>
          <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-900">{statusLabel(dc.status)}</span>
          <span className={`inline-block mt-2 ml-2 px-2 py-0.5 rounded-full text-xs ${vendorDeliveryStatusClass(dc)}`}>
            {vendorDeliveryStatusLabel(dc)}
          </span>
          {dc.ship_by || dc.dispatch_mode ? (
            <span className="inline-block mt-2 ml-2 px-2 py-0.5 rounded-full text-xs bg-orange-50 text-orange-800 border border-orange-200">
              {vendorRepairDispatchModeLabel(dc.ship_by, dc.dispatch_mode)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canDispatch && ['dispatched', 'partially_returned'].includes(dc.status) && !dc.vendor_delivered_at ? (
            <button
              type="button"
              disabled={deliverBusy}
              onClick={handleMarkDeliveredToVendor}
              className="inline-flex items-center gap-1 px-3 py-2 bg-emerald-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {deliverBusy ? 'Saving…' : 'Mark Delivered to Vendor'}
            </button>
          ) : null}
          <button
            type="button"
            disabled={pdfBusy || !canDownloadPdf}
            onClick={handleDownloadPdf}
            title={!canDownloadPdf ? (ewayCompliance?.lock_message || 'E-way Bill required') : undefined}
            className="inline-flex items-center gap-1 px-3 py-2 border rounded-lg text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> {pdfBusy ? 'PDF…' : 'Dispatch PDF'}
          </button>
          {(dc.receive_dc_number || dc.receive_pdf_path || (dc.items || []).some((i) => i.receive_dc_number)) ? (
            <button
              type="button"
              disabled={receivePdfBusy}
              onClick={handleDownloadReceivePdf}
              className="inline-flex items-center gap-1 px-3 py-2 border rounded-lg text-sm disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> {receivePdfBusy ? 'PDF…' : 'Receive PDF'}
            </button>
          ) : null}
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 px-3 py-2 border rounded-lg text-sm">
            <Printer className="w-4 h-4" /> Print
          </button>
          {canProcess && ['dispatched', 'partially_returned'].includes(dc.status) && dispatchedItems.length ? (
            <button type="button" onClick={() => setReceiveOpen(true)} className="inline-flex items-center gap-1 px-3 py-2 bg-green-700 text-white rounded-lg text-sm font-semibold">
              <RotateCcw className="w-4 h-4" /> Receive Back ({dispatchedItems.length})
            </button>
          ) : null}
        </div>
      </div>

      {ewayCompliance?.applies ? (
        <VrdcEwayPanel
          dcNumber={dcNumber}
          compliance={ewayCompliance}
          onReload={load}
          isSuperAdmin={user?.role === 'super_admin'}
        />
      ) : null}

      <div className="rounded-xl border bg-slate-50 p-4 text-sm whitespace-pre-wrap text-slate-700">
        <p className="text-xs font-semibold uppercase text-slate-500 mb-1">Dispatch From (TRUETECH)</p>
        {DEFAULT_BILLING_ADDRESS}
      </div>

      <div className="grid md:grid-cols-2 gap-4 print:grid-cols-2">
        <div className="rounded-xl border bg-white p-4 text-sm space-y-1">
          <h3 className="font-semibold mb-2">Vendor Billing Address</h3>
          <p className="text-slate-600 whitespace-pre-wrap">{dc.vendor_billing_display || dc.vendor_address || dc.vendor_name || '—'}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 text-sm space-y-1">
          <h3 className="font-semibold mb-2">Vendor Shipping Address</h3>
          <p className="text-slate-600 whitespace-pre-wrap">{dc.vendor_shipping_display || dc.shipping_address || dc.vendor_address || '—'}</p>
          <p className="text-slate-600 pt-2">{dc.contact_person || '—'} · {dc.contact_mobile || '—'}</p>
          <p className="text-slate-600">Expected return: {fmtVendorRepairDate(dc.expected_return_date)}</p>
          {!ewayCompliance?.applies && (dc.eway_bill_number || dc.eway_bill_date) ? (
            <p className="text-slate-700 pt-1">
              <span className="font-semibold">E-way Bill:</span>{' '}
              <span className="font-mono">{dc.eway_bill_number || '—'}</span>
              {dc.eway_bill_date ? (
                <span className="text-slate-500"> · {fmtVendorRepairDate(dc.eway_bill_date)}</span>
              ) : null}
            </p>
          ) : null}
          {dc.items_received_count != null ? (
            <p className="text-slate-600 font-medium pt-1">
              Received: {dc.items_received_count || 0} / {dc.items_dispatched_count || dc.items?.length || 0}
            </p>
          ) : null}
        </div>
      </div>

      {dc.remarks ? (
        <div className="rounded-xl border bg-white p-4 text-sm">
          <h3 className="font-semibold mb-1">Remarks</h3>
          <p className="text-slate-700">{dc.remarks}</p>
        </div>
      ) : null}

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-slate-50 print:hidden">
          <p className="text-xs text-slate-600">
            Declared value:{' '}
            <span className="font-semibold text-slate-900">
              ₹{declaredTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </span>
          </p>
          {canEditCommercial ? (
            <button
              type="button"
              disabled={commercialSaving}
              onClick={saveCommercialDetails}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-700 text-white rounded-lg text-xs font-semibold disabled:opacity-60"
            >
              {commercialSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Save Price / HSN
            </button>
          ) : null}
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-teal-700 text-xs uppercase text-white">
            <tr>
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-center w-28">HSN</th>
              <th className="p-3 text-right w-28">Price</th>
              <th className="p-3 text-center w-16">Qty.</th>
              <th className="p-3 text-left">Remarks</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Sent / Received</th>
              <th className="p-3 text-left">Ticket</th>
            </tr>
          </thead>
          <tbody>
            {(dc.items || []).map((item) => {
              const prod = formatVrdcProductLines(item);
              return (
                <tr key={item.id} className="border-t align-top">
                  <td className="p-3 text-xs">
                    {prod.title ? <p className="font-semibold text-gray-900">{prod.title}</p> : null}
                    {prod.specs.map((line) => (
                      <p key={line} className="text-gray-500">{line}</p>
                    ))}
                    {prod.ids ? <p className="font-mono font-semibold text-gray-800 mt-1">{prod.ids}</p> : null}
                  </td>
                  <td className="p-3 text-xs text-center">
                    {canEditHsn ? (
                      <input
                        className="w-full max-w-[7rem] mx-auto border rounded px-1.5 py-1 text-xs font-mono text-center"
                        placeholder="HSN"
                        value={itemHsnCodes[item.ticket_id] ?? ''}
                        onChange={(e) => setItemHsnCodes((prev) => ({ ...prev, [item.ticket_id]: e.target.value }))}
                      />
                    ) : (
                      <span className="font-mono">{item.hsn_code || '847330'}</span>
                    )}
                  </td>
                  <td className="p-3 text-xs text-right whitespace-nowrap">
                    {canEditCommercial ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-full max-w-[7.5rem] ml-auto border rounded px-1.5 py-1 text-xs text-right"
                        placeholder="0.00"
                        value={itemPrices[item.ticket_id] ?? ''}
                        onChange={(e) => setItemPrices((prev) => ({ ...prev, [item.ticket_id]: e.target.value }))}
                      />
                    ) : (
                      item.price != null && item.price !== ''
                        ? `₹${Number(item.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
                        : '—'
                    )}
                  </td>
                  <td className="p-3 text-xs text-center">1 Pcs.</td>
                  <td className="p-3 text-xs max-w-[180px]">{item.item_remarks || item.diagnosis_failed_reason || '—'}</td>
                  <td className="p-3 text-xs capitalize">{itemStatusLabel(item)}</td>
                  <td className="p-3 text-xs text-slate-600">
                    {dc.dispatched_at ? <p>Sent: {fmtVendorRepairDate(dc.dispatched_at)}</p> : null}
                    {item.returned_at ? <p>Received: {fmtVendorRepairDateTimeIst(item.returned_at)}</p> : null}
                    {item.receive_wh_signer_name ? <p>By: {item.receive_wh_signer_name}</p> : null}
                    {item.receive_dc_number ? <p className="font-mono text-[10px]">{item.receive_dc_number}</p> : null}
                    {item.replacement_dc_number ? (
                      <p className="text-purple-800 font-mono text-[10px]">Rep: {item.replacement_dc_number}</p>
                    ) : null}
                    {item.replacement_serial_number ? (
                      <p className="font-mono text-[10px]">{item.replacement_serial_number} · {item.replacement_ttspl_id || '—'}</p>
                    ) : null}
                    {!dc.dispatched_at && !item.returned_at ? '—' : null}
                  </td>
                  <td className="p-3">
                    <Link to={`/floor-pipeline/tickets/${item.ticket_id}`} className="text-blue-600">#{item.ticket_id}</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border bg-white p-4 text-sm space-y-2 print:hidden">
        <h3 className="font-semibold">Send to vendor</h3>
        {dc.status === 'draft' && canDispatch ? (
          <>
            <VrdcDispatchFields
              shipBy={shipBy}
              onShipByChange={setShipBy}
              fields={dispatchFields}
              onFieldsChange={setDispatchFields}
              deliveryTechnicians={deliveryTechnicians}
            />
            <button
              type="button"
              disabled={dispatchSaving}
              onClick={saveDispatchDetails}
              className="px-3 py-2 border rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {dispatchSaving ? 'Saving…' : 'Save send details'}
            </button>
          </>
        ) : (
          <div className="text-slate-600 space-y-1">
            <p>Mode: <strong>{vendorRepairDispatchModeLabel(dc.ship_by, dc.dispatch_mode)}</strong></p>
            {(dc.ship_by === 'by_courier' || dc.dispatch_mode === 'courier') && (
              <p>Courier: {dc.courier_name || '—'} · AWB: {dc.awb_number || '—'}
                {dc.courier_tracking_url ? (
                  <> · <a href={dc.courier_tracking_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Track</a></>
                ) : null}
              </p>
            )}
            {(dc.ship_by === 'by_porter' || dc.dispatch_mode === 'porter') && (
              <p>Porter ID: {dc.porter_tracking_id || '—'}
                {dc.porter_order_id ? <> · Order: {dc.porter_order_id}</> : null}
                {dc.porter_booking_url ? (
                  <> · <a href={dc.porter_booking_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Track</a></>
                ) : null}
              </p>
            )}
            {(dc.ship_by === 'by_hand' || dc.dispatch_mode === 'inhouse') && (
              <p>Delivery person: {dc.delivery_person_name || '—'}{dc.delivery_person_phone ? ` · ${dc.delivery_person_phone}` : ''}</p>
            )}
            {dc.vendor_delivered_at ? (
              <p className="text-green-700 font-medium">Delivered to vendor: {fmtVendorRepairDate(dc.vendor_delivered_at)}</p>
            ) : dc.dispatched_at ? (
              <p className="text-blue-700">Left warehouse: {fmtVendorRepairDate(dc.dispatched_at)} — awaiting vendor delivery confirmation</p>
            ) : null}
          </div>
        )}
      </div>

      {canDispatch && dc.status === 'draft' ? (
        <div className="rounded-xl border bg-white p-4 space-y-3 print:hidden">
          <h3 className="font-semibold">Dispatch e-signatures</h3>
          <p className="text-xs text-slate-500">Warehouse signature and name are required. Vendor signature is optional.</p>
          <div className="grid md:grid-cols-2 gap-3">
            <EsignBox
              label="Warehouse e-sign"
              url={dc.warehouse_dispatch_esign_url}
              previewUrl={pendingWhDispatch}
              canSign={canDispatch}
              onSign={() => setActiveSign('wh_dispatch')}
              signerName={whDispatchSignerName}
              onSignerNameChange={setWhDispatchSignerName}
            />
            <EsignBox
              label="Vendor e-sign"
              url={dc.vendor_dispatch_esign_url}
              previewUrl={pendingVendorDispatch}
              canSign={canDispatch}
              onSign={() => setActiveSign('vendor_dispatch')}
              signerName={vendorDispatchSignerName}
              onSignerNameChange={setVendorDispatchSignerName}
              optional
            />
          </div>
          <div className="rounded-lg border border-dashed p-3 space-y-2">
            <p className="text-xs font-semibold uppercase text-slate-500">Proof of dispatch (optional)</p>
            <p className="text-xs text-slate-500">Upload a photo of the handover or courier receipt if available.</p>
            {pendingDispatchPod ? (
              <div className="space-y-2">
                <img src={pendingDispatchPod} alt="Dispatch POD" className="w-full max-h-32 object-contain border rounded bg-white" />
                <button type="button" onClick={() => setPendingDispatchPod(null)} className="text-xs text-red-600">Remove photo</button>
              </div>
            ) : (
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                className="text-xs w-full"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5 * 1024 * 1024) {
                    toast.error('Image must be under 5 MB');
                    e.target.value = '';
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => setPendingDispatchPod(reader.result);
                  reader.onerror = () => toast.error('Could not read image');
                  reader.readAsDataURL(file);
                  e.target.value = '';
                }}
              />
            )}
          </div>
          {dispatchReady ? (
            <>
              {!effectiveShipBy ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Select send mode above (By Hand, Courier, or Porter) before confirming dispatch.
                </p>
              ) : null}
              <button
                type="button"
                disabled={dispatchBusy}
                onClick={completeDispatchSign}
                className="w-full py-2.5 rounded-lg bg-purple-700 text-white font-semibold text-sm disabled:opacity-50"
              >
                {dispatchBusy ? 'Confirming dispatch…' : 'Confirm dispatch to vendor'}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {canDispatch && dc.status === 'dispatched' && dc.warehouse_dispatch_esign_url ? (
        <div className="space-y-3 print:hidden">
          <div className="grid md:grid-cols-2 gap-3">
            <EsignBox label="Warehouse dispatch sign" url={dc.warehouse_dispatch_esign_url} signerName={dc.warehouse_dispatch_signer_name} />
            <EsignBox label="Vendor dispatch sign" url={dc.vendor_dispatch_esign_url} signerName={dc.vendor_dispatch_signer_name} optional />
          </div>
          {dc.dispatch_pod_path ? (
            <div className="rounded-xl border p-3">
              <p className="text-xs font-semibold uppercase text-slate-500 mb-2">Proof of dispatch</p>
              <img
                src={uploadUrl(dc.dispatch_pod_path)}
                alt="Dispatch POD"
                className="w-full max-h-48 object-contain border rounded bg-white"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {receiveOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => { setReceiveOpen(false); setReceiveTargetItem(null); }} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            {!receiveTargetItem ? (
              <>
                <h3 className="font-semibold">Receive Back — one laptop at a time</h3>
                <p className="text-xs text-slate-500">Verify serial, sign with your name, and receive each laptop individually. Timestamp recorded in IST.</p>
                <div className="border rounded-lg divide-y">
                  {dispatchedItems.map((item) => {
                    const prod = formatVrdcProductLines(item);
                    return (
                      <div key={item.id} className="p-3 flex items-center justify-between gap-2">
                        <div className="text-xs">
                          <p className="font-mono font-semibold">{item.ttspl_id} · {item.serial_number}</p>
                          <p className="text-slate-500">{prod.title}</p>
                        </div>
                        <button type="button" onClick={() => openReceiveForItem(item)} className="px-3 py-1.5 bg-green-700 text-white rounded-lg text-xs font-semibold shrink-0">
                          Receive
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={() => setReceiveOpen(false)} className="w-full px-4 py-2 border rounded-lg text-sm">Close</button>
              </>
            ) : (
              <>
                <h3 className="font-semibold">Receive {receiveTargetItem.ttspl_id}</h3>
                <p className="text-xs text-slate-500 font-mono">{receiveTargetItem.serial_number} · Ticket #{receiveTargetItem.ticket_id}</p>
                <div className="flex flex-wrap gap-3 text-xs">
                  <label className="inline-flex items-center gap-1">
                    <input type="radio" checked={receiveForm.receive_mode === 'repaired'} onChange={() => setReceiveForm((p) => ({ ...p, receive_mode: 'repaired' }))} />
                    Repaired return
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input type="radio" checked={receiveForm.receive_mode === 'replacement'} onChange={() => setReceiveForm((p) => ({ ...p, receive_mode: 'replacement' }))} />
                    Vendor replacement
                  </label>
                </div>
                {receiveForm.receive_mode === 'repaired' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-600">Scan/type serial to verify it matches the laptop sent for repair.</p>
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                      placeholder={`Expected: ${receiveTargetItem.serial_number || '—'}`}
                      value={receiveForm.verified_serial}
                      onChange={(e) => setReceiveForm((p) => ({ ...p, verified_serial: e.target.value }))}
                    />
                  </div>
                ) : (
                  <div className="space-y-2 text-xs">
                    <p className="text-slate-600 font-medium">Original config (sent for repair)</p>
                    <div className="bg-slate-50 border rounded-lg p-2 space-y-1">
                      {(() => {
                        const cfg = parseVrdcItemConfig(receiveTargetItem);
                        return (
                          <>
                            <p>{cfg.brand} {cfg.model} · Gen {cfg.generation || '—'}</p>
                            <p className="text-slate-500">{cfg.processor} · {cfg.ram} · {cfg.storage}</p>
                            <p className="font-mono">Replaces: {receiveTargetItem.ttspl_id} / {receiveTargetItem.serial_number}</p>
                          </>
                        );
                      })()}
                    </div>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="New serial number *" value={receiveForm.replacement_serial_number} onChange={(e) => setReceiveForm((p) => ({ ...p, replacement_serial_number: e.target.value }))} />
                    <div className="grid grid-cols-3 gap-2">
                      <input className="border rounded-lg px-2 py-1.5" placeholder="Brand *" value={receiveForm.replacement_brand} onChange={(e) => setReceiveForm((p) => ({ ...p, replacement_brand: e.target.value }))} />
                      <input className="border rounded-lg px-2 py-1.5" placeholder="Model *" value={receiveForm.replacement_model} onChange={(e) => setReceiveForm((p) => ({ ...p, replacement_model: e.target.value }))} />
                      <input className="border rounded-lg px-2 py-1.5" placeholder="Generation" value={receiveForm.replacement_generation} onChange={(e) => setReceiveForm((p) => ({ ...p, replacement_generation: e.target.value }))} />
                    </div>
                    <p className="text-[10px] text-slate-500">Creates Replacement Receive Challan (REP) and tags asset as replacement.</p>
                  </div>
                )}
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Receiver name *" value={receiveForm.wh_signer_name} onChange={(e) => setReceiveForm((p) => ({ ...p, wh_signer_name: e.target.value }))} />
                <button type="button" onClick={() => setActiveSign('wh_receive')} className="w-full py-2 border rounded-lg text-sm">
                  {receiveForm.wh_esign ? 'Signature captured ✓ — tap to re-sign' : 'Warehouse e-sign *'}
                </button>
                {receiveForm.wh_esign ? (
                  <img src={receiveForm.wh_esign} alt="Receive sign" className="w-full max-h-20 object-contain border rounded" />
                ) : null}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setReceiveTargetItem(null)} className="px-4 py-2 border rounded-lg text-sm">Back</button>
                  <button type="button" disabled={receiveBusy} onClick={submitReceiveOne} className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {receiveBusy ? 'Receiving…' : 'Confirm receive'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {activeSign ? (
        <SignatureModal
          title={
            activeSign === 'wh_dispatch' ? 'Warehouse signature'
              : activeSign === 'vendor_dispatch' ? 'Vendor signature (optional)'
                : 'Warehouse receive signature'
          }
          onClose={() => setActiveSign(null)}
          onSave={async (dataUrl) => {
            if (activeSign === 'wh_dispatch') setPendingWhDispatch(dataUrl);
            else if (activeSign === 'vendor_dispatch') setPendingVendorDispatch(dataUrl);
            else if (activeSign === 'wh_receive') setReceiveForm((prev) => ({ ...prev, wh_esign: dataUrl }));
          }}
        />
      ) : null}
    </div>
  );
}
