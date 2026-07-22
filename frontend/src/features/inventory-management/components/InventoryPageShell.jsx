import React from 'react';

export default function InventoryPageShell({ title, description, erpSegment, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-6 lg:p-8 space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{title}</h1>
        {description && (
          <p className="text-sm text-slate-600 leading-relaxed max-w-3xl mt-2">{description}</p>
        )}
        {erpSegment && (
          <p className="text-xs text-slate-400 mt-2">
            ERP: <code className="text-[11px] bg-slate-50 px-1.5 py-0.5 rounded">admin/inventory/{erpSegment}</code>
          </p>
        )}
      </div>
      {children ?? (
        <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg p-6 bg-slate-50/50">
          List UI will connect to <code className="text-[11px]">/api/inventory-management</code> endpoints mirroring
          Laravel Inventory Management.
        </p>
      )}
    </div>
  );
}
