import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { recordPayment } from '../salesPipelineApi';
import { formatCurrency } from '../salesPipelineUtils';

const PAYMENT_TYPES = [
  { value: 'advance', label: 'Advance' },
  { value: 'security_deposit', label: 'Security Deposit' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'partial', label: 'Partial' },
  { value: 'final', label: 'Final' },
];

const PAYMENT_MODES = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];

export default function PaymentModal({ open, soNumber, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    payment_type: 'advance',
    amount: '',
    payment_date: today,
    payment_mode: 'bank_transfer',
    reference_number: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setSaving(true);
    try {
      await recordPayment(soNumber, { ...form, amount });
      toast.success(`Payment of ${formatCurrency(amount)} recorded`);
      onSaved?.();
      onClose();
      setForm({ payment_type: 'advance', amount: '', payment_date: today, payment_mode: 'bank_transfer', reference_number: '', notes: '' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Record Payment</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600">Payment Type *</label>
            <select
              className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
              value={form.payment_type}
              onChange={(e) => setForm((f) => ({ ...f, payment_type: e.target.value }))}
            >
              {PAYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Amount (₹) *</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Payment Date *</label>
            <input
              type="date"
              className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
              value={form.payment_date}
              onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Payment Mode *</label>
            <select
              className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
              value={form.payment_mode}
              onChange={(e) => setForm((f) => ({ ...f, payment_mode: e.target.value }))}
            >
              {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Reference Number</label>
            <input
              className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
              value={form.reference_number}
              onChange={(e) => setForm((f) => ({ ...f, reference_number: e.target.value }))}
              placeholder="UTR / cheque number"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Notes</label>
            <textarea
              className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
