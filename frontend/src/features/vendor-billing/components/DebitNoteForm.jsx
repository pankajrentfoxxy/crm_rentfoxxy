import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { createDebitNote, listBillableVendors } from '../vendorBillingApi';

export default function DebitNoteForm({ open, onClose, onCreated }) {
  const [vendors, setVendors] = useState([]);
  const [form, setForm] = useState({
    vendor_id: '', po_id: '', reason: '', description: '',
    amount: '', quantity: '', unit_rate: '', ttspl_ids: [],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    listBillableVendors()
      .then((r) => setVendors(r.data?.vendors || []))
      .catch(() => setVendors([]));
  }, [open]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createDebitNote({
        ...form,
        vendor_id: Number(form.vendor_id),
        po_id: form.po_id ? Number(form.po_id) : null,
        amount: parseFloat(form.amount || 0),
        quantity: parseInt(form.quantity || 0, 10),
        unit_rate: parseFloat(form.unit_rate || 0),
      });
      toast.success('Debit note created');
      onCreated?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <form onSubmit={handleSubmit} className="relative bg-white w-full max-w-md h-full overflow-y-auto p-6 shadow-xl">
        <h3 className="font-semibold text-lg mb-4">Create Debit Note</h3>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block text-gray-600 mb-1">Vendor *</label>
            <select required value={form.vendor_id} onChange={(e) => set('vendor_id', e.target.value)} className="w-full border rounded-lg px-3 py-2">
              <option value="">Select…</option>
              {vendors.map((v) => (
                <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name || v.business_name || v.first_name || `Vendor #${v.vendor_id}`}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Related PO ID</label>
            <input type="number" value={form.po_id} onChange={(e) => set('po_id', e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Reason *</label>
            <input required value={form.reason} onChange={(e) => set('reason', e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} className="w-full border rounded-lg px-3 py-2" rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-gray-600 mb-1">Units</label>
              <input type="number" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} className="w-full border rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Unit Rate</label>
              <input type="number" value={form.unit_rate} onChange={(e) => set('unit_rate', e.target.value)} className="w-full border rounded-lg px-3 py-2" />
            </div>
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Total Amount *</label>
            <input required type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">Create</button>
        </div>
      </form>
    </div>
  );
}
