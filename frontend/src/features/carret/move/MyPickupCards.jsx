import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, DateTime, DocNumber, Field, FlowSteps, Input, Notice, Textarea,
} from '../../../components/carret';
import ScanField from '../../../components/ScanField';
import { usePermission } from '../../../hooks/usePermission';
import {
  markReached, submitDeliveryWithPod, verifySerialAndGenerateOtp,
} from '../../sales-pipeline/salesPipelineApi';
import { fetchReturnDcChargers, scanReturnDcCharger } from '../../dispatch-charger/dispatchChargerApi';
import DamageReportDrawer from '../serve/DamageReportDrawer';
import {
  BIG, CardHead, LaptopList, LaptopScanList, ProofCapture, emptyProof, errMsg, proofForm, useRunner, withGps,
} from './fieldDeliveryShared';

/**
 * Field → My deliveries: the return pickup (RDC) and the vendor hand-over
 * (VRTDC return to vendor, VRDC repair to vendor) — what used to open the
 * classic screen. Same endpoints as that screen; the server re-checks every
 * rule (the challan is mine, every laptop scanned, charger back or declared).
 *
 * Pickup: reached → scan every laptop (+ the charger we sent) → customer OTP
 *   → OTP + photo/signature → collected → hand in at the gate (list below).
 * Vendor: reached → receiver signs (+ photo) → handed to the vendor.
 */

/** One laptop's charger kit: TTSPL + adapter (+ cable) scans. */
function ChargerUnitForm({ rdcNumber, unit, onDone, disabled }) {
  const [ttspl, setTtspl] = useState('');
  const [adapter, setAdapter] = useState('');
  const [cable, setCable] = useState('');
  const [err, setErr] = useState(null);
  const { busy, run } = useRunner(onDone);
  const needsCable = Boolean(unit.charger?.cable_label || unit.charger?.needs_both_kit_scans);
  const submit = () => {
    setErr(null);
    if (!ttspl.trim() || !adapter.trim() || (needsCable && !cable.trim())) {
      setErr(needsCable ? 'Scan the laptop, the charger and the power cable' : 'Scan the laptop and the charger');
      return;
    }
    run(() => scanReturnDcCharger(rdcNumber, { ttspl_scan: ttspl, adapter_scan: adapter, charger_scan: adapter, cable_scan: cable })
      .catch((e) => { setErr(errMsg(e)); throw e; }), 'Charger matched');
  };
  return (
    <div className="c-stack" style={{ gap: '6px', paddingTop: '8px', borderTop: '1px solid var(--rule)' }}>
      <div className="font-ui" style={{ fontSize: 'var(--d-sm)' }}>
        <span className="font-mono">{unit.ttspl_id || 'Laptop'}</span> — charger {unit.charger?.adapter_label || unit.charger?.prt_id || 'we sent'}
        {needsCable ? ` · cable ${unit.charger?.cable_label || ''}` : ''}
      </div>
      <ScanField value={ttspl} onChange={setTtspl} placeholder="Scan the laptop TTSPL" aria-label="Scan laptop TTSPL" disabled={disabled} />
      <ScanField value={adapter} onChange={setAdapter} placeholder="Scan the charger we sent" aria-label="Scan charger" disabled={disabled} />
      {needsCable && <ScanField value={cable} onChange={setCable} placeholder="Scan the power cable we sent" aria-label="Scan power cable" disabled={disabled} />}
      {err && <Notice tone="crit">{err}</Notice>}
      <Button variant="primary" onClick={submit} disabled={disabled || busy} style={BIG}>{busy ? 'Checking…' : 'Check the charger'}</Button>
    </div>
  );
}

/**
 * The chargers we sent with the laptops on this Return DC. Reports how many
 * still need a scan; a charger that is not coming back is declared with a
 * reason (sent with the pickup, noted on the challan).
 */
function ReturnChargerScans({ rdcNumber, canScan, missingReason, onMissingReason, onPending }) {
  const [units, setUnits] = useState(null);
  const load = useCallback(() => {
    fetchReturnDcChargers(rdcNumber)
      .then(({ data }) => setUnits((data.data?.units || []).filter((u) => u.required)))
      .catch(() => setUnits([]));
  }, [rdcNumber]);
  useEffect(() => { load(); }, [load]);
  const pending = (units || []).filter((u) => !u.scanned);
  useEffect(() => { if (units) onPending(pending.length); }, [units, pending.length, onPending]);

  if (units === null) return <div className="text-ink-3 font-ui" style={{ fontSize: 'var(--d-sm)' }}>Checking which chargers we sent…</div>;
  if (!units.length) return null;
  return (
    <div className="c-stack" style={{ gap: '8px' }}>
      <div className="flex items-baseline">
        <strong className="font-ui">Chargers we sent</strong>
        <span className="ml-auto font-mono tabular-nums text-ink-2">{units.length - pending.length} / {units.length}</span>
      </div>
      {units.filter((u) => u.scanned).map((u) => (
        <div key={u.pickup_item_id} className="font-ui" style={{ color: 'var(--alert-good)', fontSize: 'var(--d-sm)' }}>
          ✓ <span className="font-mono">{u.ttspl_id}</span> — charger {u.charger?.charger_label || 'matched'}
        </div>
      ))}
      {canScan
        ? pending.map((u) => <ChargerUnitForm key={u.pickup_item_id} rdcNumber={rdcNumber} unit={u} onDone={load} />)
        : pending.length > 0 && <Notice tone="warn">You cannot scan chargers here — ask your lead, or say below why the charger is not coming back.</Notice>}
      {pending.length > 0 && (
        <Field label="Charger not coming back? Say why" hint="Only if the customer does not have it. It is noted on the challan for the warehouse.">
          <Input value={missingReason} onChange={(e) => onMissingReason(e.target.value)} placeholder="e.g. customer lost it" />
        </Field>
      )}
    </div>
  );
}

export function PickupCard({ dc, onChanged }) {
  const { hasPermission } = usePermission();
  const canAct = hasPermission('technician_bucket', 'edit');
  const canScanCharger = ['dispatch_charger', 'support_tickets', 'delivery_my_deliveries'].some((s) => hasPermission(s, 'view'));
  const canDamage = ['damage_charges', 'support_tickets', 'return_dc'].some((s) => hasPermission(s, 'create'));
  const [scanned, setScanned] = useState({});
  const [chargersPending, setChargersPending] = useState(0);
  const [missingReason, setMissingReason] = useState('');
  const [otp, setOtp] = useState('');
  const [proof, setProof] = useState(emptyProof());
  const [notes, setNotes] = useState('');
  const [rescan, setRescan] = useState(false);
  const [damageFor, setDamageFor] = useState(null);
  const { busy, run } = useRunner(onChanged);

  const status = String(dc.status || '').toLowerCase();
  const serials = dc.serials || [];
  const allScanned = serials.length > 0 && Object.keys(scanned).length === serials.length;
  const chargerOk = chargersPending === 0 || missingReason.trim().length >= 3;
  // A part return (RPDC) carries parts, not laptops — the Parts desk closes it.
  const isPart = dc.dc_purpose === 'part_return';
  const live = ['in_transit', 'reached'].includes(status) && !isPart;
  const stage = !live ? -1 : status === 'in_transit' ? 0 : ((!dc.otp_pending || rescan) ? 1 : 2);
  const steps = [['Reached'], ['Scan laptops'], ['Customer OTP'], ['Hand in']].map(([label], i) => ({
    key: label, label, state: i < stage ? 'done' : i === stage ? 'current' : 'todo',
  }));

  const reached = () => withGps((lat, lng) => run(() => markReached(dc.dc_number, { latitude: lat, longitude: lng }), 'Marked reached — scan each laptop'));
  const sendOtp = () => run(async () => {
    if (!allScanned) throw new Error(`Scan every laptop — ${Object.keys(scanned).length} of ${serials.length}`);
    const codes = Object.values(scanned);
    await verifySerialAndGenerateOtp(dc.dc_number, { serial_numbers: codes, serial_number: codes[0] });
    setRescan(false);
  }, 'All laptops matched — the customer has an OTP');
  const collect = () => run(async () => {
    if (!/^\d{4,8}$/.test(otp.trim())) throw new Error('Enter the OTP from the customer');
    if (!chargerOk) throw new Error('Scan the charger we sent, or say why it is not coming back');
    if (proof.type === 'photo' && !proof.file) throw new Error('Take a photo of the laptops you collected');
    if (proof.type === 'esign' && !proof.esign) throw new Error('Take the customer’s signature');
    await submitDeliveryWithPod(dc.dc_number, proofForm(proof, {
      otp: otp.trim(),
      pod_type: proof.type,
      notes: notes.trim(),
      charger_missing_reason: chargersPending ? missingReason.trim() : '',
    }));
  }, 'Collected — take the laptops to the warehouse gate');

  return (
    <article className="c-card" style={{ padding: 'var(--d-pad-x)' }}>
      <CardHead dc={dc} kindLabel="Pickup" />
      <div style={{ marginTop: '12px' }}><FlowSteps steps={steps} /></div>
      {stage !== 1 && <LaptopList serials={serials} />}

      <div className="c-stack" style={{ marginTop: '14px', gap: '12px' }}>
        {!canAct && <Notice tone="info">View only — you cannot record pickups.</Notice>}
        {isPart && <Notice tone="info" title="Part pickup">Collect the parts listed on the challan; the Parts desk records them received.</Notice>}
        {!isPart && !['in_transit', 'reached'].includes(status) && (
          <Notice tone="warn" title={`This pickup is ${status.replace(/_/g, ' ')}`}>Call your lead before doing anything with these laptops.</Notice>
        )}

        {canAct && stage === 0 && (
          <>
            <Button variant="primary" onClick={reached} disabled={busy} style={BIG}>I have reached the customer</Button>
            <Notice tone="info">Customer not there or not handing over? Call your lead — a pickup is rescheduled or cancelled by the lead, not refused here.</Notice>
          </>
        )}

        {canAct && stage === 1 && (
          <>
            <LaptopScanList serials={serials} scanned={scanned} onScanned={setScanned} disabled={busy} />
            <ReturnChargerScans rdcNumber={dc.dc_number} canScan={canScanCharger} missingReason={missingReason} onMissingReason={setMissingReason} onPending={setChargersPending} />
            <Button variant="primary" onClick={sendOtp} disabled={busy || !allScanned} style={BIG}>
              {allScanned ? 'Send the customer an OTP' : `Scan every laptop (${Object.keys(scanned).length} of ${serials.length})`}
            </Button>
            {rescan && <Button variant="quiet" onClick={() => setRescan(false)}>Back to the OTP</Button>}
          </>
        )}

        {canAct && stage === 2 && (
          <>
            <ReturnChargerScans rdcNumber={dc.dc_number} canScan={canScanCharger} missingReason={missingReason} onMissingReason={setMissingReason} onPending={setChargersPending} />
            <Field label="OTP the customer received" required>
              <Input value={otp} inputMode="numeric" maxLength={8} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="font-mono" style={{ fontSize: '24px', letterSpacing: '6px', textAlign: 'center' }} />
            </Field>
            <ProofCapture value={proof} onChange={setProof} />
            <Field label="Notes (condition, accessories)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Button variant="primary" onClick={collect} disabled={busy || !chargerOk} style={BIG}>{busy ? 'Saving…' : 'Collected — confirm pickup'}</Button>
            <Button variant="quiet" onClick={() => { setScanned({}); setRescan(true); }} disabled={busy}>Send the OTP again (scan the laptops again)</Button>
          </>
        )}

        {canDamage && stage > 0 && serials.length > 0 && (
          <div className="c-stack" style={{ gap: '6px' }}>
            <strong className="font-ui" style={{ fontSize: 'var(--d-sm)' }}>Damaged or missing parts?</strong>
            {serials.map((s) => (
              <Button key={`${s.ttspl}-${s.serial_number}`} variant="quiet" onClick={() => setDamageFor(s)} style={{ minHeight: '48px', justifyContent: 'flex-start' }}>
                Report damage on <span className="font-mono">&nbsp;{s.ttspl || s.serial_number}</span>
              </Button>
            ))}
          </div>
        )}
      </div>

      <DamageReportDrawer
        open={Boolean(damageFor)}
        onClose={() => setDamageFor(null)}
        onDone={() => setDamageFor(null)}
        laptop={damageFor ? { asset_code: damageFor.ttspl || damageFor.serial_number } : null}
        source="return_pickup"
        returnDcNumber={dc.dc_number}
        customerId={dc.customer_id}
      />
    </article>
  );
}

export function VendorCard({ dc, onChanged }) {
  const { hasPermission } = usePermission();
  const canAct = hasPermission('technician_bucket', 'edit');
  const [proof, setProof] = useState(emptyProof());
  const [receiver, setReceiver] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, run } = useRunner(onChanged);
  const status = String(dc.status || '').toLowerCase();
  const isRepair = dc.dc_purpose === 'vendor_repair';
  const stage = status === 'reached' ? 1 : 0;
  const steps = [['Reached the vendor'], ['Vendor signs']].map(([label], i) => ({
    key: label, label, state: i < stage ? 'done' : i === stage ? 'current' : 'todo',
  }));

  const reached = () => withGps((lat, lng) => run(() => markReached(dc.dc_number, { latitude: lat, longitude: lng }), 'Marked reached — get the vendor’s signature'));
  const handOver = () => run(async () => {
    if (!proof.esign) throw new Error('The vendor’s signature is required');
    await submitDeliveryWithPod(dc.dc_number, proofForm(proof, {
      pod_type: 'esign',
      receiver_name: receiver.trim(),
      notes: notes.trim(),
    }));
  }, 'Handed to the vendor');

  return (
    <article className="c-card" style={{ padding: 'var(--d-pad-x)' }}>
      <CardHead dc={dc} kindLabel="Vendor" />
      <div style={{ marginTop: '12px' }}><FlowSteps steps={steps} /></div>
      <LaptopList serials={dc.serials || []} />
      <div className="c-stack" style={{ marginTop: '14px', gap: '12px' }}>
        {!canAct && <Notice tone="info">View only — you cannot record hand-overs.</Notice>}
        {canAct && stage === 0 && <Button variant="primary" onClick={reached} disabled={busy} style={BIG}>I have reached the vendor</Button>}
        {canAct && stage === 1 && (
          <>
            <Notice tone="info">
              Hand over every laptop listed above{isRepair ? ' for repair' : ''}. Nothing else leaves with you — a replacement from the vendor comes back through the gate.
            </Notice>
            <Field label="Received by"><Input value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="Name of the person at the vendor" /></Field>
            <ProofCapture mode="vendor" value={proof} onChange={setProof} />
            <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Button variant="primary" onClick={handOver} disabled={busy || !proof.esign} style={BIG}>{busy ? 'Saving…' : 'Handed to the vendor'}</Button>
          </>
        )}
      </div>
    </article>
  );
}

/** Collected, not yet received by the warehouse: gate, then warehouse. */
export function HandInCard({ row }) {
  const tick = (v) => (v
    ? <span style={{ color: 'var(--alert-good)' }}>✓ <DateTime value={v} /></span>
    : <span className="text-ink-3">not yet</span>);
  return (
    <article className="c-card" style={{ padding: 'var(--d-pad-x)' }}>
      <div className="flex items-baseline flex-wrap" style={{ gap: '8px' }}>
        <DocNumber value={row.dc_number} />
        <span className="ml-auto font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>collected <DateTime value={row.picked_up_at} /></span>
      </div>
      <div className="font-ui text-ink" style={{ fontWeight: 600, marginTop: '6px' }}>{row.customer_name}</div>
      <table className="font-ui" style={{ width: '100%', marginTop: '8px', fontSize: 'var(--d-sm)', borderCollapse: 'collapse' }}>
        <thead><tr className="text-ink-3"><th align="left">Laptop</th><th align="left">Gate</th><th align="left">Warehouse</th></tr></thead>
        <tbody>
          {row.laptops.map((l) => (
            <tr key={l.id} style={{ borderTop: '1px solid var(--rule)' }}>
              <td className="font-mono" style={{ padding: '6px 0' }}>{l.ttspl || l.serial_number}</td>
              <td>{tick(l.gate_inward_at)}</td>
              <td>{tick(l.warehouse_received_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
