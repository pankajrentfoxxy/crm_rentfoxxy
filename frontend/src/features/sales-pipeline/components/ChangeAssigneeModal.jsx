import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { updateDcAssignment, generateBluedartWaybill } from '../salesPipelineApi';
import { sumDeclaredValueForUnits } from '../bluedartDeclaredValue';

function initialMode(head) {
  if (head.dispatch_mode) return head.dispatch_mode;
  if (head.ship_by === 'by_hand') return 'inhouse';
  if (head.ship_by === 'by_porter') return 'porter';
  return 'courier';
}

function parseAddr(addr) {
  if (!addr) return {};
  if (typeof addr === 'object') return addr;
  try { return JSON.parse(addr); } catch { return {}; }
}

const isBlueDartCourier = (name) => /bluedart|blue\s*dart/i.test(String(name || ''));

function buildConsigneeFromHead(head) {
  const shipping = parseAddr(head.customer_shipping_address);
  const pin = String(shipping.pincode || shipping.zip_code || '').replace(/\D/g, '').slice(0, 6);
  const mobile = String(
    shipping.phone || shipping.mobile || head.d_customer_mobile || head.customer_mobile || ''
  ).replace(/\D/g, '').slice(-10);
  const address = [shipping.address, shipping.city, shipping.state].filter(Boolean).join(', ')
    || shipping.address
    || '';
  return {
    name: shipping.name || head.customer_name || '',
    mobile,
    address,
    pincode: pin,
    email: shipping.email || head.email || head.customer_email || '',
    gst: head.gst_number || '',
    attention: shipping.name || head.customer_name || '',
  };
}

export default function ChangeAssigneeModal({
  open,
  dcNumber,
  head = {},
  units = [],
  technicians = [],
  onClose,
  onSaved,
}) {
  const [mode, setMode] = useState('courier');
  const [form, setForm] = useState({
    courier_name: '',
    awb_number: '',
    courier_tracking_url: '',
    porter_booking_id: '',
    porter_tracking_id: '',
    porter_order_id: '',
    porter_booking_url: '',
    delivery_person_id: '',
    dispatch_date: '',
    estimated_delivery: '',
    reason: '',
  });
  const [saving, setSaving] = useState(false);
  const [bdBusy, setBdBusy] = useState(false);
  const [bdOpen, setBdOpen] = useState(true);
  const [bdForm, setBdForm] = useState({
    name: '', mobile: '', address: '', pincode: '',
    declaredValue: '', weight: '2.50', pieceCount: '1',
  });

  useEffect(() => {
    if (!open) return;
    const m = initialMode(head);
    setMode(m);
    const courierName = head.courier_name || (m === 'courier' ? 'BlueDart' : '');
    setForm({
      courier_name: courierName,
      awb_number: head.awb_number || '',
      courier_tracking_url: head.courier_tracking_url || '',
      porter_booking_id: head.porter_booking_id || '',
      porter_tracking_id: head.porter_tracking_id || head.porter_booking_id || '',
      porter_order_id: head.porter_order_id || '',
      porter_booking_url: head.porter_booking_url || '',
      delivery_person_id: head.delivery_person_id ? String(head.delivery_person_id) : '',
      dispatch_date: head.dispatched_at ? String(head.dispatched_at).slice(0, 10) : '',
      estimated_delivery: head.estimated_delivery ? String(head.estimated_delivery).slice(0, 10) : '',
      reason: '',
    });
    const c = buildConsigneeFromHead(head);
    const pieces = Math.max(1, Number(head.quantity || head.main_qty || units.length || 1));
    const unitList = (units || []).length
      ? units
      : [{ processor: head.processor, generation: head.generation }];
    const declared = sumDeclaredValueForUnits(unitList);
    setBdForm({
      name: c.name,
      mobile: c.mobile,
      address: c.address,
      pincode: c.pincode,
      declaredValue: declared != null ? String(declared) : '',
      weight: (2.5 * pieces).toFixed(2),
      pieceCount: String(pieces),
    });
    setBdOpen(isBlueDartCourier(courierName) || m === 'courier');
  }, [open, head, units]);

  if (!open) return null;

  const generateAwb = async () => {
    const consignee = {
      name: bdForm.name.trim(),
      mobile: bdForm.mobile.trim(),
      address: bdForm.address.trim(),
      pincode: bdForm.pincode.trim(),
      email: head.email || head.customer_email || '',
      gst: head.gst_number || '',
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
      const soKey = String(head.sales_order_number || dcNumber || '')
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(-8);
      const { data } = await generateBluedartWaybill({
        consignee,
        services: {
          pieceCount: Number(bdForm.pieceCount) || 1,
          actualWeight: bdForm.weight,
          declaredValue,
          itemName: [head.brand, head.model_name].filter(Boolean).join(' ') || 'LAPTOP',
        },
        credit_reference_no: `SO${soKey}${Date.now().toString(36).toUpperCase()}`.slice(0, 20),
      });
      const awb = data?.data?.awb_number;
      if (!awb) {
        toast.error(data?.message || 'No AWB returned');
        return;
      }
      setForm((f) => ({
        ...f,
        courier_name: f.courier_name?.trim() || 'BlueDart',
        awb_number: awb,
      }));
      toast.success(`BlueDart AWB: ${awb}`);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'BlueDart AWB failed');
    } finally {
      setBdBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (mode === 'courier' && (!form.courier_name?.trim() || !form.awb_number?.trim())) {
      toast.error('Courier name and AWB are required');
      return;
    }
    if (mode === 'porter' && !String(form.porter_tracking_id || form.porter_booking_id).trim()) {
      toast.error('Porter booking / tracking ID is required');
      return;
    }
    if (mode === 'inhouse' && !form.delivery_person_id) {
      toast.error('Select a delivery technician');
      return;
    }
    setSaving(true);
    try {
      const { data } = await updateDcAssignment(dcNumber, {
        dispatch_mode: mode,
        ...form,
        reason: form.reason?.trim() || undefined,
      });
      toast.success(data?.message || 'Delivery details updated — DC PDF regenerated');
      onSaved?.(data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update delivery details');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Change delivery details</h2>
        <p className="text-xs text-gray-500 mb-4">
          Update delivery mode, assignee, dispatch date, and estimated delivery before pickup starts. Changes are logged and the DC PDF is regenerated.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            {['courier', 'porter', 'inhouse'].map((m) => (
              <label key={m} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="dispatch_mode"
                  checked={mode === m}
                  onChange={() => {
                    setMode(m);
                    if (m === 'courier' && !form.courier_name) {
                      setForm((f) => ({ ...f, courier_name: 'BlueDart' }));
                      setBdOpen(true);
                    }
                  }}
                />
                {m === 'inhouse' ? 'By Hand (Technician)' : m.charAt(0).toUpperCase() + m.slice(1)}
              </label>
            ))}
          </div>
          {mode === 'courier' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-gray-600">
                  Courier *
                  <select
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    value={
                      isBlueDartCourier(form.courier_name) ? 'BlueDart'
                        : (form.courier_name ? 'Other' : '')
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'BlueDart') {
                        setForm((f) => ({ ...f, courier_name: 'BlueDart' }));
                        setBdOpen(true);
                      } else if (v === 'Other') {
                        setForm((f) => ({
                          ...f,
                          courier_name: isBlueDartCourier(f.courier_name) ? '' : f.courier_name,
                        }));
                        setBdOpen(false);
                      } else {
                        setForm((f) => ({ ...f, courier_name: '' }));
                      }
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="BlueDart">BlueDart</option>
                    <option value="Other">Other courier</option>
                  </select>
                </label>
                <label className="block text-xs text-gray-600">
                  AWB Number *
                  <input
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="AWB Number *"
                    value={form.awb_number}
                    onChange={(e) => setForm((f) => ({ ...f, awb_number: e.target.value }))}
                  />
                </label>
              </div>
              {!isBlueDartCourier(form.courier_name) && (
                <label className="block text-xs text-gray-600">
                  Courier name *
                  <input
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="Courier Name *"
                    value={form.courier_name}
                    onChange={(e) => setForm((f) => ({ ...f, courier_name: e.target.value }))}
                  />
                </label>
              )}
              <label className="block text-xs text-gray-600">
                Tracking URL (optional)
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Tracking URL (optional)"
                  value={form.courier_tracking_url}
                  onChange={(e) => setForm((f) => ({ ...f, courier_tracking_url: e.target.value }))}
                />
              </label>

              {isBlueDartCourier(form.courier_name) && (
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
                        <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white"
                          value={bdForm.name} onChange={(e) => setBdForm((f) => ({ ...f, name: e.target.value }))} />
                      </label>
                      <label className="block">
                        <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Mobile *</span>
                        <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white"
                          value={bdForm.mobile} onChange={(e) => setBdForm((f) => ({ ...f, mobile: e.target.value }))} />
                      </label>
                      <label className="block">
                        <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Pincode *</span>
                        <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white"
                          value={bdForm.pincode} onChange={(e) => setBdForm((f) => ({ ...f, pincode: e.target.value }))} />
                      </label>
                      <label className="col-span-2 block">
                        <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Address *</span>
                        <textarea className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white min-h-[56px]"
                          value={bdForm.address} onChange={(e) => setBdForm((f) => ({ ...f, address: e.target.value }))} />
                      </label>
                      <label className="block">
                        <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Weight (kg)</span>
                        <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white"
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
                        <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white"
                          value={bdForm.pieceCount} onChange={(e) => setBdForm((f) => ({ ...f, pieceCount: e.target.value }))} />
                      </label>
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={bdBusy}
                    onClick={generateAwb}
                    className="w-full py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {bdBusy ? 'Generating AWB…' : (form.awb_number ? 'Regenerate BlueDart AWB' : 'Generate BlueDart AWB')}
                  </button>
                  {form.awb_number && (
                    <p className="text-[11px] text-emerald-700">AWB ready — click Save to store it on the DC.</p>
                  )}
                </div>
              )}
            </div>
          )}
          {mode === 'porter' && (
            <>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Porter Tracking / Booking ID *" value={form.porter_tracking_id} onChange={(e) => setForm((f) => ({ ...f, porter_tracking_id: e.target.value, porter_booking_id: e.target.value }))} />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Porter Order ID (optional)" value={form.porter_order_id} onChange={(e) => setForm((f) => ({ ...f, porter_order_id: e.target.value }))} />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Booking URL (optional)" value={form.porter_booking_url} onChange={(e) => setForm((f) => ({ ...f, porter_booking_url: e.target.value }))} />
            </>
          )}
          {mode === 'inhouse' && (
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.delivery_person_id} onChange={(e) => setForm((f) => ({ ...f, delivery_person_id: e.target.value }))}>
              <option value="">Select technician *</option>
              {technicians.map((t) => (
                <option key={t.technician_id} value={t.technician_id}>
                  {[t.first_name, t.last_name].filter(Boolean).join(' ') || t.email || `Technician #${t.technician_id}`}
                </option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs text-gray-600">
              Dispatch date
              <input
                type="date"
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.dispatch_date}
                onChange={(e) => setForm((f) => ({ ...f, dispatch_date: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-gray-600">
              Estimated delivery
              <input
                type="date"
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.estimated_delivery}
                onChange={(e) => setForm((f) => ({ ...f, estimated_delivery: e.target.value }))}
              />
            </label>
          </div>
          <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} placeholder="Reason for change (optional)" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save & regenerate PDF'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
