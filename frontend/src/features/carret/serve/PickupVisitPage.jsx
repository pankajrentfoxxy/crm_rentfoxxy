import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import FieldShell from '../../../shells/FieldShell';
import {
  Button, EmptyState, Field, FlowSteps, Input, Notice, SignaturePad,
} from '../../../components/carret';
import api from '../../../utils/api';
import PickupPhotos from './PickupPhotos';
import CollectLaterDrawer from './CollectLaterDrawer';
import { CollectChargerPanel } from '../move/challanCharger';
import FieldDayBar from '../field/FieldDayBar';
import { useFieldTasks } from '../field/TaskQueue';
import { signReturnDc } from './serveApi';
import { TECH_TABS, errMsg, mapsLink, when } from './serveShared';
import { podUrl } from '../../../components/support/utils';

/**
 * Support → a pickup visit (17 Oct 2026): every laptop on one Return DC,
 * collected together.
 *
 *   1 Arrived        — once, for every laptop (and a travel stop)
 *   2 Each laptop    — 6 photos + its charger, or "Customer keeps it"
 *                      (moves to a later pickup, with a date and time)
 *   3 Signatures     — the technician signs the Return DC; the customer signs
 *   4 Customer OTP   — one code for every laptop being collected
 *   5 Mail           — the signed Return DC to the customer (required)
 *   6 Gate           — hand the laptops in at the warehouse gate
 */
const vpath = (rdc, s = '') => `/support/return-dc/${encodeURIComponent(rdc)}${s}`;
const gps = () => new Promise((resolve) => {
  if (!navigator.geolocation) { resolve({}); return; }
  navigator.geolocation.getCurrentPosition((p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => resolve({}), { timeout: 10000, maximumAge: 60000 });
});

export default function PickupVisitPage() {
  const { rdc: raw } = useParams();
  const rdc = decodeURIComponent(raw || '');
  const navigate = useNavigate();
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dayOk, setDayOk] = useState(true);
  const [laterFor, setLaterFor] = useState(null);
  const [custSign, setCustSign] = useState(null);
  const [custName, setCustName] = useState('');
  const [otp, setOtp] = useState('');
  const [mailTo, setMailTo] = useState('');
  const [chargerOk, setChargerOk] = useState({});
  const ft = useFieldTasks();

  const reloadTasks = ft.reload;
  const load = useCallback(() => {
    reloadTasks();
    api.get(vpath(rdc, '/visit')).then(({ data }) => {
      setV(data);
      setMailTo((m) => m || data.mail?.to || data.email || '');
    }).catch((e) => setV({ error: errMsg(e, 'Could not load the pickup') }));
  }, [rdc, reloadTasks]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); toast.success(r?.data?.message || ok); load(); return r; } catch (e) { toast.error(errMsg(e)); return null; } finally { setBusy(false); }
  };

  if (!v) return <FieldShell title="Pickup" tabs={TECH_TABS}><EmptyState title="Loading…" /></FieldShell>;
  if (v.error) return <FieldShell title="Pickup" tabs={TECH_TABS}><EmptyState title="Not available" body={v.error} action={<Button onClick={() => navigate('/carret/serve/my-work')}>My work</Button>} /></FieldShell>;

  // One task at a time (migration 439): another task's screen stays shut.
  if (!ft.allowed(`rdc:${rdc}`)) {
    return (
      <FieldShell title={v.customer || 'Pickup'} tabs={TECH_TABS} onBack={() => navigate('/carret/serve/my-work')}>
        <EmptyState title="Not yet — one task at a time" body={`Finish ${ft.data?.current?.title || 'your current task'}${ft.data?.current?.customer ? ` (${ft.data.current.customer})` : ''} first.`} action={<Button variant="primary" onClick={() => navigate(ft.data?.current?.link || '/carret/serve/my-work')}>Go to it</Button>} />
      </FieldShell>
    );
  }
  const laptops = v.laptops || [];
  const open = laptops.filter((l) => !l.collected_at);
  const collected = laptops.filter((l) => l.collected_at);
  const photosOk = (l) => l.pickup_method === 'courier' || l.pickup_method === 'porter' || new Set((l.photos || []).map((p) => p.slot)).size >= 6;
  const ready = (l) => photosOk(l) && (Boolean(l.charger_collected) || chargerOk[l.item_id]);
  const allReady = open.length > 0 && open.every(ready);
  const techSigned = Boolean(v.technician_sign);
  const mailDone = Boolean(v.mail?.attempted_at);
  const step = !v.arrived_at ? 0 : open.length ? (!allReady ? 1 : (!techSigned || !custSign) ? 2 : 3) : (!mailDone ? 4 : 5);
  const steps = ['Arrived', 'Laptops', 'Signatures', 'Customer OTP', 'Mail', 'Gate'].map((label, i) => ({
    key: label, label, state: i < step ? 'done' : i === step ? 'current' : 'todo',
  }));

  const arrived = () => run(async () => api.post(vpath(rdc, '/arrived'), await gps()), 'Arrived — take the photos of each laptop');
  const sendOtp = () => run(() => api.post(vpath(rdc, '/send-otp'), { item_ids: open.map((l) => l.item_id) }), 'OTP sent to the customer');
  const collect = () => run(async () => {
    if (!/^\d{4,8}$/.test(otp.trim())) throw new Error('Enter the OTP the customer received');
    const r = await api.post(vpath(rdc, '/collect'), { item_ids: open.map((l) => l.item_id), otp: otp.trim(), customer_esign_data: custSign, customer_signer_name: custName.trim() || undefined });
    setOtp('');
    return r;
  }, 'Collected');
  const mail = () => run(() => api.post(vpath(rdc, '/email-customer'), { to: mailTo.trim() }), 'Mailed');

  return (
    <FieldShell title={v.customer || 'Pickup'} tabs={TECH_TABS} onBack={() => navigate('/carret/serve/my-work')}>
      <div className="c-stack">
        <FieldDayBar onReady={setDayOk} />
        <div className="c-card" style={{ padding: '12px 16px' }}>
          <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>Pickup · {rdc} · {laptops.length} laptop{laptops.length > 1 ? 's' : ''}</div>
          <div>{v.address || '—'}</div>
          <div className="flex flex-wrap" style={{ gap: '8px', marginTop: '8px' }}>
            {v.phone && <a className="c-btn" href={`tel:${v.phone}`}>Call {v.phone}</a>}
            {v.address && <a className="c-btn" href={mapsLink(v.address, v.customer)} target="_blank" rel="noopener noreferrer">Map</a>}
          </div>
        </div>
        <FlowSteps steps={steps} className="c-flow-sm" />

        {step === 0 && (
          <div className="c-card" style={{ padding: '16px' }}>
            <Button variant="primary" disabled={busy || !dayOk} onClick={arrived} style={{ width: '100%', minHeight: '56px' }}>{dayOk ? 'I have arrived' : 'Start your day first'}</Button>
          </div>
        )}

        {v.arrived_at && open.length > 0 && (
          <>
            {open.map((l, n) => (
              <section key={l.item_id} className={`c-pvl${ready(l) ? ' is-ready' : ''}`}>
                <header className="c-pvl-h">
                  <span className="c-pvl-n">{n + 1}</span>
                  <div className="min-w-0">
                    <b className="font-mono">{l.ttspl_id || l.serial_number}</b>
                    <small>{[l.model, l.config].filter(Boolean).join(' · ')}</small>
                  </div>
                  <span className={`c-pvl-s${ready(l) ? ' is-ok' : ''}`}>{ready(l) ? 'Ready' : 'To do'}</span>
                </header>
                {!(l.pickup_method === 'courier' || l.pickup_method === 'porter') && (
                  <PickupPhotos itemId={l.item_id} photos={l.photos} onChange={() => load()} />
                )}
                <CollectChargerPanel itemId={l.item_id} rdc={rdc} code={l.ttspl_id || l.serial_number} onReady={(ok) => setChargerOk((m) => (m[l.item_id] === ok ? m : { ...m, [l.item_id]: ok }))} />
                {open.length > 1 && (
                  <Button variant="quiet" onClick={() => setLaterFor({ id: l.item_id, code: l.ttspl_id || l.serial_number, rdc })}>Customer keeps it — collect later</Button>
                )}
              </section>
            ))}

            {allReady && (
              <section className="c-pvl">
                <header className="c-pvl-h"><span className="c-pvl-n">✎</span><div><b>Signatures</b><small>The technician and the customer sign the Return DC</small></div></header>
                {techSigned ? (
                  <Notice tone="good" title={`Signed by you${v.technician_sign.name ? ` (${v.technician_sign.name})` : ''}`} />
                ) : (
                  <div>
                    <strong style={{ display: 'block', marginBottom: '6px' }}>Your signature</strong>
                    <SignaturePad prompt="Sign as the technician collecting these laptops" saveLabel="Sign" onSave={(d) => run(() => signReturnDc(open[0].item_id, d), 'Signed')} />
                  </div>
                )}
                {custSign ? (
                  <div className="c-stack" style={{ gap: '6px' }}>
                    <img src={custSign} alt="Customer signature" style={{ height: '70px', border: '1px solid var(--rule)', borderRadius: '8px', background: '#fff', objectFit: 'contain' }} />
                    <Button variant="quiet" onClick={() => setCustSign(null)}>Customer signs again</Button>
                  </div>
                ) : (
                  <div>
                    <strong style={{ display: 'block', marginBottom: '6px' }}>Customer’s signature</strong>
                    <SignaturePad prompt="Customer signs for the laptops handed over" saveLabel="Customer signed" onSave={setCustSign} />
                  </div>
                )}
                <Field label="Customer’s name"><Input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Who handed them over" /></Field>
              </section>
            )}

            {allReady && techSigned && custSign && (
              <section className="c-pvl is-accent">
                <header className="c-pvl-h"><span className="c-pvl-n">#</span><div><b>Customer OTP</b><small>One code collects all {open.length} laptop{open.length > 1 ? 's' : ''}</small></div></header>
                {v.otp_sent_at ? <p className="text-ink-3" style={{ margin: 0 }}>OTP sent {when(v.otp_sent_at)}{v.otp ? ` · code ${v.otp}` : ''}</p> : null}
                <Button disabled={busy} onClick={sendOtp}>{v.otp_sent_at ? 'Send the OTP again' : 'Send the customer an OTP'}</Button>
                <Field label="OTP the customer received" required>
                  <Input inputMode="numeric" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} style={{ fontSize: '24px', letterSpacing: '6px', textAlign: 'center' }} />
                </Field>
                <Button variant="primary" disabled={busy || !otp} onClick={collect} style={{ width: '100%', minHeight: '56px' }}>Collect {open.length} laptop{open.length > 1 ? 's' : ''}</Button>
              </section>
            )}
          </>
        )}

        {collected.length > 0 && !open.length && (
          <section className={`c-pvl${mailDone ? ' is-ready' : ' is-accent'}`}>
            <header className="c-pvl-h"><span className="c-pvl-n">@</span><div><b>Mail the signed Return DC</b><small>Required — the customer gets the challan for the {collected.length} laptop{collected.length > 1 ? 's' : ''} collected</small></div></header>
            {mailDone && (
              <Notice tone={v.mail.sent_at ? 'good' : 'warn'} title={v.mail.sent_at ? `Mailed to ${v.mail.to}` : `Recorded for ${v.mail.to}`}>
                {v.mail.sent_at ? when(v.mail.sent_at) : `The mail did not go out: ${v.mail.error || 'mail is turned off on this server'}.`}
              </Notice>
            )}
            <Field label="Customer’s email" required><Input type="email" value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="name@company.com" /></Field>
            <Button variant={mailDone ? undefined : 'primary'} disabled={busy || !mailTo.trim()} onClick={mail} style={{ width: '100%', minHeight: '52px' }}>{mailDone ? 'Send again' : 'Send the signed Return DC'}</Button>
          </section>
        )}

        {collected.length > 0 && !open.length && mailDone && (
          <Notice tone="info" title="Take the laptops to the warehouse gate">
            Hand them in at the gate with Return DC <strong className="font-mono">{rdc}</strong>. The guard scans them in and the job leaves your list.
          </Notice>
        )}

        {collected.length > 0 && (
          <section className="c-pvl">
            <header className="c-pvl-h"><span className="c-pvl-n">✓</span><div><b>Collected · {collected.length}</b></div></header>
            {collected.map((l) => (
              <div key={l.item_id} className="c-pvl-done">
                <span className="font-mono">{l.ttspl_id || l.serial_number}</span>
                <span className="text-ink-3">{when(l.collected_at)}</span>
                <span className="c-pvl-thumbs">{(l.photos || []).slice(0, 6).map((p) => <img key={p.slot} src={podUrl(p.path)} alt={p.slot} />)}</span>
              </div>
            ))}
          </section>
        )}
      </div>
      <CollectLaterDrawer open={Boolean(laterFor)} onClose={() => setLaterFor(null)} onDone={() => { setLaterFor(null); load(); }} item={laterFor} />
    </FieldShell>
  );
}
