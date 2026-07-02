import React, { useState } from 'react';
import { INDIAN_STATES, slugifyState } from '../../../constants/indianStates';
import { lookupAndResolvePincode } from '../../../utils/pincodeLookup';

const emptyForm = {
  name: '',
  phone: '',
  state: '',
  city: '',
  zip_code: '',
  address: '',
};

export default function ShippingAddressModal({ open, onClose, onSubmit, saving }) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await onSubmit({
        ...form,
        state: slugifyState(form.state),
      });
      setForm(emptyForm);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to save address');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-lg font-semibold">Add New Shipping Address</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500">Contact Person Name *</label>
              <input required className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Contact Person Number *</label>
              <input required className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Country *</label>
              <input readOnly className="w-full mt-1 px-3 py-2 border rounded-lg text-sm bg-gray-50" value="India" />
            </div>
            <div>
              <label className="text-xs text-gray-500">State *</label>
              <select required className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}>
                <option value="">Select a State</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">City *</label>
              <input required className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Pin Code *</label>
              <input required className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" value={form.zip_code}
                onChange={async (e) => {
                  const { pin, info } = await lookupAndResolvePincode(e.target.value);
                  setForm((f) => ({
                    ...f,
                    zip_code: pin,
                    ...(info ? { city: info.city || f.city, state: info.state || f.state } : {}),
                  }));
                }} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500">Address *</label>
              <textarea required rows={2} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
          </div>
          {error ? <p className="text-red-600 text-sm">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm disabled:opacity-50">
              {saving ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
