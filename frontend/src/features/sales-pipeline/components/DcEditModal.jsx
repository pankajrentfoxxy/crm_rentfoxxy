import React, { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { updateDC } from '../salesPipelineApi';

function parseAddr(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return { address: v }; }
}

/**
 * Super-Admin-only DC editor. Updates the same DC (same number) in place and
 * the backend regenerates the PDF.
 */
export default function DcEditModal({ dcNumber, head, onClose, onSaved }) {
  const billing0 = parseAddr(head.customer_billing_address);
  const shipping0 = parseAddr(head.customer_shipping_address);
  const [form, setForm] = useState({
    customer_name: head.customer_name || '',
    email: head.email || head.customer_email || '',
    gst_number: head.gst_number || head.GST_number || '',
    supply_state: head.supply_state || '',
    courier_name: head.courier_name || '',
    awb_number: head.awb_number || '',
    remarks: head.remarks || '',
  });
  const [billing, setBilling] = useState({
    name: billing0.name || '', phone: billing0.phone || '', address: billing0.address || '',
    city: billing0.city || '', state: billing0.state || '', zip_code: billing0.zip_code || '',
    gst_number: billing0.gst_number || head.gst_number || '', country: billing0.country || 'India',
  });
  const [shipping, setShipping] = useState({
    name: shipping0.name || '', phone: shipping0.phone || '', address: shipping0.address || '',
    city: shipping0.city || '', state: shipping0.state || '', zip_code: shipping0.zip_code || '',
    country: shipping0.country || 'India',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="relative w-full max-w-[560px] bg-white shadow-xl flex flex-col max-h-full overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Edit {dcNumber} <span className="text-xs text-amber-600">(Super Admin)</span></h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field('Customer Name', form.customer_name, (v) => setForm({ ...form, customer_name: v }))}
            {field('Email', form.email, (v) => setForm({ ...form, email: v }))}
            {field('GST Number', form.gst_number, (v) => setForm({ ...form, gst_number: v }))}
            {field('Supply State', form.supply_state, (v) => setForm({ ...form, supply_state: v }))}
            {field('Courier Name', form.courier_name, (v) => setForm({ ...form, courier_name: v }))}
            {field('AWB Number', form.awb_number, (v) => setForm({ ...form, awb_number: v }))}
            {field('Remarks', form.remarks, (v) => setForm({ ...form, remarks: v }), true)}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Billing Address</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {field('Name', billing.name, (v) => setBilling({ ...billing, name: v }))}
              {field('Phone', billing.phone, (v) => setBilling({ ...billing, phone: v }))}
              {field('Address', billing.address, (v) => setBilling({ ...billing, address: v }), true)}
              {field('City', billing.city, (v) => setBilling({ ...billing, city: v }))}
              {field('State', billing.state, (v) => setBilling({ ...billing, state: v }))}
              {field('Zip Code', billing.zip_code, (v) => setBilling({ ...billing, zip_code: v }))}
              {field('GST Number', billing.gst_number, (v) => setBilling({ ...billing, gst_number: v }))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Shipping Address</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {field('Name', shipping.name, (v) => setShipping({ ...shipping, name: v }))}
              {field('Phone', shipping.phone, (v) => setShipping({ ...shipping, phone: v }))}
              {field('Address', shipping.address, (v) => setShipping({ ...shipping, address: v }), true)}
              {field('City', shipping.city, (v) => setShipping({ ...shipping, city: v }))}
              {field('State', shipping.state, (v) => setShipping({ ...shipping, state: v }))}
              {field('Zip Code', shipping.zip_code, (v) => setShipping({ ...shipping, zip_code: v }))}
            </div>
          </div>
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
