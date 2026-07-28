import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { listPartInstances } from '../../floor-pipeline/partRequestsApi';

/**
 * Warehouse picks the physical unit (serial / PRT-ID) for each selected support
 * part request before generating the challan. "Auto" lets the backend pick the
 * oldest available unit for that part.
 *
 * onConfirm(instanceMap) — { [request_id]: instance_id } (only explicit picks).
 */
export default function PickSupportSerialsModal({ open, requests = [], busy = false, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);
  const [unitsByPart, setUnitsByPart] = useState({});
  const [choice, setChoice] = useState({}); // { [request_id]: instance_id | 'auto' }

  const partIds = useMemo(
    () => [...new Set(requests.map((r) => r.part_id).filter(Boolean))],
    [requests]
  );

  useEffect(() => {
    if (!open || !partIds.length) return;
    let alive = true;
    setLoading(true);
    setChoice(Object.fromEntries(requests.map((r) => [r.id, 'auto'])));
    Promise.all(
      partIds.map((pid) =>
        listPartInstances({ part_id: pid, status: 'in_stock', limit: 500 })
          .then(({ data }) => [pid, data.instances || []])
          .catch(() => [pid, []])
      )
    )
      .then((pairs) => { if (alive) setUnitsByPart(Object.fromEntries(pairs)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, partIds, requests]);

  if (!open) return null;

  const confirm = () => {
    const instanceMap = {};
    Object.entries(choice).forEach(([reqId, val]) => {
      if (val && val !== 'auto') instanceMap[reqId] = Number(val);
    });
    onConfirm(instanceMap);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <button type="button" className="fixed inset-0 bg-black/50" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 my-8 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-900">Select serial numbers</h3>
            <p className="text-xs text-slate-500 mt-0.5">Choose which unit to issue for each part</p>
          </div>
          <button type="button" className="p-2 rounded-lg hover:bg-slate-100" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading available units…
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {requests.map((r) => {
              const units = unitsByPart[r.part_id] || [];
              return (
                <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-800 text-sm">{r.part_name}</p>
                    <span className="font-mono text-[11px] text-slate-500">{r.request_number}</span>
                  </div>
                  <select
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={choice[r.id] ?? 'auto'}
                    onChange={(e) => setChoice((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  >
                    <option value="auto">Auto-pick oldest available unit</option>
                    {units.map((u) => (
                      <option key={u.instance_id} value={u.instance_id}>
                        {(u.serial_number || 'No serial')} · {u.prt_id}{u.location_code ? ` · ${u.location_code}` : ''}
                      </option>
                    ))}
                  </select>
                  {!units.length && (
                    <p className="mt-1 text-[11px] text-amber-600">No stocked units with serials — auto-pick will assign one.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
          <button type="button" className="flex-1 rounded-lg border border-slate-200 py-2 text-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg bg-[#534AB7] text-white py-2 text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            onClick={confirm}
            disabled={busy || loading}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {busy ? 'Working…' : 'Approve + generate challan'}
          </button>
        </div>
      </div>
    </div>
  );
}
