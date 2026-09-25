import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, DateTime, DocNumber, Drawer, EmptyState, Field, FormGrid, Input, KeyValue, Notice, Section,
  Segmented, Textarea,
} from '../../../components/carret';
import {
  adminDeliverOverride, getRefusedReturnUnits, markRejected, receiveRefusedReturn, sendDeliveryOtp,
  sendWarehouseReturnOtp, submitDeliveryWithPod, updateDcDeliveryDate, verifyWarehouseReturnOtp,
} from '../../sales-pipeline/salesPipelineApi';
import SignaturePadComponent from '../../sales-pipeline/components/SignaturePad';
import { usePermission } from '../../../hooks/usePermission';
import { pdfUrl } from '../sell/sellShared';
import { modeOf } from './ChallanDispatch';

/**
 * The last mile, on the one delivery routine (deliveryCompletionService):
 *
 * - by hand: send the customer an OTP, then the OTP plus a photo or signature
 *   closes it (POST /deliver — the same call the technician's phone makes);
 * - courier / porter: BlueDart closes it from tracking; anything else is
 *   confirmed here with a proof-of-delivery photo and a reason (admin-deliver);
 * - refused: the reason is recorded, the laptops wait at the gate, the guard
 *   scans them inward, and the warehouse signs them back into stock.
 *
 * The old screen's "Mark Delivered" and "Verify & Deliver" sent no proof and
 * the server refused them; nothing here can reach that dead end.
 */
const OUT = ['in_transit', 'shipped', 'reached'];
const ADMIN_DELIVER_ROLES = ['admin', 'manager', 'warehouse', 'support_tech', 'dispatch', 'super_admin'];

function ProofInput({ proof, setProof }) {
  return (
    <div className="c-stack" style={{ gap: '10px' }}>
      <Segmented label="Proof" value={proof.type} onChange={(type) => setProof({ type, file: null, esign: null })} options={[{ value: 'photo', label: 'Photo' }, { value: 'esign', label: 'Customer signature' }]} />
      {proof.type === 'photo' ? (
        <Field label="Photo of the delivered laptops or signed challan" required>
          <Input type="file" accept="image/*" capture="environment" onChange={(e) => setProof((p) => ({ ...p, file: e.target.files?.[0] || null }))} />
        </Field>
      ) : proof.esign ? (
        <div className="flex items-center" style={{ gap: '10px' }}>
          <img src={proof.esign} alt="Customer signature" style={{ height: 64, border: '1px solid var(--rule)', borderRadius: 'var(--d-radius)', background: 'var(--surface)' }} />
          <Button variant="quiet" onClick={() => setProof((p) => ({ ...p, esign: null }))}>Sign again</Button>
        </div>
      ) : (
        <SignaturePadComponent onSave={(esign) => setProof((p) => ({ ...p, esign }))} onCancel={() => setProof({ type: 'photo', file: null, esign: null })} />
      )}
    </div>
  );
}

export default function ChallanDelivery({ dc, head, detail, onChanged }) {
  const { hasPermission, user } = usePermission();
  const status = String(head.status || '').toLowerCase();
  const mode = modeOf(head);
  const role = user?.role;

  const canOtp = hasPermission('delivery_challans', 'edit');
  const canDeliverByHand = hasPermission('technician_bucket', 'edit');
  const canConfirm = ADMIN_DELIVER_ROLES.includes(role) || hasPermission('delivery_register_management', 'edit');
  const canRefuse = ['sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement', 'delivery_challans'].some((s) => hasPermission(s, 'edit'));
  const canReceive = ['delivery_challans', 'technician_bucket'].some((s) => hasPermission(s, 'edit'));
  const isAdmin = ['admin', 'super_admin'].includes(role);

  const [open, setOpen] = useState('');
  const [otp, setOtp] = useState('');
  const [shownOtp, setShownOtp] = useState(detail?.can_view_otp ? detail?.otp_code : null);
  const [proof, setProof] = useState({ type: 'photo', file: null, esign: null });
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { setShownOtp(detail?.can_view_otp ? detail?.otp_code : null); }, [detail]);

  const reset = () => { setOtp(''); setProof({ type: 'photo', file: null, esign: null }); setNotes(''); setReason(''); };
  const close = () => { setOpen(''); reset(); };
  const act = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); close(); onChanged?.(); } catch (e) { toast.error(e?.response?.data?.message || e.message || 'That did not work.'); } finally { setBusy(''); }
  };

  const sendOtp = async () => {
    setBusy('otp');
    try {
      const { data } = await sendDeliveryOtp(dc);
      if (data?.otp_visible) setShownOtp(data.otp_visible);
      toast.success(data?.message || 'OTP sent to the customer');
      onChanged?.();
    } catch (e) { toast.error(e?.response?.data?.message || 'Could not send the OTP.'); } finally { setBusy(''); }
  };

  const deliverByHand = () => act('deliver', async () => {
    if (!/^\d{4,8}$/.test(otp.trim())) throw new Error('Enter the OTP the customer received');
    if (proof.type === 'photo' && !proof.file) throw new Error('Attach a photo');
    if (proof.type === 'esign' && !proof.esign) throw new Error('Take the customer’s signature');
    const fd = new FormData();
    fd.append('otp', otp.trim());
    fd.append('pod_type', proof.type);
    fd.append('notes', notes);
    if (proof.file) fd.append('pod_photo', proof.file);
    if (proof.esign) fd.append('esign_data', proof.esign);
    await submitDeliveryWithPod(dc, fd);
  }, 'Delivered — rent and invoicing start from here');

  const confirmDelivery = () => act('confirm', async () => {
    if (!proof.file) throw new Error('Attach the proof-of-delivery photo');
    if (reason.trim().length < 3) throw new Error('Say how you know it was delivered');
    const fd = new FormData();
    fd.append('pod_photo', proof.file);
    fd.append('reason', reason.trim());
    fd.append('notes', notes);
    await adminDeliverOverride(dc, fd);
  }, 'Delivery confirmed');

  const refuse = () => act('refuse', async () => {
    if (reason.trim().length < 3) throw new Error('Give the customer’s reason');
    await markRejected(dc, { rejection_reason: reason.trim(), rejection_remarks: notes.trim() || undefined });
  }, 'Refusal recorded — the laptops come back through the gate');

  // --- rendering by status ---
  if (status === 'dispatch_ready' || status === 'pending') {
    return (
      <Section title="Delivery">
        <Notice tone="info" title="Not out yet">
          The challan is waiting at the gate. Delivery can be recorded once the guard has scanned it out.
        </Notice>
        {canRefuse && (
          <div style={{ marginTop: '12px' }}>
            <Button variant="quiet" onClick={() => setOpen('refuse')}>Customer refused before dispatch</Button>
          </div>
        )}
        <RefuseDrawer open={open === 'refuse'} onClose={close} reason={reason} setReason={setReason} notes={notes} setNotes={setNotes} onSave={refuse} busy={busy === 'refuse'} />
      </Section>
    );
  }

  if (OUT.includes(status)) {
    return (
      <Section title="Delivery">
        <div className="c-stack">
          <Notice tone="info" title={status === 'reached' ? 'The technician has reached the customer' : 'On the way'}>
            {mode === 'inhouse' && 'Send the customer an OTP. The OTP and a photo or signature close the delivery.'}
            {mode === 'courier' && (/blue\s*dart/i.test(head.courier_name || '') ? 'BlueDart tracking closes this delivery automatically when every AWB shows delivered. Confirm it by hand only if tracking is wrong.' : 'Confirm delivery with the courier’s proof of delivery.')}
            {mode === 'porter' && 'Confirm delivery with Porter’s proof of delivery.'}
          </Notice>
          <KeyValue items={[
            { label: 'Left the gate', value: <DateTime value={head.dispatched_at} /> },
            head.reached_at && { label: 'Reached', value: <DateTime value={head.reached_at} /> },
            { label: 'OTP sent', value: head.otp_sent_at ? <DateTime value={head.otp_sent_at} /> : 'Not yet' },
            shownOtp && { label: 'OTP (visible to you)', value: <DocNumber value={shownOtp} /> },
          ]}
          />
          <div className="flex flex-wrap" style={{ gap: '8px' }}>
            {mode === 'inhouse' && canOtp && <Button onClick={sendOtp} disabled={busy === 'otp'}>{busy === 'otp' ? 'Sending…' : (head.otp_sent_at ? 'Resend OTP' : 'Send OTP to customer')}</Button>}
            {mode === 'inhouse' && canDeliverByHand && <Button variant="primary" onClick={() => setOpen('hand')}>Deliver with OTP</Button>}
            {canConfirm && <Button variant={mode === 'inhouse' ? 'secondary' : 'primary'} onClick={() => setOpen('confirm')}>{mode === 'inhouse' ? 'Confirm without OTP (proof + reason)' : 'Confirm delivery'}</Button>}
            {canRefuse && <Button variant="quiet" onClick={() => setOpen('refuse')}>Customer refused</Button>}
          </div>
        </div>

        <Drawer
          open={open === 'hand'}
          onClose={close}
          title="Deliver with OTP"
          footer={<div className="flex justify-end" style={{ gap: '8px' }}><Button variant="quiet" onClick={close}>Cancel</Button><Button variant="primary" onClick={deliverByHand} disabled={busy === 'deliver'}>{busy === 'deliver' ? 'Saving…' : 'Mark delivered'}</Button></div>}
        >
          <FormGrid cols={1}>
            <Field label="OTP from the customer" required><Input value={otp} inputMode="numeric" maxLength={8} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="font-mono" /></Field>
            <ProofInput proof={proof} setProof={setProof} />
            <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </FormGrid>
        </Drawer>

        <Drawer
          open={open === 'confirm'}
          onClose={close}
          title="Confirm delivery"
          footer={<div className="flex justify-end" style={{ gap: '8px' }}><Button variant="quiet" onClick={close}>Cancel</Button><Button variant="primary" onClick={confirmDelivery} disabled={busy === 'confirm'}>{busy === 'confirm' ? 'Saving…' : 'Confirm delivered'}</Button></div>}
        >
          <FormGrid cols={1}>
            <Notice tone="warn">This is recorded as a manual confirmation against your name, with the photo and your reason.</Notice>
            <Field label="Proof-of-delivery photo" required>
              <Input type="file" accept="image/*" capture="environment" onChange={(e) => setProof({ type: 'photo', file: e.target.files?.[0] || null, esign: null })} />
            </Field>
            <Field label="How do you know it was delivered?" required hint="e.g. Porter POD received, customer confirmed on call."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </FormGrid>
        </Drawer>

        <RefuseDrawer open={open === 'refuse'} onClose={close} reason={reason} setReason={setReason} notes={notes} setNotes={setNotes} onSave={refuse} busy={busy === 'refuse'} />
      </Section>
    );
  }

  if (status === 'delivered') return <DeliveredView dc={dc} head={head} isAdmin={isAdmin} onChanged={onChanged} />;
  if (status === 'rejected') return <RefusedView dc={dc} head={head} canReceive={canReceive} onChanged={onChanged} />;
  if (status === 'cancelled') return <Section title="Delivery"><Notice tone="serious" title="Cancelled">This challan was cancelled; its laptops went back to stock.</Notice></Section>;
  return null;
}

function RefuseDrawer({ open, onClose, reason, setReason, notes, setNotes, onSave, busy }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Customer refused the delivery"
      footer={<div className="flex justify-end" style={{ gap: '8px' }}><Button variant="quiet" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Record refusal'}</Button></div>}
    >
      <FormGrid cols={1}>
        <Notice tone="info">The laptops are released from the order and wait at the gate. The guard scans them inward, then the warehouse signs them back into stock and a QC check is opened.</Notice>
        <Field label="Customer’s reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="Remarks"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </FormGrid>
    </Drawer>
  );
}

function DeliveredView({ dc, head, isAdmin, onChanged }) {
  const [date, setDate] = useState('');
  const [open, setOpen] = useState(false);
  const save = async () => {
    if (!date) { toast.error('Choose the date'); return; }
    try { await updateDcDeliveryDate(dc, { delivered_at: date }); toast.success('Delivery date corrected — rent start recalculated'); setOpen(false); onChanged?.(); } catch (e) { toast.error(e?.response?.data?.message || 'Could not change the date.'); }
  };
  return (
    <Section title="Delivered" actions={isAdmin && <Button variant="quiet" onClick={() => { setDate(String(head.delivered_at || '').slice(0, 10)); setOpen(true); }}>Correct the date</Button>}>
      <div className="c-stack">
        <KeyValue items={[
          { label: 'Delivered', value: <DateTime value={head.delivered_at} /> },
          { label: 'Proof', value: head.pod_type ? String(head.pod_type).replace(/_/g, ' ') : '—' },
          head.pod_photo_url && { label: 'Photo', value: <a href={pdfUrl(head.pod_photo_url)} target="_blank" rel="noreferrer">Open photo</a> },
          head.esign_url && { label: 'Signature', value: <a href={pdfUrl(head.esign_url)} target="_blank" rel="noreferrer">Open signature</a> },
          head.delivery_notes && { label: 'Notes', value: head.delivery_notes },
        ]}
        />
      </div>
      <Drawer open={open} onClose={() => setOpen(false)} title="Correct the delivery date" footer={<div className="flex justify-end" style={{ gap: '8px' }}><Button variant="quiet" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>}>
        <FormGrid cols={1}>
          <Notice tone="warn">The rent start date is worked out again from this.</Notice>
          <Field label="Delivered on"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </FormGrid>
      </Drawer>
    </Section>
  );
}

function RefusedView({ dc, head, canReceive, onChanged }) {
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState('');
  const [scans, setScans] = useState({});
  const [signer, setSigner] = useState('');
  const [remarks, setRemarks] = useState('');
  const [esign, setEsign] = useState(null);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState('');
  const { user } = usePermission();

  const load = () => getRefusedReturnUnits(dc).then(({ data }) => setInfo(data)).catch((e) => setInfo({ error: e?.response?.data?.message || 'Could not load the refused laptops.' }));
  useEffect(() => { load(); }, [dc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSigner(user?.name || ''); }, [user]);

  const units = info?.units || [];
  const received = info && !info.warehouse_return_pending && !info.error;
  const guardPending = Boolean(info?.guard_inward_pending);
  const allMatched = useMemo(() => units.every((u, i) => {
    const s = String(scans[i] || '').trim().toUpperCase();
    return s && [u.ttspl, u.ttspl_id, u.serial_number].filter(Boolean).map((x) => String(x).toUpperCase()).includes(s);
  }), [units, scans]);

  const receive = async () => {
    if (!allMatched) { toast.error('Scan every laptop'); return; }
    if (!esign) { toast.error('Sign to receive'); return; }
    setBusy('recv');
    try {
      await receiveRefusedReturn(dc, {
        esign_data: esign, signer_name: signer, remarks,
        units: units.map((u) => ({ ttspl: u.ttspl || u.ttspl_id, serial_number: u.serial_number })),
      });
      toast.success('Received back into stock — QC re-check opened');
      setOpen(''); load(); onChanged?.();
    } catch (e) { toast.error(e?.response?.data?.message || 'Could not receive the laptops.'); } finally { setBusy(''); }
  };
  const sendOtp = async () => {
    setBusy('otp');
    try { const { data } = await sendWarehouseReturnOtp(dc); toast.success(data?.otp_visible ? `OTP ${data.otp_visible}` : 'OTP sent to the warehouse lead'); } catch (e) { toast.error(e?.response?.data?.message || 'Could not send the OTP.'); } finally { setBusy(''); }
  };
  const verifyOtp = async () => {
    setBusy('votp');
    try { await verifyWarehouseReturnOtp(dc, { otp: otp.trim() }); toast.success('Received back into stock'); setOpen(''); load(); onChanged?.(); } catch (e) { toast.error(e?.response?.data?.message || 'Wrong OTP.'); } finally { setBusy(''); }
  };

  return (
    <Section title="Refused by the customer">
      <div className="c-stack">
        <KeyValue items={[
          { label: 'Refused', value: <DateTime value={head.rejected_at} /> },
          { label: 'Reason', value: head.rejection_reason },
          head.rejection_remarks && { label: 'Remarks', value: head.rejection_remarks },
          { label: 'Guard inward scan', value: info?.guard_inward_at ? <DateTime value={info.guard_inward_at} /> : (received ? '—' : 'Waiting') },
          received && { label: 'Received by', value: [head.warehouse_receiver_name, head.warehouse_received_at && new Date(head.warehouse_received_at).toLocaleString()].filter(Boolean).join(' · ') },
        ]}
        />
        {info?.error && <Notice tone="warn">{info.error}</Notice>}
        {received && <Notice tone="good" title="Back in stock">The laptops were received and sent for a QC re-check. The sales order can now be cancelled if needed.</Notice>}
        {!received && !info?.error && guardPending && <Notice tone="warn" title="Waiting for the guard">The guard must scan these laptops inward at the gate before the warehouse can receive them.</Notice>}
        {!received && !info?.error && !guardPending && canReceive && (
          <div className="flex flex-wrap" style={{ gap: '8px' }}>
            <Button variant="primary" onClick={() => setOpen('recv')}>Receive back (scan + sign)</Button>
            <Button variant="quiet" onClick={() => setOpen('otp')}>Use the warehouse OTP instead</Button>
          </div>
        )}
      </div>

      <Drawer
        open={open === 'recv'}
        onClose={() => setOpen('')}
        title="Receive the refused laptops"
        width="40rem"
        footer={<div className="flex justify-end" style={{ gap: '8px' }}><Button variant="quiet" onClick={() => setOpen('')}>Cancel</Button><Button variant="primary" onClick={receive} disabled={busy === 'recv' || !allMatched || !esign}>{busy === 'recv' ? 'Saving…' : 'Receive into stock'}</Button></div>}
      >
        {!units.length ? <EmptyState title="No laptop to receive" /> : (
          <div className="c-stack">
            {units.map((u, i) => {
              const s = String(scans[i] || '').trim().toUpperCase();
              const ok = s && [u.ttspl, u.ttspl_id, u.serial_number].filter(Boolean).map((x) => String(x).toUpperCase()).includes(s);
              return (
                <Field key={u.ttspl || u.serial_number || i} label={`${u.ttspl || u.ttspl_id || ''} · ${u.serial_number || ''}`} hint={[u.brand, u.model, u.processor, u.ram, u.storage].filter(Boolean).join(' · ')} error={s && !ok ? 'Does not match this laptop' : null}>
                  <Input value={scans[i] || ''} onChange={(e) => setScans((x) => ({ ...x, [i]: e.target.value }))} placeholder="Scan the TTSPL or serial" className="font-mono" />
                </Field>
              );
            })}
            <Field label="Received by"><Input value={signer} onChange={(e) => setSigner(e.target.value)} /></Field>
            <Field label="Remarks"><Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
            {esign
              ? <div className="flex items-center" style={{ gap: '10px' }}><img src={esign} alt="Signature" style={{ height: 64, border: '1px solid var(--rule)', borderRadius: 'var(--d-radius)', background: 'var(--surface)' }} /><Button variant="quiet" onClick={() => setEsign(null)}>Sign again</Button></div>
              : <SignaturePadComponent onSave={setEsign} onCancel={() => setEsign(null)} />}
          </div>
        )}
      </Drawer>

      <Drawer
        open={open === 'otp'}
        onClose={() => setOpen('')}
        title="Receive with the warehouse OTP"
        footer={<div className="flex justify-end" style={{ gap: '8px' }}><Button variant="quiet" onClick={() => setOpen('')}>Cancel</Button><Button variant="primary" onClick={verifyOtp} disabled={busy === 'votp' || !otp.trim()}>Confirm</Button></div>}
      >
        <FormGrid cols={1}>
          <Button onClick={sendOtp} disabled={busy === 'otp'}>{busy === 'otp' ? 'Sending…' : 'Send the OTP to the warehouse lead'}</Button>
          <Field label="OTP"><Input value={otp} inputMode="numeric" onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="font-mono" /></Field>
        </FormGrid>
      </Drawer>
    </Section>
  );
}
