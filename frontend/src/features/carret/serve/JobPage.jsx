import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import FieldShell from '../../../shells/FieldShell';
import {
  Button, EmptyState, Field, FlowSteps, Input, Notice, SignaturePad, Textarea,
} from '../../../components/carret';
import RaisePartRequestForm from '../../support/components/RaisePartRequestForm';
import PickupChargerScanPanel from '../../dispatch-charger/PickupChargerScanPanel';
import { CollectChargerPanel } from '../move/challanCharger';
import PickupPhotos from './PickupPhotos';
import {
  fetchMyWork, fetchTicket, markArrived, sendOtp, setOutcome, signReturnDc, uploadPhoto, verifyLaptop, verifyPickupOtp,
  verifyVisitOtp, workDone,
} from './serveApi';
import { TECH_TABS, errMsg, mapsLink, when, withGps } from './serveShared';
import DamageReportDrawer from './DamageReportDrawer';
import CollectLaterDrawer from './CollectLaterDrawer';
import ItemComments from './ItemComments';
import { FindingFields, emptyFinding, findingBody, findingError, useIssueCatalog } from './IssueFields';

/**
 * Serve → one job (claude/carret-support.md S4). The screen only ever offers
 * the next step, as one big button, over the existing support endpoints.
 *
 *   Visit   Arrived (GPS + scan the laptop) → Result (fixed / no fault: photo;
 *           needs a part; needs pickup or replacement) + what was wrong, why,
 *           what fixed it (tickets raised under the issue process) → Customer OTP
 *   Pickup  Arrived → photo + scan laptop and charger → Customer OTP
 *           → drop at the warehouse gate with the Return DC
 */
const RESULTS = [
  { key: 'fixed', label: 'Fixed', hint: 'Repaired on site' },
  { key: 'working', label: 'No fault found', hint: 'Working as it should' },
  { key: 'parts', label: 'Needs a part', hint: 'Request it from the warehouse' },
  { key: 'repair_pickup_requested', label: 'Needs workshop repair', hint: 'Ask your lead to approve — then you collect it now' },
  { key: 'replacement_required', label: 'Needs a replacement', hint: 'Your lead decides next' },
];

function PhotoInput({ file, onFile }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div>
      <label className="c-btn" style={{ display: 'inline-flex', cursor: 'pointer' }}>
        {file ? 'Retake photo' : 'Take photo'}
        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] || null)} />
      </label>
      {preview && <img src={preview} alt="" style={{ display: 'block', marginTop: '8px', maxHeight: '180px', borderRadius: '8px' }} />}
    </div>
  );
}

export default function JobPage() {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState(null);
  const [otp, setOtp] = useState('');
  const [ticket, setTicket] = useState(null);
  const [chargerOk, setChargerOk] = useState(false);
  const [photos, setPhotos] = useState(null); // pickup photos taken on this screen
  const catalog = useIssueCatalog();
  const [finding, setFinding] = useState(null);
  const [damageOpen, setDamageOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);

  const load = useCallback(() => {
    fetchMyWork()
      .then(({ data }) => setJob((data.jobs || []).find((j) => String(j.item_id) === String(itemId)) || null))
      .catch((e) => { setJob(null); toast.error(errMsg(e)); });
  }, [itemId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (job && !finding) setFinding(emptyFinding(job.reported)); }, [job, finding]);
  // The ticket feeds the part request form and the comment thread with the lead.
  const loadTicket = useCallback((ticketId) => {
    fetchTicket(ticketId).then(({ data }) => setTicket(data)).catch(() => {});
  }, []);
  useEffect(() => {
    if (job?.ticket_id && !ticket) loadTicket(job.ticket_id);
  }, [job, ticket, loadTicket]);
  const ticketItem = (ticket?.items || ticket?.ticket?.items || []).find((i) => String(i.id) === String(job?.item_id));

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); setPhoto(null); setOtp(''); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  if (job === undefined) return <FieldShell title="Job" tabs={TECH_TABS}><EmptyState title="Loading…" /></FieldShell>;
  if (job === null) {
    return (
      <FieldShell title="Job" tabs={TECH_TABS} onBack={() => navigate('/carret/serve/my-work')}>
        <EmptyState title="Nothing left for you on this job" body="It is done, or it is with your lead now." action={<Button onClick={() => navigate('/carret/serve/my-work')}>Back to my work</Button>} />
      </FieldShell>
    );
  }

  const isPickup = job.kind === 'pickup';
  const k = job.next.key;
  const flow = isPickup
    ? [['arrive', 'Arrived'], ['pickup_photo', 'Photo + scan'], ['otp', 'Customer OTP'], ['drop', 'At the gate']]
    : [['arrive', 'Arrived'], ['result', 'Result'], ['otp', 'Customer OTP']];
  const idx = flow.findIndex(([key]) => key === k);
  const steps = flow.map(([key, label], i) => ({ key, label, state: i < idx ? 'done' : i === idx ? 'current' : 'todo' }));

  const arrived = () => withGps((lat, lng) => run(() => markArrived(job.item_id, { latitude: lat, longitude: lng }), isPickup ? 'Marked arrived' : 'Marked arrived — scan the laptop'));
  const verify = () => run(async () => {
    if (!code.trim()) throw new Error('Scan or type the laptop’s TTSPL or serial');
    await verifyLaptop(job.item_id, code.trim());
  }, 'Laptop matched');
  // The finding travels with the outcome (the server refuses one without it).
  const withFinding = () => {
    if (!job.needs_finding) return {};
    const err = findingError(result, finding, catalog);
    if (err) throw new Error(err);
    return findingBody(result, finding, catalog);
  };
  const finishResult = () => run(async () => {
    if (!result) throw new Error('Choose the result');
    if (result === 'replacement_required' || result === 'repair_pickup_requested') {
      if (note.trim().length < 3) throw new Error('Write what is wrong, for your lead');
      await setOutcome(job.item_id, { outcome: result, comment: note.trim(), ...(result === 'replacement_required' ? withFinding() : {}) });
      return;
    }
    if (!photo) throw new Error('Take a photo of the laptop');
    if (!job.outcome) await setOutcome(job.item_id, { outcome: result, comment: note.trim() || undefined, ...withFinding() });
    await uploadPhoto(job.item_id, photo);
    await workDone(job.item_id);
    await sendOtp(job.item_id);
  }, ['replacement_required', 'repair_pickup_requested'].includes(result)
    ? (result === 'repair_pickup_requested' ? 'Asked — once your lead approves, the pickup opens in My work' : 'Sent to your lead')
    : 'Done — the customer has an OTP');
  const pickupPhoto = () => run(async () => {
    if (!photo) throw new Error('Take a photo of the laptop');
    await uploadPhoto(job.item_id, photo);
  }, 'Photo saved — scan the laptop and charger');
  const askOtp = () => run(() => sendOtp(job.item_id), 'OTP sent to the customer');
  const confirmOtp = () => run(async () => {
    if (!/^\d{4,8}$/.test(otp.trim())) throw new Error('Enter the OTP from the customer');
    await (isPickup ? verifyPickupOtp(job.item_id, otp.trim()) : verifyVisitOtp(job.item_id, otp.trim()));
  }, isPickup ? 'Collected — take it to the warehouse gate' : 'Closed ✓');

  return (
    <FieldShell title={job.customer} tabs={TECH_TABS} onBack={() => navigate('/carret/serve/my-work')}>
      <div className="c-stack">
        <FlowSteps steps={steps} />
        <div className="c-card" style={{ padding: '12px 16px' }}>
          <div>{job.address || '—'}</div>
          {job.appointment && <div className="text-ink-3">🗓 {when(job.appointment)}</div>}
          <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
            {[job.laptop.brand, job.laptop.model].filter(Boolean).join(' ')} · <span className="font-mono">{job.laptop.ttspl || job.laptop.serial}</span>{job.issue ? ` · ${job.issue}` : ''}
          </div>
          {job.remarks && <div style={{ marginTop: '4px' }}>“{job.remarks}”</div>}
          <div className="flex flex-wrap" style={{ gap: '8px', marginTop: '8px' }}>
            {job.phone && <a className="c-btn" href={`tel:${job.phone}`}>Call {job.phone}</a>}
            {job.address && <a className="c-btn" href={mapsLink(job.address, job.customer)} target="_blank" rel="noopener noreferrer">Map</a>}
          </div>
        </div>

        {k === 'arrive' && (
          <div className="c-card" style={{ padding: '16px' }}>
            {!job.visited_at ? (
              <Button variant="primary" disabled={busy} onClick={arrived} style={{ width: '100%', minHeight: '56px' }}>I have arrived</Button>
            ) : (
              <>
                <Field label="Scan or type the laptop’s TTSPL / serial" required>
                  <Input autoFocus value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && verify()} placeholder={job.laptop.ttspl || 'TTSPL…'} />
                </Field>
                <Button variant="primary" disabled={busy} onClick={verify} style={{ width: '100%', minHeight: '56px', marginTop: '12px' }}>Check the laptop</Button>
              </>
            )}
          </div>
        )}

        {k === 'result' && (
          <div className="c-card" style={{ padding: '16px' }}>
            <div className="c-stack" style={{ gap: '8px' }}>
              {RESULTS.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setResult(r.key)}
                  className="c-btn"
                  style={{ justifyContent: 'flex-start', minHeight: '52px', textAlign: 'left', borderWidth: result === r.key ? 2 : 1, borderColor: result === r.key ? 'var(--accent)' : undefined }}
                  disabled={Boolean(job.outcome) && job.outcome !== r.key}
                >
                  <span><strong>{r.label}</strong><br /><span className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>{r.hint}</span></span>
                </button>
              ))}
            </div>
            {job.needs_finding && !job.outcome && finding && ['fixed', 'working', 'replacement_required'].includes(result) && (
              <div className="c-stack" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--line, #e2e8f0)' }}>
                <strong>{result === 'working' ? 'What the customer reported' : 'What you found'}</strong>
                <FindingFields catalog={catalog} finish={result} value={finding} onChange={setFinding} idPrefix={`job-${job.item_id}`} />
              </div>
            )}
            {(result === 'fixed' || result === 'working') && (
              <div className="c-stack" style={{ marginTop: '12px' }}>
                <PhotoInput file={photo} onFile={setPhoto} />
                <Field label="Note (optional)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                <Button variant="primary" disabled={busy} onClick={finishResult} style={{ width: '100%', minHeight: '56px' }}>Done — send the customer an OTP</Button>
              </div>
            )}
            {(result === 'replacement_required' || result === 'repair_pickup_requested') && (
              <div className="c-stack" style={{ marginTop: '12px' }}>
                <Field label={result === 'repair_pickup_requested' ? 'Why it must go to the workshop' : 'What is wrong'} required><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                <Button variant="primary" disabled={busy} onClick={finishResult} style={{ width: '100%', minHeight: '56px' }}>{result === 'repair_pickup_requested' ? 'Ask my lead to approve' : 'Send to my lead'}</Button>
              </div>
            )}
            {result === 'parts' && (
              <div style={{ marginTop: '12px' }}>
                {ticket ? (
                  <RaisePartRequestForm ticket={ticket.ticket || ticket} item={(ticket.items || ticket.ticket?.items || []).find((i) => String(i.id) === String(job.item_id)) || { id: job.item_id, ttspl_id: job.laptop.ttspl, serial_number: job.laptop.serial }} />
                ) : <EmptyState title="Loading…" />}
                <Notice tone="info">When the part reaches you (My parts), fit it, then come back here and record the result.</Notice>
              </div>
            )}
          </div>
        )}

        {k === 'pickup_photo' && (
          <div className="c-card" style={{ padding: '16px' }}>
            {job.needs_photos && (photos || job.photos || []).length < 6 ? (
              // Six photos of the laptop (migration 433), each compressed and uploaded as it is taken.
              <PickupPhotos itemId={job.item_id} photos={photos || job.photos} onChange={setPhotos} />
            ) : !job.needs_photos && !job.has_photo ? (
              <div className="c-stack">
                <PhotoInput file={photo} onFile={setPhoto} />
                <Button variant="primary" disabled={busy} onClick={pickupPhoto} style={{ width: '100%', minHeight: '56px' }}>Save the photo</Button>
              </div>
            ) : (
              <div className="c-stack">
                {job.needs_photos && <PickupPhotos itemId={job.item_id} photos={photos || job.photos} onChange={setPhotos} />}
                {/* With / without charger, saved on the Return DC (migration 430). */}
                {job.return_dc_number
                  ? <CollectChargerPanel itemId={job.item_id} rdc={job.return_dc_number} code={job.laptop.ttspl || job.laptop.serial} onReady={setChargerOk} />
                  : <PickupChargerScanPanel pickupItemId={job.item_id} onScanned={() => setChargerOk(true)} />}
                {/* The technician signs the Return DC (16 Oct 2026) — once per Return DC. */}
                {job.return_dc_number && (job.signed ? (
                  <Notice tone="good" title={`Return DC ${job.return_dc_number} signed`} />
                ) : (
                  <div className="c-qsec" style={{ padding: '12px 14px' }}>
                    <strong style={{ display: 'block', marginBottom: '6px' }}>Sign the Return DC</strong>
                    <SignaturePad
                      prompt="Sign as the technician collecting the laptop"
                      saveLabel={busy ? 'Saving…' : 'Sign'}
                      onSave={(dataUrl) => run(() => signReturnDc(job.item_id, dataUrl), 'Signed')}
                    />
                  </div>
                ))}
                <Button variant="primary" disabled={busy || (Boolean(job.return_dc_number) && (!chargerOk || !job.signed))} onClick={askOtp} style={{ width: '100%', minHeight: '56px' }}>
                  {!job.return_dc_number || (chargerOk && job.signed) ? 'Send the customer an OTP' : (!chargerOk ? 'Record the charger first' : 'Sign the Return DC first')}
                </Button>
              </div>
            )}
          </div>
        )}

        {k === 'otp' && (
          <div className="c-card" style={{ padding: '16px' }}>
            <Field label="OTP the customer received" required>
              <Input inputMode="numeric" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} style={{ fontSize: '24px', letterSpacing: '6px', textAlign: 'center' }} />
            </Field>
            <Button variant="primary" disabled={busy} onClick={confirmOtp} style={{ width: '100%', minHeight: '56px', marginTop: '12px' }}>Confirm</Button>
            <Button variant="quiet" disabled={busy} onClick={askOtp} style={{ width: '100%', marginTop: '8px' }}>Send the OTP again</Button>
          </div>
        )}

        {/* The customer keeps this laptop: it moves to its own Return DC (own OTP)
            so the laptops already collected can go through the gate today. */}
        {isPickup && !job.collected && ['arrive', 'pickup_photo', 'otp'].includes(k) && job.return_dc_number && (
          job.rdc_laptops > 1 ? (
            <Button variant="quiet" onClick={() => setLaterOpen(true)} style={{ width: '100%' }}>
              Customer keeps this laptop — collect later
            </Button>
          ) : (
            <p className="text-ink-3" style={{ fontSize: 'var(--d-sm)', textAlign: 'center' }}>
              Customer keeps it? This is the only laptop on {job.return_dc_number} — ask your lead to move the visit slot.
            </p>
          )
        )}

        {k === 'drop' && (
          <Notice tone="info" title="Take it to the warehouse gate">
            Hand the laptop in at the gate with Return DC <strong className="font-mono">{job.return_dc_number || '—'}</strong>. The guard scans it in and the job leaves your list.
          </Notice>
        )}

        <div className="c-card" style={{ padding: '16px' }}>
          <strong style={{ display: 'block', marginBottom: '8px' }}>Comments with your lead</strong>
          {ticketItem ? <ItemComments item={ticketItem} canShare={false} onAdded={() => loadTicket(job.ticket_id)} /> : <div className="text-ink-3">Loading…</div>}
        </div>

        {/* DM1: damage found at the visit / pickup — part, issue and photo; the warehouse prices it. */}
        <Button variant="quiet" onClick={() => setDamageOpen(true)} style={{ width: '100%', marginTop: '12px' }}>Report damage on this laptop</Button>
        <CollectLaterDrawer
          open={laterOpen}
          onClose={() => setLaterOpen(false)}
          onDone={() => { setLaterOpen(false); load(); }}
          item={{ id: job.item_id, code: job.laptop?.ttspl || job.laptop?.serial, rdc: job.return_dc_number }}
        />
        <DamageReportDrawer
          open={damageOpen}
          onClose={() => setDamageOpen(false)}
          onDone={() => setDamageOpen(false)}
          laptop={{ asset_code: job.laptop?.ttspl || job.laptop?.serial }}
          source={job.kind === 'visit' ? 'technician_visit' : (job.pickup_type === 'repair' ? 'repair_pickup' : 'return_pickup')}
          ticketId={job.ticket_id}
          ticketItemId={job.item_id}
          returnDcNumber={job.return_dc_number || undefined}
        />
      </div>
    </FieldShell>
  );
}
