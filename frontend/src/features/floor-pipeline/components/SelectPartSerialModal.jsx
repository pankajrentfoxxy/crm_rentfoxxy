import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { listPartInstances } from '../partRequestsApi';

/**
 * Warehouse picks which physical unit (serial number / PRT-ID) to attach when
 * approving a part request. Falls back to "auto-pick oldest" when no explicit
 * choice is made.
 *
 * onConfirm(instanceId | null) — null means "let the system auto-select".
 */
export default function SelectPartSerialModal({
  open, partId, partName, requestLabel, busy = false, onClose, onConfirm,
}) {
  const [loading, setLoading] = useState(false);
  const [units, setUnits] = useState([]);
  const [selected, setSelected] = useState(null); // instance_id or 'auto'
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open || !partId) return;
    let alive = true;
    setLoading(true);
    setSelected(null);
    setSearch('');
    listPartInstances({ part_id: partId, status: 'in_stock', limit: 500 })
      .then(({ data }) => {
        if (!alive) return;
        const rows = data.instances || [];
        setUnits(rows);
        setSelected(rows.length ? rows[0].instance_id : 'auto');
      })
      .catch(() => { if (alive) { setUnits([]); setSelected('auto'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, partId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return units;
    return units.filter((u) =>
      String(u.serial_number || '').toLowerCase().includes(q) ||
      String(u.prt_id || '').toLowerCase().includes(q) ||
      String(u.location_code || '').toLowerCase().includes(q)
    );
  }, [units, search]);

  if (!open) return null;

  const confirm = () => {
    if (selected == null) return;
    onConfirm(selected === 'auto' ? null : Number(selected));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <button type="button" className="fixed inset-0 bg-black/50" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 my-8 w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-900">Select serial number</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {partName}{requestLabel ? ` · ${requestLabel}` : ''}
            </p>
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
            {units.length > 3 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="w-full rounded-lg border border-slate-200 pl-8 pr-2 py-2 text-sm"
                  placeholder="Search serial, PRT-ID, location"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}

            <label className={`flex items-center gap-3 rounded-lg border p-3 text-sm cursor-pointer ${selected === 'auto' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
              <input type="radio" name="unit" checked={selected === 'auto'} onChange={() => setSelected('auto')} />
              <span className="font-medium text-slate-700">Auto-pick oldest available unit</span>
            </label>

            <div className="space-y-2 max-h-[46vh] overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">
                  {units.length ? 'No units match your search.' : 'No stocked units with serials. Auto-pick will assign one.'}
                </p>
              ) : filtered.map((u) => (
                <label
                  key={u.instance_id}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-sm cursor-pointer ${Number(selected) === u.instance_id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}
                >
                  <input
                    type="radio"
                    name="unit"
                    checked={Number(selected) === u.instance_id}
                    onChange={() => setSelected(u.instance_id)}
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 truncate">
                      {u.serial_number || <span className="text-slate-400 italic">No serial</span>}
                    </p>
                    <p className="text-xs text-slate-500 font-mono">
                      {u.prt_id}{u.location_code ? ` · ${u.location_code}` : ''}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
          <button type="button" className="flex-1 rounded-lg border border-slate-200 py-2 text-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg bg-green-600 text-white py-2 text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            onClick={confirm}
            disabled={busy || loading || selected == null}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {busy ? 'Approving…' : 'Approve with this unit'}
          </button>
        </div>
      </div>
    </div>
  );
}
