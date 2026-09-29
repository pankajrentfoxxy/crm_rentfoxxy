import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, Field, FormGrid, Input, Money, Notice, SearchSelect, Section, Select, Textarea,
} from '../../../components/carret';
import {
  MONTHS, createCreditNote, errMsg, getInvoice, listInvoices, useCustomerOptions,
} from './moneyApi';

/**
 * New credit note (Builder 1, MD2) — against an issued invoice of the
 * customer, optionally for chosen laptops on it. The server takes the number
 * from the CN/yy-yy series, refuses Rs 0 and anything above what the invoice
 * has left to credit, and creates it as a draft for someone else to approve.
 * Opened from an invoice it arrives with the customer and invoice filled in.
 */
const ISSUED = ['sent', 'overdue', 'partially_paid', 'paid'];
const isSecurity = (l) => l?.line_type === 'security' || l?.is_security === true || l?.is_security === 'true';

export default function CreditNoteFormPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const customerOptions = useCustomerOptions();
  const [customerId, setCustomerId] = useState(params.get('customer') || '');
  const [invoiceId, setInvoiceId] = useState(params.get('invoice') || '');
  const [invoices, setInvoices] = useState([]);
  const [invoice, setInvoice] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [form, setForm] = useState({ reason: '', description: '', amount: '', from_date: '', to_date: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!customerId) { setInvoices([]); return undefined; }
    let off = false;
    listInvoices({ customer_id: customerId, limit: 200 })
      .then(({ data }) => { if (!off) setInvoices((data.invoices || []).filter((i) => ISSUED.includes(String(i.status).toLowerCase()))); })
      .catch(() => { if (!off) setInvoices([]); });
    return () => { off = true; };
  }, [customerId]);

  useEffect(() => {
    if (!invoiceId) { setInvoice(null); return undefined; }
    let off = false;
    getInvoice(invoiceId)
      .then(({ data }) => {
        if (off) return;
        setInvoice(data.invoice);
        if (!customerId && data.invoice?.customer_id) setCustomerId(String(data.invoice.customer_id));
      })
      .catch((e) => { if (!off) { setInvoice(null); toast.error(errMsg(e)); } });
    setPicked(new Set());
    return () => { off = true; };
  }, [invoiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = useMemo(() => {
    const raw = invoice?.line_items;
    const arr = Array.isArray(raw) ? raw : [];
    return arr.filter((l) => !isSecurity(l) && l.ttspl_id);
  }, [invoice]);
  const pickedLines = lines.filter((l, i) => picked.has(`${l.ttspl_id}|${i}`));
  const pickedAmount = pickedLines.reduce((a, l) => a + Number(l.amount || 0), 0);
  const invoiceOptions = invoices.map((i) => ({
    value: String(i.invoice_id),
    label: `${i.invoice_number} · ${MONTHS[i.invoice_month] || ''} ${i.invoice_year} · ₹${Number(i.grand_total).toLocaleString('en-IN')} · ${i.status}`,
  }));
  if (invoice && !invoiceOptions.some((o) => o.value === String(invoice.invoice_id))) {
    invoiceOptions.unshift({ value: String(invoice.invoice_id), label: `${invoice.invoice_number} · ${invoice.status}` });
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const amt = Number(form.amount);
  const invStatus = String(invoice?.status || '').toLowerCase();
  const invoiceOk = invoice && ISSUED.includes(invStatus) && String(invoice.customer_id) === String(customerId);
  const valid = customerId && invoiceOk && form.reason.trim().length >= 3 && amt > 0
    && (!form.from_date || !form.to_date || form.from_date <= form.to_date);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const { data } = await createCreditNote({
        customer_id: Number(customerId),
        invoice_id: Number(invoiceId),
        reason: form.reason.trim(),
        description: form.description.trim() || undefined,
        amount: Math.round(amt * 100) / 100,
        from_date: form.from_date || undefined,
        to_date: form.to_date || undefined,
        ttspl_ids: pickedLines.map((l) => l.ttspl_id),
        quantity: pickedLines.length || undefined,
      });
      toast.success(`${data.credit_note.credit_note_number} raised — awaiting approval`);
      navigate(`/carret/money/credit-notes/${data.credit_note.credit_note_id}`);
    } catch (e) {
      toast.error(errMsg(e, 'Could not raise the credit note'));
      setBusy(false);
    }
  };

  const togglePick = (k) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  return (
    <DeskShell
      title="New credit note"
      breadcrumb="Finance / Credit notes"
      actions={<Button variant="primary" disabled={!valid || busy} onClick={submit}>{busy ? 'Raising…' : 'Raise for approval'}</Button>}
    >
      <div className="c-stack">
        <Notice tone="info">
          A credit note is raised against an issued invoice of the same customer and needs a different person to approve it.
          Once approved it comes off the customer&apos;s next draft invoice. It cannot be more than the invoice has left to credit.
        </Notice>
        <Section title="Against">
          <FormGrid cols={2}>
            <Field label="Customer" required>
              <SearchSelect options={customerOptions} value={customerId} placeholder="Choose customer" onChange={(e) => { setCustomerId(e.target.value); setInvoiceId(''); }} />
            </Field>
            <Field label="Invoice" required hint={customerId && !invoices.length ? 'No issued invoices for this customer' : 'Issued invoices only'}>
              <Select options={invoiceOptions} placeholder="Choose invoice" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} />
            </Field>
          </FormGrid>
          {invoice && (
            <p className="font-ui text-ink-2" style={{ fontSize: 'var(--d-sm)', marginTop: '10px' }}>
              {invoice.invoice_number}: total <Money value={invoice.grand_total} />, received <Money value={invoice.amount_paid || 0} />.
              {!invoiceOk && ' This invoice cannot be credited (it is a draft, cancelled, or another customer’s).'}
            </p>
          )}
        </Section>

        {lines.length > 0 && (
          <Section title={`Laptops on the invoice (${picked.size} ticked · ₹${pickedAmount.toLocaleString('en-IN')} billed)`}>
            <div style={{ display: 'grid', gap: '6px', maxHeight: '300px', overflowY: 'auto' }}>
              {lines.map((l, i) => {
                const k = `${l.ttspl_id}|${i}`;
                return (
                  <Checkbox
                    key={k}
                    checked={picked.has(k)}
                    onChange={() => togglePick(k)}
                    label={`${l.ttspl_id} · ${[l.brand, l.model].filter(Boolean).join(' ')} · ${String(l.rent_start || '').slice(0, 10)} → ${String(l.rent_end || '').slice(0, 10)} · ₹${Number(l.amount || 0).toLocaleString('en-IN')}`}
                  />
                );
              })}
            </div>
            {picked.size > 0 && (
              <div style={{ marginTop: '10px' }}>
                <Button variant="quiet" onClick={() => setForm((f) => ({ ...f, amount: pickedAmount.toFixed(2) }))}>Use the ticked laptops&apos; billed amount</Button>
              </div>
            )}
          </Section>
        )}

        <Section title="Credit">
          <FormGrid cols={2}>
            <Field label="Reason" required><Input value={form.reason} maxLength={250} onChange={set('reason')} /></Field>
            <Field label="Amount" required hint="Deducted from the next invoice total"><Input type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} /></Field>
            <Field label="Credited from"><Input type="date" value={form.from_date} onChange={set('from_date')} /></Field>
            <Field label="Credited to" error={form.from_date && form.to_date && form.from_date > form.to_date ? 'Before the start date' : undefined}><Input type="date" value={form.to_date} onChange={set('to_date')} /></Field>
          </FormGrid>
          <Field label="Description"><Textarea rows={3} value={form.description} onChange={set('description')} /></Field>
        </Section>
      </div>
    </DeskShell>
  );
}
