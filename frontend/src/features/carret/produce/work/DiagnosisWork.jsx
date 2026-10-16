import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, EmptyState, Field, FormGrid, Input, Notice, Segmented, Textarea } from '../../../../components/carret';
import api from '../../../../utils/api';
import {
  Choice, QuestionSection, firstOpenSection, WorkLayout, WorkStep, WorkSummary, errText, useFloorChecklists, TtsplInput,
} from './workShared';

/**
 * Diagnosis — find out what is wrong with the laptop.
 *
 *   1. Check every part of the laptop: OK / Fault / Not fitted.
 *   2. Choose what happens next (the answers pre-select it; faults rule out
 *      "No faults"; "Needs parts" needs the parts asked for first).
 *   3. Scan the TTSPL and serial, and submit.
 *
 * Answers save as a draft while you work, so nothing is lost on a refresh.
 * Layout (14 Oct 2026): numbered step cards, and a pinned panel with what is
 * still needed and the submit button (workShared WorkLayout).
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
  // Chip / body repair waits until every part asked for is fitted or its
  // request cancelled (16 Oct 2026; the server checks too).
  const blockingParts = (partRequests || []).filter((r) => OPEN_PART.includes(r.status) && r.blocks_stage !== false);
  const repairBlocked = blockingParts.length > 0;
  const suggested = useMemo(() => suggest(sections, answers), [sections, answers]);
  useEffect(() => {
    if (touchedOutcome) return;
    setOutcome(openCount || (repairBlocked && ['chip', 'body'].includes(suggested)) ? '' : suggested);
  }, [suggested, openCount, touchedOutcome, repairBlocked]);
  useEffect(() => { if (repairBlocked && ['chip', 'body'].includes(outcome)) setOutcome(''); }, [repairBlocked, outcome]);

  if (error) return <Notice tone="crit" title="Could not load the diagnosis checklist">{error}</Notice>;
  if (!defs) return <EmptyState title="Loading…" />;

  const setA = (k, v) => setAnswers((a) => ({ ...a, [k]: v }));
  const outcomes = (defs.diagnosis.outcomes || []).map((o) => ({
    ...o,
    hint: o.value === suggested && faults.length ? 'Suggested from your answers' : undefined,
    disabled: (o.value === 'assembly' && faults.length > 0) || (o.value === 'parts' && !openParts)
      || (['chip', 'body'].includes(o.value) && repairBlocked),
    why: o.value === 'assembly' ? `You marked ${faults.length} fault(s).`
      : o.value === 'parts' ? 'Ask for the parts in the Parts tab first.'
        : ['chip', 'body'].includes(o.value) ? `Part request open (${blockingParts.map((r) => r.part_name || r.request_number).join(', ')}) — fit it or cancel it first.`
          : undefined,
  }));
  const repairRoute = ['chip', 'body'].includes(outcome);
  const needNote = faults.length > 0 || repairRoute || outcome === 'floor_manager';
  const noteLabel = outcome === 'chip' ? 'Why it needs chip-level repair'
    : outcome === 'body' ? 'Why it needs body / paint work'
      : needNote ? 'What is wrong (for the next person)' : 'Note (optional)';
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

  const step1Done = Boolean(powersOn) && openCount === 0;
  const step2Done = Boolean(outcome) && !(needNote && remarks.trim().length < 5);
  const step3Done = Boolean(ttspl.trim()) && (!needSerial || Boolean(serial.trim()));
  const chosen = outcomes.find((o) => o.value === outcome);
  const checks = [
    ...(ticket.received_condition === 'not_on' ? [{ label: 'Say whether it powers on now', ok: Boolean(powersOn) }] : []),
    { label: `Answer every check (${items.length - openCount}/${items.length})`, ok: openCount === 0 },
    { label: 'Choose what happens next', ok: Boolean(outcome) },
    ...(needNote ? [{ label: 'Write what is wrong', ok: remarks.trim().length >= 5 }] : []),
    { label: 'Scan the TTSPL', ok: Boolean(ttspl.trim()) },
    ...(needSerial ? [{ label: 'Scan the serial', ok: Boolean(serial.trim()) }] : []),
  ];

  const summary = (
    <WorkSummary
      stage="Diagnosis"
      goal="Find out what is wrong with this laptop and send it to the team that fixes it."
      after={chosen ? chosen.label : 'Choose what happens next (step 2)'}
      checks={checks}
      facts={[
        { label: 'Faults found', value: faults.length, tone: faults.length ? 'bad' : 'good' },
        { label: 'Parts asked for', value: openParts },
        { label: 'Answered', value: `${items.length - openCount}/${items.length}` },
        { label: 'Draft', value: saved ? `saved ${saved}` : 'not yet' },
      ]}
    >
      <Button variant="primary" disabled={busy || !ready} onClick={submit}>{busy ? 'Submitting…' : 'Submit diagnosis'}</Button>
      {!ready && openCount > 0 && <Button variant="quiet" onClick={() => setShowOpen(true)}>Show what's open</Button>}
    </WorkSummary>
  );

  return (
    <WorkLayout summary={summary}>
      {ticket.received_condition === 'not_on' && (
        <Notice tone="warn" title="It arrived not powering on">
          <span style={{ display: 'inline-flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            Does it power on now?
            <Segmented value={powersOn} onChange={setPowersOn} label="Powers on now" options={[{ value: 'on', label: 'Yes, it powers on' }, { value: 'not_on', label: 'No' }]} />
          </span>
        </Notice>
      )}

      <WorkStep
        n={1}
        title="Check each part of the laptop"
        state={step1Done ? 'done' : 'current'}
        summary={`${items.length - openCount}/${items.length} answered${faults.length ? ` · ${faults.length} fault${faults.length > 1 ? 's' : ''}` : ''}`}
      >
        <p className="text-ink-3" style={{ margin: 0, fontSize: '13px' }}>
          Answer each check: green is good, red is a fault. A finished group folds away. Your answers save as a draft while you work.
        </p>
        {sections.map((s) => <QuestionSection key={s.key} section={s} answers={answers} onChange={setA} showOpen={showOpen} focused={s.key === firstOpenSection(sections, answers)} />)}
      </WorkStep>

      <WorkStep
        n={2}
        title="What happens next"
        state={step2Done ? 'done' : step1Done ? 'current' : 'todo'}
        summary={chosen ? chosen.label : (openCount ? 'Suggested once every check is answered' : null)}
      >
        <Choice name="dx-outcome" value={outcome} onChange={(v) => { setTouchedOutcome(true); setOutcome(v); }} options={outcomes} />
        {outcome === 'parts' && (
          <Notice tone="info" title={`${openParts} part request(s) open`} action={onOpenParts && <Button variant="quiet" onClick={onOpenParts}>Parts tab</Button>}>
            The laptop goes to assembly with you; it can't leave assembly until the parts are fitted.
          </Notice>
        )}
        <Field label={noteLabel} required={needNote} hint={repairRoute ? 'The repair technician sees this first.' : undefined}>
          <Textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={faults.length ? faults.map((f) => f.q.replace(/\?$/, '')).join('; ') : ''} />
        </Field>
      </WorkStep>

      <WorkStep
        n={3}
        title="Scan the laptop on your bench"
        state={step3Done ? 'done' : step1Done && step2Done ? 'current' : 'todo'}
        summary={step3Done ? 'Scanned' : null}
      >
        <FormGrid cols={2}>
          <Field label="TTSPL" required><TtsplInput value={ttspl} onChange={setTtspl} expected={ticket.ttspl_id} placeholder="Scan the TTSPL label" /></Field>
          <Field label="Serial" required={needSerial} hint={needSerial ? undefined : "Optional — it doesn't power on"}><Input value={serial} onChange={(e) => setSerial(e.target.value)} className="font-mono" /></Field>
        </FormGrid>
      </WorkStep>
    </WorkLayout>
  );
}
