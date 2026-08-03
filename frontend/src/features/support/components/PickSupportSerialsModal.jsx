import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Check, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { listPartInstances } from '../../floor-pipeline/partRequestsApi';
import ScanField from '../../../components/ScanField';

/**
 * Warehouse picks the physical unit (serial / PRT-ID) for each selected support
 * part request before generating the challan.
 *
 * Each part has a searchable / scannable list of in-stock units — the picker
 * must choose an explicit serial for every request (no auto-pick).
 *
 * onConfirm(instanceMap) — { [request_id]: instance_id }.
 */
export default function PickSupportSerialsModal({ open, requests = [], busy = false, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);
  const [unitsByPart, setUnitsByPart] = useState({});
  const [choice, setChoice] = useState({}); // { [request_id]: instance_id }
  const [search, setSearch] = useState({}); // { [request_id]: text }

  const partIds = useMemo(
    () => [...new Set(requests.map((r) => r.part_id).filter(Boolean))],
    [requests]
  );

  useEffect(() => {
    if (!open || !partIds.length) return;
    let alive = true;
    setLoading(true);
    setChoice({});
    setSearch({});
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

  const unitsFor = (r) => unitsByPart[r.part_id] || [];

  const filteredUnits = (r) => {
    const q = (search[r.id] || '').trim().toLowerCase();
    const units = unitsFor(r);
    if (!q) return units;
    return units.filter((u) =>
      String(u.serial_number || '').toLowerCase().includes(q) ||
      String(u.prt_id || '').toLowerCase().includes(q) ||
      String(u.location_code || '').toLowerCase().includes(q)
    );
  };

  const pick = (reqId, instanceId) =>
    setChoice((prev) => ({ ...prev, [reqId]: instanceId }));

  const setQuery = (reqId, text) =>
    setSearch((prev) => ({ ...prev, [reqId]: text }));

  // Scan / Enter → match against this part's stock and select it.
  const handleScan = (r, text) => {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return;
    const units = unitsFor(r);
    const match =
      units.find((u) =>
        String(u.serial_number || '').toLowerCase() === t ||
        String(u.prt_id || '').toLowerCase() === t) ||
      units.find((u) =>
        String(u.serial_number || '').toLowerCase().includes(t) ||
        String(u.prt_id || '').toLowerCase().includes(t));
    if (match) {
      pick(r.id, match.instance_id);
      setQuery(r.id, '');
      toast.success(`Selected ${match.serial_number || match.prt_id}`);
    } else {
      toast.error('No matching unit in stock for this part');
    }
  };

  const allChosen = requests.every((r) => choice[r.id]);

  const confirm = () => {
    if (!allChosen) {
      toast.error('Pick a serial number for every part');
      return;
    }
    const instanceMap = {};
    requests.forEach((r) => { instanceMap[r.id] = Number(choice[r.id]); });
    onConfirm(instanceMap);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <button type="button" className="fixed inset-0 bg-black/50" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 my-8 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-900">Select serial numbers</h3>
            <p className="text-xs text-slate-500 mt-0.5">Search or scan to choose a unit for each part</p>
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
              const units = unitsFor(r);
              const shown = filteredUnits(r);
              const selectedId = choice[r.id];
              const selectedUnit = units.find((u) => String(u.instance_id) === String(selectedId));
              return (
                <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-800 text-sm">
                      {r.part_name}
                      {r.quantity > 1 ? <span className="text-slate-400 font-normal"> · Qty {r.quantity}</span> : null}
                    </p>
                    <span className="font-mono text-[11px] text-slate-500">{r.request_number}</span>
                  </div>

                  {!units.length ? (
                    <p className="mt-2 text-[11px] text-amber-600">No stocked units for this part.</p>
                  ) : (
                    <>
                      <div className="mt-2">
                        <ScanField
                          value={search[r.id] || ''}
                          onChange={(text) => setQuery(r.id, text)}
                          onScan={(text) => handleScan(r, text)}
                          placeholder="Search or scan serial / PRT-ID…"
                          aria-label={`Search or scan serial for ${r.part_name}`}
                        />
                      </div>

                      {selectedUnit && (
                        <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="text-xs text-emerald-800 font-mono truncate">
                            {selectedUnit.serial_number || 'No serial'} · {selectedUnit.prt_id}
                            {selectedUnit.location_code ? ` · ${selectedUnit.location_code}` : ''}
                          </span>
                          <button
                            type="button"
                            className="ml-auto text-[11px] text-emerald-700 hover:underline shrink-0"
                            onClick={() => setChoice((prev) => { const n = { ...prev }; delete n[r.id]; return n; })}
                          >
                            Change
                          </button>
                        </div>
                      )}

                      {!selectedUnit && (
                        <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-50">
                          {shown.length === 0 ? (
                            <p className="px-3 py-3 text-[11px] text-slate-400">No units match your search.</p>
                          ) : shown.map((u) => (
                            <button
                              key={u.instance_id}
                              type="button"
                              onClick={() => pick(r.id, u.instance_id)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"
                            >
                              <span className="font-mono text-slate-800 truncate">
                                {u.serial_number || 'No serial'}
                              </span>
                              <span className="font-mono text-slate-400">· {u.prt_id}</span>
                              {u.location_code && (
                                <span className="ml-auto inline-flex items-center gap-1 text-slate-400 shrink-0">
                                  <MapPin className="w-3 h-3" /> {u.location_code}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
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
            disabled={busy || loading || !allChosen}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {busy ? 'Working…' : 'Approve + generate challan'}
          </button>
        </div>
      </div>
    </div>
  );
}
