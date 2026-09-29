import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Drawer, EmptyState, Field, FormGrid, Input, Segmented, Textarea } from '../../../../components/carret';
import { assignTicket, getTeamMembers } from '../../../floor-pipeline/floorPipelineApi';
import api from '../../../../utils/api';
import { errText, TtsplInput } from './workShared';

/**
 * Triage (a new laptop at Floor Manager) or reassign (any other stage).
 * Triage: confirm it powers on or not, scan TTSPL + serial, give it to a
 * technician — it moves to Diagnosis with them. Assign / reassign at any other
 * stage: pick someone on the stage's team or anyone at all; the laptop stays at
 * its stage (keep_stage) and only the person changes, with an optional reason
 * kept in the history. Floor managers, managers, admins and anyone given
 * "Assign floor tickets" do this (the server checks).
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
  const [scope, setScope] = useState('team'); // 'team' | 'anyone'
  const [everyone, setEveryone] = useState(null);
  const [q, setQ] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open || !ticket) return;
    setPowers(ticket.received_condition === 'not_on' ? 'not_on' : ticket.received_condition === 'on' ? 'on' : '');
    setTtspl(ticket.ttspl_id || '');
    setSerial(ticket.serial_number && ticket.serial_number !== 'NOT_ON' ? ticket.serial_number : '');
    setWho(null);
    setMembers(null);
    setScope('team');
    setQ('');
    setReason('');
    getTeamMembers(TEAM_FOR_STAGE[ticket.stage_name] || 'Hardware & Software')
      .then(({ data }) => setMembers(data?.members || []))
      .catch(() => setMembers([]));
  }, [open, ticket]);

  useEffect(() => {
    if (!open || scope !== 'anyone' || everyone) return;
    api.get('/tickets/assignable-users')
      .then(({ data }) => setEveryone(data?.users || []))
      .catch((e) => { toast.error(errText(e, 'Could not load people')); setEveryone([]); });
  }, [open, scope, everyone]);

  if (!ticket) return null;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const pool = (scope === 'anyone' ? everyone : members);
  const list = pool == null ? null : pool
    .filter((m) => m.user_id !== ticket.assigned_user_id || scope === 'team')
    .filter((m) => { const hay = `${m.name} ${m.role || ''} ${(m.teams || []).join(' ')}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
  const least = (list || []).reduce((b, m) => (b == null || (m.active_tickets ?? 0) < (b.active_tickets ?? 0) ? m : b), null);
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
      else Object.assign(body, { keep_stage: true, reason: reason.trim() || undefined });
      await assignTicket(ticket.ticket_id, body);
      toast.success(triage ? 'Triaged and assigned' : (ticket.assigned_user_id ? 'Reassigned' : 'Assigned'));
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
      title={triage ? 'Triage and assign' : (ticket.assigned_user_id ? `Reassign — ${ticket.stage_name}` : `Assign — ${ticket.stage_name}`)}
      width="32rem"
      footer={(
        <>
          {missing.length > 0 && <span className="text-ink-3" style={{ fontSize: '13px', marginRight: 'auto' }}>To assign: {missing.join(', ')}.</span>}
          <Button variant="primary" disabled={busy || missing.length > 0} onClick={go}>{triage ? 'Assign' : (ticket.assigned_user_id ? 'Reassign' : 'Assign')}</Button>
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
              <Field label="TTSPL" required><TtsplInput value={ttspl} onChange={setTtspl} expected={ticket?.ttspl_id} /></Field>
              <Field label="Serial" required={powers === 'on'} hint={powers === 'not_on' ? 'Optional while it will not power on' : undefined}><Input value={serial} onChange={(e) => setSerial(e.target.value)} className="font-mono" /></Field>
            </FormGrid>
          </>
        )}
        {!triage && ticket.assigned_user_id && (
          <p className="text-ink-2" style={{ margin: 0 }}>Now with <b>{ticket.assigned_user_name || 'someone'}</b>. The laptop stays at {ticket.stage_name}; only the person changes.</p>
        )}
        <Segmented
          label="Who can take it"
          value={scope}
          onChange={(v) => { setScope(v); setWho(null); }}
          options={[{ value: 'team', label: TEAM_FOR_STAGE[ticket.stage_name] || 'Hardware & Software' }, { value: 'anyone', label: 'Anyone' }]}
        />
        {triage && scope === 'anyone' && <p className="text-ink-3" style={{ margin: 0, fontSize: '13px' }}>The laptop moves to the first stage of that person’s team.</p>}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, role or team" />
        <Field label={triage ? 'Technician' : 'Who takes it'} required>
          {list == null ? <EmptyState title="Loading…" /> : !list.length ? <EmptyState title={q ? 'Nobody matches' : 'Nobody here'} /> : (
            <div className="c-choice" style={{ maxHeight: '22rem', overflowY: 'auto' }}>
              {list.map((m) => (
                <label key={m.user_id} className={who === m.user_id ? 'is-on' : ''}>
                  <input type="radio" name="assignee" checked={who === m.user_id} onChange={() => setWho(m.user_id)} />
                  <span>
                    {m.name}
                    <small>
                      {m.active_tickets || 0} open ticket{(m.active_tickets || 0) === 1 ? '' : 's'}{least && least.user_id === m.user_id ? ' · least busy' : ''}
                      {scope === 'anyone' && [m.role, ...(m.teams || [])].filter(Boolean).length > 0 && ` · ${[m.role, ...(m.teams || [])].filter(Boolean).join(', ')}`}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          )}
        </Field>
        {!triage && (
          <Field label="Reason (optional)" hint="Kept in the ticket history.">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. on leave today, workload" />
          </Field>
        )}
      </div>
    </Drawer>
  );
}
