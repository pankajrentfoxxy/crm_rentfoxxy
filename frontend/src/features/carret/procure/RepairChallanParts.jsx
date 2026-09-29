import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, ConfirmDialog, DateTime, Drawer, Field, FormGrid, Input, KeyValue, Money, Notice, Section, Segmented, SignaturePad, Textarea,
} from '../../../components/carret';
import {
  decideReplacement, downloadRepairRequestPdf, fetchRepairMailPreview, markVendorKept, previewVendorKept, receiveVendorRepairBack,
  sendAccountsVrdcEwayMail, sendRepairMail, updateRepairRequestDetails, uploadVrdcEway,
} from '../../floor-pipeline/vendorRepairApi';
import { parseVrdcItemConfig } from '../../floor-pipeline/vendorRepairUi';
import { addDaysYmd, issueTypeLabel, todayIst } from '../../floor-pipeline/repairIssueTypes';
import { DEFAULT_CONDITION, requiresConfigCapture } from '../../../constants/laptopConditions';
import { errMsg } from './procureShared';
import { docUrl, prettyYmd, ymdOf } from './repairShared';

/* ------------------------------------------------------------------ */
/* Vendor mail & rent (claude/carret-vendor-repair.md step 2)          */
/* ------------------------------------------------------------------ */

/**
 * Mailing the vendor sends the repair-request PDF and stops rent from the stop
 * date on the laptops rented from this vendor. Required before the challan
 * can be signed for dispatch (server rule).
 */
export function RentMailSection({ dc, canAct, onReload }) {
  const [preview, setPreview] = useState(null);
  const [showMail, setShowMail] = useState(false);
  const [busy, setBusy] = useState('');
  const [stop, setStop] = useState('');
  const [confirmSend, setConfirmSend] = useState(false);
  const mailed = Boolean(dc.vendor_notified_at);
  const open = ['draft', 'dispatch_ready'].includes(dc.status);
  const stopYmd = ymdOf(dc.rent_stop_date);

  useEffect(() => { setStop(stopYmd); }, [stopYmd]);
  useEffect(() => {
    if (!dc.rent_stop_date || mailed) { setPreview(null); return; }
    fetchRepairMailPreview(dc.dc_number).then(({ data }) => setPreview(data.preview)).catch(() => setPreview(null));
  }, [dc.dc_number, dc.rent_stop_date, dc.updated_at, mailed]);

  if (!dc.rent_stop_date && !mailed) return null;
  const today = todayIst();
  const passed = stopYmd && stopYmd < today && !mailed;

  const run = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); onReload?.(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };

  return (
    <Section
      title="Vendor mail & rent"
      actions={<Button disabled={busy === 'pdf'} onClick={() => run('pdf', () => downloadRepairRequestPdf(dc.dc_number))}>Repair request PDF</Button>}
    >
      {mailed ? (
        <Notice tone="good" title={`Mailed to ${dc.notify_to || 'the vendor'} on ${prettyYmd(ymdOf(dc.vendor_notified_at))}`}>
          Rent on the laptops rented from this vendor stopped from <strong>{prettyYmd(stopYmd)}</strong>; each one’s rent starts again
          the day it (or its replacement) is back at our gate.
          {dc.cancel_mail_sent_at ? ' The challan was cancelled and the vendor told — rent continued as before.' : ''}
        </Notice>
      ) : (
        <div className="c-stack">
          <Notice tone="warn" title="Not mailed yet">
            Mailing the vendor stops rent from the date below on {preview?.paused_laptops ?? '…'} laptop(s) rented from them, and must be
            done before the challan can be signed for dispatch.
          </Notice>
          <FormGrid cols={3}>
            <Field label="Rent stops from" hint={`Billed up to ${prettyYmd(stop ? addDaysYmd(stop, -1) : '')}.`}>
              <Input type="date" min={today} max={addDaysYmd(today, 30)} value={stop} disabled={!canAct || !open} onChange={(e) => setStop(e.target.value)} />
            </Field>
          </FormGrid>
          {passed && <Notice tone="crit">This date has passed — change it to today or later before mailing.</Notice>}
          {preview && !preview.to && <Notice tone="crit">The vendor has no email address — add it on the vendor record.</Notice>}
          {dc.notify_error && <Notice tone="serious">Last attempt failed: {dc.notify_error}</Notice>}
          <div className="flex flex-wrap" style={{ gap: '8px' }}>
            {canAct && open && stop && stop !== stopYmd && (
              <Button disabled={busy === 'date'} onClick={() => run('date', () => updateRepairRequestDetails(dc.dc_number, { rent_stop_date: stop }), 'Rent stop date changed')}>Save date</Button>
            )}
            <Button variant="quiet" onClick={() => setShowMail((v) => !v)}>{showMail ? 'Hide the mail' : 'Preview the mail'}</Button>
            {canAct && open && (
              <Button variant="primary" disabled={busy === 'send' || passed || !preview?.to || stop !== stopYmd} onClick={() => setConfirmSend(true)}>
                {busy === 'send' ? 'Sending…' : 'Mail the vendor'}
              </Button>
            )}
          </div>
          {showMail && preview && (
            <div className="c-card" style={{ padding: '12px' }}>
              <KeyValue cols={2} items={[
                { label: 'To', value: preview.to || '—' },
                { label: 'CC', value: preview.cc || '—' },
                { label: 'Subject', value: preview.subject },
                { label: 'Attached', value: 'Repair request PDF' },
              ]}
              />
              <iframe title="Repair mail preview" sandbox="" srcDoc={preview.html} style={{ width: '100%', height: '460px', border: '1px solid var(--rule)', borderRadius: '6px', marginTop: '8px', background: 'var(--surface)' }} />
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        onConfirm={() => { setConfirmSend(false); run('send', () => sendRepairMail(dc.dc_number), 'Mailed — rent stopped from the date shown'); }}
        title={`Mail ${preview?.to || 'the vendor'} now?`}
        body={`Rent stops from ${prettyYmd(stopYmd)} on ${preview?.paused_laptops || 0} laptop(s).`}
        confirmLabel="Mail the vendor"
        tone="warn"
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* E-way bill (repair challans at Rs 50,000 or more)                   */
/* ------------------------------------------------------------------ */

export function EwaySection({ dcNumber, compliance, onReload }) {
  const c = compliance || {};
  const [number, setNumber] = useState(c.eway_bill_number || '');
  const [date, setDate] = useState(c.eway_bill_date ? String(c.eway_bill_date).slice(0, 10) : '');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirmMail, setConfirmMail] = useState(false);
  useEffect(() => { setNumber(c.eway_bill_number || ''); }, [c.eway_bill_number]);

  if (!c.applies) return null;
  const done = c.eway_complete === true;
  const threshold = Number(c.eway_threshold || 50000);

  const mail = async () => {
    setBusy('mail');
    try {
      const { data } = await sendAccountsVrdcEwayMail(dcNumber);
      toast.success(data?.message || 'Mail sent to Accounts');
      onReload?.();
    } catch (e) {
      if (e?.response?.status === 409) { toast.success(errMsg(e)); onReload?.(); } else toast.error(errMsg(e, 'Could not send the mail'));
    } finally { setBusy(''); }
  };

  const save = async () => {
    if (!number.trim()) { toast.error('E-way bill number is required'); return; }
    if (!file && !c.eway_bill_pdf_path) { toast.error('Attach the e-way bill (image or PDF)'); return; }
    const fd = new FormData();
    fd.append('eway_bill_number', number.trim());
    if (date) fd.append('eway_bill_date', date);
    if (file) fd.append('eway_bill_pdf', file);
    setBusy('save');
    try {
      const { data } = await uploadVrdcEway(dcNumber, fd);
      toast.success(data?.message || 'E-way bill saved');
      setFile(null);
      onReload?.();
    } catch (e) { toast.error(errMsg(e, 'Could not save')); } finally { setBusy(''); }
  };

  return (
    <Section title="E-way bill">
      <div className="c-stack">
        <Notice tone={done ? 'good' : 'warn'} title={done ? 'E-way bill added' : 'E-way bill needed'}>
          Declared value <Money value={c.product_value} /> is ₹{threshold.toLocaleString('en-IN')} or more. The gate won’t let it out without the e-way bill.
          {' '}Challan PDF: <strong>{c.can_download_pdf ? (done ? 'available' : 'available to Accounts') : 'locked until the e-way bill is added'}</strong>.
          {!done && c.lock_message ? <><br />{c.lock_message}</> : null}
        </Notice>
        {done && (
          <KeyValue cols={3} items={[
            { label: 'E-way bill', value: <span className="font-mono">{c.eway_bill_number || '—'}</span> },
            { label: 'Date', value: c.eway_bill_date ? prettyYmd(c.eway_bill_date) : '—' },
            { label: 'Document', value: c.eway_bill_pdf_path ? <a href={docUrl(c.eway_bill_pdf_path)} target="_blank" rel="noopener noreferrer">Open</a> : '—' },
          ]}
          />
        )}
        {c.can_request_eway && !done && (
          <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
            <Button disabled={busy === 'mail' || c.dispatch_mail_configured === false} onClick={() => setConfirmMail(true)}>
              {c.request_sent ? 'Resend the mail to Accounts' : 'Mail Accounts for the e-way bill'}
            </Button>
            <span className="text-ink-3">
              To {c.accounts_email || 'Accounts'}{c.dispatch_mail_from ? ` from ${c.dispatch_mail_from}` : ''}, with the challan PDF.
              {c.accounts_notified_at ? <> Sent <DateTime value={c.accounts_notified_at} />.</> : null}
              {c.dispatch_mail_configured === false ? ' Dispatch mail is not configured on the server.' : ''}
            </span>
          </div>
        )}
        {c.can_upload_eway ? (
          <FormGrid cols={3}>
            <Field label="E-way bill number" required><Input value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} className="font-mono" /></Field>
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label={c.eway_bill_pdf_path ? 'Replace the document (optional)' : 'E-way bill document'} required={!c.eway_bill_pdf_path} hint="Image or PDF">
              <Input type="file" accept=".pdf,image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </Field>
            <div><Button variant="primary" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? 'Saving…' : done ? 'Update e-way bill' : 'Save e-way bill'}</Button></div>
          </FormGrid>
        ) : !done ? <p className="text-ink-3">Accounts enters the e-way bill and attaches the document; then the PDF unlocks and the gate lets it out.</p> : null}
      </div>
      <ConfirmDialog
        open={confirmMail}
        onClose={() => setConfirmMail(false)}
        onConfirm={() => { setConfirmMail(false); mail(); }}
        title="Mail Accounts for the e-way bill?"
        body={`To ${c.accounts_email || 'Accounts'}, with the challan PDF attached.`}
        confirmLabel="Send"
        tone="warn"
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Per-laptop decisions: vendor keeps it, approve / reject replacement */
/* ------------------------------------------------------------------ */

export function VendorKeptDrawer({ dcNumber, item, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { setReason(''); setPreview(null); }, [item?.id]);
  if (!item) return null;

  const loadPreview = async () => {
    if (reason.trim().length < 3) { toast.error('Say what the vendor told us'); return; }
    setBusy('p');
    try {
      const { data } = await previewVendorKept(dcNumber, { item_id: item.id, reason });
      setPreview(data.preview);
    } catch (e) { toast.error(errMsg(e, 'Could not build the mail')); } finally { setBusy(''); }
  };
  const confirm = async () => {
    setBusy('k');
    try {
      await markVendorKept(dcNumber, { item_id: item.id, reason });
      toast.success('Mailed the vendor — laptop recorded as returned to them');
      onDone?.();
    } catch (e) { toast.error(errMsg(e, 'Could not mark it')); } finally { setBusy(''); }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Vendor keeps ${item.ttspl_id}`}
      width="40rem"
      footer={preview
        ? <Button variant="primary" disabled={busy === 'k'} onClick={confirm}>{busy === 'k' ? 'Sending…' : 'Send mail and mark returned'}</Button>
        : <Button variant="primary" disabled={busy === 'p'} onClick={loadPreview}>Preview the mail</Button>}
    >
      <div className="c-stack">
        <p>
          The vendor says they can’t repair it and will keep it. They get a confirmation mail, the laptop is recorded as returned to
          them, its floor ticket closes and a draft debit note is made for Accounts.
        </p>
        <Field label="What the vendor told us" required>
          <Textarea rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setPreview(null); }} />
        </Field>
        {preview && (
          <>
            <KeyValue cols={2} items={[
              { label: 'To', value: preview.to || '—' },
              { label: 'CC', value: preview.cc || '—' },
              { label: 'Rent ends', value: prettyYmd(preview.rent_end_date) },
            ]}
            />
            <iframe title="Vendor keeps mail" sandbox="" srcDoc={preview.html} style={{ width: '100%', height: '320px', border: '1px solid var(--rule)', borderRadius: '6px', background: 'var(--surface)' }} />
          </>
        )}
      </div>
    </Drawer>
  );
}

export function ReplacementDecisionDrawer({ dcNumber, item, approve, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNote(''); }, [item?.id, approve]);
  if (!item) return null;
  const p = item.replacement_proposed || {};
  const mismatches = (item.replacement_config_result?.checks || []).filter((c) => c.matched === false);

  const submit = async () => {
    if (!approve && note.trim().length < 3) { toast.error('Give the reason — it goes to the vendor'); return; }
    setBusy(true);
    try {
      const { data } = await decideReplacement(dcNumber, { item_id: item.id, approve, note });
      toast.success(data?.message || 'Saved');
      onDone?.();
    } catch (e) { toast.error(errMsg(e, 'Could not save the decision')); } finally { setBusy(false); }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={approve ? `Approve the replacement for ${item.ttspl_id}?` : `Reject the replacement for ${item.ttspl_id}?`}
      footer={<Button variant="primary" disabled={busy} onClick={submit}>{approve ? 'Approve' : 'Reject and mail the vendor'}</Button>}
    >
      <div className="c-stack">
        <KeyValue cols={1} items={[
          { label: 'We sent', value: `${item.configuration || '—'} · ${item.serial_number || '—'}` },
          { label: 'They sent', value: `${[p.brand, p.model, p.processor, p.generation, p.ram, p.ssd].filter(Boolean).join(' · ') || '—'} · ${p.serial_number || '—'}` },
        ]}
        />
        {p.condition === 'not_on' && <Notice tone="warn">It does not power on — its configuration could not be read.</Notice>}
        {mismatches.map((c) => (
          <Notice key={c.field} tone="warn">{c.label || c.field}: expected {c.expected || '—'}, found {c.actual || '—'}</Notice>
        ))}
        <p className="text-ink-3">
          {approve
            ? 'It becomes the replacement at the original laptop’s monthly rent, billed from the day it reached our gate. The warehouse then receives it.'
            : 'The vendor is mailed that it is not accepted; it is handed back and the original stays with the vendor with rent stopped.'}
        </p>
        <Field label={approve ? 'Note (optional)' : 'Reason (goes to the vendor)'} required={!approve}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Receive back from the vendor                                        */
/* ------------------------------------------------------------------ */

const blankReceive = (user, item) => {
  const cfg = parseVrdcItemConfig(item || {});
  return {
    receive_mode: 'repaired',
    laptop_condition: DEFAULT_CONDITION,
    bypass_gate_flow: false,
    serials: {},
    wh_signer_name: user?.name || user?.email || '',
    wh_esign: null,
    replacement_serial_number: '',
    replacement_brand: cfg.brand,
    replacement_model: cfg.model,
    replacement_generation: cfg.generation,
  };
};

/** One laptop's state line in the receive picker. */
function receiveHint(dc, item) {
  if (!dc.gate_legacy && !item.gate_inward_at) return 'Waiting for the guard’s inward scan';
  if (!dc.gate_legacy && (!item.return_config_verified_at || !item.return_captured_serial)) return 'If it powers on: run the vendor-return script (serial + specs)';
  return 'Ready to receive';
}

/**
 * Same checks and payload as the old "Receive back" modal: the guard's inward
 * scan first (unless a legacy challan or a super-admin bypass), the
 * vendor-return script on a laptop that powers on, a typed serial otherwise,
 * and the warehouse e-signature. A replacement that differs goes to approval.
 */
export function ReceiveDrawer({ open, dc, items, user, onClose, onDone }) {
  const [picked, setPicked] = useState([]);
  const [step, setStep] = useState('pick');
  const [form, setForm] = useState(() => blankReceive(user, null));
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const isSuperAdmin = user?.role === 'super_admin';

  useEffect(() => { if (open) { setPicked([]); setStep('pick'); setSigning(false); } }, [open]);

  const chosen = items.filter((i) => picked.includes(i.id));
  const first = chosen[0];
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const bypass = isSuperAdmin && form.bypass_gate_flow;
  const isOn = form.laptop_condition === 'on';

  const start = () => {
    if (!chosen.length) { toast.error('Pick at least one laptop'); return; }
    setForm(blankReceive(user, first));
    setStep('form');
  };

  const submit = async () => {
    if (!form.wh_signer_name.trim()) { toast.error('Enter the receiver’s name'); return; }
    if (!form.wh_esign) { toast.error('The warehouse signature is required'); return; }
    if (form.receive_mode === 'repaired' && !isOn) {
      for (const it of chosen) {
        const typed = String(form.serials[it.id] || '').trim().toUpperCase();
        if (!typed || typed !== String(it.serial_number || '').trim().toUpperCase()) { toast.error(`Serial must match ${it.serial_number || it.ttspl_id}`); return; }
      }
    }
    if (form.receive_mode === 'replacement') {
      const scripted = !dc.gate_legacy && !bypass && isOn && first.replacement_approval_status !== 'approved';
      if (scripted) {
        if (!first.replacement_config_result || !String(first.replacement_captured_serial || '').trim()) {
          toast.error('Run the replacement check first: “It’s a replacement” on this laptop gives the access number for the script.');
          return;
        }
      } else if (first.replacement_approval_status !== 'approved') {
        if (!form.replacement_serial_number.trim()) { toast.error('Enter the replacement’s serial number'); return; }
        if (!form.replacement_brand.trim() || !form.replacement_model.trim()) { toast.error('Enter the replacement’s brand and model'); return; }
      }
    }
    const needsScript = form.receive_mode !== 'replacement' && requiresConfigCapture(form.laptop_condition);
    if (!dc.gate_legacy && !bypass) {
      for (const it of chosen) {
        if (!it.gate_inward_at) { toast.error(`The guard has not scanned ${it.ttspl_id} in yet.`); return; }
        if (needsScript && (!it.return_config_verified_at || !String(it.return_captured_serial || '').trim())) {
          toast.error(`Run the vendor-return script on ${it.ttspl_id} — it checks the specs and reads the serial.`);
          return;
        }
      }
    }
    setBusy(true);
    try {
      const { data } = await receiveVendorRepairBack(dc.dc_number, {
        bypass_gate_flow: bypass,
        items: chosen.map((it) => ({
          ticket_id: it.ticket_id,
          receive_mode: form.receive_mode,
          laptop_condition: form.laptop_condition,
          bypass_gate_flow: bypass,
          verified_serial: isOn ? String(it.return_captured_serial || it.serial_number || '').trim() : String(form.serials[it.id] || '').trim(),
          wh_esign: form.wh_esign,
          wh_signer_name: form.wh_signer_name.trim(),
          replacement_serial_number: form.replacement_serial_number,
          replacement_brand: form.replacement_brand,
          replacement_model: form.replacement_model,
          replacement_generation: form.replacement_generation,
        })),
      });
      if (data?.pending_approval?.length && !data?.received_item_ids?.length) toast(data.message, { duration: 8000 });
      else toast.success(data?.message || 'Received');
      onDone?.();
    } catch (e) { toast.error(errMsg(e, 'Receive failed')); } finally { setBusy(false); }
  };

  const cfg = first ? parseVrdcItemConfig(first) : {};

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={step === 'pick' ? 'Receive back from the vendor' : `Receive ${chosen.length > 1 ? `${chosen.length} laptops` : first?.ttspl_id || ''}`}
      width="40rem"
      footer={step === 'pick'
        ? <Button variant="primary" disabled={!chosen.length} onClick={start}>Receive {chosen.length || ''} selected</Button>
        : (
          <div className="flex" style={{ gap: '8px' }}>
            <Button variant="quiet" onClick={() => setStep('pick')}>Back</Button>
            <Button variant="primary" disabled={busy} onClick={submit}>{busy ? 'Receiving…' : 'Confirm receive'}</Button>
          </div>
        )}
    >
      {step === 'pick' ? (
        <div className="c-stack">
          <p className="text-ink-3">The guard scans it in first (not needed on an old challan). A laptop that powers on runs the vendor-return script; one that doesn’t gets its serial typed.</p>
          {items.map((it) => (
            <div key={it.id} className="c-card" style={{ padding: '10px 12px' }}>
              <Checkbox
                checked={picked.includes(it.id)}
                onChange={() => setPicked((p) => (p.includes(it.id) ? p.filter((x) => x !== it.id) : [...p, it.id]))}
                label={<span><span className="font-mono">{it.ttspl_id}</span> · {it.serial_number || '—'} — {it.configuration || '—'}</span>}
              />
              <div className="text-ink-3" style={{ marginLeft: '26px', fontSize: 'var(--d-sm)' }}>{receiveHint(dc, it)}</div>
            </div>
          ))}
          {!items.length && <p className="text-ink-3">Nothing is waiting to come back.</p>}
        </div>
      ) : first ? (
        <div className="c-stack">
          <Field label="What came back">
            <Segmented value={form.receive_mode} onChange={(v) => set('receive_mode', v)} options={[{ value: 'repaired', label: 'Our laptop, repaired' }, { value: 'replacement', label: 'A replacement' }]} label="What came back" />
          </Field>
          <Field label="Does it power on?" hint={isOn ? 'Run the vendor-return script on it — it reads the serial and checks the specs. Don’t type the serial.' : 'Type the serial to receive it.'}>
            <Segmented value={form.laptop_condition} onChange={(v) => set('laptop_condition', v)} options={[{ value: 'on', label: 'Powers on' }, { value: 'not_on', label: 'Does not power on' }]} label="Power" />
          </Field>
          {isSuperAdmin && (
            <Checkbox checked={form.bypass_gate_flow} onChange={(e) => set('bypass_gate_flow', e.target.checked)} label="Skip the guard scan and capture script (super admin only; the signature and a typed serial for a dead laptop are still needed)" />
          )}

          {form.receive_mode === 'repaired' && !isOn && chosen.map((it) => (
            <Field key={it.id} label={`Serial of ${it.ttspl_id}`} hint={`Must match ${it.serial_number || '—'}`} required>
              <Input className="font-mono" value={form.serials[it.id] || ''} onChange={(e) => setForm((f) => ({ ...f, serials: { ...f.serials, [it.id]: e.target.value } }))} />
            </Field>
          ))}
          {form.receive_mode === 'repaired' && isOn && chosen.map((it) => (
            it.return_config_verified_at && it.return_captured_serial
              ? <Notice key={it.id} tone="good" title={`${it.ttspl_id}: script verified`}>Serial {it.return_captured_serial} · specs matched</Notice>
              : (
                <Notice key={it.id} tone="warn" title={`${it.ttspl_id}: run the vendor-return script`}>
                  {it.return_config_verified_at ? 'Specs matched — run it again so it sends the serial.' : 'It reads the serial and checks the specs.'}
                  {it.return_capture?.access_number ? <> Access number <strong className="font-mono">{it.return_capture.access_number}</strong>.</> : null}
                  {' '}<a href="/vendor-return-config-match" target="_blank" rel="noopener noreferrer">Open the capture page</a>
                </Notice>
              )
          ))}

          {form.receive_mode === 'replacement' && (first.replacement_approval_status === 'approved' ? (
            <Notice tone="good" title="Approved by Accounts">
              {[first.replacement_proposed?.brand, first.replacement_proposed?.model].filter(Boolean).join(' ')} · serial {first.replacement_proposed?.serial_number || '—'}.
              {' '}It becomes the replacement for {first.ttspl_id}, billed from the day it reached the gate.
            </Notice>
          ) : (!dc.gate_legacy && !bypass && isOn) ? (
            <Notice tone="info" title="Replacement check">
              {first.replacement_config_result
                ? <>{first.replacement_config_result.configurationMatched ? 'Same model and configuration as the laptop sent — it will be accepted.' : 'Different from the laptop sent — receiving sends it to Accounts for approval.'} Serial {first.replacement_captured_serial || '— (run the script again to read it)'}.</>
                : <>Close this, press <strong>It’s a replacement</strong> on the laptop’s row for an access number, boot the replacement and run the vendor-return script. It compares the replacement with the laptop we sent.</>}
              {first.return_capture?.mode === 'replacement' && first.return_capture?.access_number ? <> Access number <strong className="font-mono">{first.return_capture.access_number}</strong>.</> : null}
            </Notice>
          ) : (
            <div className="c-stack">
              {!isOn && !dc.gate_legacy && !bypass && <Notice tone="warn">A replacement that won’t power on can’t be checked — receiving it sends it to Accounts for approval.</Notice>}
              <KeyValue cols={1} items={[
                { label: 'Sent for repair', value: `${cfg.brand || ''} ${cfg.model || ''} · Gen ${cfg.generation || '—'} · ${[cfg.processor, cfg.ram, cfg.storage].filter(Boolean).join(' · ')}` },
                { label: 'Replaces', value: `${first.ttspl_id} / ${first.serial_number || '—'}` },
              ]}
              />
              <FormGrid cols={2}>
                <Field label="New serial number" required><Input className="font-mono" value={form.replacement_serial_number} onChange={(e) => set('replacement_serial_number', e.target.value)} /></Field>
                <Field label="Brand" required><Input value={form.replacement_brand} onChange={(e) => set('replacement_brand', e.target.value)} /></Field>
                <Field label="Model" required><Input value={form.replacement_model} onChange={(e) => set('replacement_model', e.target.value)} /></Field>
                <Field label="Generation"><Input value={form.replacement_generation} onChange={(e) => set('replacement_generation', e.target.value)} /></Field>
              </FormGrid>
              <p className="text-ink-3">Makes a replacement receive challan (REP) and tags the laptop as a replacement.</p>
            </div>
          ))}

          <Field label="Received by" required><Input value={form.wh_signer_name} onChange={(e) => set('wh_signer_name', e.target.value)} /></Field>
          <Field label="Warehouse signature" required>
            {form.wh_esign && !signing ? (
              <div className="c-stack">
                <img src={form.wh_esign} alt="Receive signature" style={{ maxHeight: '80px', objectFit: 'contain', border: '1px solid var(--rule)', borderRadius: '6px', background: 'var(--surface)' }} />
                <div><Button variant="quiet" onClick={() => setSigning(true)}>Sign again</Button></div>
              </div>
            ) : signing || !form.wh_esign ? (
              <SignaturePad prompt="The person receiving signs in the box" onSave={(sig) => { set('wh_esign', sig); setSigning(false); }} onCancel={() => setSigning(false)} />
            ) : null}
          </Field>
          {first.issue_type ? <p className="text-ink-3">Issue sent for: {issueTypeLabel(first.issue_type)}</p> : null}
        </div>
      ) : null}
    </Drawer>
  );
}
