import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { recordSecurityDeposit } from '../customerBillingApi';
import api from '../../../utils/api';

export default function SecurityDepositForm({ open, onClose, onCreated }) {
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({
    customer_id: '', sales_order_number: '', amount: '', received_date: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get('/customer-management/customers', { params: { limit: 200 } })
      .then((r) => setCustomers(r.data?.customers || r.data?.rows || []))
      .catch(() => setCustomers([]));
  }, [open]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await recordSecurityDeposit({
        ...form,
        customer_id: Number(form.customer_id),
        amount: parseFloat(form.amount),
      });
      toast.success('Security deposit recorded');
      onCreated?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <form onSubmit={handleSubmit} className="relative bg-white w-full max-w-md h-full overflow-y-auto p-6 shadow-xl">
        <h3 className="font-semibold text-lg mb-4">Record Security Deposit</h3>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block text-gray-600 mb-1">Customer *</label>
            <select required value={form.customer_id} onChange={(e) => set('customer_id', e.target.value)} className="w-full border rounded-lg px-3 py-2">
              <option value="">Select…</option>
              {customers.map((c) => (
                <option key={c.customer_id} value={c.customer_id}>{c.company_name || c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Sales Order #</label>
            <input value={form.sales_order_number} onChange={(e) => set('sales_order_number', e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Amount *</label>
            <input required type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Received Date *</label>
            <input required type="date" value={form.received_date} onChange={(e) => set('received_date', e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} className="w-full border rounded-lg px-3 py-2" rows={3} />
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">Save</button>
        </div>
      </form>
    </div>
  );
}
