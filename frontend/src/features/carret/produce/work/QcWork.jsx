import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, DataTable, Drawer, EmptyState, Field, Notice, Segmented, Select, Textarea,
} from '../../../../components/carret';
import api from '../../../../utils/api';
import {
  createQc2CaptureToken, getProductionAssetByTicket, getQc2CaptureStatus, getTeamMembers, saveQc1SpecChecklist,
} from '../../../floor-pipeline/floorPipelineApi';
import DispatchQcChargerPanel from '../../../dispatch-charger/DispatchQcChargerPanel';
import DispatchQcSpecVerifyPanel from '../../../floor-pipeline/components/DispatchQcSpecVerifyPanel';
import DispatchQcSubmitScanModal from '../../../dispatch-charger/DispatchQcSubmitScanModal';
import { fetchTicketCharger } from '../../../dispatch-charger/dispatchChargerApi';
import { Choice, QuestionSection, StepHead, errText, useFloorChecklists } from './workShared';

/**
 * QC1, QC2 and Dispatch QC — one form.
 *
 *   1. Stage check: QC1 — does the laptop match its record; QC2 — the laptop's
 *      own configuration check (script) must match; Dispatch QC — charger and
 *      the configuration check for the order.
 *   2. The checklist. Each question says which answer is good; hardware the
 *      model doesn't have is "Not fitted". The result shows live, from the
 *      same rules the server applies.
 *   3. Grade, remarks, and where it goes next (pass or fail).
 *
 * "Can't test it — fail now" fails with a reason at any point (won't start,
 * configuration mismatch). Inspector ≠ repairer is enforced by the server.
 */
const INTRO = {
  QC1: 'Check the repair works. You must not be the person who repaired it.',
  QC2: "Last check before a customer gets it. The laptop's own configuration must match its record first.",
  'Dispatch QC': 'Re-check before it leaves for the order: charger, configuration, then the checklist.',
};
const SPEC_FIELDS = [
  { key: 'brand', label: 'Brand' }, { key: 'model', label: 'Model' }, { key: 'processor', label: 'Processor' },
  { key: 'generation', label: 'Generation' }, { key: 'ram', label: 'RAM' }, { key: 'ssd', label: 'Drive' },
];
const TECH_ROLES = ['technician', 'team_member', 'team_lead'];

/* ── QC1: does the laptop match its record ─────────────────────────────── */
function Qc1Match({ ticket, onReady }) {
  const [cfg, setCfg] = useState(null);
  const [paId, setPaId] = useState(null);
  const [ticks, setTicks] = useState({});
  useEffect(() => {
    getProductionAssetByTicket(ticket.ticket_id).then(({ data }) => {
      const c = data?.config || {};
      setCfg({
        brand: c.brand || ticket.brand, model: c.model || ticket.model, processor: c.processor || ticket.processor,
        generation: c.generation || '', ram: c.ram || ticket.ram, ssd: c.ssd || c.storage || ticket.storage,
      });
      setPaId(c.production_asset_id || data?.production_asset?.production_asset_id || null);
      setTicks(c.qc1_checklist?.fields || {});
    }).catch(() => setCfg({ brand: ticket.brand, model: ticket.model, processor: ticket.processor, generation: '', ram: ticket.ram, ssd: ticket.storage }));
  }, [ticket]);
  const all = SPEC_FIELDS.every((f) => ticks[f.key]);
  useEffect(() => { onReady(all); }, [all, onReady]);
  const toggle = (k) => {
    const next = { ...ticks, [k]: !ticks[k] };
    setTicks(next);
    if (paId) saveQc1SpecChecklist(paId, { fields: next, all_checked: SPEC_FIELDS.every((f) => next[f.key]) }).catch(() => {});
  };
  if (!cfg) return <EmptyState title="Loading…" />;
  return (
    <div className="c-qsec">
      <div className="c-qsec-h">Look at the laptop — does it match?<small>{SPEC_FIELDS.filter((f) => ticks[f.key]).length}/6</small></div>
      <div className="c-qsec-hint">Tick each line that matches the laptop in front of you. If something doesn't match, use "Can't pass — fail now" and say what is different.</div>
      {SPEC_FIELDS.map((f) => (
        <label key={f.key} className={`c-tick${ticks[f.key] ? ' is-on' : ''}`}>
          <input type="checkbox" checked={!!ticks[f.key]} onChange={() => toggle(f.key)} />
          <span style={{ width: '7rem', color: 'var(--ink-3)' }}>{f.label}</span>
          <b style={{ fontWeight: 500 }}>{cfg[f.key] || '—'}</b>
        </label>
      ))}
    </div>
  );
}

/* ── QC2: the laptop's own configuration check ─────────────────────────── */
function Qc2Check({ ticket, onState, onFailMismatch }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => getQc2CaptureStatus(ticket.ticket_id)
    .then(({ data }) => setSt(data?.data || { status: 'none' }))
    .catch(() => setSt({ status: 'none' })), [ticket.ticket_id]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (st?.status !== 'pending') return undefined;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [st?.status, refresh]);
  useEffect(() => { onState(st?.status || 'none'); }, [st?.status, onState]);

  const start = async () => {
    setBusy(true);
    try { await createQc2CaptureToken(ticket.ticket_id); await refresh(); } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  const url = `${window.location.origin}/qc2-config-match`;
  const checks = Array.isArray(st?.match_result?.checks) ? st.match_result.checks : [];
  const table = checks.length > 0 && (
    <DataTable
      rows={checks}
      rowKey={(c) => c.field}
      columns={[
        { key: 'f', header: '', render: (c) => (c.matched ? '✓' : '✕') },
        { key: 'l', header: 'What', render: (c) => c.label || c.field },
        { key: 'e', header: 'Record says', render: (c) => c.expected || '—' },
        { key: 'a', header: 'Laptop says', render: (c) => c.actual || '—' },
      ]}
    />
  );

  if (!st) return <EmptyState title="Loading…" />;
  if (st.status === 'matched') return <div className="c-stack"><Notice tone="good" title="Configuration matches">The laptop reported the same configuration as its record.</Notice>{table}</div>;
  if (st.status === 'failed') {
    const diff = checks.filter((c) => !c.matched && c.required !== false).map((c) => `${c.label || c.field}: record "${c.expected ?? ''}", laptop "${c.actual ?? ''}"`).join('; ');
    return (
      <div className="c-stack">
        <Notice tone="crit" title="Configuration does not match" action={<Button variant="primary" onClick={() => onFailMismatch(`Configuration mismatch — ${diff || st.match_result?.remarks || 'see the QC2 check'}`)}>Send back to QC1</Button>}>
          The laptop is not what its record says. Send it back so it is fixed (or the record corrected), or run the check again if it was a mistake.
        </Notice>
        {table}
        <p><Button variant="quiet" disabled={busy} onClick={start}>Run the check again (new number)</Button></p>
      </div>
    );
  }
  if (st.status === 'pending' && st.access_number) {
    return (
      <div className="c-qsec" style={{ padding: '16px' }}>
        <div style={{ fontSize: '12px', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Access number</div>
        <div className="font-mono" style={{ fontSize: '32px', fontWeight: 700, letterSpacing: '.3em' }}>{st.access_number}</div>
        <ol style={{ margin: '8px 0 0 18px', lineHeight: 1.7 }}>
          <li>On the laptop, open <span className="font-mono">{url}</span></li>
          <li>Type this number, download the checker and run it.</li>
          <li>This page updates by itself when the laptop has reported{st.expires_at ? ` (number valid until ${new Date(st.expires_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })})` : ''}.</li>
        </ol>
        <p style={{ marginTop: '8px' }}><Button variant="quiet" disabled={busy} onClick={start}>Get a new number</Button></p>
      </div>
    );
  }
  return (
    <Notice tone="info" title="Run the configuration check on the laptop" action={<Button variant="primary" disabled={busy} onClick={start}>Get an access number</Button>}>
      The laptop reports its own processor, RAM and drive; they must match its record before the QC2 checklist opens.
    </Notice>
  );
}

/* ── the form ──────────────────────────────────────────────────────────── */
export default function QcWork({ ticket, stage, user, lead, fittedParts = [], onDone }) {
  const { data: defs, error } = useFloorChecklists();
  const [answers, setAnswers] = useState({});
  const [grade, setGrade] = useState('');
  const [remarks, setRemarks] = useState('');
  const [specOk, setSpecOk] = useState(stage !== 'QC1');
  const [qc2State, setQc2State] = useState('none');
  const [override, setOverride] = useState('');
  const [dispatchReady, setDispatchReady] = useState(stage !== 'Dispatch QC');
  const [dispatchVerified, setDispatchVerified] = useState(stage !== 'Dispatch QC');
  const [next, setNext] = useState({ who: '', tag: ticket.purchase_order_type === 'rental_purchase' ? 'rental' : '', mode: 'rework' });
  const [people, setPeople] = useState([]);
  const [drawer, setDrawer] = useState(null); // 'fail' | 'override'
  const [failWhy, setFailWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [charger, setCharger] = useState(null);
  const [showOpen, setShowOpen] = useState(false);

  useEffect(() => {
    api.get(`/tickets/${ticket.ticket_id}/qc`, { params: { qc_stage: stage } }).then(({ data }) => {
      const d = data?.qcResult && !data.qcResult.is_locked ? data.qcResult : null;
      if (d) { setAnswers(d.checklist_data || {}); setGrade(d.final_grade || ''); setRemarks(d.remarks || ''); }
    }).catch(() => {});
  }, [ticket.ticket_id, stage]);

  const items = useMemo(() => (defs?.qc?.sections || []).flatMap((s) => s.items), [defs]);
  const criteria = defs?.qc?.criteria?.[stage] || [];
  const fails = criteria.filter((c) => c.values.includes(answers[c.key])).map((c) => c.reason);
  const openCount = items.filter((it) => !answers[it.key]).length;
  const bad = items.filter((it) => it.options.some((o) => o.tone === 'bad' && o.value === answers[it.key]));
  const willPass = !fails.length;
  const escalates = !willPass && Number(ticket.qc_fail_count || 0) >= 2;

  // Who can take it next, for the result chosen.
  useEffect(() => {
    let team = null;
    if (willPass && stage === 'QC1') team = 'qc2';
    else if (!willPass && stage === 'QC1') team = 'Hardware & Software';
    else if (!willPass && stage === 'QC2') team = 'QC1 Team';
    if (!team) { setPeople([]); return; }
    const p = team === 'qc2'
      ? api.get('/tickets/qc/qc2-assignees').then(({ data }) => data?.assignees || [])
      : getTeamMembers(team).then(({ data }) => data?.members || data?.users || []);
    p.then(setPeople).catch(() => setPeople([]));
  }, [willPass, stage]);

  const configGateOpen = stage !== 'QC2' || qc2State === 'matched' || override.trim().length >= 10;
  const gateOpen = specOk && configGateOpen && dispatchReady && dispatchVerified;

  if (error) return <Notice tone="crit" title="Could not load the QC checklist">{error}</Notice>;
  if (!defs) return <EmptyState title="Loading…" />;

  const setA = (k, v) => setAnswers((a) => ({ ...a, [k]: v }));
  const payloadBase = {
    qcStage: stage,
    checklist_version: 2,
    replacedParts: fittedParts.map((p) => ({ part_name: p.part_name, part_code: p.prt_id || '', serial_number: p.prt_id || '' })),
  };
  const send = async (body) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/tickets/${ticket.ticket_id}/qc/submit`, { ...payloadBase, ...body });
      toast.success(`${stage}: ${data?.result === 'PASS' ? 'passed' : 'failed'} — now at ${data?.nextStage}`);
      onDone?.();
    } catch (e) {
      toast.error(errText(e, `Could not submit ${stage}`));
    } finally {
      setBusy(false);
      setDrawer(null);
    }
  };
  const submit = async () => {
    if (stage === 'Dispatch QC' && willPass) {
      try {
        const { data } = await fetchTicketCharger(ticket.ticket_id);
        const ch = data?.data?.charger || null;
        if (!ch?.qc_scan_matched) { setCharger(ch); setScanOpen(true); return; }
      } catch (e) { toast.error(errText(e, 'Could not check the charger scan')); return; }
    }
    await send({
      checklist: answers,
      grading: { final_grade: grade, grade_notes: (defs.qc.grades.find((g) => g.value === grade) || {}).hint || '' },
      remarks: remarks.trim(),
      assignToUserId: next.who ? Number(next.who) : undefined,
      inventory_tag: willPass && stage === 'QC2' ? next.tag : undefined,
      dispatch_fail_mode: !willPass && stage === 'Dispatch QC' ? next.mode : undefined,
      qc_override_reason: stage === 'QC2' && qc2State !== 'matched' && override.trim() ? override.trim() : undefined,
    });
  };
  const failNow = (why) => send({
    force_fail_reason: why,
    remarks: why,
    assignToUserId: next.who ? Number(next.who) : undefined,
    dispatch_fail_mode: stage === 'Dispatch QC' ? next.mode : undefined,
  });
  const saveDraft = () => api.post(`/tickets/${ticket.ticket_id}/qc/save`, {
    qcStage: stage, header: {}, checklist: answers, grading: { final_grade: grade }, remarks, replacedParts: [],
  }).then(() => toast.success('Draft saved')).catch((e) => toast.error(errText(e)));

  const missing = [
    !gateOpen && 'finish step 1',
    openCount && `answer ${openCount} more question${openCount > 1 ? 's' : ''}`,
    !grade && 'choose the grade',
    bad.length > 0 && !remarks.trim() && 'write a remark about the problems',
    willPass && stage === 'QC2' && !next.tag && 'choose how it is listed',
  ].filter(Boolean);
  const isTech = TECH_ROLES.includes(String(user?.role || '').toLowerCase());
  const routeText = willPass
    ? { QC1: ticket.ticket_type === 'sales_order_qc' ? 'Passes → Dispatch QC' : 'Passes → QC2', QC2: 'Passes → waiting to go into stock', 'Dispatch QC': 'Passes → ready for the challan' }[stage]
    : escalates ? 'Fails for the 3rd time → floor manager decides'
      : { QC1: 'Fails → back to assembly', QC2: 'Fails → back to QC1', 'Dispatch QC': next.mode === 'remove' ? 'Fails → taken off the order, back to Diagnosis' : 'Fails → fixed for the same order (back to assembly)' }[stage];

  return (
    <div className="c-stack">
      <p className="text-ink-2" style={{ margin: 0 }}>{INTRO[stage]}</p>
      {isTech && willPass && <Notice tone="warn" title="Technicians can't pass QC">A QC inspector or floor manager passes it. You can still record a failure.</Notice>}

      <StepHead n={1} of={3}>{stage === 'QC1' ? 'Does the laptop match its record' : stage === 'QC2' ? 'Configuration check' : 'Charger and configuration'}</StepHead>
      {stage === 'QC1' && <Qc1Match ticket={ticket} onReady={setSpecOk} />}
      {stage === 'QC2' && (
        <>
          <Qc2Check ticket={ticket} onState={setQc2State} onFailMismatch={(why) => { setFailWhy(why); setDrawer('fail'); }} />
          {lead && qc2State !== 'matched' && (
            override.trim().length >= 10
              ? <Notice tone="warn" title="Check overridden" action={<Button variant="quiet" onClick={() => setOverride('')}>Undo</Button>}>{override}</Notice>
              : <p><Button variant="quiet" onClick={() => { setFailWhy(''); setDrawer('override'); }}>Manager: override the check with a reason</Button></p>
          )}
        </>
      )}
      {stage === 'Dispatch QC' && (
        <>
          <DispatchQcChargerPanel ticket={ticket} onReadyChange={setDispatchReady} />
          {dispatchReady && <DispatchQcSpecVerifyPanel ticket={ticket} onVerified={(ok) => setDispatchVerified(!!ok)} />}
        </>
      )}

      <StepHead n={2} of={3}>Check the laptop</StepHead>
      {!gateOpen ? <Notice tone="info" title="Finish step 1 first">The checklist opens when step 1 is done.</Notice> : (
        <>
          <span className="text-ink-3" style={{ fontSize: '13px' }}>{openCount ? `${openCount} of ${items.length} still to answer` : 'All answered'}</span>
          {defs.qc.sections.map((s) => <QuestionSection key={s.key} section={s} answers={answers} onChange={setA} showOpen={showOpen} />)}
          {fittedParts.length > 0 && (
            <Notice tone="info" title={`Parts fitted on this laptop (${fittedParts.length})`}>
              {fittedParts.map((p) => p.part_name).join(', ')} — from the parts record; nothing to type.
            </Notice>
          )}
        </>
      )}

      {gateOpen && (
        <>
          <StepHead n={3} of={3}>Grade and result</StepHead>
          <Field label="Grade" required>
            <Select value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Choose the grade" options={defs.qc.grades.map((g) => ({ value: g.value, label: `${g.label} — ${g.hint}` }))} />
          </Field>
          <Field label={bad.length ? 'Remarks — what is wrong' : 'Remarks (optional)'} required={bad.length > 0}>
            <Textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={bad.map((b) => b.q.replace(/\?$/, '')).join('; ')} />
          </Field>
          {!openCount && (
            <Notice tone={willPass ? 'good' : 'crit'} title={routeText}>
              {willPass ? 'Nothing you marked fails this stage.' : fails.join('; ')}
            </Notice>
          )}
          {!openCount && willPass && stage === 'QC1' && (
            <Field label="QC2 inspector" hint="Leave empty for the next person in rotation.">
              <Select value={next.who} onChange={(e) => setNext((n) => ({ ...n, who: e.target.value }))} placeholder="Next in rotation" options={people.map((m) => ({ value: String(m.user_id), label: m.name }))} />
            </Field>
          )}
          {!openCount && willPass && stage === 'QC2' && (
            <Field label="How it is listed in stock" required>
              <Segmented value={next.tag} onChange={(v) => setNext((n) => ({ ...n, tag: v }))} label="Listing" options={[{ value: 'rental', label: 'Rental' }, { value: 'sale', label: 'Sale' }, { value: 'both', label: 'Both' }]} />
            </Field>
          )}
          {!openCount && !willPass && !escalates && stage === 'Dispatch QC' && (
            <Choice name="dq-mode" value={next.mode} onChange={(v) => setNext((n) => ({ ...n, mode: v }))} options={[
              { value: 'rework', label: 'Fix it for this order', hint: 'Back to assembly; it stays on the order.' },
              { value: 'remove', label: 'Take it off the order', hint: 'Back to Diagnosis; the order needs another laptop.' },
            ]}
            />
          )}
          {!openCount && !willPass && !escalates && stage !== 'Dispatch QC' && (
            <Field label="Who fixes it" hint="Leave empty to put it in that stage's queue.">
              <Select value={next.who} onChange={(e) => setNext((n) => ({ ...n, who: e.target.value }))} placeholder="The stage's queue" options={people.map((m) => ({ value: String(m.user_id), label: m.name }))} />
            </Field>
          )}
        </>
      )}

      <div className="c-actions-bar" style={{ alignItems: 'center' }}>
        {missing.length > 0 && <span className="text-ink-3" style={{ fontSize: '13px', marginRight: 'auto' }}>To submit: {missing.join(', ')}.</span>}
        {missing.length > 0 && openCount > 0 && gateOpen && <Button variant="quiet" onClick={() => setShowOpen(true)}>Show what's open</Button>}
        <Button variant="quiet" onClick={() => { setFailWhy(''); setDrawer('fail'); }}>Can't pass — fail now</Button>
        {gateOpen && <Button onClick={saveDraft}>Save draft</Button>}
        <Button variant="primary" disabled={busy || missing.length > 0} onClick={submit}>{busy ? 'Submitting…' : `Submit ${stage}`}</Button>
      </div>

      <Drawer
        open={drawer === 'fail'}
        onClose={() => setDrawer(null)}
        title={`Fail ${stage} now`}
        footer={<Button variant="primary" disabled={busy || failWhy.trim().length < 5} onClick={() => failNow(failWhy.trim())}>Fail it</Button>}
      >
        <div className="c-stack">
          <p>{stage === 'QC2' ? 'It goes back to QC1.' : stage === 'QC1' ? 'It goes back to assembly.' : 'Choose below where it goes.'} {Number(ticket.qc_fail_count || 0) >= 2 ? 'This is its 3rd failure, so it goes to the floor manager.' : ''}</p>
          <Field label="Why it fails" required><Textarea rows={4} value={failWhy} onChange={(e) => setFailWhy(e.target.value)} /></Field>
          {stage === 'Dispatch QC' && (
            <Choice name="dq-mode-now" value={next.mode} onChange={(v) => setNext((n) => ({ ...n, mode: v }))} options={[
              { value: 'rework', label: 'Fix it for this order (back to assembly)' },
              { value: 'remove', label: 'Take it off the order (back to Diagnosis)' },
            ]}
            />
          )}
        </div>
      </Drawer>
      <Drawer
        open={drawer === 'override'}
        onClose={() => setDrawer(null)}
        title="Override the configuration check"
        footer={<Button variant="primary" disabled={failWhy.trim().length < 10} onClick={() => { setOverride(failWhy.trim()); setFailWhy(''); setDrawer(null); }}>Override</Button>}
      >
        <p style={{ marginBottom: '12px' }}>Only when the check cannot run and you have confirmed the configuration another way. The reason is logged with the pass.</p>
        <Field label="Reason (a full sentence)" required><Textarea rows={3} value={failWhy} onChange={(e) => setFailWhy(e.target.value)} /></Field>
      </Drawer>
      <DispatchQcSubmitScanModal open={scanOpen} ticket={ticket} charger={charger} onClose={() => setScanOpen(false)} onMatched={() => { setScanOpen(false); submit(); }} />
    </div>
  );
}
