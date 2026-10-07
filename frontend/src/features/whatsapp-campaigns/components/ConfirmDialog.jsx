import React from 'react';
import { Button } from '../../../components/ui/primitives';

export default function ConfirmDialog({
  open, title, children, confirmLabel = 'Confirm', tone = 'primary', loading = false, onConfirm, onClose,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <div className="mt-3 text-sm text-slate-600 space-y-2">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Back</Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
