import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, DataTable, DateTime, DocNumber, Field, FormGrid, Input, KeyValue, Money, Notice, Section,
} from '../../../components/carret';
import {
  requestDemoEway, sendAccountsDcMail, uploadDemoEway, uploadSaleDcCompliance,
} from '../../sales-pipeline/salesPipelineApi';
import { isAccountsMailBlocked } from '../../sales-pipeline/salesPipelineUtils';
import { pdfUrl } from '../sell/sellShared';
import {
  REPLACE_REASON_MIN, ReplaceReason, SharedInvoiceConfirm, errCode, isReplacing,
} from '../money/gst/gstShared';

/**
 * A challan's paperwork: the e-way bill (value ≥ ₹50,000) and, for a sale or a
 * customer's first challan, the e-invoice. Both are Accounts' job; the desk's
 * job is to ask them. The gate refuses a challan whose e-way bill is missing,
 * and the challan PDF stays locked until the paperwork is on file.
 *
 * Same endpoints as the old E-Way Bill and E-Invoice tabs.
 */
const FileLink = ({ path, children }) => (path ? <a href={pdfUrl(path)} target="_blank" rel="noreferrer">{children}</a> : null);

function EwayPanel({ dc, status, c, onChanged }) {
  const [f, setF] = useState({ number: '', date: '', vehicle: '', file: null, reason: '' });
  const [busy, setBusy] = useState('');
  useEffect(() => { setF({ number: c.eway_bill_number || '', date: c.eway_bill_date ? String(c.eway_bill_date).slice(0, 10) : '', vehicle: c.vehicle_number || '', file: null, reason: '' }); }, [c]);
  const mailBlocked = isAccountsMailBlocked(status);
  // MD7: a different number than the one on file is a replace, which needs a reason.
  const ewayChanges = isReplacing(c.eway_bill_number, f.number)
    ? [{ label: 'E-way bill', from: c.eway_bill_number, to: f.number.trim() }] : [];

  const ask = async () => {
    setBusy('ask');
    try { await requestDemoEway(dc); toast.success('Accounts asked for the e-way bill'); onChanged?.(); } catch (e) { toast.error(e?.response?.data?.message || 'Could not send the request.'); } finally { setBusy(''); }
  };
  const upload = async () => {
    if (!f.number.trim()) { toast.error('Enter the e-way bill number'); return; }
    if (!f.file && !c.eway_bill_pdf_path) { toast.error('Attach the e-way bill document'); return; }
    if (c.requires_vehicle_number && !f.vehicle.trim()) { toast.error('Enter the vehicle number'); return; }
    if (ewayChanges.length && f.reason.trim().length < REPLACE_REASON_MIN) { toast.error('Give a reason for replacing the e-way bill'); return; }
    const fd = new FormData();
    fd.append('eway_bill_number', f.number.trim());
    if (ewayChanges.length) { fd.append('replace', '1'); fd.append('replace_reason', f.reason.trim()); }
    if (f.date) fd.append('eway_bill_date', f.date);
    if (f.file) fd.append('eway_bill_pdf', f.file);
    if (f.vehicle.trim()) fd.append('vehicle_number', f.vehicle.trim().toUpperCase());
    setBusy('up');
    try { await uploadDemoEway(dc, fd); toast.success('E-way bill saved — the challan is unlocked'); onChanged?.(); } catch (e) { toast.error(e?.response?.data?.message || 'Could not save the e-way bill.'); } finally { setBusy(''); }
  };

  return (
    <Section title="E-way bill">
      <div className="c-stack">
        {c.eway_complete
          ? <Notice tone="good" title={`E-way bill ${c.eway_bill_number}`}>On file{c.eway_bill_uploaded_at ? <> since <DateTime value={c.eway_bill_uploaded_at} /></> : ''}. The gate will let this challan out.</Notice>
          : <Notice tone="serious" title="E-way bill needed before this challan can leave">{c.lock_message || `The laptops are worth ${new Intl.NumberFormat('en-IN').format(c.asset_value || 0)} — at or above ₹${new Intl.NumberFormat('en-IN').format(c.eway_threshold || 50000)}.`}</Notice>}
        <KeyValue cols={3} items={[
          { label: 'Asset value (for the e-way rule)', value: <Money value={c.asset_value} /> },
          { label: 'Billed value', value: <Money value={c.billed_value ?? c.product_value} /> },
          { label: 'Threshold', value: <Money value={c.eway_threshold || 50000} /> },
          { label: 'Accounts asked', value: c.accounts_notified_at ? <DateTime value={c.accounts_notified_at} /> : 'Not yet' },
          { label: 'Vehicle', value: c.vehicle_number && <DocNumber value={c.vehicle_number} /> },
          { label: 'Document', value: <FileLink path={c.eway_bill_pdf_path}>Open e-way bill</FileLink> },
        ]}
        />
        {(c.asset_units || []).length > 0 && (
          <DataTable
            rows={c.asset_units}
            rowKey={(u, i) => u.ttspl || u.serial || i}
            columns={[
              { key: 't', header: 'Laptop', render: (u) => <DocNumber value={u.ttspl || u.serial || '—'} />, sub: (u) => u.serial || null },
              { key: 'p', header: 'Processor', render: (u) => [u.processor, u.generation].filter(Boolean).join(' · ') },
              { key: 'v', header: 'Asset value', numeric: true, render: (u) => <Money value={u.asset_value ?? u.value} /> },
            ]}
          />
        )}
        {!c.eway_complete && c.can_request_eway && !mailBlocked && (
          <div className="flex items-center flex-wrap" style={{ gap: '10px' }}>
            <Button onClick={ask} disabled={busy === 'ask'}>{c.request_sent || c.accounts_notified_at ? 'Remind Accounts' : 'Ask Accounts for the e-way bill'}</Button>
            <span className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
              Emails {c.accounts_email || 'Accounts'} with the challan attached.{c.dispatch_mail_configured === false ? ' Dispatch mail is not configured on this server.' : ''}
            </span>
          </div>
        )}
        {c.can_upload_eway && (
          <div className="c-card" style={{ padding: '14px 16px' }}>
            <div className="c-label" style={{ marginBottom: '10px' }}>{c.eway_complete ? 'Update the e-way bill' : 'Upload the e-way bill (Accounts)'}</div>
            <FormGrid cols={2}>
              <Field label="E-way bill number" required><Input value={f.number} onChange={(e) => setF((x) => ({ ...x, number: e.target.value }))} className="font-mono" /></Field>
              <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} /></Field>
              {c.requires_vehicle_number && (
                <Field label="Vehicle number" required><Input value={f.vehicle} onChange={(e) => setF((x) => ({ ...x, vehicle: e.target.value }))} className="font-mono" /></Field>
              )}
              <Field label="Document (PDF or image)" required={!c.eway_bill_pdf_path}>
                <Input type="file" accept="application/pdf,image/*" onChange={(e) => setF((x) => ({ ...x, file: e.target.files?.[0] || null }))} />
              </Field>
            </FormGrid>
            <div style={{ marginTop: '12px' }}>
              <ReplaceReason changes={ewayChanges} value={f.reason} onChange={(v) => setF((x) => ({ ...x, reason: v }))} />
            </div>
            <div style={{ marginTop: '12px' }}>
              <Button variant="primary" onClick={upload} disabled={busy === 'up'}>{busy === 'up' ? 'Saving…' : (c.eway_complete ? 'Update e-way bill' : 'Save and unlock the challan')}</Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function EinvoicePanel({ dc, status, c, onChanged }) {
  const [f, setF] = useState({ number: '', file: null, ewayNumber: '', ewayFile: null, reason: '' });
  const [busy, setBusy] = useState('');
  const [sharedAsk, setSharedAsk] = useState(null);
  const [share, setShare] = useState(false);
  useEffect(() => { setF({ number: c.einvoice_number || '', file: null, ewayNumber: c.eway_bill_number || '', ewayFile: null, reason: '' }); setSharedAsk(null); setShare(false); }, [c]);
  const needsEway = Boolean(c.requires_eway_bill);
  const mailBlocked = isAccountsMailBlocked(status);
  // MD7: changing a number on file is an explicit replace with a reason.
  const changes = [
    isReplacing(c.einvoice_number, f.number) && { label: 'E-invoice number', from: c.einvoice_number, to: f.number.trim() },
    needsEway && isReplacing(c.eway_bill_number, f.ewayNumber) && { label: 'E-way bill', from: c.eway_bill_number, to: f.ewayNumber.trim() },
  ].filter(Boolean);

  const ask = async () => {
    setBusy('ask');
    try { await sendAccountsDcMail(dc); toast.success('Accounts asked for the invoice'); onChanged?.(); } catch (e) { toast.error(e?.response?.data?.message || 'Could not send the request.'); } finally { setBusy(''); }
  };
  const upload = async () => {
    if (!f.number.trim()) { toast.error('Enter the e-invoice number'); return; }
    if (!f.file && !c.einvoice_pdf_path) { toast.error('Attach the e-invoice'); return; }
    if (needsEway && !f.ewayNumber.trim()) { toast.error('Enter the e-way bill number'); return; }
    if (needsEway && !f.ewayFile && !c.eway_bill_pdf_path) { toast.error('Attach the e-way bill'); return; }
    if (changes.length && f.reason.trim().length < REPLACE_REASON_MIN) { toast.error('Give a reason for replacing'); return; }
    if (sharedAsk && !share) { toast.error('Confirm the shared invoice first'); return; }
    const fd = new FormData();
    fd.append('einvoice_number', f.number.trim());
    if (changes.length) { fd.append('replace', '1'); fd.append('replace_reason', f.reason.trim()); }
    if (share) fd.append('share_invoice', '1');
    if (f.file) fd.append('einvoice_pdf', f.file);
    if (needsEway) {
      fd.append('eway_bill_number', f.ewayNumber.trim());
      if (f.ewayFile) fd.append('eway_bill_pdf', f.ewayFile);
    }
    setBusy('up');
    try {
      await uploadSaleDcCompliance(dc, fd);
      toast.success('Invoice saved — the challan is unlocked');
      onChanged?.();
    } catch (e) {
      if (errCode(e) === 'SHARED_INVOICE_CONFIRM') setSharedAsk({ message: e.response.data.message });
      else toast.error(e?.response?.data?.message || 'Could not save the invoice.');
    } finally { setBusy(''); }
  };

  return (
    <Section title={c.is_sale_dc ? 'Sale invoice' : 'First-challan e-invoice'}>
      <div className="c-stack">
        {c.compliance_complete || c.einvoice_complete
          ? <Notice tone="good" title={`E-invoice ${c.einvoice_number}`}>On file{c.einvoice_uploaded_at ? <> since <DateTime value={c.einvoice_uploaded_at} /></> : ''}.</Notice>
          : <Notice tone="serious" title="Invoice needed">{c.is_sale_dc ? 'A sale challan needs its e-invoice before the PDF can be printed.' : 'A new customer’s first challan needs an e-invoice before the PDF can be printed.'}</Notice>}
        <KeyValue cols={3} items={[
          { label: 'Challan value', value: <Money value={c.grand_total ?? c.product_value} /> },
          { label: 'E-way bill', value: needsEway ? (c.eway_bill_number || 'Needed') : 'Not needed' },
          { label: 'Accounts asked', value: c.accounts_notified_at ? <DateTime value={c.accounts_notified_at} /> : 'Not yet' },
          { label: 'E-invoice', value: <FileLink path={c.einvoice_pdf_path}>Open e-invoice</FileLink> },
          needsEway && { label: 'E-way document', value: <FileLink path={c.eway_bill_pdf_path}>Open e-way bill</FileLink> },
        ]}
        />
        {!(c.compliance_complete) && c.can_send_accounts_mail && !mailBlocked && (
          <div className="flex items-center flex-wrap" style={{ gap: '10px' }}>
            <Button onClick={ask} disabled={busy === 'ask'}>{c.accounts_notified_at ? 'Remind Accounts' : 'Ask Accounts for the invoice'}</Button>
            <span className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>Emails {c.accounts_email || 'Accounts'}.</span>
          </div>
        )}
        {c.can_upload_compliance && (
          <div className="c-card" style={{ padding: '14px 16px' }}>
            <div className="c-label" style={{ marginBottom: '10px' }}>Upload (Accounts)</div>
            <FormGrid cols={2}>
              <Field label="E-invoice number" required><Input value={f.number} onChange={(e) => setF((x) => ({ ...x, number: e.target.value }))} className="font-mono" /></Field>
              <Field label="E-invoice (PDF or image)" required={!c.einvoice_pdf_path}><Input type="file" accept="application/pdf,image/*" onChange={(e) => setF((x) => ({ ...x, file: e.target.files?.[0] || null }))} /></Field>
              {needsEway && (
                <>
                  <Field label="E-way bill number" required><Input value={f.ewayNumber} onChange={(e) => setF((x) => ({ ...x, ewayNumber: e.target.value }))} className="font-mono" /></Field>
                  <Field label="E-way bill (PDF or image)" required={!c.eway_bill_pdf_path}><Input type="file" accept="application/pdf,image/*" onChange={(e) => setF((x) => ({ ...x, ewayFile: e.target.files?.[0] || null }))} /></Field>
                </>
              )}
            </FormGrid>
            <div className="c-stack" style={{ marginTop: '12px' }}>
              <ReplaceReason changes={changes} value={f.reason} onChange={(v) => setF((x) => ({ ...x, reason: v }))} />
              <SharedInvoiceConfirm ask={sharedAsk} checked={share} onChange={setShare} />
            </div>
            <div style={{ marginTop: '12px' }}>
              <Button variant="primary" onClick={upload} disabled={busy === 'up'}>{busy === 'up' ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

export default function ChallanPaperwork({ dc, status, detail, onChanged }) {
  const eway = detail?.demo_eway_compliance;
  const inv = detail?.sale_compliance;
  const needsEway = Boolean(eway?.applies || detail?.requires_demo_eway);
  const needsInvoice = Boolean(inv?.requires_invoice_compliance || detail?.requires_invoice_compliance || inv?.is_sale_dc);
  if (!needsEway && !needsInvoice) {
    return <Notice tone="good" title="No paperwork needed">This challan is under the e-way threshold and needs no e-invoice.</Notice>;
  }
  return (
    <div className="c-stack">
      {needsEway && eway && <EwayPanel dc={dc} status={status} c={eway} onChanged={onChanged} />}
      {needsInvoice && inv && <EinvoicePanel dc={dc} status={status} c={inv} onChanged={onChanged} />}
    </div>
  );
}

/** Is paperwork still blocking this challan? */
export function paperworkState(detail) {
  const eway = detail?.demo_eway_compliance;
  const inv = detail?.sale_compliance;
  const needsEway = Boolean(eway?.applies || detail?.requires_demo_eway);
  const needsInvoice = Boolean(inv?.requires_invoice_compliance || detail?.requires_invoice_compliance || inv?.is_sale_dc);
  const ewayDone = !needsEway || Boolean(eway?.eway_complete);
  const invDone = !needsInvoice || Boolean(inv?.compliance_complete || inv?.einvoice_complete);
  return { needsEway, needsInvoice, ewayDone, invDone, done: ewayDone && invDone, none: !needsEway && !needsInvoice };
}
