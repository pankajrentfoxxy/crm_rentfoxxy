import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, Check, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listPartInstances,
  updatePartInstanceFitment,
} from '../../floor-pipeline/partRequestsApi';
import ScanField from '../../../components/ScanField';
import FitmentControls, {
  FitmentChip,
  computeFitStatus,
  emptyFitment,
} from '../../inventory-management/components/FitmentControls';

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
  const [unitsByReq, setUnitsByReq] = useState({});
  const [choice, setChoice] = useState({}); // { [request_id]: instance_id }
  const [search, setSearch] = useState({}); // { [request_id]: text }
  const [showAllByReq, setShowAllByReq] = useState({}); // { [request_id]: bool }
  const [retagKey, setRetagKey] = useState(null); // `${reqId}:${instanceId}`
  const [retagValue, setRetagValue] = useState(emptyFitment());
  const [retagReason, setRetagReason] = useState('');
  const [retagBusy, setRetagBusy] = useState(false);

  const partIds = useMemo(
    () => [...new Set(requests.map((r) => r.part_id).filter(Boolean))],
    [requests]
  );

  const laptopFor = useCallback((r) => ({
    brand: r.brand || r.laptop_brand || '',
    model: r.model || r.laptop_model || '',
  }), []);

  const loadUnits = useCallback(async () => {
    if (!requests.length) return;
    setLoading(true);
    try {
      const pairs = await Promise.all(
        requests.map(async (r) => {
          const params = {
            part_id: r.part_id,
            status: 'in_stock',
            limit: 500,
            for_request_id: r.id || r.request_id,
            for_request_kind: 'support',
          };
          if (showAllByReq[r.id]) params.include_incompatible = true;
          try {
            const { data } = await listPartInstances(params);
            return [r.id, data.instances || []];
          } catch {
            return [r.id, []];
          }
        })
      );
      const byReq = Object.fromEntries(pairs);
      setUnitsByReq(byReq);
    } finally {
      setLoading(false);
    }
  }, [requests, showAllByReq]);

  useEffect(() => {
    if (!open || !partIds.length) return undefined;
    setChoice({});
    setSearch({});
    setShowAllByReq({});
    setRetagKey(null);
    return undefined;
  }, [open, partIds]);

  useEffect(() => {
    if (!open || !requests.length) return undefined;
    loadUnits();
    return undefined;
  }, [open, requests, loadUnits]);

  if (!open) return null;

  const unitsFor = (r) => unitsByReq[r.id] || [];

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

  const openRetag = (r, u) => {
    const hint = laptopFor(r);
    setRetagKey(`${r.id}:${u.instance_id}`);
    setRetagValue({
      fitment: u.fitment || 'unset',
      fits_laptop_brand: u.fits_laptop_brand || hint.brand || null,
      fits_laptop_models: Array.isArray(u.fits_laptop_models) && u.fits_laptop_models.length
        ? u.fits_laptop_models
        : (hint.model ? [hint.model] : []),
    });
    setRetagReason('');
  };

  const saveRetag = async (r, instanceId) => {
    if (retagValue.fitment === 'specific' && !retagValue.fits_laptop_brand) {
      toast.error('Pick a laptop brand');
      return;
    }
    if (!retagReason.trim()) {
      toast.error('Reason is required to retag');
      return;
    }
    setRetagBusy(true);
    try {
      await updatePartInstanceFitment(instanceId, {
        fitment: retagValue.fitment,
        fits_laptop_brand: retagValue.fits_laptop_brand,
        fits_laptop_models: retagValue.fits_laptop_models,
        reason: retagReason.trim(),
      });
      toast.success('Fitment updated');
      setRetagKey(null);
      await loadUnits();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Retag failed');
    } finally {
      setRetagBusy(false);
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
              const hint = laptopFor(r);
              return (
                <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-800 text-sm">
                      {r.part_name}
                      {r.quantity > 1 ? <span className="text-slate-400 font-normal"> · Qty {r.quantity}</span> : null}
                    </p>
                    <span className="font-mono text-[11px] text-slate-500">{r.request_number}</span>
                  </div>
                  {(r.ttspl_id || hint.brand) ? (
                    <p className="text-[11px] text-slate-500 m-0 mt-0.5">
                      {[r.ttspl_id, hint.brand && `${hint.brand}${hint.model ? ` ${hint.model}` : ''}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ) : null}

                  {!units.length ? (
                    <p className="mt-2 text-[11px] text-amber-600">No stocked units for this part.</p>
                  ) : (
                    <>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <ScanField
                            value={search[r.id] || ''}
                            onChange={(text) => setQuery(r.id, text)}
                            onScan={(text) => handleScan(r, text)}
                            placeholder="Search or scan serial / PRT-ID…"
                            aria-label={`Search or scan serial for ${r.part_name}`}
                          />
                        </div>
                        <label
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 cursor-pointer shrink-0 whitespace-nowrap"
                          title="Hides units tagged for a different laptop brand/model"
                        >
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={!showAllByReq[r.id]}
                            onChange={(e) => setShowAllByReq((prev) => ({ ...prev, [r.id]: !e.target.checked }))}
                          />
                          Only parts for this laptop
                        </label>
                      </div>

                      {selectedUnit && (
                        <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="text-xs text-emerald-800 font-mono truncate">
                            {selectedUnit.serial_number || 'No serial'} · {selectedUnit.prt_id}
                            {selectedUnit.location_code ? ` · ${selectedUnit.location_code}` : ''}
                          </span>
                          <FitmentChip status={computeFitStatus(selectedUnit, hint.brand, hint.model)} />
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
                          ) : shown.map((u) => {
                            const status = computeFitStatus(u, hint.brand, hint.model);
                            const key = `${r.id}:${u.instance_id}`;
                            return (
                              <div key={u.instance_id} className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => pick(r.id, u.instance_id)}
                                  className="flex w-full items-center gap-2 text-left text-xs hover:bg-slate-50 rounded"
                                >
                                  <span className="font-mono text-slate-800 truncate">
                                    {u.serial_number || 'No serial'}
                                  </span>
                                  <span className="font-mono text-slate-400">· {u.prt_id}</span>
                                  <FitmentChip status={status} />
                                  {u.location_code && (
                                    <span className="ml-auto inline-flex items-center gap-1 text-slate-400 shrink-0">
                                      <MapPin className="w-3 h-3" /> {u.location_code}
                                    </span>
                                  )}
                                </button>
                                {status === 'unfit' ? (
                                  <div className="mt-1.5">
                                    {retagKey === key ? (
                                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2">
                                        <FitmentControls
                                          compact
                                          value={retagValue}
                                          onChange={setRetagValue}
                                          laptopHint={hint.brand ? hint : null}
                                          allowUnset
                                        />
                                        <input
                                          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                                          placeholder="Reason for retag"
                                          value={retagReason}
                                          onChange={(e) => setRetagReason(e.target.value)}
                                        />
                                        <div className="flex gap-2">
                                          <button
                                            type="button"
                                            disabled={retagBusy}
                                            onClick={() => saveRetag(r, u.instance_id)}
                                            className="rounded-lg bg-slate-800 text-white px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                                          >
                                            {retagBusy ? 'Saving…' : 'Save retag'}
                                          </button>
                                          <button
                                            type="button"
                                            disabled={retagBusy}
                                            onClick={() => setRetagKey(null)}
                                            className="rounded-lg border px-2.5 py-1 text-xs"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        className="text-[11px] font-semibold text-blue-700 hover:underline"
                                        onClick={() => openRetag(r, u)}
                                      >
                                        Retag
                                      </button>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
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
