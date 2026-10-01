import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DateTime, DocNumber, Drawer, EmptyState, Field, FlowSteps, FormGrid, Input, Notice, Select, StatusChip, Tabs, Textarea,
} from '../../../components/carret';
import api from '../../../utils/api';
import { useAuth } from '../../../context/AuthContext';
import { searchParts } from '../../floor-pipeline/floorPipelineApi';
import DiagnosisWork from './work/DiagnosisWork';
import StageWork from './work/StageWork';
import QcWork from './work/QcWork';
import PartsWork from './work/PartsWork';
import AssignDrawer from './work/AssignDrawer';
import { usePermission } from '../../../hooks/usePermission';
import { TtsplInput } from './work/workShared';
import {
  FLOW, activeWork, claimTicket, configText, dismantleTicket, endWork, errMsg, fetchTicket, holdTicket, isFloorLead, moveStage,
  releaseTicket, stageLabel, startWork, activePartRequests,
} from './produceShared';

/**
 * Production → a laptop on the floor (one ticket).
 *
 * The next step leads, by stage: triage assigns a technician; Diagnosis,
 * the repair stages, Assembly / Testing and QC each show their own work form
 * (produce/work/*: numbered steps, questions that say which answer is good,
 * checked again on the server); Pending Inventory goes to the receive screen. Around it: claim, the work timer (only the assignee — PD13),
 * parts (requests only — PD7), hold / release with a reason (PD11), dismantle
 * for parts (PD14) and send back to the vendor. The ticket's history and the
 * laptop's cost are not shown here (2 Oct 2026, user decision): the laptop's
 * full story and money live on its Lifecycle page, linked from the header.
 */
const WORK_STAGES = ['Diagnosis', 'Chip Level Repair', 'Body & Paint', 'Assembly & Software', 'Final Testing', 'QC1', 'QC2', 'Dispatch QC'];

export default function FloorTicketPage() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const lead = isFloorLead(user);
  const { hasPermission } = usePermission();
  // Assign / reassign: floor leads, or anyone given "Assign floor tickets" (migration 409).
  const canAssign = lead || hasPermission('floor_ticket_assign', 'edit');

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [work, setWork] = useState(null);
  const [tab, setTab] = useState('work');
  const [busy, setBusy] = useState('');
  const [drawer, setDrawer] = useState(null); // 'start' | 'hold' | 'release' | 'fail' | 'dismantle' | 'toDismantle'
  const [form, setForm] = useState({});
  const [assignOpen, setAssignOpen] = useState(false);
  const [partHits, setPartHits] = useState([]);

  const load = useCallback(() => {
    fetchTicket(ticketId).then(({ data: d }) => setData(d)).catch((e) => setError(errMsg(e, 'Could not load the ticket.')));
    activeWork(ticketId).then(({ data: d }) => setWork(d?.work_log || d?.active || d?.data || null)).catch(() => setWork(null));
  }, [ticketId]);
  useEffect(() => { load(); }, [load]);

  const t = data?.ticket;
  const stage = t?.stage_name;
  const mine = t && Number(t.assigned_user_id) === Number(user?.user_id);
  const run = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); setDrawer(null); setForm({}); load(); return true; } catch (e) { toast.error(errMsg(e)); return false; } finally { setBusy(''); }
  };
  const done = () => { load(); };
  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  if (error) return <DeskShell title="Ticket" breadcrumb="Production / Floor"><EmptyState title="Could not load this ticket" body={error} action={<Button onClick={() => navigate('/carret/produce/floor')}>Back to the floor</Button>} /></DeskShell>;
  if (!t) return <DeskShell title="Ticket" breadcrumb="Production / Floor"><EmptyState title="Loading…" /></DeskShell>;

  const closed = ['completed', 'cancelled'].includes(t.status);
  const idx = FLOW.findIndex((f) => f.key === stage || f.stages?.includes(stage));
  const flow = FLOW.map((f, i) => ({
    key: f.key,
    label: f.label,
    state: closed ? 'done' : (stage === 'Hold' ? (f.key === t.hold_from_stage_name ? 'blocked' : 'todo') : (i < idx ? 'done' : i === idx ? 'current' : 'todo')),
  }));

  // The one thing to do next.
  let next = null;
  if (closed) next = <Notice tone="good" title={t.status === 'completed' ? 'Finished' : 'Closed'}>{t.completed_at ? <>On <DateTime value={t.completed_at} />.</> : null}</Notice>;
  else if (stage === 'Hold') next = <Notice tone="warn" title={`On hold (from ${t.hold_from_stage_name || '—'})`} action={lead && <Button variant="primary" onClick={() => setDrawer('release')}>Release</Button>}>{t.hold_reason}</Notice>;
  else if (!t.assigned_user_id && stage === 'Floor Manager') next = <Notice tone="info" title="New on the floor — waiting for triage" action={canAssign && <Button variant="primary" onClick={() => setAssignOpen(true)}>Triage and assign</Button>}>Check it powers on, confirm the TTSPL and serial, and give it to a technician.</Notice>;
  else if (!t.assigned_user_id) next = <Notice tone="info" title="Waiting to be picked up" action={<Button variant="primary" disabled={busy === 'claim'} onClick={() => run('claim', () => claimTicket(t.ticket_id), 'Claimed — it is yours')}>Claim</Button>}>Anyone on the {stageLabel(stage)} team can claim it.</Notice>;
  else if (mine && !work && WORK_STAGES.includes(stage)) next = <Notice tone="info" title="Start work to begin the timer" action={<Button variant="primary" onClick={() => setDrawer('start')}>Start work</Button>}>Scan or type the TTSPL and the serial from the laptop, so the right laptop is on the bench.</Notice>;
  else if (stage === 'Pending Inventory') next = <Notice tone="good" title="Passed QC — waiting to go into stock" action={<Button variant="primary" onClick={() => navigate('/carret/produce/into-stock')}>Receive into a slot</Button>}>The warehouse scans the serial into a carret slot; only then is it in stock.</Notice>;
  else if (!mine && t.assigned_user_id) next = <Notice tone="info" title={`With ${t.assigned_user_name || 'a technician'}`}>{canAssign ? 'You can reassign it.' : 'Only they work on it and run its timer.'}</Notice>;

  const QC_STAGES = ['QC1', 'QC2', 'Dispatch QC'];
  const fitted = (data.part_requests || []).filter((r) => r.status === 'attached');
  const workForm = (() => {
    if (closed || stage === 'Hold') return null;
    if (stage === 'Diagnosis') return <DiagnosisWork ticket={t} partRequests={data.part_requests} onDone={done} onOpenParts={() => setTab('parts')} />;
    if (['Chip Level Repair', 'Body & Paint', 'Assembly & Software', 'Final Testing'].includes(stage)) return <StageWork ticket={t} stage={stage} onDone={done} />;
    if (QC_STAGES.includes(stage)) return <QcWork ticket={t} stage={stage} user={user} lead={lead} fittedParts={fitted} onDone={done} />;
    if (stage === 'Dismantle') {
      return (
        <Notice tone="warn" title="Being broken for parts" action={lead && <Button variant="primary" onClick={() => { setForm({ parts: [] }); setDrawer('dismantle'); }}>Finish dismantling</Button>}>
          Record the parts taken off; the laptop is then scrapped. It never goes into stock.
        </Notice>
      );
    }
    return null;
  })();

  // Assign / Reassign sits next to the assignee in the header, not here.
  const actions = (
    <>
      {mine && work && <Button onClick={() => run('stop', () => endWork(t.ticket_id), 'Timer stopped')}>Stop work</Button>}
      {lead && !closed && stage !== 'Hold' && <Button variant="quiet" onClick={() => setDrawer('hold')}>Hold</Button>}
      {lead && !closed && ['Diagnosis', 'Floor Manager'].includes(stage) && <Button variant="quiet" onClick={() => setDrawer('toDismantle')}>Break for parts</Button>}
      {lead && !closed && t.vendor_serial_id && <Button variant="quiet" onClick={() => setDrawer('fail')}>Send back to vendor</Button>}
    </>
  );

  const cc = data.config_check?.config || {};
  const disagreements = data.config_check?.disagreements || [];

  // The laptop, once, in the header (1 Oct 2026: the "Laptop" tab repeated the
  // header's TTSPL / serial and dumped the config, cost and grade; the full
  // story of the laptop now lives on its Lifecycle page).
  const serial = [t.resolved_serial_number, t.serial_number].find((s) => s && s !== 'NOT_ON') || null;
  const cfg = configText({ ...t, ...Object.fromEntries(Object.entries(cc).filter(([, v]) => v)) });
  const lifeKey = t.ttspl_id || serial;
  const days = t.stage_entered_at ? Math.max(0, Math.floor((Date.now() - new Date(t.stage_entered_at)) / 86400000)) : null;
  const daysTone = days == null ? undefined : days > 7 ? 'var(--alert-crit)' : days > 3 ? 'var(--alert-warn)' : undefined;
  const stageChip = closed
    ? <StatusChip status={t.status} />
    : stage === 'Hold'
      ? <StatusChip status="pending" label="On hold" />
      : <StatusChip status="processing" label={stageLabel(stage)} />;
  const arrived = t.received_condition === 'not_on' ? "Won't power on" : t.received_condition === 'part_missing' ? 'Part missing' : 'Powers on';
  const meta = [
    { label: 'At this stage', value: closed || days == null ? '—' : <span style={{ color: daysTone, fontWeight: daysTone ? 600 : undefined }}>{days === 0 ? 'Since today' : `${days} day${days === 1 ? '' : 's'}`}</span> },
    {
      label: 'Assigned to',
      value: (
        <span className="flex items-center flex-wrap" style={{ gap: '4px 10px' }}>
          <span>{t.assigned_user_name || <span className="text-ink-3">Nobody yet</span>}</span>
          {canAssign && !closed && (
            <Button variant="quiet" style={{ height: '28px', padding: '0 8px' }} onClick={() => setAssignOpen(true)}>
              {stage === 'Floor Manager' && !t.assigned_user_id ? 'Triage' : t.assigned_user_id ? 'Reassign' : 'Assign'}
            </Button>
          )}
        </span>
      ),
    },
    { label: 'Arrived', value: arrived },
    { label: 'Opened', value: <DateTime value={t.created_at} /> },
    ...(t.final_grade ? [{ label: 'Grade', value: t.final_grade }] : []),
    ...(t.qc_fail_count > 0 ? [{ label: 'QC failures', value: <span style={{ color: 'var(--alert-crit)', fontWeight: 600 }}>{t.qc_fail_count}</span> }] : []),
  ];
  const partsTab = stage !== 'Dispatch QC' || activePartRequests(data.part_requests).length > 0;

  return (
    <DeskShell title={`Floor ticket #${t.ticket_id}`} breadcrumb="Production / Floor">
      <div className="c-stack">
        <header className="c-card" style={{ padding: '18px 20px' }}>
          <div className="flex flex-wrap items-start" style={{ gap: '12px 20px' }}>
            <div className="min-w-0" style={{ flex: '1 1 22rem' }}>
              <div className="text-ink-3 font-ui uppercase tracking-wide" style={{ fontSize: 'var(--d-sm)' }}>
                Floor ticket #{t.ticket_id}{t.ticket_type === 'sales_order_qc' ? ` · sales-order check${t.sales_order_number ? ` ${t.sales_order_number}` : ''}` : ''}
              </div>
              <div className="flex flex-wrap items-center" style={{ gap: '8px 12px', marginTop: '4px' }}>
                <span className="text-ink" style={{ fontSize: '20px', fontWeight: 600 }}><DocNumber value={t.ttspl_id || serial || `#${t.ticket_id}`} /></span>
                {stageChip}
              </div>
              <div className="c-idstrip">
                {serial && t.ttspl_id && <span><span className="c-idstrip-k">S/N</span><span className="font-mono">{serial}</span></span>}
                {cfg && <span className="text-ink">{cfg}</span>}
                {t.po_number && <span><span className="c-idstrip-k">PO</span><span className="font-mono">{t.po_number}</span></span>}
                {lifeKey && <Link to={`/carret/stock/lifecycle/${encodeURIComponent(lifeKey)}`} className="text-accent" style={{ fontWeight: 500 }}>Lifecycle →</Link>}
              </div>
            </div>
            <div className="flex flex-wrap items-center" style={{ gap: 'var(--d-gap)' }}>{actions}</div>
          </div>
          <dl
            className="grid border-t border-rule"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px 20px', marginTop: '14px', paddingTop: '14px', marginBottom: 0 }}
          >
            {meta.map((m) => (
              <div key={m.label} className="min-w-0">
                <dt className="text-ink-3 font-ui" style={{ fontSize: '13px', fontWeight: 500 }}>{m.label}</dt>
                <dd className="text-ink font-ui m-0" style={{ fontSize: 'var(--d-base)', marginTop: '2px' }}>{m.value ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </header>

        <FlowSteps steps={flow} />
        {t.highlighted && <Notice tone="warn" title="Needs attention">{t.highlighted_reason}</Notice>}
        {/* Kept from the old Laptop tab: records that disagree about the config are worth fixing before QC. */}
        {disagreements.length > 0 && !closed && (
          <Notice tone="warn" title="Records disagree about this laptop's configuration">
            {disagreements.map((d) => `${d.field}: ${({ floor: 'floor copy', legacy: 'old inventory', last_confirmed: 'last check' })[d.where] || d.where} says "${d.value}", record says "${d.current}"`).join(' · ')}
          </Notice>
        )}
        {next}

        <div className="c-stack min-w-0">
            <Tabs
              value={partsTab ? tab : 'work'}
              onChange={setTab}
              tabs={[
                { key: 'work', label: `Work — ${stageLabel(stage)}` },
                // A laptop reaches Dispatch QC fully ready: no part requests there.
                // Earlier requests stay visible (read-only) if there are any.
                ...(partsTab ? [{ key: 'parts', label: 'Parts', count: activePartRequests(data.part_requests).length }] : []),
              ]}
            />
            {(tab === 'work' || !partsTab) && (
              workForm
                // The assigned technician sees the task only after Start work
                // (TTSPL + serial scanned, timer running) — the server insists too.
                ? (mine && WORK_STAGES.includes(stage) && !work
                  ? (
                    <Notice tone="info" title="Start work to see the task" action={<Button variant="primary" onClick={() => setDrawer('start')}>Start work</Button>}>
                      Scan or type the TTSPL ID and the serial number from the laptop. The timer starts and the {stageLabel(stage)} task opens.
                    </Notice>
                  )
                  : (mine || lead || QC_STAGES.includes(stage)) ? workForm : <EmptyState title="Assigned to someone else" body="The work form opens for the technician working on it." />)
                : <EmptyState title={stage === 'Floor Manager' ? 'Triage happens from "Triage and assign"' : 'Nothing to fill in at this stage'} />
            )}
            {tab === 'parts' && partsTab && (
              <PartsWork ticket={t} partRequests={data.part_requests} parts={data.parts} canWork={!closed && stage !== 'Dispatch QC' && (mine || lead)} onChanged={done} />
            )}
        </div>
      </div>

      <AssignDrawer ticket={t} open={assignOpen} onClose={() => setAssignOpen(false)} onDone={() => { setAssignOpen(false); load(); }} />

      <Drawer open={drawer === 'start'} onClose={() => setDrawer(null)} title="Start work" footer={<Button variant="primary" disabled={busy === 'start' || !String(form.ttspl || '').trim() || (t.received_condition !== 'not_on' && !String(form.serial || '').trim())} onClick={() => run('start', () => startWork(t.ticket_id, { verify_ttspl: form.ttspl, verify_serial: form.serial }), 'Timer started — the task is open')}>Start</Button>}>
        <div className="c-stack">
          <p>Scan the labels on the laptop in front of you.</p>
          <Field label="TTSPL" required><TtsplInput autoFocus value={form.ttspl || ''} onChange={setF('ttspl')} expected={t.ttspl_id} /></Field>
          <Field label="Serial" required={t.received_condition !== 'not_on'} hint={t.received_condition === 'not_on' ? "Optional — this laptop doesn't power on" : undefined}><Input value={form.serial || ''} onChange={setF('serial')} className="font-mono" /></Field>
        </div>
      </Drawer>


      {['hold', 'release', 'fail', 'toDismantle'].map((k) => {
        const cfg = {
          hold: { title: 'Put on hold', label: 'Hold', hint: 'It leaves its queue until released, and goes back to this stage.', go: () => holdTicket(t.ticket_id, form.reason), ok: 'On hold' },
          release: { title: 'Release the hold', label: 'Release', hint: `It goes back to ${t.hold_from_stage_name || 'Floor Manager'}.`, go: () => releaseTicket(t.ticket_id, form.reason), ok: 'Released' },
          fail: { title: 'Send back to the vendor', label: 'Fail and send back', hint: 'The laptop goes to QC-failed and appears in Vendor returns → To send back; a draft debit note is raised.', go: () => api.patch(`/tickets/${t.ticket_id}/floor-manager-fail`, { reason: form.reason }), ok: 'Failed — it is on the vendor-return list' },
          toDismantle: { title: 'Break for parts', label: 'Send to Dismantle', hint: 'For a laptop that is not worth repairing. Its good parts go into stock; the laptop is scrapped.', go: () => moveStage(t.ticket_id, { to_stage_name: 'Dismantle', reason: form.reason }), ok: 'Sent to Dismantle' },
        }[k];
        return (
          <Drawer key={k} open={drawer === k} onClose={() => setDrawer(null)} title={cfg.title} footer={<Button variant="primary" disabled={busy === k || String(form.reason || '').trim().length < 5} onClick={() => run(k, cfg.go, cfg.ok)}>{cfg.label}</Button>}>
            <p style={{ marginBottom: '12px' }}>{cfg.hint}</p>
            <Field label="Reason" required><Textarea rows={3} value={form.reason || ''} onChange={setF('reason')} /></Field>
          </Drawer>
        );
      })}

      <Drawer
        open={drawer === 'dismantle'}
        onClose={() => setDrawer(null)}
        title="Finish dismantling"
        width="36rem"
        footer={<Button variant="primary" disabled={busy === 'dis' || String(form.reason || '').trim().length < 5} onClick={() => run('dis', () => dismantleTicket(t.ticket_id, { reason: form.reason, parts: form.parts || [] }), 'Dismantled — parts added, laptop scrapped')}>Finish</Button>}
      >
        <div className="c-stack">
          <Field label="Parts taken off" hint="Search the parts catalog and add each part">
            <Input placeholder="e.g. 8GB DDR4, 14 inch screen" value={form.q || ''} onChange={async (e) => { const v = e.target.value; setForm((f) => ({ ...f, q: v })); if (v.trim().length >= 2) { try { const r = await searchParts(v, 10); setPartHits(r.data?.parts || r.data?.data || []); } catch { setPartHits([]); } } else setPartHits([]); }} />
          </Field>
          {partHits.length > 0 && (
            <div className="c-stack" style={{ gap: '4px' }}>
              {partHits.map((p) => <Button key={p.part_id} variant="quiet" onClick={() => { setForm((f) => ({ ...f, q: '', parts: [...(f.parts || []), { part_id: p.part_id, name: p.part_name, condition: 'good', quantity: 1 }] })); setPartHits([]); }}>+ {p.part_name}</Button>)}
            </div>
          )}
          {(form.parts || []).map((p, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <FormGrid key={i} cols={3}>
              <span>{p.name}</span>
              <Select value={p.condition} onChange={(e) => setForm((f) => ({ ...f, parts: f.parts.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)) }))} options={[{ value: 'good', label: 'Good — into stock' }, { value: 'defective', label: 'Defective' }]} />
              <Button variant="quiet" onClick={() => setForm((f) => ({ ...f, parts: f.parts.filter((_, j) => j !== i) }))}>Remove</Button>
            </FormGrid>
          ))}
          <Field label="Why it is broken for parts" required><Textarea rows={3} value={form.reason || ''} onChange={setF('reason')} /></Field>
        </div>
      </Drawer>
    </DeskShell>
  );
}
