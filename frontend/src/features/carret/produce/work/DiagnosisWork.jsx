import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, EmptyState, Field, FormGrid, Input, Notice, Segmented, Textarea } from '../../../../components/carret';
import api from '../../../../utils/api';
import { Choice, QuestionSection, StepHead, errText, useFloorChecklists } from './workShared';

/**
 * Diagnosis — find out what is wrong with the laptop.
 *
 *   1. Check every part of the laptop: OK / Fault / Not fitted.
 *   2. Choose what happens next (the answers pre-select it; faults rule out
 *      "No faults"; "Needs parts" needs the parts asked for first).
 *   3. Scan the TTSPL and serial, and submit.
 *
 * Answers save as a draft while you work, so nothing is lost on a refresh.
 */
const OPEN_PART = ['pending', 'escalated', 'ordered', 'received', 'approved'];

function suggest(sections, answers) {
  const faults = sections.flatMap((s) => s.items.filter((it) => it.options.some((o) => o.tone === 'bad' && o.value === answers[it.key])).map(() => s.route));
  if (!faults.length) return 'assembly';
  for (const r of ['floor_manager', 'chip', 'parts', 'body']) if (faults.includes(r)) return r;
  return 'floor_manager';
}

export default function DiagnosisWork({ ticket, partRequests = [], onDone, onOpenParts }) {
  const { data: defs, error } = useFloorChecklists();
  const [answers, setAnswers] = useState({});
  const [remarks, setRemarks] = useState('');
  const [outcome, setOutcome] = useState('');
  const [touchedOutcome, setTouchedOutcome] = useState(false);
  const [powersOn, setPowersOn] = useState(ticket.received_condition === 'not_on' ? '' : 'on');
  const [ttspl, setTtspl] = useState('');
  const [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [showOpen, setShowOpen] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    api.get(`/diagnosis/ticket/${ticket.ticket_id}`).then(({ data }) => {
      const d = data?.diagnosis;
      if (d?.answers && typeof d.answers === 'object') setAnswers(d.answers);
      if (d?.remarks && d.status !== 'Completed') setRemarks(d.remarks);
    }).catch(() => {}).finally(() => { loaded.current = true; });
  }, [ticket.ticket_id]);

  // Draft save, a moment after the last change.
  useEffect(() => {
    if (!loaded.current || !Object.keys(answers).length) return undefined;
    const t = setTimeout(() => {
      api.post(`/diagnosis/ticket/${ticket.ticket_id}`, { answers, remarks })
        .then(() => setSaved(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })))
        .catch(() => setSaved(''));
    }, 1500);
    return () => clearTimeout(t);
  }, [answers, remarks, ticket.ticket_id]);

  const sections = useMemo(() => defs?.diagnosis?.sections || [], [defs]);
  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const openCount = items.filter((it) => !answers[it.key]).length;
  const faults = items.filter((it) => it.options.some((o) => o.tone === 'bad' && o.value === answers[it.key]));
  const openParts = (partRequests || []).filter((r) => OPEN_PART.includes(r.status)).length;
  const suggested = useMemo(() => suggest(sections, answers), [sections, answers]);
  useEffect(() => { if (!touchedOutcome) setOutcome(openCount ? '' : suggested); }, [suggested, openCount, touchedOutcome]);

  if (error) return <Notice tone="crit" title="Could not load the diagnosis checklist">{error}</Notice>;
  if (!defs) return <EmptyState title="Loading…" />;

  const setA = (k, v) => setAnswers((a) => ({ ...a, [k]: v }));
  const outcomes = (defs.diagnosis.outcomes || []).map((o) => ({
    ...o,
    hint: o.value === suggested && faults.length ? 'Suggested from your answers' : undefined,
    disabled: (o.value === 'assembly' && faults.length > 0) || (o.value === 'parts' && !openParts),
    why: o.value === 'assembly' ? `You marked ${faults.length} fault(s).` : o.value === 'parts' ? 'Ask for the parts in the Parts tab first.' : undefined,
  }));
  const needNote = faults.length > 0 || outcome === 'floor_manager';
  const needSerial = powersOn === 'on';
  const missing = [
    !powersOn && 'say whether it powers on',
    openCount && `answer ${openCount} more question${openCount > 1 ? 's' : ''}`,
    !outcome && 'choose what happens next',
    needNote && remarks.trim().length < 5 && 'write what is wrong',
    !ttspl.trim() && 'scan the TTSPL',
    needSerial && !serial.trim() && 'scan the serial',
  ].filter(Boolean);
  const ready = !missing.length;

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/diagnosis/ticket/${ticket.ticket_id}/submit`, {
        answers,
        outcome,
        remarks: remarks.trim(),
        laptop_condition: powersOn === 'on' ? 'on' : 'not_on',
        verify_ttspl: ttspl.trim(),
        verify_serial: serial.trim() || undefined,
        serial_number: needSerial ? serial.trim() : undefined,
      });
      toast.success(`Diagnosis done — now at ${data?.next_team || 'the next stage'}`);
      onDone?.();
    } catch (e) {
      toast.error(errText(e, 'Could not submit the diagnosis'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="c-stack">
      {ticket.received_condition === 'not_on' && (
        <Notice tone="warn" title="It arrived not powering on">
          <span style={{ display: 'inline-flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            Does it power on now?
            <Segmented value={powersOn} onChange={setPowersOn} label="Powers on now" options={[{ value: 'on', label: 'Yes, it powers on' }, { value: 'not_on', label: 'No' }]} />
          </span>
        </Notice>
      )}

      <StepHead n={1} of={3}>Check each part of the laptop</StepHead>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="text-ink-3" style={{ fontSize: '13px' }}>
          {openCount ? `${openCount} of ${items.length} still to answer` : 'All answered'}{faults.length ? ` · ${faults.length} fault(s)` : ''}{saved ? ` · draft saved ${saved}` : ''}
        </span>
      </div>
      {sections.map((s) => <QuestionSection key={s.key} section={s} answers={answers} onChange={setA} showOpen={showOpen} />)}

      <StepHead n={2} of={3}>What happens next</StepHead>
      <Choice name="dx-outcome" value={outcome} onChange={(v) => { setTouchedOutcome(true); setOutcome(v); }} options={outcomes} />
      {outcome === 'parts' && (
        <Notice tone="info" title={`${openParts} part request(s) open`} action={onOpenParts && <Button variant="quiet" onClick={onOpenParts}>Parts tab</Button>}>
          The laptop goes to assembly with you; it can't leave assembly until the parts are fitted.
        </Notice>
      )}
      <Field label={needNote ? 'What is wrong (for the next person)' : 'Note (optional)'} required={needNote}>
        <Textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={faults.length ? faults.map((f) => f.q.replace(/\?$/, '')).join('; ') : ''} />
      </Field>

      <StepHead n={3} of={3}>Scan the laptop and submit</StepHead>
      <FormGrid cols={2}>
        <Field label="TTSPL" required><Input value={ttspl} onChange={(e) => setTtspl(e.target.value)} className="font-mono" placeholder={ticket.ttspl_id ? 'Scan the TTSPL label' : ''} /></Field>
        <Field label="Serial" required={needSerial} hint={needSerial ? undefined : "Optional — it doesn't power on"}><Input value={serial} onChange={(e) => setSerial(e.target.value)} className="font-mono" /></Field>
      </FormGrid>
      <div className="c-actions-bar" style={{ alignItems: 'center' }}>
        {!ready && <span className="text-ink-3" style={{ fontSize: '13px', marginRight: 'auto' }}>To submit: {missing.join(', ')}.</span>}
        {!ready && openCount > 0 && <Button variant="quiet" onClick={() => setShowOpen(true)}>Show what's open</Button>}
        <Button variant="primary" disabled={busy || !ready} onClick={submit}>{busy ? 'Submitting…' : 'Submit diagnosis'}</Button>
      </div>
    </div>
  );
}
