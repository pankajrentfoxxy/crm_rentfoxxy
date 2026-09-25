import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import FieldShell from '../../../shells/FieldShell';
import {
  Button, DocNumber, EmptyState, Field, Input, Notice, Segmented, Textarea,
} from '../../../components/carret';
import {
  getMyDeliveries, markCustomerRejected, markReached, sendWarehouseReturnOtp, submitDeliveryWithPod,
  verifySerialAndGenerateOtp, verifyWarehouseReturnOtp,
} from '../../sales-pipeline/salesPipelineApi';
import { formatDeliveryAddressLine, deliveryAddressPhone } from '../../sales-pipeline/salesPipelineUtils';
import SignaturePadComponent from '../../sales-pipeline/components/SignaturePad';

/**
 * Field → My deliveries (the delivery technician's phone).
 *
 * One card per challan, and the card only ever offers the next step:
 * on the way → reached → scan the laptop (the customer gets an OTP) → OTP plus a
 * photo or signature → delivered. Refused at the door is one tap away at every
 * step, and a refused challan then walks the technician through handing the
 * laptops back to the warehouse.
 *
 * Same endpoints as the old My Deliveries page. Return pickups and vendor
 * returns belong to later processes and still open the old page.
 */
function Card({ dc, onChanged }) {
  const [serial, setSerial] = useState('');
  const [otp, setOtp] = useState('');
  const [proof, setProof] = useState({ type: 'photo', file: null, esign: null, preview: null });
  const [notes, setNotes] = useState('');
  const [refuse, setRefuse] = useState(null);
  const [whOtp, setWhOtp] = useState('');
  const [busy, setBusy] = useState(false);

  const status = String(dc.status || '').toLowerCase();
  const otherFlow = ['vendor_return', 'return_pickup'].includes(dc.dc_purpose) || dc.movement_type === 'return' || /^VRTDC|^RDC/i.test(dc.dc_number || '');
  const addr = formatDeliveryAddressLine(dc.delivery_address);
  const phone = deliveryAddressPhone(dc.delivery_address, dc.customer_phone);
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr || dc.customer_name || '')}`;

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); onChanged(); } catch (e) { toast.error(e?.response?.data?.message || e.message || 'That did not work.'); } finally { setBusy(false); }
  };

  const reached = () => {
    const send = (lat, lng) => run(() => markReached(dc.dc_number, { latitude: lat, longitude: lng }), 'Marked reached — scan the laptop next');
    if (!navigator.geolocation) { send(null, null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => send(String(p.coords.latitude), String(p.coords.longitude)),
      () => send(null, null),
      { timeout: 10000, maximumAge: 60000 }
    );
  };
  const verify = () => run(async () => {
    if (!serial.trim()) throw new Error('Scan or type the laptop’s TTSPL or serial');
    await verifySerialAndGenerateOtp(dc.dc_number, { serial_number: serial.trim() });
  }, 'Laptop matched — the customer has been sent an OTP');
  const deliver = () => run(async () => {
    if (!/^\d{4,8}$/.test(otp.trim())) throw new Error('Enter the OTP from the customer');
    if (proof.type === 'photo' && !proof.file) throw new Error('Take a photo');
    if (proof.type === 'esign' && !proof.esign) throw new Error('Take the customer’s signature');
    const fd = new FormData();
    fd.append('otp', otp.trim());
    fd.append('pod_type', proof.type);
    fd.append('notes', notes);
    if (proof.file) fd.append('pod_photo', proof.file);
    if (proof.esign) fd.append('esign_data', proof.esign);
    await submitDeliveryWithPod(dc.dc_number, fd);
  }, 'Delivered ✓');
  const doRefuse = () => run(async () => {
    if ((refuse?.reason || '').trim().length < 3) throw new Error('Why did the customer refuse?');
    await markCustomerRejected(dc.dc_number, { rejection_reason: refuse.reason.trim(), rejection_remarks: refuse.remarks?.trim() || undefined, source: 'technician' });
    setRefuse(null);
  }, 'Refusal recorded — bring the laptops back to the gate');
  const askWhOtp = () => run(async () => { await sendWarehouseReturnOtp(dc.dc_number); }, 'The warehouse lead has the OTP');
  const giveBack = () => run(async () => { await verifyWarehouseReturnOtp(dc.dc_number, { otp: whOtp.trim() }); }, 'Handed back to the warehouse');

  const onPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => setProof((p) => ({ ...p, file, preview: ev.target.result }));
    r.readAsDataURL(file);
  };

  return (
    <article className="c-card" style={{ padding: 'var(--d-pad-x)' }}>
      <div className="flex items-baseline flex-wrap" style={{ gap: '8px' }}>
        <DocNumber value={dc.dc_number} />
        <span className="ml-auto font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>{status.replace(/_/g, ' ')}</span>
      </div>
      <div className="font-ui text-ink" style={{ fontWeight: 600, marginTop: '6px' }}>{dc.customer_name}</div>
      {addr && <div className="font-ui text-ink-2" style={{ fontSize: 'var(--d-sm)' }}>{addr}</div>}
      <div className="flex flex-wrap" style={{ gap: '8px', marginTop: '10px' }}>
        {phone && <a className="c-btn" href={`tel:${phone}`}>Call {phone}</a>}
        <a className="c-btn" href={maps} target="_blank" rel="noreferrer">Map</a>
      </div>
      {(dc.serials || []).length > 0 && (
        <ul className="list-none p-0 m-0 font-mono text-ink-2" style={{ marginTop: '10px', fontSize: 'var(--d-sm)', display: 'grid', gap: '2px' }}>
          {dc.serials.map((s) => <li key={s.ttspl || s.serial_number}>{s.ttspl} · {s.serial_number} · {[s.brand, s.model].filter(Boolean).join(' ')}</li>)}
        </ul>
      )}

      <div className="c-stack" style={{ marginTop: '14px', gap: '10px' }}>
        {otherFlow && <Notice tone="info" title="Return or vendor pickup">This one is handled on the classic screen. <a href="/sales-pipeline/my-deliveries">Open it there</a>.</Notice>}

        {!otherFlow && status === 'in_transit' && (
          <Button variant="primary" onClick={reached} disabled={busy}>I have reached the customer</Button>
        )}

        {!otherFlow && status === 'reached' && !dc.otp_pending && (
          <>
            <Field label="Scan the laptop you are handing over">
              <Input value={serial} onChange={(e) => setSerial(e.target.value)} className="font-mono" placeholder="TTSPL or serial" autoComplete="off" />
            </Field>
            <Button variant="primary" onClick={verify} disabled={busy}>Match laptop and send OTP</Button>
          </>
        )}

        {!otherFlow && status === 'reached' && dc.otp_pending && (
          <>
            <Field label="OTP from the customer"><Input value={otp} inputMode="numeric" maxLength={8} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="font-mono" /></Field>
            <Segmented label="Proof" value={proof.type} onChange={(type) => setProof({ type, file: null, esign: null, preview: null })} options={[{ value: 'photo', label: 'Photo' }, { value: 'esign', label: 'Signature' }]} />
            {proof.type === 'photo' ? (
              <>
                <Input type="file" accept="image/*" capture="environment" onChange={onPhoto} />
                {proof.preview && <img src={proof.preview} alt="Proof of delivery" style={{ maxHeight: 160, borderRadius: 'var(--d-radius)', border: '1px solid var(--rule)' }} />}
              </>
            ) : proof.esign
              ? <img src={proof.esign} alt="Customer signature" style={{ height: 80, background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--d-radius)' }} />
              : <SignaturePadComponent onSave={(esign) => setProof((p) => ({ ...p, esign }))} onCancel={() => setProof({ type: 'photo', file: null, esign: null, preview: null })} />}
            <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Button variant="primary" onClick={deliver} disabled={busy}>{busy ? 'Saving…' : 'Confirm delivery'}</Button>
            <Button variant="quiet" onClick={verify} disabled={busy || !serial.trim()}>Resend OTP (scan again first)</Button>
          </>
        )}

        {!otherFlow && ['in_transit', 'reached'].includes(status) && (
          refuse ? (
            <div className="c-stack" style={{ gap: '8px' }}>
              <Field label="Why did the customer refuse?" required><Textarea rows={2} value={refuse.reason || ''} onChange={(e) => setRefuse((r) => ({ ...r, reason: e.target.value }))} /></Field>
              <Field label="Remarks"><Input value={refuse.remarks || ''} onChange={(e) => setRefuse((r) => ({ ...r, remarks: e.target.value }))} /></Field>
              <div className="flex" style={{ gap: '8px' }}>
                <Button variant="primary" onClick={doRefuse} disabled={busy}>Record refusal</Button>
                <Button variant="quiet" onClick={() => setRefuse(null)}>Back</Button>
              </div>
            </div>
          ) : <Button variant="quiet" onClick={() => setRefuse({})}>Customer refused</Button>
        )}

        {!otherFlow && status === 'rejected' && dc.warehouse_return_pending && (
          <>
            <Notice tone="warn" title="Refused — bring the laptops back">
              {dc.refusal_stage_label || 'Hand them to the guard at the gate, then to the warehouse.'}
            </Notice>
            <Button onClick={askWhOtp} disabled={busy}>Ask the warehouse lead for the OTP</Button>
            <Field label="Warehouse OTP"><Input value={whOtp} inputMode="numeric" onChange={(e) => setWhOtp(e.target.value.replace(/\D/g, ''))} className="font-mono" /></Field>
            <Button variant="primary" onClick={giveBack} disabled={busy || !whOtp.trim()}>Handed back to the warehouse</Button>
          </>
        )}
      </div>
    </article>
  );
}

export default function MyDeliveriesPage() {
  const [state, setState] = useState({ loading: true, rows: [], error: null });
  const load = useCallback(() => {
    getMyDeliveries()
      .then(({ data }) => setState({ loading: false, rows: data?.items || [], error: null }))
      .catch((e) => setState({ loading: false, rows: [], error: e?.response?.data?.message || 'Could not load your deliveries.' }));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  return (
    <FieldShell title={`My deliveries${state.rows.length ? ` · ${state.rows.length}` : ''}`}>
      <div className="c-stack" style={{ maxWidth: '40rem', margin: '0 auto' }}>
        {state.loading && <EmptyState title="Loading…" />}
        {state.error && <Notice tone="crit">{state.error}</Notice>}
        {!state.loading && !state.error && !state.rows.length && <EmptyState title="Nothing to deliver right now" body="Challans assigned to you appear here once the gate lets them out." />}
        {state.rows.map((dc) => <Card key={dc.dc_number} dc={dc} onChanged={load} />)}
      </div>
    </FieldShell>
  );
}
