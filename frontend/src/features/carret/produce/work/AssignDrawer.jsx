import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Drawer, EmptyState, Field, FormGrid, Input, Segmented } from '../../../../components/carret';
import { assignTicket, getTeamMembers } from '../../../floor-pipeline/floorPipelineApi';
import { errText } from './workShared';

/**
 * Triage (a new laptop at Floor Manager) or reassign (any other stage).
 * Triage: confirm it powers on or not, scan TTSPL + serial, give it to a
 * technician — it moves to Diagnosis with them. Reassign: pick someone on the
 * stage's team. Only floor managers do this (the server checks).
 */
const TEAM_FOR_STAGE = {
  'Chip Level Repair': 'Chip Level Repair Team',
  QC1: 'QC1 Team',
  QC2: 'QC2 Team',
};

export default function AssignDrawer({ ticket, open, onClose, onDone }) {
  const triage = ticket?.stage_name === 'Floor Manager';
  const [powers, setPowers] = useState('');
  const [ttspl, setTtspl] = useState('');
  const [serial, setSerial] = useState('');
  const [members, setMembers] = useState(null);
  const [who, setWho] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !ticket) return;
    setPowers(ticket.received_condition === 'not_on' ? 'not_on' : ticket.received_condition === 'on' ? 'on' : '');
    setTtspl(ticket.ttspl_id || '');
    setSerial(ticket.serial_number && ticket.serial_number !== 'NOT_ON' ? ticket.serial_number : '');
    setWho(null);
    setMembers(null);
    getTeamMembers(TEAM_FOR_STAGE[ticket.stage_name] || 'Hardware & Software')
      .then(({ data }) => setMembers(data?.members || []))
      .catch(() => setMembers([]));
  }, [open, ticket]);

  if (!ticket) return null;
  const least = (members || []).reduce((b, m) => (b == null || (m.active_tickets ?? 0) < (b.active_tickets ?? 0) ? m : b), null);
  const missing = [
    triage && !powers && 'say whether it powers on',
    triage && !ttspl.trim() && 'scan the TTSPL',
    triage && powers === 'on' && !serial.trim() && 'scan the serial',
    !who && 'pick a person',
  ].filter(Boolean);

  const go = async () => {
    setBusy(true);
    try {
      const body = { user_id: who };
      if (triage) Object.assign(body, { laptop_condition: powers, ttspl_id: ttspl.trim(), serial_number: serial.trim() || undefined });
      await assignTicket(ticket.ticket_id, body);
      toast.success(triage ? 'Triaged — it is in Diagnosis' : 'Reassigned');
      onDone?.();
    } catch (e) {
      toast.error(errText(e, 'Could not assign'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={triage ? 'Triage and assign' : 'Reassign'}
      width="32rem"
      footer={(
        <>
          {missing.length > 0 && <span className="text-ink-3" style={{ fontSize: '13px', marginRight: 'auto' }}>To assign: {missing.join(', ')}.</span>}
          <Button variant="primary" disabled={busy || missing.length > 0} onClick={go}>{triage ? 'Send to Diagnosis' : 'Reassign'}</Button>
        </>
      )}
    >
      <div className="c-stack">
        {triage && (
          <>
            <Field label="Does it power on?" required>
              <Segmented value={powers} onChange={setPowers} label="Powers on" options={[{ value: 'on', label: 'Yes' }, { value: 'not_on', label: "No, it won't power on" }]} />
            </Field>
            <FormGrid cols={2}>
              <Field label="TTSPL" required><Input value={ttspl} onChange={(e) => setTtspl(e.target.value)} className="font-mono" /></Field>
              <Field label="Serial" required={powers === 'on'} hint={powers === 'not_on' ? 'Optional while it will not power on' : undefined}><Input value={serial} onChange={(e) => setSerial(e.target.value)} className="font-mono" /></Field>
            </FormGrid>
          </>
        )}
        <Field label={triage ? 'Technician for Diagnosis' : `Who takes it (${TEAM_FOR_STAGE[ticket.stage_name] || 'Hardware & Software'})`} required>
          {members == null ? <EmptyState title="Loading…" /> : !members.length ? <EmptyState title="Nobody on this team" /> : (
            <div className="c-choice">
              {members.map((m) => (
                <label key={m.user_id} className={who === m.user_id ? 'is-on' : ''}>
                  <input type="radio" name="assignee" checked={who === m.user_id} onChange={() => setWho(m.user_id)} />
                  <span>
                    {m.name}
                    <small>{m.active_tickets || 0} open ticket{(m.active_tickets || 0) === 1 ? '' : 's'}{least && least.user_id === m.user_id ? ' · least busy' : ''}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
        </Field>
      </div>
    </Drawer>
  );
}
