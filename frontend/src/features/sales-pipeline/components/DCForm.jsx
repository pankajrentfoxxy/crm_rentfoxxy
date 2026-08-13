/**
 * DCForm — Create Delivery Challan(s)
 *
 * Business rule: ONE DC = ONE delivery address.
 * When a SO has laptops going to different addresses,
 * multiple DCs are created automatically (one per address group).
 *
 * Steps:
 *  1. Select SO
 *  2. Review/edit address groups (each group = one DC)
 *  3. Choose dispatch mode
 *  4. Confirm + Create
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Package, MapPin, ChevronDown, ChevronUp, AlertTriangle, Edit2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { createDcsByAddress, getDCMeta, listSalesOrders, generateBluedartWaybill, downloadBluedartWaybillPdfByAwb } from '../salesPipelineApi';
import { applyPincodeAutofill } from '../../../utils/pincodeLookup';
import { downloadBlob } from '../salesPipelineUtils';
import { deliveryChallanDetailTo, salesOrderDcNavState } from '../salesPipelineUtils';
import { BillingAddressPanel } from '../../operation-management/components/CustomerAddressPanels';
import { sumDeclaredValueForUnits } from '../bluedartDeclaredValue';

// ── helpers ──────────────────────────────────────────────────────────────────

const parseAddr = (addr) => {
  if (!addr) return null;
  if (typeof addr !== 'string') return addr;
  try { return JSON.parse(addr); } catch { return null; }
};

/** Stable key for comparing addresses */
const addrKey = (addr) => {
  const a = parseAddr(addr);
  if (!a) return '__NO_ADDRESS__';
  return `${(a.address || '').trim().toLowerCase()}|${(a.pincode || a.zip_code || '').toString().trim()}|${(a.city || '').trim().toLowerCase()}`;
};

/** Short display of address */
const addrLine = (addr) => {
  const a = parseAddr(addr);
  if (!a) return 'No address set';
  return [a.address, a.city, a.state, a.pincode || a.zip_code].filter(Boolean).join(', ');
};

const isBlueDartCourier = (name) => /bluedart|blue\s*dart/i.test(String(name || ''));

function buildConsigneeFromAddress(address, meta) {
  const a = parseAddr(address) || {};
  const pin = String(a.pincode || a.zip_code || '').replace(/\D/g, '').slice(0, 6);
  const mobile = String(a.phone || a.mobile || meta?.customer_mobile || meta?.customer_phone || '').replace(/\D/g, '').slice(-10);
  const line = [a.address, a.city, a.state].filter(Boolean).join(', ') || a.address || '';
  return {
    name: a.name || meta?.customer_name || '',
    mobile,
    address: line,
    pincode: pin,
    email: a.email || meta?.customer_email || meta?.email || '',
    gst: meta?.gst_number || '',
    attention: a.name || meta?.customer_name || '',
  };
}

// ── AddressEditDrawer ─────────────────────────────────────────────────────────

function AddressEditDrawer({ address, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '', phone: '', address: '', city: '',
    state: '', pincode: '', landmark: '',
    ...(parseAddr(address) || {}),
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handlePincodeChange = async (e) => {
    const value = e.target.value;
    await applyPincodeAutofill(value, setForm, {
      pinKey: 'pincode',
      cityKey: 'city',
      stateKey: 'state',
      addressKey: 'address',
      fillAddressIfEmpty: true,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Edit Delivery Address</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          {[
            ['Contact Name', 'name', 'text'],
            ['Phone', 'phone', 'tel'],
            ['Address*', 'address', 'text'],
            ['City*', 'city', 'text'],
            ['State*', 'state', 'text'],
            ['Landmark', 'landmark', 'text'],
          ].map(([label, key, type]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <input type={type} value={form[key] || ''} onChange={set(key)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Pincode*</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={form.pincode || ''}
              onChange={handlePincodeChange}
              onBlur={handlePincodeChange}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="6-digit pincode auto-fills city/state"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          <button type="button"
            onClick={() => {
              if (!form.address?.trim() || !form.city?.trim() || !form.state?.trim()) {
                toast.error('Address, city and state are required');
                return;
              }
              onSave(form);
              onClose();
            }}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
            Save Address
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DispatchFields ────────────────────────────────────────────────────────────

function DispatchFields({
  shipBy, fields, onChange, deliveryTechnicians = [], requireVehicle = false,
  group = null, meta = null, soNumber = '',
}) {
  const set = (k) => (e) => onChange({ ...fields, [k]: e.target.value });
  const [bdBusy, setBdBusy] = useState(false);
  const [bdOpen, setBdOpen] = useState(false);
  const [bdForm, setBdForm] = useState({
    name: '', mobile: '', address: '', pincode: '',
    declaredValue: '', weight: '2.50', pieceCount: '1',
  });

  useEffect(() => {
    if (shipBy !== 'by_courier') return;
    const c = buildConsigneeFromAddress(group?.address, meta);
    const selected = (group?.serials || []).filter((s) => s.selected && s.qc_status === 'passed');
    const pieces = selected.length || 1;
    const declared = sumDeclaredValueForUnits(selected);
    setBdForm((f) => ({
      ...f,
      name: c.name || f.name,
      mobile: c.mobile || f.mobile,
      address: c.address || f.address,
      pincode: c.pincode || f.pincode,
      pieceCount: String(pieces),
      weight: (2.5 * pieces).toFixed(2),
      declaredValue: declared != null ? String(declared) : f.declaredValue,
    }));
    if (isBlueDartCourier(fields.courier_name) || !fields.courier_name) {
      setBdOpen(true);
    }
  }, [shipBy, group?.address, group?.serials, meta, fields.courier_name]);

  const generateAwb = async () => {
    const consignee = {
      name: bdForm.name.trim(),
      mobile: bdForm.mobile.trim(),
      address: bdForm.address.trim(),
      pincode: bdForm.pincode.trim(),
      email: meta?.customer_email || meta?.email || '',
      gst: meta?.gst_number || '',
      attention: bdForm.name.trim(),
    };
    if (!consignee.name || !consignee.address || !consignee.pincode || !consignee.mobile) {
      toast.error('Fill consignee name, mobile, address and pincode for BlueDart');
      return;
    }
    const declaredValue = Number(bdForm.declaredValue);
    if (!bdForm.declaredValue?.trim() || Number.isNaN(declaredValue) || declaredValue <= 0) {
      toast.error('Enter declared value (₹)');
      return;
    }
    setBdBusy(true);
    try {
      const { data } = await generateBluedartWaybill({
        consignee,
        services: {
          pieceCount: Number(bdForm.pieceCount) || 1,
          actualWeight: bdForm.weight,
          declaredValue,
          itemName: 'LAPTOP',
        },
        credit_reference_no: `SO${String(soNumber || '').replace(/[^A-Za-z0-9]/g, '').slice(-8)}${Date.now().toString(36).toUpperCase()}`.slice(0, 20),
      });
      const awb = data?.data?.awb_number;
      const pdfPath = data?.data?.pdf_path || null;
      const pdfSaved = Boolean(data?.data?.pdf_saved && pdfPath);
      if (!awb) {
        toast.error(data?.message || 'No AWB returned');
        return;
      }
      onChange({
        ...fields,
        courier_name: fields.courier_name?.trim() || 'BlueDart',
        awb_number: awb,
        bluedart_awb_pdf_path: pdfPath,
        bluedart_pdf_ready: pdfSaved,
      });
      if (pdfSaved) {
        toast.success(`AWB ${awb} generated — PDF saved. Click Download PDF.`);
      } else {
        toast.success(`AWB ${awb} generated (PDF not returned by BlueDart)`);
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'BlueDart AWB failed');
    } finally {
      setBdBusy(false);
    }
  };

  const downloadAwbPdf = async () => {
    const awb = fields.awb_number;
    if (!awb) {
      toast.error('Generate BlueDart AWB first');
      return;
    }
    setBdBusy(true);
    try {
      const pdfRes = await downloadBluedartWaybillPdfByAwb(awb);
      downloadBlob(new Blob([pdfRes.data], { type: 'application/pdf' }), `BlueDart_${awb}.pdf`);
      toast.success('BlueDart PDF downloaded');
    } catch {
      toast.error('PDF not found — generate waybill again');
    } finally {
      setBdBusy(false);
    }
  };

  if (shipBy === 'by_courier') {
    return (
      <div className="space-y-2 mt-2">
        <div className="grid grid-cols-2 gap-2">
          <select
            className="border rounded-lg px-3 py-2 text-sm"
            value={
              isBlueDartCourier(fields.courier_name) ? 'BlueDart'
                : (fields.courier_name === 'Other' || (fields.courier_name && !isBlueDartCourier(fields.courier_name)) ? 'Other' : '')
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'BlueDart') {
                onChange({ ...fields, courier_name: 'BlueDart' });
                setBdOpen(true);
              } else if (v === 'Other') {
                onChange({ ...fields, courier_name: fields.courier_name && !isBlueDartCourier(fields.courier_name) ? fields.courier_name : '' });
                setBdOpen(false);
              } else {
                onChange({ ...fields, courier_name: '' });
              }
            }}
          >
            <option value="">Courier*</option>
            <option value="BlueDart">BlueDart</option>
            <option value="Other">Other courier</option>
          </select>
          <input className="border rounded-lg px-3 py-2 text-sm" placeholder="AWB Number"
            value={fields.awb_number || ''} onChange={set('awb_number')} />
        </div>
        {!isBlueDartCourier(fields.courier_name) && fields.courier_name !== undefined && (
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Courier Name*"
            value={isBlueDartCourier(fields.courier_name) ? '' : (fields.courier_name || '')}
            onChange={set('courier_name')} />
        )}
        <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Tracking URL (optional)"
          value={fields.courier_tracking_url || ''} onChange={set('courier_tracking_url')} />

        {isBlueDartCourier(fields.courier_name) && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-blue-900">BlueDart GenerateWayBill</p>
              <button type="button" className="text-[11px] text-blue-700 underline" onClick={() => setBdOpen((v) => !v)}>
                {bdOpen ? 'Hide' : 'Show'} details
              </button>
            </div>
            {bdOpen && (
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2 block">
                  <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Consignee name *</span>
                  <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white" placeholder="Name"
                    value={bdForm.name} onChange={(e) => setBdForm((f) => ({ ...f, name: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Mobile *</span>
                  <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white" placeholder="10-digit mobile"
                    value={bdForm.mobile} onChange={(e) => setBdForm((f) => ({ ...f, mobile: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Pincode *</span>
                  <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white" placeholder="6-digit pincode"
                    value={bdForm.pincode} onChange={(e) => setBdForm((f) => ({ ...f, pincode: e.target.value }))} />
                </label>
                <label className="col-span-2 block">
                  <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Address *</span>
                  <textarea className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white min-h-[56px]" placeholder="Full delivery address"
                    value={bdForm.address} onChange={(e) => setBdForm((f) => ({ ...f, address: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Weight (kg)</span>
                  <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white" placeholder="e.g. 2.50"
                    value={bdForm.weight} onChange={(e) => setBdForm((f) => ({ ...f, weight: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Declared value (₹) *</span>
                  <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white" placeholder="Auto from i5/i7/R7 + gen"
                    value={bdForm.declaredValue} onChange={(e) => setBdForm((f) => ({ ...f, declaredValue: e.target.value }))} />
                  <span className="block text-[10px] text-slate-500 mt-0.5">
                    Autofilled from processor + generation matrix (editable)
                  </span>
                </label>
                <label className="block">
                  <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Pieces</span>
                  <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white" placeholder="1"
                    value={bdForm.pieceCount} onChange={(e) => setBdForm((f) => ({ ...f, pieceCount: e.target.value }))} />
                </label>
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={bdBusy}
                onClick={generateAwb}
                className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {bdBusy ? 'Generating…' : (fields.awb_number ? 'Regenerate Waybill' : 'Generate Waybill')}
              </button>
              <button
                type="button"
                disabled={bdBusy || !fields.awb_number}
                onClick={downloadAwbPdf}
                className="flex-1 py-2 rounded-lg border border-sky-400 bg-sky-50 text-sky-900 text-xs font-semibold hover:bg-sky-100 disabled:opacity-50"
              >
                Download PDF
              </button>
            </div>
            {fields.awb_number && (
              <p className="text-[11px] text-emerald-700">
                AWB <strong className="font-mono">{fields.awb_number}</strong>
                {fields.bluedart_pdf_ready || fields.bluedart_awb_pdf_path
                  ? ' · PDF saved — click Download PDF'
                  : ' · generate again if PDF download fails'}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }
  if (shipBy === 'by_porter') return (
    <div className="space-y-2 mt-2">
      <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Porter Booking/Tracking ID*"
        value={fields.porter_tracking_id || ''} onChange={set('porter_tracking_id')} />
      <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Porter Order ID (optional)"
        value={fields.porter_order_id || ''} onChange={set('porter_order_id')} />
      <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Booking URL (optional)"
        value={fields.porter_booking_url || ''} onChange={set('porter_booking_url')} />
      {requireVehicle && (
        <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Vehicle number* (E-Way Bill)"
          value={fields.vehicle_number || ''} onChange={set('vehicle_number')} />
      )}
    </div>
  );
  if (shipBy === 'by_hand') return (
    <div className="mt-2 space-y-2">
      <select className="w-full border rounded-lg px-3 py-2 text-sm"
        value={fields.delivery_person_id || ''} onChange={set('delivery_person_id')}>
        <option value="">Select delivery technician*</option>
        {deliveryTechnicians.filter((t) => t.is_active).map((t) => (
          <option key={t.technician_id} value={t.technician_id}>
            {t.first_name} {t.last_name || ''}{t.phone ? ` — ${t.phone}` : ''}
          </option>
        ))}
      </select>
      {!deliveryTechnicians.length && (
        <p className="text-xs text-amber-600 mt-1">
          No delivery technicians found. Add via Sales Pipeline → Delivery Technicians.
        </p>
      )}
      {requireVehicle && (
        <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Vehicle number* (E-Way Bill)"
          value={fields.vehicle_number || ''} onChange={set('vehicle_number')} />
      )}
    </div>
  );
  return null;
}

// ── DcGroup card ─────────────────────────────────────────────────────────────

function DcGroupCard({
  groupIndex, group, meta, shipBy, dispatchFields, onDispatchChange,
  onAddressEdit, onToggleSerial, requireVehicle = false, soNumber = '',
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingAddress, setEditingAddress] = useState(false);

  const allPassed = group.serials.every((s) => s.qc_status === 'passed');
  const someNotPassed = group.serials.some((s) => s.qc_status !== 'passed');

  return (
    <div className="border rounded-xl overflow-hidden bg-white">
      {/* Group header */}
      <div className={`px-4 py-3 flex items-start justify-between
        ${allPassed ? 'bg-emerald-50 border-b border-emerald-100' : 'bg-amber-50 border-b border-amber-100'}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <MapPin className={`w-4 h-4 flex-shrink-0 ${allPassed ? 'text-emerald-600' : 'text-amber-500'}`} />
            <span className="text-sm font-semibold text-gray-900">
              DC #{groupIndex + 1}
              {group.is_wfh && (
                <span className="ml-2 px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded text-[10px] font-medium">WFH</span>
              )}
            </span>
            <span className="ml-auto text-xs text-gray-500">{group.serials.length} laptop(s)</span>
          </div>
          <p className="text-xs text-gray-600 mt-0.5 ml-6 truncate">{addrLine(group.address)}</p>
          {group.address?.name && (
            <p className="text-xs font-medium text-gray-700 mt-0.5 ml-6">{group.address.name}</p>
          )}
          {group.address?.phone && (
            <p className="text-xs text-gray-500 ml-6">{group.address.phone}</p>
          )}
        </div>
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          <button type="button" onClick={() => setEditingAddress(true)}
            className="p-1.5 rounded hover:bg-white/60 text-gray-500" title="Edit address">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => setExpanded((e) => !e)}
            className="p-1.5 rounded hover:bg-white/60 text-gray-500">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Laptops in this group */}
      {expanded && (
        <div className="divide-y">
          {group.serials.map((s) => (
            <div key={s.allocation_id}
              className={`flex items-center justify-between px-4 py-2 ${
                s.qc_status !== 'passed' ? 'bg-red-50' : ''
              }`}>
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={s.selected !== false}
                  disabled={s.qc_status !== 'passed'}
                  onChange={() => onToggleSerial(groupIndex, s.allocation_id)}
                  className="rounded" />
                <div>
                  <p className="font-mono text-xs text-blue-700 font-medium">{s.ttspl_id || s.serial_number}</p>
                  <p className="text-[11px] text-gray-500">
                    {[s.brand, s.model, s.processor, s.generation, s.ram, s.storage]
                      .filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  s.qc_status === 'passed'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {s.qc_status === 'passed' ? 'QC Passed' : `QC ${s.qc_status}`}
                </span>
              </div>
            </div>
          ))}

          {someNotPassed && (
            <div className="px-4 py-2 bg-red-50">
              <p className="text-xs text-red-700">
                Laptops that haven't passed QC cannot be dispatched and will be skipped.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Dispatch details for this group */}
      {expanded && shipBy && (
        <div className="px-4 py-3 border-t bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Dispatch Details</p>
          <DispatchFields
            shipBy={shipBy}
            fields={dispatchFields}
            onChange={onDispatchChange}
            deliveryTechnicians={meta?.delivery_technicians || []}
            requireVehicle={requireVehicle}
            group={group}
            meta={meta}
            soNumber={soNumber}
          />
        </div>
      )}

      {editingAddress && (
        <AddressEditDrawer
          address={group.address}
          onSave={(addr) => { onAddressEdit(groupIndex, addr); setEditingAddress(false); }}
          onClose={() => setEditingAddress(false)}
        />
      )}
    </div>
  );
}

// ── Main DCForm ───────────────────────────────────────────────────────────────

export default function DCForm({ open, onClose, prefillSo, soScope, returnTab = 'dcs' }) {
  const navigate = useNavigate();

  const [salesOrders, setSalesOrders] = useState([]);
  const [soNumber, setSoNumber] = useState(prefillSo || '');

  const [meta, setMeta] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(false);

  const [dcGroups, setDcGroups] = useState([]);

  const [shipBy, setShipBy] = useState('');
  const [groupDispatch, setGroupDispatch] = useState({});

  const [saving, setSaving] = useState(false);

  const isSale = meta?.quotation_type === 'sale' || meta?.quotation_type === 'sales';
  const requireVehicle = isSale && (shipBy === 'by_porter' || shipBy === 'by_hand');

  // ── Load SOs ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    listSalesOrders({ limit: 200 })
      .then((res) => setSalesOrders(res.data?.sales_orders || []))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (prefillSo && open) setSoNumber(prefillSo);
  }, [prefillSo, open]);

  // ── Build address groups from attached serials ────────────────────────────
  const buildGroups = (data) => {
    const attached = (data.attached_serials || []);

    if (!attached.length) {
      setDcGroups([]);
      setGroupDispatch({});
      return;
    }

    const groupMap = new Map();

    for (const serial of attached) {
      const addr = parseAddr(serial.delivery_address);
      const key = addrKey(addr);

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          address: addr || data.shipping_address || null,
          is_wfh: serial.is_wfh || false,
          serials: [],
        });
      }
      groupMap.get(key).serials.push({
        ...serial,
        selected: serial.qc_status === 'passed',
      });
    }

    const groups = Array.from(groupMap.values());

    // If NO addresses were set on serials, fall back to the SO shipping/billing address.
    if (groups.length === 1 && groups[0].key === '__NO_ADDRESS__') {
      groups[0].address = data.shipping_address || data.billing_address || null;
    }

    setDcGroups(groups);

    const initDispatch = {};
    groups.forEach((_, i) => { initDispatch[i] = {}; });
    setGroupDispatch(initDispatch);
  };

  // ── Load meta + build groups when SO selected ─────────────────────────────
  useEffect(() => {
    if (!open || !soNumber) {
      setMeta(null);
      setDcGroups([]);
      return;
    }
    setLoadingMeta(true);
    setMeta(null);
    setDcGroups([]);
    setShipBy('');

    getDCMeta(soNumber)
      .then((res) => {
        const data = res.data;
        setMeta(data);
        buildGroups(data);
      })
      .catch(() => toast.error('Failed to load SO data'))
      .finally(() => setLoadingMeta(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, soNumber]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleToggleSerial = (groupIndex, allocationId) => {
    setDcGroups((prev) => prev.map((g, i) =>
      i !== groupIndex ? g : {
        ...g,
        serials: g.serials.map((s) =>
          s.allocation_id === allocationId ? { ...s, selected: !s.selected } : s
        ),
      }
    ));
  };

  const handleAddressEdit = (groupIndex, newAddress) => {
    setDcGroups((prev) => prev.map((g, i) =>
      i !== groupIndex ? g : { ...g, address: newAddress }
    ));
  };

  const handleGroupDispatchChange = (groupIndex, fields) => {
    setGroupDispatch((prev) => ({ ...prev, [groupIndex]: fields }));
  };

  // Validation summary
  const validation = useMemo(() => {
    const errors = [];
    const warnings = [];

    if (!dcGroups.length) {
      return { errors, warnings, valid: false, dcCount: 0, totalLaptops: 0 };
    }

    const activeDcGroups = dcGroups.filter((g) =>
      g.serials.some((s) => s.selected && s.qc_status === 'passed')
    );

    if (!activeDcGroups.length) {
      errors.push('No QC-passed laptops selected.');
    }

    if (!shipBy) {
      errors.push('Select dispatch mode (Courier / Porter / Inhouse).');
    }

    activeDcGroups.forEach((g) => {
      const idx = dcGroups.indexOf(g);
      const gd = groupDispatch[idx] || {};
      if (shipBy === 'by_courier' && !gd.courier_name?.trim()) {
        errors.push(`DC #${idx + 1}: Courier name is required.`);
      }
      if (shipBy === 'by_porter' && !gd.porter_tracking_id?.trim()) {
        errors.push(`DC #${idx + 1}: Porter tracking ID is required.`);
      }
      if (shipBy === 'by_hand' && !gd.delivery_person_id) {
        errors.push(`DC #${idx + 1}: Select a delivery technician.`);
      }
      if (requireVehicle && !gd.vehicle_number?.trim()) {
        errors.push(`DC #${idx + 1}: Vehicle number is required for sale Porter / Inhouse dispatch.`);
      }
    });

    activeDcGroups.forEach((g) => {
      const idx = dcGroups.indexOf(g);
      if (!g.address) {
        warnings.push(`DC #${idx + 1}: No delivery address set — will use billing address.`);
      }
    });

    const notPassed = dcGroups.flatMap((g) =>
      g.serials.filter((s) => s.qc_status !== 'passed')
    );
    if (notPassed.length) {
      warnings.push(`${notPassed.length} laptop(s) haven't passed QC — they will be skipped.`);
    }

    const totalLaptops = activeDcGroups.reduce(
      (sum, g) => sum + g.serials.filter((s) => s.selected && s.qc_status === 'passed').length, 0
    );

    return {
      errors,
      warnings,
      valid: errors.length === 0,
      dcCount: activeDcGroups.length,
      totalLaptops,
    };
  }, [dcGroups, shipBy, groupDispatch, requireVehicle]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!validation.valid) {
      validation.errors.forEach((e) => toast.error(e));
      return;
    }

    setSaving(true);
    try {
      const groups = dcGroups
        .map((g, i) => {
          const passedSelected = g.serials.filter(
            (s) => s.selected && s.qc_status === 'passed'
          );
          if (!passedSelected.length) return null;
          return {
            delivery_address: g.address || meta?.billing_address || null,
            is_wfh: g.is_wfh,
            allocation_ids: passedSelected.map((s) => s.allocation_id),
            ...groupDispatch[i],
          };
        })
        .filter(Boolean);

      const res = await createDcsByAddress({
        sales_order_number: soNumber,
        ship_by: shipBy,
        courier_name: groups[0]?.courier_name,
        courier_tracking_url: groups[0]?.courier_tracking_url,
        dc_groups: groups,
      });

      const { dc_numbers, dcs_created, first_dc, bluedart_awbs } = res.data;

      if (dcs_created === 1) {
        toast.success(`DC created: ${first_dc}`);
      } else {
        toast.success(`${dcs_created} DCs created: ${dc_numbers.join(', ')}`);
      }
      const awbOk = (bluedart_awbs || []).filter((r) => r.awb_number && !r.error);
      if (awbOk.length) {
        toast.success(`BlueDart AWB: ${awbOk.map((r) => r.awb_number).join(', ')}`);
      }
      const awbErr = (bluedart_awbs || []).find((r) => r.error);
      if (awbErr) {
        toast.error(`BlueDart AWB: ${awbErr.error}`);
      }

      onClose();
      if (first_dc) {
        navigate(deliveryChallanDetailTo(
          first_dc,
          salesOrderDcNavState({ salesOrderNumber: soNumber, soScope, returnTab })
        ));
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="relative w-full max-w-[640px] bg-white shadow-xl flex flex-col max-h-full overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
          <h2 className="font-semibold text-gray-900">Create Delivery Challan</h2>
            <p className="text-xs text-gray-400 mt-0.5">One DC per delivery address</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* SO selector */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sales Order</label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={soNumber} onChange={(e) => setSoNumber(e.target.value)}>
              <option value="">Select Sales Order…</option>
              {salesOrders.map((so) => (
                <option key={so.sales_order_number} value={so.sales_order_number}>
                  {so.sales_order_number} — {so.customer_name}
                </option>
              ))}
            </select>
          </div>

          {loadingMeta && (
            <div className="text-center py-8">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-sm text-gray-500">Loading order details…</p>
            </div>
          )}

          {meta && !loadingMeta && !dcGroups.length && (
            <div className="text-center py-8 bg-amber-50 rounded-xl border border-amber-100">
              <Package className="w-10 h-10 text-amber-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-amber-800">No laptops attached to this SO yet</p>
              <p className="text-xs text-amber-600 mt-1">
                Go to Sales Order → Laptops & QC to attach and pass QC first.
              </p>
                  </div>
          )}

          {dcGroups.length > 0 && (
            <>
              {/* Summary banner */}
              <div className={`rounded-xl px-4 py-3 border text-sm ${
                validation.valid
                  ? 'bg-blue-50 border-blue-100 text-blue-800'
                  : 'bg-amber-50 border-amber-100 text-amber-800'
              }`}>
                <p className="font-semibold">
                  {validation.dcCount} DC(s) will be created · {validation.totalLaptops} laptop(s)
                </p>
                {dcGroups.length > 1 && (
                  <p className="text-xs mt-0.5">
                    Laptops have {dcGroups.length} different delivery addresses → {dcGroups.length} separate DCs.
                  </p>
                )}
              </div>

              {/* Global dispatch mode */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Dispatch Mode* <span className="text-gray-400">(applies to all DCs)</span>
                </label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  value={shipBy} onChange={(e) => {
                    const mode = e.target.value;
                    setShipBy(mode);
                    const init = {};
                    dcGroups.forEach((_, i) => {
                      init[i] = mode === 'by_courier' ? { courier_name: 'BlueDart' } : {};
                    });
                    setGroupDispatch(init);
                  }}>
                  <option value="">Select dispatch mode…</option>
                  <option value="by_courier">Courier (Bluedart, Delhivery etc.)</option>
                  <option value="by_porter">Porter / Last-mile service</option>
                  <option value="by_hand">Inhouse Delivery Technician</option>
                </select>
                {isSale && (
                  <p className="text-xs text-indigo-700 mt-2">
                    Sale order: DC will be created now. Accounts will be emailed to prepare E-Invoice.
                    If DC value exceeds ₹50,000, E-Way Bill is required on upload. Vehicle number is required for Porter / Inhouse.
                  </p>
                )}
                        </div>

              {/* DC Group Cards */}
              <div className="space-y-3">
                {dcGroups.map((group, i) => (
                  <DcGroupCard
                    key={group.key}
                    groupIndex={i}
                    group={group}
                    meta={meta}
                    shipBy={shipBy}
                    dispatchFields={groupDispatch[i] || {}}
                    onDispatchChange={(fields) => handleGroupDispatchChange(i, fields)}
                    onAddressEdit={handleAddressEdit}
                    onToggleSerial={handleToggleSerial}
                    requireVehicle={requireVehicle}
                    soNumber={soNumber}
                  />
                      ))}
                    </div>

              {/* Billing address (always shown) */}
              {meta?.billing_address && (
                <BillingAddressPanel
                  billing={meta.billing_address}
                  gstNumber={meta.gst_number}
                />
              )}

              {/* Validation errors */}
              {validation.errors.length > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-1">
                  {validation.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-700 flex items-start gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{e}
                    </p>
                  ))}
                </div>
              )}

              {/* Warnings */}
              {validation.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-1">
                  {validation.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700 flex items-start gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{w}
                </p>
              ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 flex items-center justify-between gap-3">
          <div className="text-xs text-gray-400">
            {validation.dcCount > 0 && `${validation.dcCount} DC(s) · ${validation.totalLaptops} laptop(s)`}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !validation.valid || !dcGroups.length}
              onClick={submit}
              className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {saving
                ? 'Creating…'
                : validation.dcCount > 1
                  ? `Create ${validation.dcCount} DCs`
                  : 'Create DC'
              }
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
