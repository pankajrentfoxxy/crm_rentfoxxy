import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { sendInvoice } from '../customerBillingApi';

export default function SendInvoiceModal({ invoice, onClose, onSent }) {
  const [toEmail, setToEmail] = useState(invoice?.customer_email || '');
  const [cc, setCc] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      const ccEmails = cc.split(',').map((e) => e.trim()).filter(Boolean);
      await sendInvoice(invoice.invoice_id, { to_email: toEmail, cc_emails: ccEmails });
      toast.success('Invoice sent');
      onSent?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Send Invoice {invoice?.invoice_number}</h3>
        <label className="block text-sm text-gray-600 mb-1">To Email</label>
        <input
          type="email"
          value={toEmail}
          onChange={(e) => setToEmail(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
        />
        <label className="block text-sm text-gray-600 mb-1">CC (comma-separated)</label>
        <input
          type="text"
          value={cc}
          onChange={(e) => setCc(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm mb-4"
        />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button type="button" onClick={handleSend} disabled={sending} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50">
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
