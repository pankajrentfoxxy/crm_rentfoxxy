import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import FieldShell from '../../../shells/FieldShell';
import {
  Button, EmptyState, Field, FlowSteps, Input, Notice, Segmented, Textarea,
} from '../../../components/carret';
import ScanField from '../../../components/ScanField';
import { usePermission } from '../../../hooks/usePermission';
import {
  getMyDeliveries, markCustomerRejected, markReached, sendWarehouseReturnOtp, submitDeliveryWithPod,
  verifySerialAndGenerateOtp, verifyWarehouseReturnOtp,
} from '../../sales-pipeline/salesPipelineApi';
import {
  BIG, CardHead, LaptopList, ProofCapture, emptyProof, errMsg, proofForm, useRunner, withGps,
} from './fieldDeliveryShared';
import { HandInCard, PickupCard, VendorCard } from './MyPickupCards';
import { TECH_TABS } from '../serve/serveShared';

/**
 * Field → My deliveries (the delivery technician's phone; also Support →
 * Technician). Every job assigned to me, one card each, and the card only
 * offers the next step:
 *
 *   Delivery   on the way → reached → scan the laptop (customer gets an OTP)
 *              → OTP + photo or signature → delivered. Refused at the door is
 *              one tap away; a refused challan walks the laptops back to the
 *              warehouse with the warehouse OTP.
 *   Pickup     reached → scan every laptop + the charger we sent → OTP + proof
 *              → collected → "Hand in" until the warehouse receives them.
 *   Vendor     return (VRTDC) or repair (VRDC) by hand: reached → the vendor
 *              signs → handed over.
 *
 * Same endpoints as the classic My Deliveries (which stays routed); warehouse
 * receive stays on the Return challan record. ?show=pickups opens on pickups
 * (Support's "My pickups").
 */
const kindOf = (dc) => {
  if (['vendor_return', 'vendor_repair'].includes(dc.dc_purpose)) return 'vendor';
  if (dc.movement_type === 'return') return 'pickup';
  return 'delivery';
};

function DeliveryCard({ dc, onChanged }) {
  const { hasPermission } = usePermission();
  const canAct = hasPermission('technician_bucket', 'edit');
  const [serial, setSerial] = useState('');
  const [otp, setOtp] = useState('');
  const [proof, setProof] = useState(emptyProof());
  const [notes, setNotes] = useState('');
  const [refuse, setRefuse] = useState(null);
  const [whOtp, setWhOtp] = useState('');
  const [whAsked, setWhAsked] = useState(Boolean(dc.warehouse_return_otp_sent));
  const { busy, run } = useRunner(onChanged);

  const status = String(dc.status || '').toLowerCase();
  const stage = status === 'in_transit' ? 0 : status === 'reached' ? (dc.otp_pending ? 2 : 1) : 3;
  const steps = status === 'rejected' ? null : [['Reached'], ['Scan laptop'], ['OTP + proof']].map(([label], i) => ({
    key: label, label, state: i < stage ? 'done' : i === stage ? 'current' : 'todo',
  }));

  const reached = () => withGps((lat, lng) => run(() => markReached(dc.dc_number, { latitude: lat, longitude: lng }), 'Marked reached — scan the laptop next'));
  const verify = () => run(async () => {
    if (!serial.trim()) throw new Error('Scan or type the laptop’s TTSPL or serial');
    await verifySerialAndGenerateOtp(dc.dc_number, { serial_number: serial.trim() });
  }, 'Laptop matched — the customer has been sent an OTP');
  const deliver = () => run(async () => {
    if (!/^\d{4,8}$/.test(otp.trim())) throw new Error('Enter the OTP from the customer');
    if (proof.type === 'photo' && !proof.file) throw new Error('Take a photo');
    if (proof.type === 'esign' && !proof.esign) throw new Error('Take the customer’s signature');
    await submitDeliveryWithPod(dc.dc_number, proofForm(proof, { otp: otp.trim(), pod_type: proof.type, notes }));
  }, 'Delivered ✓');
  const doRefuse = () => run(async () => {
    if ((refuse?.reason || '').trim().length < 3) throw new Error('Why did the customer refuse?');
    await markCustomerRejected(dc.dc_number, { rejection_reason: refuse.reason.trim(), rejection_remarks: refuse.remarks?.trim() || undefined, source: 'technician' });
    setRefuse(null);
  }, 'Refusal recorded — bring the laptops back to the gate');
  const askWhOtp = () => run(async () => { await sendWarehouseReturnOtp(dc.dc_number); setWhAsked(true); }, 'The warehouse lead has the OTP');
  const giveBack = () => run(async () => { await verifyWarehouseReturnOtp(dc.dc_number, { otp: whOtp.trim() }); }, 'Handed back to the warehouse');

  return (
    <article className="c-card" style={{ padding: 'var(--d-pad-x)' }}>
      <CardHead dc={dc} kindLabel="Delivery" />
      {steps && <div style={{ marginTop: '12px' }}><FlowSteps steps={steps} /></div>}
      <LaptopList serials={dc.serials || []} />

      <div className="c-stack" style={{ marginTop: '14px', gap: '10px' }}>
        {!canAct && <Notice tone="info">View only — you cannot record deliveries.</Notice>}

        {canAct && status === 'in_transit' && (
          <Button variant="primary" onClick={reached} disabled={busy} style={BIG}>I have reached the customer</Button>
        )}

        {canAct && status === 'reached' && !dc.otp_pending && (
          <>
            <Field label="Scan the laptop you are handing over">
              <ScanField value={serial} onChange={setSerial} placeholder="TTSPL or serial" aria-label="Scan the laptop" disabled={busy} />
            </Field>
            <Button variant="primary" onClick={verify} disabled={busy || !serial.trim()} style={BIG}>Match laptop and send OTP</Button>
          </>
        )}

        {canAct && status === 'reached' && dc.otp_pending && (
          <>
            <Field label="OTP from the customer" required>
              <Input value={otp} inputMode="numeric" maxLength={8} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="font-mono" style={{ fontSize: '24px', letterSpacing: '6px', textAlign: 'center' }} />
            </Field>
            <ProofCapture value={proof} onChange={setProof} />
            <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Button variant="primary" onClick={deliver} disabled={busy} style={BIG}>{busy ? 'Saving…' : 'Confirm delivery'}</Button>
            <Field label="Customer did not get the OTP? Scan the laptop again">
              <ScanField value={serial} onChange={setSerial} placeholder="TTSPL or serial" aria-label="Scan the laptop again" disabled={busy} />
            </Field>
            <Button variant="quiet" onClick={verify} disabled={busy || !serial.trim()}>Send the OTP again</Button>
          </>
        )}

        {canAct && ['in_transit', 'reached'].includes(status) && (
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

        {status === 'rejected' && dc.warehouse_return_pending && (
          <>
            <Notice tone="warn" title="Refused — bring the laptops back">
              {dc.rejection_reason ? `Reason: ${dc.rejection_reason}. ` : ''}
              {dc.refusal_stage_label || 'Hand them to the guard at the gate, then to the warehouse.'}
            </Notice>
            {canAct && (
              <>
                {!whAsked && <Button onClick={askWhOtp} disabled={busy} style={{ minHeight: '48px' }}>Ask the warehouse lead for the OTP</Button>}
                <Field label="Warehouse OTP"><Input value={whOtp} inputMode="numeric" onChange={(e) => setWhOtp(e.target.value.replace(/\D/g, ''))} className="font-mono" /></Field>
                <Button variant="primary" onClick={giveBack} disabled={busy || !whOtp.trim()} style={BIG}>Handed back to the warehouse</Button>
                {whAsked && <Button variant="quiet" onClick={askWhOtp} disabled={busy}>Ask for the OTP again</Button>}
              </>
            )}
          </>
        )}
      </div>
    </article>
  );
}

const SHOW = ['all', 'deliveries', 'pickups', 'vendor'];
const SHOW_KIND = { deliveries: 'delivery', pickups: 'pickup', vendor: 'vendor' };

export default function MyDeliveriesPage() {
  const { hasPermission } = usePermission();
  // A support technician keeps the My work / Deliveries / My parts tabs.
  const tabs = hasPermission('support_tickets', 'view') ? TECH_TABS : [];
  const [params, setParams] = useSearchParams();
  const show = SHOW.includes(params.get('show')) ? params.get('show') : 'all';
  const [state, setState] = useState({ loading: true, rows: [], handIn: [], error: null });
  const load = useCallback(() => {
    getMyDeliveries()
      .then(({ data }) => setState({ loading: false, rows: data?.items || [], handIn: data?.hand_in || [], error: null }))
      .catch((e) => setState((s) => ({ ...s, loading: false, error: errMsg(e) || 'Could not load your deliveries.' })));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const count = (k) => state.rows.filter((dc) => kindOf(dc) === k).length;
  const rows = show === 'all' ? state.rows : state.rows.filter((dc) => kindOf(dc) === SHOW_KIND[show]);
  const showHandIn = (show === 'all' || show === 'pickups') && state.handIn.length > 0;
  const options = [
    { value: 'all', label: `All ${state.rows.length}` },
    { value: 'deliveries', label: `Deliveries ${count('delivery')}` },
    { value: 'pickups', label: `Pickups ${count('pickup') + state.handIn.length}` },
    { value: 'vendor', label: `Vendor ${count('vendor')}` },
  ];

  return (
    <FieldShell title={`My deliveries${state.rows.length ? ` · ${state.rows.length}` : ''}`} tabs={tabs}>
      <div className="c-stack" style={{ maxWidth: '40rem', margin: '0 auto' }}>
        <div style={{ overflowX: 'auto' }}>
          <Segmented label="Show" value={show} onChange={(v) => setParams(v === 'all' ? {} : { show: v }, { replace: true })} options={options} />
        </div>
        {show === 'pickups' && hasPermission('support_tickets', 'view') && (
          <Notice tone="info" title="Support pickups are in My work">
            A support ticket&apos;s laptops are collected one by one with the customer&apos;s OTP in <Link to="/carret/serve/my-work">My work</Link>.
            If the customer keeps a laptop, use &quot;Collect later&quot; on that job.
          </Notice>
        )}
        {state.loading && <EmptyState title="Loading…" />}
        {state.error && <Notice tone="crit">{state.error}</Notice>}
        {!state.loading && !state.error && !rows.length && !showHandIn && (
          <EmptyState title="Nothing here right now" body="Challans assigned to you appear once the gate lets them out; pickups once they are assigned to you." />
        )}
        {rows.map((dc) => {
          const k = kindOf(dc);
          if (k === 'pickup') return <PickupCard key={dc.dc_number} dc={dc} onChanged={load} />;
          if (k === 'vendor') return <VendorCard key={dc.dc_number} dc={dc} onChanged={load} />;
          return <DeliveryCard key={dc.dc_number} dc={dc} onChanged={load} />;
        })}
        {showHandIn && (
          <>
            <Notice tone="info" title="Hand in at the warehouse gate">
              The guard scans each laptop in, then the warehouse receives it. Rent stops only when the warehouse receives it — hand them in the same day.
            </Notice>
            {state.handIn.map((row) => <HandInCard key={row.dc_number} row={row} />)}
          </>
        )}
      </div>
    </FieldShell>
  );
}
