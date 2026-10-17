import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import FieldShell from '../../../shells/FieldShell';
import {
  Button, EmptyState, Field, FlowSteps, Input, Notice, SignaturePad,
} from '../../../components/carret';
import PickupChargerScanPanel from '../../dispatch-charger/PickupChargerScanPanel';
import { CollectChargerPanel } from '../move/challanCharger';
import PickupPhotos from './PickupPhotos';
import { useFieldTasks } from '../field/TaskQueue';
import {
  fetchMyWork, fetchTicket, markArrived, sendOtp, signReturnDc, uploadPhoto, verifyPickupOtp,
} from './serveApi';
import { TECH_TABS, errMsg, mapsLink, when, withGps } from './serveShared';
import DamageReportDrawer from './DamageReportDrawer';
import CollectLaterDrawer from './CollectLaterDrawer';
import ItemComments from './ItemComments';
import VisitJob from './VisitJob';

/**
 * Serve → one job (claude/carret-support.md S4). The screen only ever offers
 * the next step, as one big button, over the existing support endpoints.
 *
 *   Visit   its own screen (VisitJob): reached → check laptop → result →
 *           6 photos → customer OTP
 *   Pickup  Arrived → photo + scan laptop and charger → Customer OTP
 *           → drop at the warehouse gate with the Return DC
 */

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
  const [photo, setPhoto] = useState(null);
  const [otp, setOtp] = useState('');
  const [ticket, setTicket] = useState(null);
  const [chargerOk, setChargerOk] = useState(false);
  const ft = useFieldTasks();
  const [photos, setPhotos] = useState(null); // pickup photos taken on this screen
  const [damageOpen, setDamageOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);

  const reloadTasks = ft.reload;
  const load = useCallback(() => {
    reloadTasks();
    fetchMyWork()
      .then(({ data }) => setJob((data.jobs || []).find((j) => String(j.item_id) === String(itemId)) || null))
      .catch((e) => { setJob(null); toast.error(errMsg(e)); });
  }, [itemId, reloadTasks]);
  useEffect(() => { load(); }, [load]);
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

  // One task at a time (migration 439): another task's screen stays shut.
  const taskKey = job.kind === 'pickup' && job.return_dc_number ? `rdc:${job.return_dc_number}` : `item:${job.item_id}`;
  if (!ft.allowed(taskKey)) {
    return (
      <FieldShell title={job.customer} tabs={TECH_TABS} onBack={() => navigate('/carret/serve/my-work')}>
        <EmptyState title="Not yet — one task at a time" body={`Finish ${ft.data?.current?.title || 'your current task'}${ft.data?.current?.customer ? ` (${ft.data.current.customer})` : ''} first.`} action={<Button variant="primary" onClick={() => navigate(ft.data?.current?.link || '/carret/serve/my-work')}>Go to it</Button>} />
      </FieldShell>
    );
  }
  if (job.kind === 'visit') {
    return <VisitJob key={job.item_id} job={job} ticket={ticket} ticketItem={ticketItem} onReload={load} onTicketReload={() => loadTicket(job.ticket_id)} />;
  }
  const isPickup = true;
  const k = job.next.key;
  const flow = [['arrive', 'Arrived'], ['pickup_photo', 'Photo + scan'], ['otp', 'Customer OTP'], ['drop', 'At the gate']];
  const idx = flow.findIndex(([key]) => key === k);
  const steps = flow.map(([key, label], i) => ({ key, label, state: i < idx ? 'done' : i === idx ? 'current' : 'todo' }));

  const arrived = () => withGps((lat, lng) => run(() => markArrived(job.item_id, { latitude: lat, longitude: lng }), 'Marked arrived'));
  const pickupPhoto = () => run(async () => {
    if (!photo) throw new Error('Take a photo of the laptop');
    await uploadPhoto(job.item_id, photo);
  }, 'Photo saved — scan the laptop and charger');
  const askOtp = () => run(() => sendOtp(job.item_id), 'OTP sent to the customer');
  const confirmOtp = () => run(async () => {
    if (!/^\d{4,8}$/.test(otp.trim())) throw new Error('Enter the OTP from the customer');
    await verifyPickupOtp(job.item_id, otp.trim());
  }, 'Collected — take it to the warehouse gate');

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
            <Button variant="primary" disabled={busy} onClick={arrived} style={{ width: '100%', minHeight: '56px' }}>I have arrived</Button>
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
          source={job.pickup_type === 'repair' ? 'repair_pickup' : 'return_pickup'}
          ticketId={job.ticket_id}
          ticketItemId={job.item_id}
          returnDcNumber={job.return_dc_number || undefined}
        />
      </div>
    </FieldShell>
  );
}
