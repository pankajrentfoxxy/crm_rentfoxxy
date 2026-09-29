import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Drawer, Field, Input, Notice, Select, Textarea,
} from '../../../components/carret';
import { collectLater } from './serveApi';
import { errMsg } from './serveShared';

const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const tomorrowIst = () => new Date(Date.now() + 330 * 60000 + 86400000).toISOString().slice(0, 10);

/**
 * "Collect later" — the customer keeps this laptop for now. It moves to a new
 * Return DC on the same ticket with its own customer OTP; the laptops already
 * collected stay on the current Return DC and can go through the gate today.
 * POST /support/items/:id/collect-later — the technician on their own pickup,
 * or the support lead (who may choose another technician or nobody yet).
 */
export default function CollectLaterDrawer({
  open, onClose, onDone, item, asLead = false, techs = [],
}) {
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(tomorrowIst());
  const [who, setWho] = useState('same');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setReason(''); setDate(tomorrowIst()); setWho('same'); }
  }, [open]);

  const submit = async () => {
    if (reason.trim().length < 3) { toast.error('Write why the customer kept it'); return; }
    if (!date) { toast.error('Choose the new pickup date'); return; }
    setBusy(true);
    try {
      const body = { reason: reason.trim(), pickup_date: date };
      if (asLead && who === 'none') body.unassigned = true;
      else if (asLead && who !== 'same') body.technician_user_id = Number(who);
      const { data } = await collectLater(item.id, body);
      toast.success(data.message || `Moved to ${data.return_dc_number}`);
      onDone?.(data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const techOptions = [
    { value: 'same', label: 'Same technician' },
    ...techs.filter((t) => t.assignee_kind === 'technician' || t.role === 'support_tech')
      .map((t) => ({ value: String(t.user_id), label: t.name })),
    { value: 'none', label: 'Nobody yet — assign later' },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Collect later${item?.code ? ` · ${item.code}` : ''}`}
      footer={<Button variant="primary" disabled={busy} onClick={submit}>{busy ? 'Moving…' : 'Move to a later pickup'}</Button>}
    >
      <div className="c-stack">
        <Notice tone="info">
          The customer keeps this laptop for now. It moves to a new Return DC with its own customer OTP.
          The laptops already collected stay on {item?.rdc || 'this Return DC'} and can go through the gate today.
          Rent on this laptop runs until the warehouse receives it.
        </Notice>
        <Field label="Why did the customer keep it" required>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. still copying data, back tomorrow" />
        </Field>
        <Field label="New pickup date" required>
          <Input type="date" min={todayIst()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {asLead && (
          <Field label="Who collects it">
            <Select value={who} onChange={(e) => setWho(e.target.value)} options={techOptions} />
          </Field>
        )}
      </div>
    </Drawer>
  );
}
