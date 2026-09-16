import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { updateSoShipping } from '../salesPipelineApi';
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

export default function SoShippingAddressEditModal({
  open, soNumber, shippingRaw, shippingCharge = 0, hasDc = false, onClose, onSaved,
}) {
  const [form, setForm] = useState(mapShippingForm(null));
  const [charge, setCharge] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(mapShippingForm(shippingRaw));
    setCharge(shippingCharge != null && shippingCharge !== '' ? String(shippingCharge) : '0');
  }, [open, shippingRaw, shippingCharge]);

  if (!open) return null;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handlePincodeChange = async (pincode) => {
    const { info } = await applyPincodeAutofill(pincode, setForm, {
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
    if (required.some((k) => !String(form[k] || '').trim())) {
      toast.error('Please fill all required fields');
      return;
    }
    const chargeNum = Number(charge);
    if (charge !== '' && (!Number.isFinite(chargeNum) || chargeNum < 0)) {
      toast.error('Shipping charge must be zero or more');
      return;
    }
    setSaving(true);
    try {
      const { data } = await updateSoShipping(soNumber, {
        customer_shipping_address: form,
        shiping_charges: charge === '' ? undefined : chargeNum,
      });
      toast.success(data.message || 'Shipping updated');
      const skipped = data.data?.dc_address_skipped || [];
      if (skipped.length) {
        toast(
          `${skipped.length} delivery challan(s) kept their own shipping address: ${skipped.join(', ')}. `
          + 'Edit those on the challan itself.',
          { duration: 7000, icon: '\u2139\uFE0F' }
        );
      }
      const delivered = data.data?.delivered_dcs_touched || [];
      if (delivered.length) {
        toast(
          `Charge was also applied to already-delivered DC ${delivered.join(', ')} \u2014 its PDF has been rewritten.`,
          { duration: 7000, icon: '\u26A0\uFE0F' }
        );
      }
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
          <h2 className="font-semibold">Edit shipping</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-xs text-gray-500 mb-4">
            Updates the shipping charge and address on every line of this sales order, pushes
            them to the linked delivery challans, and regenerates the PDFs.
            {hasDc ? ' This order already has a delivery challan — its PDF will be rewritten.' : ''}
          </p>

          <label className="text-sm block mb-4">
            <span className="text-gray-500 text-xs">Shipping charge (\u20b9)</span>
            <input
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={charge}
              inputMode="decimal"
              onChange={(e) => setCharge(e.target.value)}
              placeholder="0"
            />
            <span className="block text-[11px] text-gray-400 mt-1">
              Applied to the sales order and to every open delivery challan on it.
            </span>
          </label>

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
            <label className="text-sm">
              <span className="text-gray-500 text-xs">Zip / Pincode *</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={form.zip_code || ''}
                inputMode="numeric"
                maxLength={6}
                onChange={(e) => handlePincodeChange(e.target.value)}
                onBlur={(e) => handlePincodeChange(e.target.value)}
              />
            </label>
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
