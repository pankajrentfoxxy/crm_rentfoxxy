import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import SearchableSelect from '../../operation-management/components/SearchableSelect';
import { createCreditNote, listInvoices } from '../customerBillingApi';
import api from '../../../utils/api';

export default function CreditNoteForm({ open, onClose, onCreated }) {
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [form, setForm] = useState({
    customer_id: '', invoice_id: '', reason: '', description: '',
    amount: '', quantity: '', unit_rate: '', from_date: '', to_date: '', ttspl_ids: [],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get('/customer-management/customers/ids')
      .then((r) => setCustomers(r.data?.customers || []))
      .catch(() => setCustomers([]));
  }, [open]);

  const customerOptions = useMemo(
    () => customers.map((c) => ({
      value: String(c.customer_id),
      label: c.company_name || c.name || c.customer_name || `Customer #${c.customer_id}`,
    })),
    [customers]
  );

  useEffect(() => {
    if (!form.customer_id) { setInvoices([]); return; }
    listInvoices({ customer_id: form.customer_id, limit: 50 })
      .then((r) => setInvoices(r.data?.invoices || []))
      .catch(() => setInvoices([]));
  }, [form.customer_id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createCreditNote({
        ...form,
        customer_id: Number(form.customer_id),
        invoice_id: form.invoice_id ? Number(form.invoice_id) : null,
        amount: parseFloat(form.amount || 0),
        quantity: parseInt(form.quantity || 0, 10),
        unit_rate: parseFloat(form.unit_rate || 0),
      });
      toast.success('Credit note created');
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
        <h3 className="font-semibold text-lg mb-4">Create Credit Note</h3>
        <div className="space-y-3 text-sm">
          <SearchableSelect
            id="credit-note-customer"
            label="Customer"
            required
            value={form.customer_id}
            onChange={(v) => set('customer_id', v)}
            options={customerOptions}
            placeholder="Select customer"
          />
          <div>
            <label className="block text-gray-600 mb-1">Related Invoice</label>
            <select value={form.invoice_id} onChange={(e) => set('invoice_id', e.target.value)} className="w-full border rounded-lg px-3 py-2">
              <option value="">None</option>
              {invoices.map((inv) => (
                <option key={inv.invoice_id} value={inv.invoice_id}>{inv.invoice_number}</option>
              ))}
            </select>
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
              <label className="block text-gray-600 mb-1">From Date</label>
              <input type="date" value={form.from_date} onChange={(e) => set('from_date', e.target.value)} className="w-full border rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="block text-gray-600 mb-1">To Date</label>
              <input type="date" value={form.to_date} onChange={(e) => set('to_date', e.target.value)} className="w-full border rounded-lg px-3 py-2" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-gray-600 mb-1">Quantity</label>
              <input type="number" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} className="w-full border rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Unit Rate</label>
              <input type="number" value={form.unit_rate} onChange={(e) => set('unit_rate', e.target.value)} className="w-full border rounded-lg px-3 py-2" />
            </div>
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Amount *</label>
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
