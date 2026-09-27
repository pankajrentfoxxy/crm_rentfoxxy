import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Drawer, Field, FormGrid, Input, Notice, Select, Textarea,
} from '../../../components/carret';
import {
  TAG_OPTIONS, errMsg, fetchCarret, requestScrap, retag, setLocation,
} from './stockApi';

/**
 * Stock actions shared by the asset record and Ready stock (claude/carret-stock.md, ST-D2/D3).
 * Every change carries a reason; the backend logs it on the laptop's history.
 */

/** Re-tag one or more ready laptops: Rent / Sell / Rent or sell. */
export function RetagDrawer({ laptops, onClose, onDone }) {
  const [tag, setTag] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTag(laptops?.length === 1 ? (laptops[0].tag || '') : ''); setReason(''); }, [laptops]);
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await retag(laptops.map((l) => l.serial_id), tag, reason);
      toast.success(data.message);
      onDone?.();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Drawer open={Boolean(laptops?.length)} onClose={onClose} title={`Tag ${laptops?.length === 1 ? laptops[0].ttspl_id : `${laptops?.length || 0} laptops`}`} footer={<Button variant="primary" disabled={busy || !tag || reason.trim().length < 3} onClick={save}>Save</Button>}>
      <div className="c-stack">
        <Field label="Use for" required><Select value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Choose…" options={TAG_OPTIONS} /></Field>
        <Field label="Reason" required hint="Kept in the laptop's history"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

/** Put a ready laptop in a carret slot (free slots shown), or take it out. */
export function LocationDrawer({ laptop, onClose, onDone }) {
  const [carret, setCarret] = useState('');
  const [slot, setSlot] = useState('');
  const [occ, setOcc] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCarret(laptop?.warehouse_carret ? String(laptop.warehouse_carret) : '');
    setSlot(laptop?.warehouse_carret_slot ? String(laptop.warehouse_carret_slot) : '');
    setReason('');
  }, [laptop]);
  useEffect(() => {
    if (!carret) { setOcc(null); return; }
    fetchCarret(carret).then(({ data }) => setOcc(data)).catch(() => setOcc(null));
  }, [carret]);
  const slotsPer = occ?.slots_per_carret || 17;
  const taken = new Map(((occ?.data?.slots) || []).map((s) => [Number(s.slot), s]));
  const save = async (clear = false) => {
    setBusy(true);
    try {
      const { data } = await setLocation(laptop.serial_id, clear ? null : Number(carret), clear ? null : Number(slot), reason);
      toast.success(data.message);
      onDone?.();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const carretOptions = Array.from({ length: (occ?.carret_max || 30) - (occ?.carret_min || 1) + 1 }, (_, i) => String((occ?.carret_min || 1) + i));
  return (
    <Drawer
      open={Boolean(laptop)}
      onClose={onClose}
      title={`Slot — ${laptop?.ttspl_id || ''}`}
      footer={(
        <>
          {laptop?.warehouse_carret && <Button variant="quiet" disabled={busy || reason.trim().length < 3} onClick={() => save(true)}>Take out of slot</Button>}
          <Button variant="primary" disabled={busy || !carret || !slot || reason.trim().length < 3} onClick={() => save(false)}>Move here</Button>
        </>
      )}
    >
      {laptop && (
        <div className="c-stack">
          <p>Now: <strong>{laptop.location || 'no slot'}</strong></p>
          <FormGrid cols={2}>
            <Field label="Carret" required>
              <Select value={carret} onChange={(e) => { setCarret(e.target.value); setSlot(''); }} placeholder="Choose…" options={carretOptions.map((c) => ({ value: c, label: `Carret ${c}` }))} />
            </Field>
            <Field label="Slot" required>
              <Select
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                placeholder={carret ? 'Choose…' : 'Pick a carret'}
                options={Array.from({ length: slotsPer }, (_, i) => i + 1).map((n) => {
                  const t = taken.get(n);
                  const mine = t && Number(t.serial_id) === Number(laptop.serial_id);
                  return { value: String(n), label: t && !mine ? `Slot ${n} — ${t.inventory_asset_code || t.ttspl_id || 'taken'}` : `Slot ${n}${mine ? ' (this laptop)' : ''}`, disabled: Boolean(t && !mine) };
                })}
              />
            </Field>
          </FormGrid>
          {carret && occ && <p className="text-ink-3">{taken.size} of {slotsPer} slots in carret {carret} are taken.</p>}
          <Field label="Reason" required hint="Kept in the laptop's history"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      )}
    </Drawer>
  );
}

/** Ask for a laptop to be scrapped; a manager approves on Stock → Scrap. */
export function ScrapRequestDrawer({ laptop, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setReason(''), [laptop]);
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await requestScrap(laptop.serial_id, reason);
      toast.success(data.message);
      onDone?.();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Drawer open={Boolean(laptop)} onClose={onClose} title={`Scrap ${laptop?.ttspl_id || ''}`} footer={<Button variant="primary" disabled={busy || reason.trim().length < 5} onClick={save}>Send for approval</Button>}>
      <div className="c-stack">
        <Notice tone="warn">A manager must approve. Once approved the laptop is scrapped for good and goes out on a scrap challan to the buyer. If it has usable parts, dismantle it on the floor first.</Notice>
        <Field label="Why it cannot be repaired or used" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}
