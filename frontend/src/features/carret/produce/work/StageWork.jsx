import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, EmptyState, Field, Notice, Select, Textarea } from '../../../../components/carret';
import api from '../../../../utils/api';
import { getTeamMembers } from '../../../floor-pipeline/floorPipelineApi';
import { Choice, StepHead, errText, useFloorChecklists } from './workShared';

/**
 * Chip-level repair, Body & Paint, Assembly & software, Final testing.
 *
 *   1. Tick each job as you finish it (the list is the stage's own checklist).
 *   2. Choose the outcome — "done" needs every tick; anything else needs a
 *      reason. Final testing → QC1 can name an inspector (not you, and not
 *      anyone who worked on it) or leave it for the QC1 queue.
 *
 * One server action finishes the stage and moves the laptop (the old panel
 * saved, then moved, in two requests — and Body & Paint could not leave).
 */
const INTRO = {
  'Chip Level Repair': 'Repair the board. Parts go through the Parts tab. When it works, it goes back to Diagnosis for a full re-check.',
  'Body & Paint': 'Fix the body. When done, it goes back to Diagnosis for a full re-check.',
  'Assembly & Software': 'Fit any parts waiting in the Parts tab, put it together and set up the software.',
  'Final Testing': 'Test everything before QC. Someone else inspects it at QC1.',
};

export default function StageWork({ ticket, stage, onDone }) {
  const { data: defs, error } = useFloorChecklists();
  const [ticks, setTicks] = useState({});
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [qc, setQc] = useState('');
  const [inspectors, setInspectors] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (stage !== 'Final Testing') return;
    getTeamMembers('QC1 Team').then(({ data }) => setInspectors(data?.members || data?.users || [])).catch(() => setInspectors([]));
  }, [stage]);

  if (error) return <Notice tone="crit" title="Could not load the checklist">{error}</Notice>;
  if (!defs) return <EmptyState title="Loading…" />;

  const items = defs.stages?.[stage] || [];
  const outcomes = (defs.stageOutcomes?.[stage] || []);
  const openTicks = items.filter((it) => !ticks[it.key]).length;
  const chosen = outcomes.find((o) => o.value === outcome);
  const doneNeedsTicks = outcome === 'done' && openTicks > 0;
  const needReason = chosen?.needsReason;
  const missing = [
    !outcome && 'choose the outcome',
    doneNeedsTicks && `tick ${openTicks} more job${openTicks > 1 ? 's' : ''}`,
    needReason && reason.trim().length < 5 && 'say what is wrong',
  ].filter(Boolean);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/tickets/${ticket.ticket_id}/stage-work`, {
        outcome,
        checklist: ticks,
        notes: notes.trim() || undefined,
        reason: reason.trim() || undefined,
        assign_to: qc ? Number(qc) : undefined,
      });
      toast.success(`${chosen?.label || 'Done'}`);
      onDone?.();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const others = inspectors.filter((m) => Number(m.user_id) !== Number(ticket.assigned_user_id));

  return (
    <div className="c-stack">
      <p className="text-ink-2" style={{ margin: 0 }}>{INTRO[stage]}</p>
      <StepHead n={1} of={2}>Tick each job when it is done</StepHead>
      <div className="c-qsec">
        <div className="c-qsec-h">{stage}<small>{items.length - openTicks}/{items.length}</small></div>
        {items.map((it) => (
          <label key={it.key} className={`c-tick${ticks[it.key] ? ' is-on' : ''}`}>
            <input type="checkbox" checked={!!ticks[it.key]} onChange={() => setTicks((t) => ({ ...t, [it.key]: !t[it.key] }))} />
            {it.label}
          </label>
        ))}
      </div>
      <Field label="Work notes (optional)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

      <StepHead n={2} of={2}>What happens next</StepHead>
      <Choice
        name={`sw-${stage}`}
        value={outcome}
        onChange={setOutcome}
        options={outcomes.map((o) => ({ value: o.value, label: o.label, hint: o.value === 'done' && openTicks ? `${openTicks} job(s) not ticked yet` : undefined }))}
      />
      {needReason && <Field label="What is wrong" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      {stage === 'Final Testing' && outcome === 'done' && (
        <Field label="QC1 inspector" hint="Leave empty to put it in the QC1 queue. It can't be you or anyone who worked on it.">
          <Select value={qc} onChange={(e) => setQc(e.target.value)} placeholder="QC1 queue (anyone on the team)" options={others.map((m) => ({ value: String(m.user_id), label: m.name }))} />
        </Field>
      )}
      <div className="c-actions-bar" style={{ alignItems: 'center' }}>
        {missing.length > 0 && <span className="text-ink-3" style={{ fontSize: '13px', marginRight: 'auto' }}>To finish: {missing.join(', ')}.</span>}
        <Button variant="primary" disabled={busy || missing.length > 0} onClick={submit}>{busy ? 'Saving…' : 'Finish this stage'}</Button>
      </div>
    </div>
  );
}
