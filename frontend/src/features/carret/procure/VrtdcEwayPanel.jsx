import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, EmptyState, Field, FormGrid, Input, KeyValue, Money, Notice, StatusChip,
} from '../../../components/carret';
import {
  downloadReturnToVendorEwayPdf,
  fetchReturnToVendorEway,
  requestReturnToVendorEway,
  saveReturnToVendorEway,
} from '../../vendor-management/vendorManagementApi';

/**
 * E-way bill for a return challan (VRTDC) — the Carret take on
 * vendor-management/components/VrtdcEwayPanel. Same props and the same four
 * calls. Two audiences hand off on one panel:
 *   - the warehouse sees the declared value, whether a bill is needed, and
 *     the button that asks Accounts for it;
 *   - Accounts sees the same figures and the form to record the bill.
 * It says so plainly when no bill is needed, so nobody wonders whether the
 * feature is broken. The page puts it inside its own Section.
 */
const ymd = (v) => (v ? String(v).slice(0, 10) : '');

export default function VrtdcEwayPanel({ dcNumber, status, onChange, onState }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [num, setNum] = useState('');
  const [date, setDate] = useState('');
  const [file, setFile] = useState(null);
  const [dlBusy, setDlBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchReturnToVendorEway(dcNumber);
      const c = res.data?.compliance || null;
      setState(c);
      onState?.(c);
      if (c?.eway_bill_number) setNum(c.eway_bill_number);
      if (c?.eway_bill_date) setDate(ymd(c.eway_bill_date));
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Could not load E-way status');
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [dcNumber, onState]);
  useEffect(() => { load(); }, [load]);

  // The driver needs the bill itself at the gate, not just its number.
  const downloadEway = async () => {
    setDlBusy(true);
    try { await downloadReturnToVendorEwayPdf(dcNumber); } catch (err) { toast.error(err.message || 'Could not download the E-way Bill'); } finally { setDlBusy(false); }
  };

  const request = async () => {
    setBusy(true);
    try {
      const res = await requestReturnToVendorEway(dcNumber);
      toast.success(`Sent to ${res.data?.to || 'Accounts'}`);
      await load();
      onChange?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Could not send the request');
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!num.trim()) { toast.error('E-way Bill number is required'); return; }
    if (!file && !state?.eway_bill_pdf_path) { toast.error('Attach the E-way Bill document'); return; }
    setBusy(true);
    try {
      await saveReturnToVendorEway(dcNumber, { eway_bill_number: num.trim(), eway_bill_date: date || undefined, file });
      toast.success('E-way Bill saved — consignment released to the gate');
      setFile(null);
      await load();
      onChange?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Could not save the E-way Bill');
    } finally { setBusy(false); }
  };

  if (loading) return <EmptyState title="Loading E-way Bill status…" />;
  if (!state) return null;

  const needed = state.requires_eway_bill;
  const done = state.eway_complete;
  const missingValues = Number(state.items_missing_value) > 0;
  const laptops = state.laptop_count != null ? `${state.laptop_count} laptop${state.laptop_count === 1 ? '' : 's'}` : null;

  return (
    <div className="c-stack">
      <div className="flex flex-wrap items-center justify-between" style={{ gap: '8px' }}>
        <div style={{ flex: 1, minWidth: '16rem' }}>
          <KeyValue
            cols={3}
          items={[
            { label: 'Declared value', value: <Money value={state.product_value} /> },
            { label: 'Laptops', value: laptops },
            { label: 'Threshold', value: <Money value={state.eway_threshold} /> },
          ]}
          />
        </div>
        <StatusChip
          status={!needed ? 'draft' : done ? 'completed' : 'pending'}
          label={!needed ? 'Not required' : done ? 'Bill on file' : 'Required — not yet raised'}
        />
      </div>

      {missingValues && (
        <Notice tone="warn">
          {state.items_missing_value} laptop{state.items_missing_value === 1 ? ' has' : 's have'} no declared value. The total above — and so
          whether a bill is needed — is understated until every laptop is priced at dispatch.
        </Notice>
      )}

      {state.lock_message && <Notice tone={needed && !done ? 'warn' : 'info'}>{state.lock_message}</Notice>}

      {done && (
        <Notice
          tone="good"
          title={<span className="font-mono">{state.eway_bill_number}</span>}
          action={state.eway_bill_pdf_path && <Button disabled={dlBusy} onClick={downloadEway}>{dlBusy ? 'Downloading…' : 'E-way Bill document'}</Button>}
        >
          {[state.eway_bill_date && `Dated ${ymd(state.eway_bill_date)}`, state.eway_bill_uploaded_at && `recorded ${ymd(state.eway_bill_uploaded_at)}`].filter(Boolean).join(' · ') || 'Bill on file'}
        </Notice>
      )}

      {/* Warehouse: ask Accounts. Only while a bill is needed and missing. */}
      {needed && !done && state.can_request_eway && (
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Button variant="primary" disabled={busy} onClick={request}>
            {state.request_sent ? 'Send reminder to Accounts' : 'Send for E-way Bill'}
          </Button>
          {state.request_sent && <span className="text-ink-3">Requested {ymd(state.accounts_notified_at)} · {state.accounts_email}</span>}
          {!state.dispatch_mail_configured && <span style={{ color: 'var(--alert-crit)' }}>Dispatch mail is not configured — the request will fail.</span>}
        </div>
      )}

      {/* Accounts: record the bill. */}
      {needed && state.can_upload_eway && status !== 'dispatched' && status !== 'completed' && (
        <div className="c-stack">
          <div className="c-label">Accounts — record the E-way Bill</div>
          <FormGrid cols={3}>
            <Field label="E-way Bill number" required><Input id="vrtdc-eway-number" className="font-mono" value={num} onChange={(e) => setNum(e.target.value)} /></Field>
            <Field label="Date"><Input id="vrtdc-eway-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field
              label="Document"
              required={!state.eway_bill_pdf_path}
              hint={state.eway_bill_pdf_path && !file ? 'A document is already on file — leave blank to keep it.' : 'PDF or image'}
            >
              <Input id="vrtdc-eway-file" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </Field>
          </FormGrid>
          <div><Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save E-way Bill'}</Button></div>
        </div>
      )}
    </div>
  );
}
