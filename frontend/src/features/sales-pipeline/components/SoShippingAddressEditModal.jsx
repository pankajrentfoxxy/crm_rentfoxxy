import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { updateSoShippingAddress } from '../salesPipelineApi';
import { parseDeliveryAddress } from '../salesPipelineUtils';
import { INDIAN_STATES, resolveStateSelectValue } from '../../../constants/indianStates';
import { applyPincodeAutofill } from '../../../utils/pincodeLookup';

function mapShippingForm(raw) {
  const a = parseDeliveryAddress(raw) || {};
  return {
    name: a.name || '',
    phone: a.phone || '',
    address: a.address || a.address_line_1 || '',
    city: a.city || '',
    state: a.state || '',
    zip_code: a.zip_code || a.pincode || '',
    country: a.country || 'India',
  };
}

export default function SoShippingAddressEditModal({ open, soNumber, shippingRaw, onClose, onSaved }) {
  const [form, setForm] = useState(mapShippingForm(null));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(mapShippingForm(shippingRaw));
  }, [open, shippingRaw]);

  if (!open) return null;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handlePincodeChange = async (pincode) => {
    set('zip_code', pincode);
    const filled = await applyPincodeAutofill(pincode);
    if (filled?.city) set('city', filled.city);
    if (filled?.state) set('state', filled.state);
  };

  const submit = async () => {
    const required = ['name', 'phone', 'address', 'city', 'state', 'zip_code'];
    if (required.some((k) => !String(form[k] || '').trim())) {
      toast.error('Please fill all required fields');
      return;
    }
    setSaving(true);
    try {
      const { data } = await updateSoShippingAddress(soNumber, {
        customer_shipping_address: form,
      });
      const dcCount = data.dc_pdfs?.length || 0;
      toast.success(
        dcCount
          ? `Shipping address updated — SO and ${dcCount} DC PDF(s) regenerated`
          : (data.message || 'Shipping address updated')
      );
      onSaved?.(data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const field = (label, key, full) => (
    <label className={`text-sm ${full ? 'sm:col-span-2' : ''}`}>
      <span className="text-gray-500 text-xs">{label}</span>
      <input
        className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
        value={form[key] || ''}
        onChange={(e) => set(key, e.target.value)}
        onBlur={key === 'zip_code' ? (e) => handlePincodeChange(e.target.value) : undefined}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="relative w-full max-w-[480px] bg-white shadow-xl flex flex-col max-h-full overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">
            Edit shipping address
            <span className="text-xs text-amber-600 ml-2">(Super Admin)</span>
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-xs text-gray-500 mb-4">
            Updates the SO header shipping address on all lines. Pending delivery challans are updated and PDFs regenerated.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field('Name *', 'name')}
            {field('Phone *', 'phone')}
            {field('Address *', 'address', true)}
            {field('City *', 'city')}
            <label className="text-sm">
              <span className="text-gray-500 text-xs">State *</span>
              <select
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
                value={resolveStateSelectValue(form.state)}
                onChange={(e) => set('state', e.target.value)}
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            {field('Zip Code *', 'zip_code')}
          </div>
        </div>
        <div className="border-t p-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save & Regenerate PDF'}
          </button>
        </div>
      </aside>
    </div>
  );
}
