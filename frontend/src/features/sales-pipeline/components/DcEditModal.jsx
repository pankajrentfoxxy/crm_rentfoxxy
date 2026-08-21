import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { updateDC } from '../salesPipelineApi';
import { INDIAN_STATES, resolveStateSelectValue } from '../../../constants/indianStates';
import { applyPincodeAutofill } from '../../../utils/pincodeLookup';

function parseAddr(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return { address: v }; }
}

function mapAddress(raw, extras = {}) {
  const a = parseAddr(raw);
  return {
    name: a.name || '',
    phone: a.phone || a.mobile || '',
    address: a.address || a.address_line_1 || '',
    city: a.city || '',
    state: a.state || '',
    zip_code: a.zip_code || a.pincode || '',
    country: a.country || 'India',
    ...extras,
  };
}

/**
 * Super-Admin-only DC editor. Updates the same DC (same number) in place and
 * the backend regenerates the PDF.
 * Shipping/billing address UI matches SO Edit shipping address modal
 * (state dropdown + pincode autofill).
 */
export default function DcEditModal({ dcNumber, head, onClose, onSaved }) {
  const [form, setForm] = useState({
    customer_name: '',
    email: '',
    gst_number: '',
    supply_state: '',
    courier_name: '',
    awb_number: '',
    remarks: '',
  });
  const [billing, setBilling] = useState(mapAddress(null, { gst_number: '' }));
  const [shipping, setShipping] = useState(mapAddress(null));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!head) return;
    const billing0 = parseAddr(head.customer_billing_address);
    setForm({
      customer_name: head.customer_name || '',
      email: head.email || head.customer_email || '',
      gst_number: head.gst_number || head.GST_number || '',
      supply_state: head.supply_state || '',
      courier_name: head.courier_name || '',
      awb_number: head.awb_number || '',
      remarks: head.remarks || '',
    });
    setBilling(mapAddress(head.customer_billing_address, {
      gst_number: billing0.gst_number || head.gst_number || '',
    }));
    setShipping(mapAddress(head.customer_shipping_address));
  }, [head, dcNumber]);

  const handleBillingPincode = async (pincode) => {
    const { info } = await applyPincodeAutofill(pincode, setBilling, {
      pinKey: 'zip_code',
      cityKey: 'city',
      stateKey: 'state',
      addressKey: 'address',
      fillAddressIfEmpty: true,
    });
    if (String(pincode || '').replace(/\D/g, '').length === 6 && !info) {
      toast.error('No city/state found for this pincode');
    }
  };

  const handleShippingPincode = async (pincode) => {
    const { info } = await applyPincodeAutofill(pincode, setShipping, {
      pinKey: 'zip_code',
      cityKey: 'city',
      stateKey: 'state',
      addressKey: 'address',
      fillAddressIfEmpty: true,
    });
    if (String(pincode || '').replace(/\D/g, '').length === 6 && !info) {
      toast.error('No city/state found for this pincode');
    }
  };

  const submit = async () => {
    const required = ['name', 'phone', 'address', 'city', 'state', 'zip_code'];
    if (required.some((k) => !String(shipping[k] || '').trim())) {
      toast.error('Please fill all required shipping address fields');
      return;
    }
    setSaving(true);
    try {
      await updateDC(dcNumber, {
        ...form,
        customer_billing_address: billing,
        customer_shipping_address: shipping,
      });
      toast.success(`${dcNumber} updated`);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const field = (label, val, onChange, full) => (
    <label className={`text-sm ${full ? 'sm:col-span-2' : ''}`}>
      <span className="text-gray-500 text-xs">{label}</span>
      <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={val} onChange={(e) => onChange(e.target.value)} />
    </label>
  );

  const addressBlock = (title, addr, setAddr, onPincode, { required = false, showGst = false } = {}) => (
    <div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field(`${required ? 'Name *' : 'Name'}`, addr.name, (v) => setAddr({ ...addr, name: v }))}
        {field(`${required ? 'Phone *' : 'Phone'}`, addr.phone, (v) => setAddr({ ...addr, phone: v }))}
        {field(`${required ? 'Address *' : 'Address'}`, addr.address, (v) => setAddr({ ...addr, address: v }), true)}
        {field(`${required ? 'City *' : 'City'}`, addr.city, (v) => setAddr({ ...addr, city: v }))}
        <label className="text-sm">
          <span className="text-gray-500 text-xs">{required ? 'State *' : 'State'}</span>
          <select
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
            value={resolveStateSelectValue(addr.state)}
            onChange={(e) => setAddr({ ...addr, state: e.target.value })}
          >
            <option value="">Select state</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-gray-500 text-xs">{required ? 'Zip / Pincode *' : 'Zip / Pincode'}</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            value={addr.zip_code || ''}
            inputMode="numeric"
            maxLength={6}
            onChange={(e) => onPincode(e.target.value)}
            onBlur={(e) => onPincode(e.target.value)}
          />
        </label>
        {showGst ? field('GST Number', addr.gst_number || '', (v) => setAddr({ ...addr, gst_number: v })) : null}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="relative w-full max-w-[560px] bg-white shadow-xl flex flex-col max-h-full overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Edit {dcNumber} <span className="text-xs text-amber-600">(Super Admin)</span></h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-xs text-gray-500">
            Updates this delivery challan in place and regenerates the PDF. Shipping fields match the SO edit shipping address modal (state list + pincode autofill).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field('Customer Name', form.customer_name, (v) => setForm({ ...form, customer_name: v }))}
            {field('Email', form.email, (v) => setForm({ ...form, email: v }))}
            {field('GST Number', form.gst_number, (v) => setForm({ ...form, gst_number: v }))}
            <label className="text-sm">
              <span className="text-gray-500 text-xs">Supply State</span>
              <select
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
                value={resolveStateSelectValue(form.supply_state)}
                onChange={(e) => setForm({ ...form, supply_state: e.target.value })}
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            {field('Courier Name', form.courier_name, (v) => setForm({ ...form, courier_name: v }))}
            {field('AWB Number', form.awb_number, (v) => setForm({ ...form, awb_number: v }))}
            {field('Remarks', form.remarks, (v) => setForm({ ...form, remarks: v }), true)}
          </div>

          {addressBlock('Billing Address', billing, setBilling, handleBillingPincode, { showGst: true })}
          {addressBlock('Shipping Address', shipping, setShipping, handleShippingPincode, { required: true })}
        </div>
        <div className="border-t p-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Save & Regenerate PDF'}
          </button>
        </div>
      </aside>
    </div>
  );
}
