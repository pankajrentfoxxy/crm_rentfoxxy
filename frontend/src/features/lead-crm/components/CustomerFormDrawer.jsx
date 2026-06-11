import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { COMPANY_TYPES } from '../leadConstants';
import { createCustomer, updateCustomer } from '../leadCrmApi';
import toast from 'react-hot-toast';

const empty = () => ({
  customer_name: '', email: '', customer_number: '', company_name: '',
  gst_number: '', pan_number: '', company_type: '', industry: '',
  billing_address: '', billing_city: '', billing_state: '', billing_pincode: '',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: '',
  whatsapp_number: '', designation: '', notes: '',
});

export default function CustomerFormDrawer({ open, customer, onClose, onSaved }) {
  const [form, setForm] = useState(empty());
  const [saving, setSaving] = useState(false);
  const isEdit = !!customer;

  useEffect(() => {
    if (customer) {
      setForm({
        customer_name: customer.customer_name || customer.name || '',
        company_name: customer.company_name || '',
        email: customer.email || '',
        customer_number: customer.customer_number || customer.phone || '',
        gst_number: customer.gst_number || '',
        pan_number: customer.pan_number || customer.pan_card_number || '',
        company_type: customer.company_type || '',
        industry: customer.industry || '',
        billing_address: typeof customer.billing_address === 'string' ? customer.billing_address : customer.billing_address?.address || '',
        billing_city: customer.billing_city || '',
        billing_state: customer.billing_state || '',
        billing_pincode: customer.billing_pincode || '',
        shipping_same: customer.shipping_same !== false,
        shipping_address: customer.shipping_address || '',
        shipping_city: customer.shipping_city || '',
        shipping_state: customer.shipping_state || '',
        shipping_pincode: customer.shipping_pincode || '',
        whatsapp_number: customer.whatsapp_number || '',
        designation: customer.designation || '',
        notes: customer.notes || '',
      });
    } else if (open) setForm(empty());
  }, [customer, open]);

  if (!open) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isEdit) {
        await updateCustomer(customer.customer_id, form);
        toast.success('Customer updated');
      } else {
        await createCustomer({
          ...form,
          contact_person_name: form.customer_name,
          contact_person_number: form.customer_number,
          billing_address_1: form.billing_address,
          billing_address_2: '',
          shipping_address_1: form.shipping_address || form.billing_address,
          shipping_address_2: '',
          shipping_state: form.shipping_state || form.billing_state,
          shipping_city: form.shipping_city || form.billing_city,
          shipping_pin_code: form.shipping_pincode || form.billing_pincode,
          billing_pin_code: form.billing_pincode,
          business_type: 'regular',
          password: 'TempPass123',
        });
        toast.success('Customer created');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} role="presentation" />
      <div className="relative w-full max-w-[560px] bg-white shadow-xl flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <h2 className="font-semibold">{isEdit ? 'Edit Customer' : 'Add Customer'}</h2>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            ['customer_name', 'Customer Name'], ['company_name', 'Company'], ['email', 'Email'],
            ['customer_number', 'Phone'], ['whatsapp_number', 'WhatsApp'], ['designation', 'Designation'],
            ['gst_number', 'GST'], ['pan_number', 'PAN'],
          ].map(([k, label]) => (
            <div key={k}>
              <label className="text-xs text-gray-500">{label}</label>
              <input value={form[k]} onChange={(e) => set(k, e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          ))}
          <div>
            <label className="text-xs text-gray-500">Company Type</label>
            <select value={form.company_type} onChange={(e) => set('company_type', e.target.value)}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">Select</option>
              {COMPANY_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Industry</label>
            <input value={form.industry} onChange={(e) => set('industry', e.target.value)}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">Billing Address</label>
            <textarea value={form.billing_address} onChange={(e) => set('billing_address', e.target.value)} rows={2}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          {['billing_city', 'billing_state', 'billing_pincode'].map((k) => (
            <div key={k}>
              <label className="text-xs text-gray-500 capitalize">{k.replace('billing_', '')}</label>
              <input value={form[k]} onChange={(e) => set(k, e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          ))}
          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">Notes</label>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex gap-2 justify-end p-4 border-t shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
