import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { convertToCustomer } from '../leadCrmApi';
import toast from 'react-hot-toast';

export default function LeadConvertModal({ open, lead, onClose }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({});
  const [shippingSame, setShippingSame] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lead) {
      setForm({
        customer_name: lead.name || '',
        company_name: lead.companyName || '',
        email: lead.email || '',
        phone: lead.phone || '',
        gst_number: lead.gstNumber || lead.research?.gst || '',
        pan_number: lead.panNumber || '',
        billing_address: lead.billingAddress || '',
        billing_city: lead.city || '',
        billing_state: lead.state || '',
        billing_pincode: lead.pincode || '',
        shipping_address: lead.shippingAddress || '',
        shipping_city: lead.city || '',
        shipping_state: lead.state || '',
        shipping_pincode: lead.pincode || '',
      });
      setShippingSame(lead.shippingSameAsBilling !== false);
    }
  }, [lead, open]);

  if (!open || !lead) return null;

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await convertToCustomer(lead.leadId, {
        ...form,
        shipping_same_as_billing: shippingSame,
      });
      toast.success('Customer profile created successfully');
      onClose();
      navigate(`/lead-crm/customers/${res.data.customer_id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Conversion failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Convert Lead to Customer</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {['customer_name', 'company_name', 'email', 'phone', 'gst_number', 'pan_number'].map((field) => (
            <div key={field}>
              <label className="text-xs text-gray-500 capitalize">{field.replace(/_/g, ' ')}</label>
              <input value={form[field] || ''} onChange={(e) => set(field, e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          ))}
          <p className="text-sm font-medium text-gray-700 pt-2">Billing Address</p>
          {['billing_address', 'billing_city', 'billing_state', 'billing_pincode'].map((field) => (
            <div key={field}>
              <label className="text-xs text-gray-500 capitalize">{field.replace(/billing_/, '')} *</label>
              <input value={form[field] || ''} onChange={(e) => set(field, e.target.value)} required={field !== 'billing_address' || true}
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={shippingSame} onChange={(e) => setShippingSame(e.target.checked)} />
            Shipping same as billing?
          </label>
          {!shippingSame && (
            <>
              <p className="text-sm font-medium text-gray-700">Shipping Address</p>
              {['shipping_address', 'shipping_city', 'shipping_state', 'shipping_pincode'].map((field) => (
                <div key={field}>
                  <label className="text-xs text-gray-500 capitalize">{field.replace(/shipping_/, '')}</label>
                  <input value={form[field] || ''} onChange={(e) => set(field, e.target.value)}
                    className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
              ))}
            </>
          )}
          <div className="flex gap-2 justify-end pt-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Converting...' : 'Convert to Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
