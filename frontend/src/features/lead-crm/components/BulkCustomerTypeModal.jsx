import React, { useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import {
  CUSTOMER_TYPE_OPTIONS,
  customerTypeBadgeClass,
  customerTypeLabel,
} from '../../../utils/customerType';

/**
 * Bulk set Customer Type for selected customers.
 */
export default function BulkCustomerTypeModal({
  open,
  customers = [],
  onClose,
  onConfirm,
  onRemove,
  saving = false,
}) {
  const [customerType, setCustomerType] = useState('both');

  const listed = useMemo(
    () => (customers || []).slice().sort((a, b) => Number(a.customer_id) - Number(b.customer_id)),
    [customers]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div>
            <h2 className="font-semibold text-slate-900">Edit Customer Type</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Apply one type to {listed.length.toLocaleString('en-IN')} selected customer{listed.length === 1 ? '' : 's'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div>
            <label className="text-xs font-medium text-slate-600">Customer Type</label>
            <select
              value={customerType}
              onChange={(e) => setCustomerType(e.target.value)}
              className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
            >
              {CUSTOMER_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-medium text-slate-600">
                Selected customers ({listed.length.toLocaleString('en-IN')})
              </p>
              {listed.length > 0 ? (
                <p className="text-[11px] text-slate-400">Remove to exclude from update</p>
              ) : null}
            </div>
            <div className="max-h-[min(50vh,28rem)] overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
              {listed.length === 0 ? (
                <p className="px-3 py-4 text-sm text-slate-400 text-center">No customers selected</p>
              ) : (
                listed.map((c) => (
                  <div key={c.customer_id} className="px-3 py-2.5 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800 truncate">
                        {c.company_name || c.customer_name || c.name || `Customer #${c.customer_id}`}
                      </p>
                      <p className="text-xs text-slate-500">#{c.customer_id} · {c.email || c.phone || '—'}</p>
                    </div>
                    <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold ${customerTypeBadgeClass(c.customer_type)}`}>
                      {customerTypeLabel(c.customer_type)}
                    </span>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => onRemove?.(c.customer_id)}
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-200 disabled:opacity-50"
                      title="Remove from selection"
                      aria-label={`Remove customer ${c.customer_id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t bg-slate-50 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !listed.length}
            onClick={() => onConfirm?.(customerType)}
            className="px-4 py-2 text-sm rounded-lg bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-50 font-medium"
          >
            {saving ? 'Updating…' : `Set type to ${customerTypeLabel(customerType)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
