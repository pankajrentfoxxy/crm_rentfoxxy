import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, Drawer, Field, FormGrid, Input, Money, Notice, Select, Textarea,
} from '../../../components/carret';
import {
  MONTH_OPTIONS, PAYMENT_METHODS, cancelInvoice, errMsg, generateInvoicesBulk, listCoverage, markPaid,
  markZoho, newRequestKey, recordPayment, sendInvoice, todayYmd, yearOptions,
} from './moneyApi';
import { outstandingOf } from './moneyShared';

/**
 * The invoice's working drawers. Each is its own top-level component (a
 * component defined inside another remounts its inputs on every keystroke).
 */

/** MD1 — record a payment. Capped at the outstanding; one key per opening. */
export function RecordPaymentDrawer({ invoice, open, onClose, onDone }) {
  const due = outstandingOf(invoice);
  const [form, setForm] = useState({ amount: '', payment_date: todayYmd(), method: 'neft', reference: '', notes: '' });
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ amount: due ? due.toFixed(2) : '', payment_date: todayYmd(), method: 'neft', reference: '', notes: '' });
    setKey(newRequestKey('pay'));
  }, [open, due]);

  const amt = Number(form.amount);
  const tooMuch = amt > due + 0.001;
  const valid = amt > 0 && !tooMuch && form.payment_date && form.payment_date <= todayYmd();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const { data } = await recordPayment(invoice.invoice_id, {
        amount: Math.round(amt * 100) / 100,
        payment_date: form.payment_date,
        method: form.method,
        reference: form.reference.trim() || undefined,
        notes: form.notes.trim() || undefined,
      }, key);
      toast.success(data.duplicate ? 'This payment was already recorded' : `Payment recorded — Rs ${Number(data.outstanding || 0).toFixed(2)} still outstanding`);
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Could not record the payment'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Record payment — ${invoice?.invoice_number || ''}`}
      footer={<Button variant="primary" disabled={!valid || busy} onClick={submit}>{busy ? 'Recording…' : 'Record payment'}</Button>}
    >
      <div className="c-stack">
        <Notice tone="info" title={<span>Outstanding <Money value={due} /></span>}>
          A payment cannot be more than what is outstanding. Record part payments as they arrive; the invoice moves to paid when the last one lands.
        </Notice>
        <FormGrid cols={2}>
          <Field label="Amount received" required error={tooMuch ? `More than the ₹${due.toFixed(2)} outstanding` : undefined}>
            <Input type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} />
          </Field>
          <Field label="Received on" required>
            <Input type="date" max={todayYmd()} value={form.payment_date} onChange={set('payment_date')} />
          </Field>
          <Field label="Method">
            <Select options={PAYMENT_METHODS} value={form.method} onChange={set('method')} />
          </Field>
          <Field label="Reference" hint="UTR, cheque number…">
            <Input value={form.reference} maxLength={100} onChange={set('reference')} />
          </Field>
        </FormGrid>
        <Field label="Notes">
          <Textarea rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Drawer>
  );
}

/** Mark the whole outstanding as received in one payment. */
export function MarkPaidDrawer({ invoice, open, onClose, onDone }) {
  const due = outstandingOf(invoice);
  const [form, setForm] = useState({ payment_reference: '', method: 'neft', payment_date: todayYmd() });
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({ payment_reference: '', method: 'neft', payment_date: todayYmd() });
    setKey(newRequestKey('paid'));
  }, [open]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await markPaid(invoice.invoice_id, form, key);
      toast.success(data.message || 'Marked paid');
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Could not mark it paid'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Mark paid — ${invoice?.invoice_number || ''}`}
      footer={<Button variant="primary" disabled={busy || !(due > 0)} onClick={submit}>{busy ? 'Saving…' : 'Record full payment'}</Button>}
    >
      <div className="c-stack">
        <Notice tone="info" title={<span>Records one payment of <Money value={due} /></span>}>
          The balance still outstanding, worked out when you save — never the full invoice again.
        </Notice>
        <FormGrid cols={2}>
          <Field label="Received on" required><Input type="date" max={todayYmd()} value={form.payment_date} onChange={set('payment_date')} /></Field>
          <Field label="Method"><Select options={PAYMENT_METHODS} value={form.method} onChange={set('method')} /></Field>
        </FormGrid>
        <Field label="Reference"><Input value={form.payment_reference} maxLength={100} onChange={set('payment_reference')} /></Field>
      </div>
    </Drawer>
  );
}

export function SendInvoiceDrawer({ invoice, open, onClose, onDone }) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setTo(invoice?.customer_email || ''); setCc(''); }
  }, [open, invoice]);
  const submit = async () => {
    setBusy(true);
    try {
      await sendInvoice(invoice.invoice_id, {
        to_email: to.trim(),
        cc_emails: cc.split(',').map((s) => s.trim()).filter(Boolean),
      });
      toast.success('Invoice sent');
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Send failed'));
    } finally {
      setBusy(false);
    }
  };
  const isDraft = String(invoice?.status || '').toLowerCase() === 'draft';
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Send ${invoice?.invoice_number || ''}`}
      footer={<Button variant="primary" disabled={busy || !to.trim()} onClick={submit}>{busy ? 'Sending…' : 'Send'}</Button>}
    >
      <div className="c-stack">
        {isDraft && (
          <Notice tone="info">
            Sending issues the invoice: it moves to Sent, gets its due date (15 days) and its GST split is fixed. It is only marked sent if the email goes out.
          </Notice>
        )}
        <Field label="To" required><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="CC" hint="Comma-separated"><Input value={cc} onChange={(e) => setCc(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

const ymd = (v) => (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || '';

/** Mark laptops as already billed on a Zoho invoice (first-order invoices). */
export function ZohoDrawer({ invoice, candidates = [], open, onClose, onDone }) {
  const initial = useMemo(() => candidates.filter((c) => c.on_invoice).map((c) => Number(c.serial_id)), [candidates]);
  const [picked, setPicked] = useState(new Set());
  const [ref, setRef] = useState('');
  const [through, setThrough] = useState('');
  const [security, setSecurity] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPicked(new Set(initial));
    setRef(invoice?.external_reference || '');
    setThrough(ymd(invoice?.to_date));
    setSecurity(true);
  }, [open, initial, invoice]);
  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const submit = async () => {
    setBusy(true);
    try {
      await markZoho(invoice.invoice_id, {
        serial_ids: [...picked],
        rent_billed_through: through,
        include_security: security,
        external_reference: ref.trim() || undefined,
      });
      toast.success('Marked as billed on Zoho — later invoices skip that rent and security');
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Could not mark the Zoho invoice'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Invoice generated on Zoho"
      footer={<Button variant="primary" disabled={busy || !picked.size || !through} onClick={submit}>{busy ? 'Saving…' : 'Mark billed on Zoho'}</Button>}
    >
      <div className="c-stack">
        <Notice tone="info">
          For a first-order invoice raised on Zoho: the laptops ticked here will not bring previous-month catch-up or security onto the next CRM invoice.
        </Notice>
        <FormGrid cols={2}>
          <Field label="Zoho invoice number"><Input value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} /></Field>
          <Field label="Rent billed through" required><Input type="date" value={through} onChange={(e) => setThrough(e.target.value)} /></Field>
        </FormGrid>
        <Checkbox label="Security already collected on Zoho" checked={security} onChange={(e) => setSecurity(e.target.checked)} />
        <div className="c-card">
          <div className="c-card-h"><h3>Laptops billed on Zoho ({picked.size})</h3></div>
          <div className="c-card-b" style={{ maxHeight: '280px', overflowY: 'auto', display: 'grid', gap: '6px' }}>
            {!candidates.length && <span className="text-ink-3">No rented laptops found for this customer.</span>}
            {candidates.map((c) => (
              <Checkbox
                key={c.serial_id}
                checked={picked.has(Number(c.serial_id))}
                onChange={() => toggle(Number(c.serial_id))}
                label={`${c.ttspl_id || `Serial ${c.serial_id}`} · delivered ${ymd(c.delivery_date) || '—'}${c.dc_number ? ` · ${c.dc_number}` : ''}${c.already_zoho ? ' · Zoho' : ''}`}
              />
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  );
}

/** MD4 — cancel with a reason; what it consumed is released. */
export function CancelInvoiceDrawer({ invoice, open, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setReason(''); }, [open]);
  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await cancelInvoice(invoice.invoice_id, reason.trim());
      const r = data.invoice?.released || {};
      toast.success(`${data.message}${r.credit_notes?.length ? ` · ${r.credit_notes.length} credit note(s) released` : ''}`);
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Could not cancel this invoice'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Cancel ${invoice?.invoice_number || ''}`}
      footer={<Button variant="primary" disabled={busy || reason.trim().length < 5} onClick={submit}>{busy ? 'Cancelling…' : 'Cancel invoice'}</Button>}
    >
      <div className="c-stack">
        <Notice tone="warn" title="Cancelling withdraws a statutory document">
          An invoice with any payment against it cannot be cancelled — raise a credit note instead. Credit notes applied on it go back to approved,
          security deposits it billed are released and each laptop&apos;s rent from this invoice is billed again on the next one. The month stays taken by the cancelled invoice.
        </Notice>
        <Field label="Reason" required hint="At least 5 characters; shown on the timeline">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

/** Generate the month's invoices for chosen customers, or all billable ones. */
export function GenerateInvoicesDrawer({ open, onClose, onDone, initialMonth, initialYear, initialCustomerIds }) {
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setMonth(String(initialMonth || now.getMonth() + 1));
    setYear(String(initialYear || now.getFullYear()));
    setAll(false);
    setPicked(new Set((initialCustomerIds || []).map(String)));
    setQ('');
  }, [open, initialMonth, initialYear, initialCustomerIds]);

  useEffect(() => {
    if (!open || !month || !year) return undefined;
    let off = false;
    listCoverage({ month, year })
      .then(({ data }) => { if (!off) setRows(data?.customers || []); })
      .catch(() => { if (!off) setRows([]); });
    return () => { off = true; };
  }, [open, month, year]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => words.every((w) => String(r.customer_name || '').toLowerCase().includes(w)));
  }, [rows, q]);
  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await generateInvoicesBulk({
        month: Number(month),
        year: Number(year),
        all,
        customer_ids: all ? undefined : [...picked].map(Number),
      });
      const s = data.summary || {};
      const parts = [];
      if (s.created) parts.push(`${s.created} created`);
      if (s.appended) parts.push(`${s.appended} updated`);
      if (s.credit_notes_applied) parts.push(`${s.credit_notes_applied} credit notes applied`);
      if (s.skipped) parts.push(`${s.skipped} skipped`);
      if (s.errors) parts.push(`${s.errors} failed`);
      toast.success(parts.join(', ') || 'Nothing to generate');
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Generate failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Generate invoices"
      width="36rem"
      footer={<Button variant="primary" disabled={busy || (!all && !picked.size)} onClick={submit}>{busy ? 'Generating…' : `Generate ${all ? 'for all billable customers' : `for ${picked.size} customer(s)`}`}</Button>}
    >
      <div className="c-stack">
        <Notice tone="info">
          Every invoice made here — and by the monthly run and on delivery — gets its GST split, a 15-day due date and any approved credit notes that fit.
          An existing draft is updated, never duplicated; an issued invoice is left alone.
        </Notice>
        <FormGrid cols={2}>
          <Field label="Month"><Select options={MONTH_OPTIONS} value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
          <Field label="Year"><Select options={yearOptions()} value={year} onChange={(e) => setYear(e.target.value)} /></Field>
        </FormGrid>
        <Checkbox label="All billable customers" checked={all} onChange={(e) => setAll(e.target.checked)} />
        {!all && (
          <div className="c-card">
            <div className="c-card-h">
              <h3>Customers with rental laptops ({picked.size} picked)</h3>
              <div className="flex" style={{ gap: '6px' }}>
                <Button variant="quiet" onClick={() => setPicked(new Set(shown.filter((r) => !r.invoice_id).map((r) => String(r.customer_id))))}>Pick all without an invoice</Button>
                <Button variant="quiet" onClick={() => setPicked(new Set())}>Clear</Button>
              </div>
            </div>
            <div className="c-card-b c-stack">
              <Input placeholder="Search customer" value={q} onChange={(e) => setQ(e.target.value)} />
              <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'grid', gap: '6px' }}>
                {!shown.length && <span className="text-ink-3">No customers with rental laptops for this month.</span>}
                {shown.map((r) => (
                  <Checkbox
                    key={r.customer_id}
                    checked={picked.has(String(r.customer_id))}
                    onChange={() => toggle(String(r.customer_id))}
                    label={`${r.customer_name} · ${r.asset_count} laptop(s)${r.invoice_number ? ` · ${r.invoice_number} (${r.invoice_status})` : ' · no invoice yet'}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
