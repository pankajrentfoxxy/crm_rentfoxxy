import React, { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';

export default function CancelTicketModal({ ticketId, open, onClose, onCancelled, hasReturnDc }) {
  const [remark, setRemark] = useState('');
  const [forceRevert, setForceRevert] = useState(!!hasReturnDc);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async () => {
    const text = remark.trim();
    if (!text) {
      toast.error('Cancellation remark is required');
      return;
    }
    const confirmMsg = forceRevert
      ? 'Void this migrated pickup ticket? Return DC will be cancelled and TTSPL will be restored with the customer so you can open a new ticket.'
      : 'Cancel this support ticket? This cannot be undone.';
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await api.post(`/support/tickets/${ticketId}/cancel`, {
        cancellation_remark: text,
        force_inventory_revert: forceRevert,
      });
      toast.success(forceRevert ? 'Ticket voided — laptop restored with customer' : 'Ticket cancelled');
      setRemark('');
      onCancelled?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not cancel ticket');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Cancel ticket</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Use this for old ERP migrated tickets that cannot complete Return DC. The ticket history is preserved.
        </p>
        {hasReturnDc ? (
          <label className="flex items-start gap-2 mb-4 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={forceRevert}
              onChange={(e) => setForceRevert(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong>Migrated pickup never happened</strong> — cancel Return DC, restore laptop with customer
              (TTSPL stays deployed), and remove the block on creating a new ticket.
            </span>
          </label>
        ) : null}
        <label className="block text-xs font-medium text-gray-600 mb-1">Cancellation remark *</label>
        <textarea
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          rows={4}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          placeholder="Why is this ticket being cancelled?"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="support-btn-outline" onClick={onClose} disabled={busy}>Close</button>
          <button type="button" className="support-btn-danger-outline" onClick={submit} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}
