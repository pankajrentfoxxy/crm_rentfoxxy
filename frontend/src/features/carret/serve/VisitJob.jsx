import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import FieldShell from '../../../shells/FieldShell';
import {
  Button, Field, FlowSteps, Input, Notice, Textarea,
} from '../../../components/carret';
import RaisePartRequestForm from '../../support/components/RaisePartRequestForm';
import PickupPhotos, { PHOTO_SLOTS } from './PickupPhotos';
import FieldDayBar from '../field/FieldDayBar';
import { fmtKm, fmtTime } from '../field/fieldApi';
import {
  markArrived, sendOtp, setOutcome, verifyLaptop, verifyVisitOtp, workDone,
} from './serveApi';
import { SLA_LABEL, SLA_TONE, TECH_TABS, errMsg, mapsLink, when } from './serveShared';
import DamageReportDrawer from './DamageReportDrawer';
import ItemComments from './ItemComments';
import { FindingFields, emptyFinding, findingBody, findingError, useIssueCatalog } from './IssueFields';

/**
 * Serve → a complaint visit, on the technician's phone (17 Oct 2026).
 *
 *   1 Reached       — GPS; the road distance from the last stop is measured
 *   2 Check laptop  — scan / type its TTSPL or serial
 *   3 Result        — fixed / no fault / needs a part / workshop / replacement,
 *                     with what was wrong (issue process)
 *   4 Photos        — six photos of the laptop (fixed / no fault)
 *   5 Customer OTP  — closes the visit
 *
 * Needs a part: the visit waits (it does not hold up other tasks); when the
 * part is with the technician it comes back — "reached" again, then the result.
 */
const RESULTS = [
  { key: 'fixed', label: 'Fixed', hint: 'Repaired on site', icon: '✓' },
  { key: 'working', label: 'No fault found', hint: 'Working as it should', icon: '○' },
  { key: 'parts', label: 'Needs a part', hint: 'Request it — come back when it is with you', icon: '⚙' },
  { key: 'repair_pickup_requested', label: 'Needs workshop repair', hint: 'Your lead approves — then you collect it', icon: '↩' },
  { key: 'replacement_required', label: 'Needs a replacement', hint: 'Your lead decides next', icon: '⇄' },
];
const PART_STATE = {
  pending: 'Waiting for approval', approved: 'Approved — being packed', challan_generated: 'Packed — challan made',
  dispatched: 'On the way', in_transit: 'On the way', reserved: 'Reserved at the warehouse', processing: 'Being packed', draft: 'Draft',
  issued: 'With you', with_technician: 'With you', delivered: 'Delivered to the customer', used: 'Fitted',
};
const gps = () => new Promise((resolve) => {
  if (!navigator.geolocation) { resolve({}); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
    () => resolve({}),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
});

function StopStrip({ stop }) {
  if (!stop) return null;
  return (
    <div className="c-vj-stop">
      <span aria-hidden="true">📍</span>
      <span>
        Reached {fmtTime(stop.reached_at)}
        {stop.measuring ? ' · measuring the distance…' : ` · ${fmtKm(stop.km)} by road${stop.minutes ? ` (${Math.round(stop.minutes)} min)` : ''}`}
        {stop.from ? <small> from {stop.from}</small> : null}
      </span>
    </div>
  );
}

export default function VisitJob({ job, ticket, ticketItem, onReload, onTicketReload }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [dayOk, setDayOk] = useState(true);
  const [code, setCode] = useState('');
  const [result, setResult] = useState(job.outcome || '');
  const [note, setNote] = useState('');
  const [otp, setOtp] = useState('');
  const [photos, setPhotos] = useState(null);
  const [damageOpen, setDamageOpen] = useState(false);
  const catalog = useIssueCatalog();
  const [finding, setFinding] = useState(() => emptyFinding(job.reported));

  // The road distance is measured just after "reached": look again shortly.
  useEffect(() => {
    if (!job.stop?.measuring) return undefined;
    const t = setTimeout(onReload, 5000);
    return () => clearTimeout(t);
  }, [job.stop, onReload]);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); setOtp(''); onReload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const k = job.next.key;
  const shot = photos || job.photos || [];
  const photosDone = new Set(shot.map((p) => p.slot)).size >= PHOTO_SLOTS.length;
  const needsPhotos = result === 'fixed' || result === 'working';
  // Where the visit is: 0 reached, 1 check laptop, 2 result, 3 photos, 4 OTP.
  let at = 0;
  if (k === 'arrive') at = job.needs_arrive ? 0 : 1;
  else if (k === 'result' || k === 'waiting') at = needsPhotos ? 3 : 2;
  else if (k === 'otp') at = 4;
  const steps = ['Reached', 'Check laptop', 'Result', 'Photos', 'Customer OTP'].map((label, i) => ({
    key: label, label, state: i < at ? 'done' : i === at ? 'current' : 'todo',
  }));

  const reached = () => run(async () => {
    const p = await gps();
    await markArrived(job.item_id, p.latitude != null ? { latitude: String(p.latitude), longitude: String(p.longitude) } : {});
  }, job.revisit ? 'Reached — fit the part, then record the result' : 'Reached — now check the laptop');
  const check = () => run(async () => {
    if (!code.trim()) throw new Error('Scan or type the laptop’s TTSPL or serial');
    await verifyLaptop(job.item_id, code.trim());
    setCode('');
  }, 'Laptop matched');
  const withFinding = () => {
    if (!job.needs_finding) return {};
    const err = findingError(result, finding, catalog);
    if (err) throw new Error(err);
    return findingBody(result, finding, catalog);
  };
  const toLead = () => run(async () => {
    if (note.trim().length < 3) throw new Error('Write what is wrong, for your lead');
    await setOutcome(job.item_id, { outcome: result, comment: note.trim(), ...(result === 'replacement_required' ? withFinding() : {}) });
  }, result === 'repair_pickup_requested' ? 'Asked — once your lead approves, the pickup opens in My work' : 'Sent to your lead');
  const finish = () => run(async () => {
    if (!photosDone) throw new Error(`Take all ${PHOTO_SLOTS.length} photos of the laptop`);
    if (!job.outcome) await setOutcome(job.item_id, { outcome: result, comment: note.trim() || undefined, ...withFinding() });
    await workDone(job.item_id);
    await sendOtp(job.item_id);
  }, 'Done — the customer has an OTP');
  const confirm = () => run(async () => {
    if (!/^\d{4,8}$/.test(otp.trim())) throw new Error('Enter the OTP the customer received');
    await verifyVisitOtp(job.item_id, otp.trim());
  }, 'Visit closed ✓');

  const sla = job.sla?.state && job.sla.state !== 'n/a' ? job.sla : null;
  const laptop = [job.laptop.brand, job.laptop.model].filter(Boolean).join(' ');

  return (
    <FieldShell title={job.customer} tabs={TECH_TABS} onBack={() => navigate('/carret/serve/my-work')}>
      <div className="c-stack">
        <FieldDayBar onReady={setDayOk} />

        <section className="c-vj-head">
          <div className="c-vj-k">
            <span className="c-tq-chip">{job.revisit ? 'Revisit' : 'Complaint visit'}</span>
            <span>Ticket #{job.ticket_id}</span>
            {job.priority !== 'normal' && <span className="c-vj-pri">{job.priority}</span>}
            {sla && <span style={{ color: SLA_TONE[sla.state], marginLeft: 'auto', fontWeight: 600 }}>{SLA_LABEL[sla.state] || sla.state}</span>}
          </div>
          <h2 className="c-vj-c">{job.customer}</h2>
          {job.contact_name && <div className="c-vj-sub">Raised by {job.contact_name}</div>}
          <dl className="c-vj-dl">
            <div><dt>Laptop</dt><dd><span className="font-mono">{job.laptop.ttspl || job.laptop.serial || '—'}</span>{laptop ? ` · ${laptop}` : ''}</dd></div>
            {job.issue && <div><dt>Problem</dt><dd>{job.issue}</dd></div>}
            {job.remarks && <div><dt>Customer says</dt><dd>“{job.remarks}”</dd></div>}
            {job.appointment && <div><dt>Slot</dt><dd>{when(job.appointment)}</dd></div>}
            <div><dt>Address</dt><dd>{job.address || 'No address on the ticket'}</dd></div>
          </dl>
          <div className="c-vj-act">
            {job.phone && <a className="c-btn" href={`tel:${job.phone}`}>📞 Call</a>}
            {job.alt_phone && <a className="c-btn" href={`tel:${job.alt_phone}`}>📞 Alternate</a>}
            {job.address && <a className="c-btn" href={mapsLink(job.address, job.customer)} target="_blank" rel="noopener noreferrer">🗺 Directions</a>}
          </div>
        </section>

        <FlowSteps steps={steps} className="c-flow-sm" />
        {!job.needs_arrive && <StopStrip stop={job.stop} />}

        {at === 0 && (
          <section className="c-pvl is-accent">
            <header className="c-pvl-h"><span className="c-pvl-n">1</span><div><b>{job.revisit ? 'Back at the customer with the part?' : 'At the customer?'}</b><small>Your location is taken — the distance from your last stop is measured.</small></div></header>
            {job.revisit && job.parts?.length > 0 && (
              <ul className="c-vj-parts">{job.parts.map((p) => <li key={p.request_number}><b>{p.part || 'Part'}</b><span>{PART_STATE[p.status] || p.status}</span></li>)}</ul>
            )}
            <Button variant="primary" disabled={busy || !dayOk} onClick={reached} style={{ width: '100%', minHeight: '56px', fontSize: '17px' }}>
              {!dayOk ? 'Check in for the day first (top)' : busy ? 'Taking your location…' : 'I have reached'}
            </Button>
          </section>
        )}

        {at === 1 && (
          <section className="c-pvl is-accent">
            <header className="c-pvl-h"><span className="c-pvl-n">2</span><div><b>Check the laptop</b><small>Scan the sticker or type the TTSPL / serial</small></div></header>
            <Field label="TTSPL or serial" required>
              <Input autoFocus value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && check()} placeholder={job.laptop.ttspl || 'TTSPL…'} />
            </Field>
            <Button variant="primary" disabled={busy} onClick={check} style={{ width: '100%', minHeight: '52px' }}>Check the laptop</Button>
          </section>
        )}

        {k === 'waiting' && (
          <section className="c-pvl">
            <header className="c-pvl-h"><span className="c-pvl-n">⚙</span><div><b>Waiting for the part</b><small>This visit is not holding you up — do your next task.</small></div></header>
            <ul className="c-vj-parts">{(job.parts || []).map((p) => <li key={p.request_number}><b>{p.part || 'Part'}</b><span className="font-mono">{p.request_number}</span><span>{PART_STATE[p.status] || p.status}</span></li>)}</ul>
            <Notice tone="info">When the part is handed to you it comes back to My work: go to the customer, tap “I have reached”, fit it, then record the result.</Notice>
            <Button onClick={() => navigate('/carret/serve/my-work')}>Back to My work</Button>
          </section>
        )}

        {k === 'result' && (
          <section className="c-pvl is-accent">
            <header className="c-pvl-h"><span className="c-pvl-n">3</span><div><b>What happened?</b><small>Choose one</small></div></header>
            <div className="c-vj-results">
              {RESULTS.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={`c-vj-r${result === r.key ? ' is-on' : ''}`}
                  onClick={() => setResult(r.key)}
                  disabled={Boolean(job.outcome) && job.outcome !== r.key}
                >
                  <span className="c-vj-ri" aria-hidden="true">{r.icon}</span>
                  <span><b>{r.label}</b><small>{r.hint}</small></span>
                </button>
              ))}
            </div>

            {job.needs_finding && !job.outcome && ['fixed', 'working', 'replacement_required'].includes(result) && (
              <div className="c-vj-sub-sec">
                <b>{result === 'working' ? 'What the customer reported' : 'What you found'}</b>
                <FindingFields catalog={catalog} finish={result} value={finding} onChange={setFinding} idPrefix={`job-${job.item_id}`} />
              </div>
            )}

            {(result === 'replacement_required' || result === 'repair_pickup_requested') && (
              <div className="c-vj-sub-sec">
                <Field label={result === 'repair_pickup_requested' ? 'Why it must go to the workshop' : 'What is wrong'} required><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                <Button variant="primary" disabled={busy} onClick={toLead} style={{ width: '100%', minHeight: '52px' }}>{result === 'repair_pickup_requested' ? 'Ask my lead to approve' : 'Send to my lead'}</Button>
              </div>
            )}

            {result === 'parts' && (
              <div className="c-vj-sub-sec">
                {ticket ? (
                  <RaisePartRequestForm
                    ticket={ticket.ticket || ticket}
                    item={ticketItem || { id: job.item_id, ttspl_id: job.laptop.ttspl, serial_number: job.laptop.serial }}
                    onRaised={onReload}
                  />
                ) : <div className="text-ink-3">Loading…</div>}
                <small className="text-ink-3">Once the part is requested this visit waits for it and your next task opens.</small>
              </div>
            )}
          </section>
        )}

        {k === 'result' && needsPhotos && (
          <section className={`c-pvl${photosDone ? ' is-ready' : ' is-accent'}`}>
            <header className="c-pvl-h"><span className="c-pvl-n">4</span><div><b>Photos of the laptop</b><small>All {PHOTO_SLOTS.length} — tap a box to take that side</small></div></header>
            <PickupPhotos itemId={job.item_id} photos={shot} onChange={setPhotos} title="Laptop photos" />
            <Field label="Note (optional)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you did" /></Field>
            <Button variant="primary" disabled={busy || !photosDone} onClick={finish} style={{ width: '100%', minHeight: '56px' }}>
              {photosDone ? 'Done — send the customer an OTP' : `Take the photos first (${new Set(shot.map((p) => p.slot)).size}/${PHOTO_SLOTS.length})`}
            </Button>
          </section>
        )}

        {k === 'otp' && (
          <section className="c-pvl is-accent">
            <header className="c-pvl-h"><span className="c-pvl-n">5</span><div><b>Customer OTP</b><small>{job.otp_sent_at ? `Sent ${when(job.otp_sent_at)} — ask the customer for it` : 'Ask the customer for the code they received'}</small></div></header>
            <Input inputMode="numeric" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} aria-label="OTP" placeholder="••••" style={{ fontSize: '26px', letterSpacing: '8px', textAlign: 'center' }} />
            <Button variant="primary" disabled={busy || !otp} onClick={confirm} style={{ width: '100%', minHeight: '56px' }}>Close the visit</Button>
            <Button variant="quiet" disabled={busy} onClick={() => run(() => sendOtp(job.item_id), 'OTP sent again')}>Send the OTP again</Button>
          </section>
        )}

        <details className="c-vj-more">
          <summary>Comments with your lead{ticketItem?.comments?.length ? ` · ${ticketItem.comments.length}` : ''}</summary>
          {ticketItem ? <ItemComments item={ticketItem} canShare={false} onAdded={onTicketReload} /> : <div className="text-ink-3">Loading…</div>}
        </details>
        <Button variant="quiet" onClick={() => setDamageOpen(true)} style={{ width: '100%' }}>Report damage on this laptop</Button>
        <DamageReportDrawer
          open={damageOpen}
          onClose={() => setDamageOpen(false)}
          onDone={() => setDamageOpen(false)}
          laptop={{ asset_code: job.laptop?.ttspl || job.laptop?.serial }}
          source="technician_visit"
          ticketId={job.ticket_id}
          ticketItemId={job.item_id}
        />
      </div>
    </FieldShell>
  );
}
