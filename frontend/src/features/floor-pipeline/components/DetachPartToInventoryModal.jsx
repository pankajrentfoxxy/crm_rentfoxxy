import React, { useEffect, useState } from 'react';
import { Loader2, Unlink, X } from 'lucide-react';

export default function DetachPartToInventoryModal({
  open,
  part,
  ttsplId,
  confirming = false,
  onClose,
  onConfirm,
}) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open, part?.instance_id, part?.request_id]);

  if (!open || !part) return null;

  const label = `${part.part_name || 'Part'} (${part.prt_id || 'no PRT'})`;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl">
        <div className="flex items-start justify-between border-b px-4 py-3">
          <div>
            <h2 className="font-semibold text-slate-900">Detach part to inventory</h2>
            {ttsplId ? (
              <p className="font-mono text-sm text-blue-700 mt-0.5">{ttsplId}</p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} disabled={confirming} className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-slate-700">
            Detach <strong>{label}</strong> from this laptop and return it to inventory stock?
          </p>
          <div>
            <label htmlFor="detach-part-reason" className="block text-xs font-medium text-slate-600 mb-1">
              Reason (optional)
            </label>
            <textarea
              id="detach-part-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={confirming}
              placeholder="Why is this part being removed?"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100 disabled:bg-slate-50"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="px-4 py-2 rounded-lg border text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={confirming}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
          >
            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
            Detach to inventory
          </button>
        </div>
      </div>
    </div>
  );
}
