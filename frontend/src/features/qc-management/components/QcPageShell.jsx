import React from 'react';

/**
 * Shared page chrome for QC Management list stubs (ERP parity).
 */
export default function QcPageShell({ title, description, statusKey, children }) {
  return (
    <div className="rounded-xl border bg-white shadow-sm p-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {description && (
          <p className="text-sm text-slate-600 leading-relaxed max-w-3xl mt-2">{description}</p>
        )}
        {statusKey && (
          <p className="text-xs text-slate-400 mt-2">
            ERP status filter: <code className="text-[11px] bg-slate-50 px-1.5 py-0.5 rounded">{statusKey}</code>
          </p>
        )}
      </div>
      {children ?? (
        <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg p-6 bg-slate-50/50">
          List UI will connect to <code className="text-[11px]">/api/qc-management</code> endpoints mirroring Laravel{' '}
          <code className="text-[11px]">admin/qc/orders/qc-orders/{'{status}'}</code>.
        </p>
      )}
    </div>
  );
}
