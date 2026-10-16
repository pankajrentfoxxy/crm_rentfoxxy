/**
 * Charger with / without on a laptop challan (migration 430): DC, Service DC,
 * Replacement DC, Return DC and Repair DC all read GET /challan-chargers.
 */
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { fetchPickupCharger, scanPickupCharger } from '../../dispatch-charger/dispatchChargerApi';
import { Button, Drawer, Field, Input, Segmented, Textarea } from '../../../components/carret';

export const fetchChallanChargers = (dc) => api.get('/challan-chargers', { params: { dc } });
export const markChallanCharger = (body) => api.post('/challan-chargers/mark', body);

const up = (v) => String(v || '').trim().toUpperCase();

export function useChallanChargers(dc) {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    if (!dc) return;
    fetchChallanChargers(dc).then(({ data: d }) => setData(d)).catch(() => setData(null));
  }, [dc]);
  useEffect(() => { load(); }, [load]);
  const unitFor = (code, serial) => (data?.units || []).find((u) => u.asset_code === up(code) || (serial && up(u.serial_number) === up(serial))) || null;
  return { data, reload: load, unitFor };
}

/** "With charger · PRT… + PRT…" / "No charger" / "—". */
export function ChargerTag({ mark, empty = '—' }) {
  if (!mark) return <span className="text-ink-3">{empty}</span>;
  const codes = [mark.adapter, mark.cable].filter(Boolean);
  return (
    <span className={`c-chg ${mark.charger === 'with' ? 'is-with' : 'is-without'}`} title={mark.note || undefined}>
      <b>{mark.charger === 'with' ? 'With charger' : 'No charger'}</b>
      {codes.length > 0 && <small className="font-mono">{codes.join(' + ')}</small>}
    </span>
  );
}

/** Set with / without on one laptop (dispatch stage: DC, Service DC, Repair DC). */
export function ChargerSetDrawer({ dc, unit, onClose, onDone }) {
  const [charger, setCharger] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCharger(unit?.dispatch?.charger || ''); setNote(''); }, [unit]);
  const save = async () => {
    setBusy(true);
    try {
      await markChallanCharger({ dc_number: dc, asset_code: unit.asset_code, stage: 'dispatch', charger, note: note.trim() || undefined });
      toast.success('Saved');
      onDone?.();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not save');
    } finally { setBusy(false); }
  };
  return (
    <Drawer
      open={Boolean(unit)}
      onClose={onClose}
      title={`Charger · ${unit?.ttspl_id || unit?.asset_code || ''}`}
      footer={<Button variant="primary" disabled={busy || !charger} onClick={save}>Save</Button>}
    >
      <div className="c-stack">
        <Segmented value={charger} onChange={setCharger} label="Charger" options={[{ value: 'with', label: 'With charger' }, { value: 'without', label: 'Without charger' }]} />
        <Field label="Note (optional)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

/* ── Return DC warehouse receive: the charger check per laptop ─────────── */
const norm = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, '');
const sentCodes = (u) => (u?.sent?.charger === 'with' ? [u.sent.adapter, u.sent.cable].filter(Boolean) : []);

/** Laptops through the gate, not yet received, with no charger check yet. */
export const unitsToCheck = (data) => (data?.units || []).filter((u) => u.gate_inward_at && !u.warehouse_received_at && !u.warehouse);

/** Missing pieces for one laptop's check, or null when it is complete. */
export function chargerCheckGap(u, v = {}) {
  if (!v.charger) return 'choose';
  const sent = sentCodes(u);
  if (v.charger === 'with' && sent.length) {
    if (!v.adapter_scan?.trim()) return 'scan the charger';
    if (u.sent.cable && !v.cable_scan?.trim()) return 'scan the cable';
  }
  if (v.charger === 'without' && sent.length && String(v.note || '').trim().length < 3) return 'say why';
  return null;
}

/** value: { [asset_code]: { charger, adapter_scan, cable_scan, note } } */
export function WarehouseChargerCheck({ units, value, onChange }) {
  const set = (code, patch) => onChange({ ...value, [code]: { ...(value[code] || {}), ...patch } });
  return (
    <div>
      {units.map((u) => {
        const v = value[u.asset_code] || {};
        const sent = sentCodes(u);
        const ok = !chargerCheckGap(u, v);
        const tick = (scan, want) => (scan && want && norm(scan) === norm(want) ? ' ✓' : '');
        return (
          <div key={u.asset_code} className={`c-chgrow${ok ? ' is-ok' : ''}`}>
            <div className="c-chgrow-h">
              <b className="font-mono">{u.ttspl_id || u.asset_code}</b>
              <small>{sent.length ? <>Sent: <span className="font-mono">{sent.join(' + ')}</span></> : 'No charger sent'}</small>
            </div>
            <Segmented
              value={v.charger || ''}
              onChange={(c) => set(u.asset_code, { charger: c })}
              label={`Charger for ${u.asset_code}`}
              options={[{ value: 'with', label: 'With charger' }, { value: 'without', label: 'Without charger' }]}
            />
            {v.charger === 'with' && sent.length > 0 && (
              <div className="c-form-grid" style={{ '--c-cols': u.sent.cable ? 2 : 1 }}>
                <Field label={`Scan charger${tick(v.adapter_scan, u.sent.adapter)}`} required>
                  <Input className="font-mono" autoComplete="off" value={v.adapter_scan || ''} placeholder={u.sent.adapter} onChange={(e) => set(u.asset_code, { adapter_scan: e.target.value })} />
                </Field>
                {u.sent.cable && (
                  <Field label={`Scan cable${tick(v.cable_scan, u.sent.cable)}`} required>
                    <Input className="font-mono" autoComplete="off" value={v.cable_scan || ''} placeholder={u.sent.cable} onChange={(e) => set(u.asset_code, { cable_scan: e.target.value })} />
                  </Field>
                )}
              </div>
            )}
            {v.charger === 'without' && sent.length > 0 && (
              <Field label="Why it is not here" required>
                <Input value={v.note || ''} onChange={(e) => set(u.asset_code, { note: e.target.value })} />
              </Field>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Pickup: was the laptop collected with its charger ──────────────────── */
/**
 * On the technician's pickup screen. "With" scans the charger we sent (and its
 * cable); "Without" needs a reason when we had sent one. Saved on the Return DC.
 * onReady(true) once it is recorded.
 */
export function CollectChargerPanel({ itemId, rdc, code, onReady }) {
  const chargers = useChallanChargers(rdc);
  const unit = chargers.unitFor(code);
  const [v, setV] = useState({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = Boolean(unit?.collected) && !editing;
  // Not on this Return DC's list (old record): nothing to record, don't block the OTP.
  const ready = Boolean(chargers.data) && (!unit || Boolean(unit.collected));
  useEffect(() => { onReady?.(ready); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!chargers.data) return <span className="text-ink-3">Checking the charger…</span>;
  if (!unit) return null;
  const sent = sentCodes(unit);
  if (done) {
    return (
      <div className="c-notice is-good">
        <div className="min-w-0" style={{ flex: 1 }}><ChargerTag mark={unit.collected} /></div>
        <Button variant="quiet" onClick={() => { setEditing(true); setV({}); }}>Change</Button>
      </div>
    );
  }
  const gap = chargerCheckGap(unit, v);
  const save = async () => {
    setBusy(true);
    try {
      let viaScan = false;
      if (v.charger === 'with' && sent.length && itemId) {
        // A return pickup records the scan against the charger we sent (restock follows).
        const st = (await fetchPickupCharger(itemId)).data?.data;
        if (st?.required) {
          await scanPickupCharger(itemId, { ttspl_scan: code, adapter_scan: v.adapter_scan, charger_scan: v.adapter_scan, cable_scan: v.cable_scan });
          viaScan = true;
        }
      }
      if (!viaScan) {
        await markChallanCharger({ dc_number: rdc, asset_code: code, stage: 'collected', charger: v.charger, adapter_scan: v.adapter_scan, cable_scan: v.cable_scan, note: v.note, source: 'pickup' });
      }
      toast.success('Charger recorded');
      setEditing(false);
      chargers.reload();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not record the charger');
    } finally { setBusy(false); }
  };
  return (
    <div className="c-qsec" style={{ padding: '12px 14px' }}>
      <WarehouseChargerCheck units={[unit]} value={{ [unit.asset_code]: v }} onChange={(m) => setV(m[unit.asset_code] || {})} />
      <Button variant="primary" disabled={busy || Boolean(gap)} onClick={save} style={{ width: '100%', marginTop: '10px' }}>Save charger</Button>
    </div>
  );
}
