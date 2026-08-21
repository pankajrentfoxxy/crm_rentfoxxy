import React, { useMemo, useState } from 'react';
import { Mono, Modal, Button } from '../../../../components/ui/supportPrimitives';
import { applySiteFromAsset, sameSite } from '../../ticketDraft';

export default function StepMachines({ state, setState, assets }) {
  const [q, setQ] = useState('');
  const [browse, setBrowse] = useState(false);
  const [cross, setCross] = useState(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  const selected = new Set(state.selectedSerials);
  const pin = String(state.site_pincode || '').replace(/\D/g, '').slice(0, 6);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (assets || []).filter((a) => {
      if (!needle) return true;
      return [a.ttspl_id, a.serial_number, a.assigned_employee, a.model, a.brand]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [assets, q]);

  const atSite = useMemo(() => {
    if (!state.site_key && !pin) return [];
    return (assets || []).filter((a) => sameSite(a, state.site_key, pin));
  }, [assets, state.site_key, pin]);

  const selectFirst = (asset) => {
    setState((s) => {
      const next = applySiteFromAsset(s, asset);
      return { ...next, selectedSerials: [asset.serial_id], unknownAsset: false };
    });
  };

  const toggle = (asset) => {
    if (state.unknownAsset) return;
    if (!state.selectedSerials.length) {
      selectFirst(asset);
      return;
    }
    if (!sameSite(asset, state.site_key, pin)) {
      setCross(asset);
      return;
    }
    setState((s) => {
      const next = new Set(s.selectedSerials);
      if (next.has(asset.serial_id)) next.delete(asset.serial_id);
      else next.add(asset.serial_id);
      return { ...s, selectedSerials: [...next] };
    });
  };

  const switchSite = (asset) => {
    selectFirst(asset);
    setCross(null);
  };

  const applyOverride = () => {
    if (overrideReason.trim().length < 10) return;
    setState((s) => ({ ...s, site_source: 'MANUAL_OVERRIDE', site_override_reason: overrideReason.trim() }));
    setOverrideOpen(false);
  };

  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search TTSPL ID, serial number, or the user's name"
        className="w-full rounded-md border border-sup-line px-3 py-2 text-[13px]"
      />
      <button type="button" className="text-[12px] text-sup-accent underline" onClick={() => setBrowse((v) => !v)}>
        {browse ? 'Hide full list' : `Browse all ${(assets || []).length} machines`}
      </button>

      {state.site_label && (
        <div className="rounded-[10px] border border-sup-accent bg-sup-accentSoft p-3 text-[12px]">
          <div className="flex justify-between gap-2">
            <div className="font-semibold">Delivery location</div>
            <button type="button" className="underline" onClick={() => setOverrideOpen(true)}>Change location</button>
          </div>
          <div>{state.site_label}</div>
          <div className="text-sup-muted">
            {state.site_dc_number ? `DC ${state.site_dc_number}` : 'Location unknown — no delivery challan matched'}
            {atSite.length ? ` · ${atSite.length} machines here` : ''}
          </div>
        </div>
      )}

      {!!atSite.length && state.selectedSerials.length > 0 && (
        <div className="bg-white rounded-[10px] border border-sup-lineSoft p-3">
          <div className="flex justify-between text-[12px] mb-2">
            <span className="font-semibold">Other machines at this location</span>
            <button type="button" className="text-sup-accent underline" onClick={() => setState((s) => ({ ...s, selectedSerials: atSite.map((a) => a.serial_id) }))}>
              Select all {atSite.length}
            </button>
          </div>
          {atSite.map((a) => (
            <label key={a.serial_id} className="flex items-center gap-2 py-1 text-[12px] border-t border-sup-lineSoft">
              <input type="checkbox" checked={selected.has(a.serial_id)} onChange={() => toggle(a)} />
              <Mono bold>{a.ttspl_id || '—'}</Mono>
              <span>{[a.brand, a.model].filter(Boolean).join(' ') || '—'}</span>
              <span className="text-sup-muted">{a.assigned_employee || '—'}</span>
              <span className="ml-auto text-sup-muted">{a.complaint_count_90d || 0} / 90d</span>
            </label>
          ))}
        </div>
      )}

      {(browse || q.trim() || !state.selectedSerials.length) && (
        <div className="bg-white rounded-[10px] border border-sup-lineSoft overflow-auto max-h-[360px]">
          <table className="w-full text-[12px]">
            <thead className="bg-sup-canvas2 text-sup-muted">
              <tr>
                <th className="w-8" />
                <th className="text-left px-2 py-1.5">TTSPL</th>
                <th className="text-left px-2 py-1.5">Model</th>
                <th className="text-left px-2 py-1.5">User</th>
                <th className="text-left px-2 py-1.5">Location</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.serial_id} className="border-t border-sup-lineSoft">
                  <td className="px-2 py-1.5"><input type="checkbox" checked={selected.has(a.serial_id)} onChange={() => toggle(a)} /></td>
                  <td className="px-2 py-1.5"><Mono bold>{a.ttspl_id || '—'}</Mono></td>
                  <td className="px-2 py-1.5">{[a.brand, a.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-2 py-1.5">{a.assigned_employee || '—'}</td>
                  <td className="px-2 py-1.5">{[a.delivery_address, a.delivery_pincode || a.pincode].filter(Boolean).join(' · ') || '—'}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-sup-muted">No machines match. Tick “Machine not listed” if it is not in the fleet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <label className="text-[12px] flex items-center gap-1.5">
        <input type="checkbox" checked={state.unknownAsset} onChange={(e) => setState((s) => ({ ...s, unknownAsset: e.target.checked, selectedSerials: e.target.checked ? [] : s.selectedSerials }))} />
        Machine not listed
      </label>
      {state.unknownAsset && (
        <p className="text-[12px] text-sup-muted">Pick a CRM address or type a pincode via Change location, then continue.</p>
      )}

      {cross && (
        <Modal title="Different location" onClose={() => setCross(null)} footer={(
          <>
            <Button variant="secondary" onClick={() => setCross(null)}>Keep this location</Button>
            <Button onClick={() => switchSite(cross)}>Switch this ticket to that location</Button>
          </>
        )}>
          <p className="text-[13px]">
            {cross.ttspl_id || 'This machine'} was delivered to <b>{[cross.delivery_address, cross.delivery_pincode].filter(Boolean).join(', ') || 'another site'}</b>, not this location.
            A ticket covers one location.
          </p>
        </Modal>
      )}

      {overrideOpen && (
        <Modal title="Change location" onClose={() => setOverrideOpen(false)} footer={(
          <>
            <Button variant="secondary" onClick={() => setOverrideOpen(false)}>Cancel</Button>
            <Button disabled={overrideReason.trim().length < 10} onClick={applyOverride}>Save override</Button>
          </>
        )}>
          <p className="text-[12px] mb-2">Requires a reason (min 10 characters). Logged as SITE_OVERRIDDEN.</p>
          <textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={3} className="w-full border rounded-md px-2 py-1.5 text-[13px]" />
        </Modal>
      )}
    </div>
  );
}

export function machinesStepValid(state) {
  if (state.unknownAsset) return Boolean(state.site_key || state.site_pincode || state.site_label);
  return (state.selectedSerials || []).length > 0;
}
