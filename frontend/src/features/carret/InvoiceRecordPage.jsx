import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, DocumentHeader, EmptyState, Input, Money, Notice, Section, Segmented, StatTile, Timeline,
} from '../../components/carret';
import { usePermission } from '../../hooks/usePermission';
import {
  MONTHS, blobErrMsg, errMsg, getInvoice, invoicePdf, invoiceTimeline, listInvoicePayments, saveBlob,
} from './money/moneyApi';
import { MoneyChip, Tiles, outstandingOf } from './money/moneyShared';
import {
  CancelInvoiceDrawer, MarkPaidDrawer, RecordPaymentDrawer, SendInvoiceDrawer, ZohoDrawer,
} from './money/InvoiceDrawers';

/**
 * Invoice record (Builder 1). Everything the old detail page did — lines with
 * the full-month / catch-up split, totals, credit notes, send, Zoho, PDF,
 * mark paid — plus what it could not: Record payment (MD1) with the payment
 * history, the GST heads, the due date, security billed, the timeline, and
 * cancel with the MD4 guard.
 */

const isSecurity = (l) => l?.line_type === 'security' || l?.is_security === true || l?.is_security === 'true';
const isCatchup = (l) => l?.is_catchup === true || l?.is_catchup === 'true';
const tidy = (v) => { const s = String(v || '').replace(/\s+/g, ' ').trim(); return !s || s === '-' ? '' : s; };
const spec = (l) => [tidy(l.processor), tidy(l.generation), tidy(l.ram), tidy(l.storage)].filter(Boolean).join(' · ');
const item = (l) => {
  const b = tidy(l.brand); const m = tidy(l.model);
  if (b && m && !m.toLowerCase().startsWith(b.toLowerCase())) return `${b} ${m}`;
  return m || b || '—';
};
const lineKind = (l) => (isSecurity(l) ? 'security' : isCatchup(l) ? 'catchup' : 'rent');

export default function InvoiceRecordPage() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('customer_billing', 'edit');
  const canCancel = hasPermission('customer_billing', 'delete');
  const canCredit = hasPermission('credit_notes', 'create');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [payments, setPayments] = useState([]);
  const [events, setEvents] = useState([]);
  const [drawer, setDrawer] = useState('');
  const [lineView, setLineView] = useState('all');
  const [q, setQ] = useState('');
  const [pdfBusy, setPdfBusy] = useState('');

  const load = useCallback(() => {
    getInvoice(invoiceId)
      .then(({ data: d }) => { setData(d); setError(''); })
      .catch((e) => setError(errMsg(e, 'Invoice not found')));
    listInvoicePayments(invoiceId).then(({ data: d }) => setPayments(d.payments || [])).catch(() => setPayments([]));
    invoiceTimeline(invoiceId).then(({ data: d }) => setEvents(d.events || [])).catch(() => setEvents([]));
  }, [invoiceId]);
  useEffect(() => { load(); }, [load]);

  const inv = data?.invoice;
  const lines = useMemo(() => {
    const raw = inv?.line_items;
    const arr = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
    return Array.isArray(arr) ? arr : [];
  }, [inv]);
  const counts = useMemo(() => ({
    all: lines.length,
    rent: lines.filter((l) => lineKind(l) === 'rent').length,
    catchup: lines.filter((l) => lineKind(l) === 'catchup').length,
    security: lines.filter((l) => lineKind(l) === 'security').length,
  }), [lines]);
  const shownLines = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return lines.filter((l) => (lineView === 'all' || lineKind(l) === lineView)
      && words.every((w) => [l.ttspl_id, l.serial_number, l.brand, l.model, l.processor, l.dc_number]
        .map((v) => String(v || '').toLowerCase()).join(' ').includes(w)));
  }, [lines, lineView, q]);

  const download = async (format) => {
    setPdfBusy(format);
    try {
      const { data: blob } = await invoicePdf(invoiceId, format);
      saveBlob(blob, `${inv.invoice_number}${format === 'laptop_details' ? '-laptops' : ''}.pdf`.replace(/\//g, '-'), 'application/pdf');
    } catch (e) {
      toast.error(await blobErrMsg(e, 'PDF download failed'));
    } finally {
      setPdfBusy('');
    }
  };

  if (error) {
    return (
      <DeskShell title="Invoice" breadcrumb="Finance / Customer invoices">
        <EmptyState title="Could not open this invoice" body={error} action={<Button onClick={() => navigate('/carret/money/invoices')}>Back to invoices</Button>} />
      </DeskShell>
    );
  }
  if (!inv) {
    return <DeskShell title="Invoice" breadcrumb="Finance / Customer invoices"><EmptyState title="Loading…" /></DeskShell>;
  }

  const st = String(inv.status || '').toLowerCase();
  const due = outstandingOf(inv);
  const issued = ['sent', 'overdue', 'partially_paid'].includes(st);
  const received = payments.reduce((a, p) => a + Number(p.amount || 0), 0);
  const creditNotes = data.credit_notes || [];
  const deposits = data.security_deposits || [];
  const gstLabel = inv.is_intra_state === null || inv.is_intra_state === undefined
    ? `GST ${inv.gst_percent}% (not classified)`
    : inv.is_intra_state ? 'CGST + SGST' : 'IGST';

  const lineCols = [
    { key: 't', header: 'Laptop', render: (l) => l.ttspl_id || '—', sub: (l) => (l.serial_number ? `SN ${l.serial_number}` : null) },
    { key: 'i', header: 'Item', render: (l) => item(l), sub: (l) => spec(l) || null },
    {
      key: 'p',
      header: 'Period',
      render: (l) => (isSecurity(l)
        ? <span>Delivered <DateTime value={l.delivery_date || l.rent_start} /></span>
        : <span><DateTime value={l.rent_start} /> → <DateTime value={l.rent_end} /></span>),
      sub: (l) => [isSecurity(l) ? 'security' : null, isCatchup(l) ? 'catch-up' : null, l.returned ? 'returned' : null, l.dc_number || null].filter(Boolean).join(' · ') || null,
    },
    { key: 'd', header: 'Days', numeric: true, render: (l) => (isSecurity(l) ? '—' : `${l.days_in_month ?? '—'}${l.month_days ? `/${l.month_days}` : ''}`) },
    { key: 'r', header: 'Monthly rate', numeric: true, render: (l) => <Money value={l.monthly_rate} showZero={false} /> },
    { key: 'a', header: 'Amount', numeric: true, render: (l) => <Money value={l.amount} /> },
  ];

  const payCols = [
    { key: 'd', header: 'Received', render: (p) => <DateTime value={p.payment_date} />, sub: (p) => p.recorded_by_name || null },
    { key: 'a', header: 'Amount', numeric: true, render: (p) => <Money value={p.amount} /> },
    { key: 'm', header: 'Method', render: (p) => p.method || '—' },
    { key: 'r', header: 'Reference', render: (p) => (p.reference ? <DocNumber value={p.reference} /> : '—') },
    { key: 'n', header: 'Notes', render: (p) => p.notes || '—' },
  ];

  const cnCols = [
    { key: 'n', header: 'Credit note', render: (c) => <Link to={`/carret/money/credit-notes/${c.credit_note_id}`}><DocNumber value={c.credit_note_number} /></Link>, sub: (c) => c.credit_note_type || null },
    { key: 's', header: 'Status', render: (c) => <MoneyChip status={c.status} /> },
    {
      key: 'w',
      header: 'On this invoice',
      render: (c) => (Number(c.applied_in_invoice_id) === Number(inv.invoice_id) ? 'Deducted here' : 'Credits this invoice'),
    },
    { key: 'a', header: 'Amount', numeric: true, render: (c) => <Money value={c.amount} /> },
  ];

  return (
    <DeskShell title={inv.invoice_number} breadcrumb="Finance / Customer invoices">
      <div className="c-stack">
        <DocumentHeader
          docNumber={inv.invoice_number}
          type="Tax invoice"
          status={null}
          actions={(
            <>
              <MoneyChip status={inv.status} />
              {canEdit && st !== 'cancelled' && <Button variant={st === 'draft' ? 'primary' : 'secondary'} onClick={() => setDrawer('send')}>{st === 'draft' ? 'Send to customer' : 'Send again'}</Button>}
              {canEdit && issued && due > 0 && <Button variant="primary" onClick={() => setDrawer('pay')}>Record payment</Button>}
              {canEdit && issued && due > 0 && <Button onClick={() => setDrawer('paid')}>Mark paid</Button>}
              {canEdit && st !== 'cancelled' && <Button variant="quiet" onClick={() => setDrawer('zoho')}>Billed on Zoho</Button>}
              {canCredit && ['sent', 'overdue', 'partially_paid', 'paid'].includes(st) && (
                <Button variant="quiet" onClick={() => navigate(`/carret/money/credit-notes/new?invoice=${inv.invoice_id}&customer=${inv.customer_id}`)}>Raise credit note</Button>
              )}
              <Button variant="quiet" disabled={pdfBusy === 'tax_invoice'} onClick={() => download('tax_invoice')}>Invoice PDF</Button>
              <Button variant="quiet" disabled={pdfBusy === 'laptop_details'} onClick={() => download('laptop_details')}>Laptop list PDF</Button>
              {canCancel && !['cancelled', 'paid', 'partially_paid'].includes(st) && Number(inv.amount_paid || 0) === 0 && (
                <Button variant="quiet" onClick={() => setDrawer('cancel')}>Cancel invoice</Button>
              )}
            </>
          )}
          meta={[
            { label: 'Customer', value: <Link to={`/carret/sell/customers/${inv.customer_id}`}>{inv.customer_name || `#${inv.customer_id}`}</Link> },
            { label: 'Billing month', value: `${MONTHS[inv.invoice_month] || ''} ${inv.invoice_year || ''}` },
            { label: 'Period', value: <span><DateTime value={inv.from_date} /> – <DateTime value={inv.to_date} /></span> },
            { label: 'Raised', value: <DateTime value={inv.invoice_date} /> },
            { label: 'Due', value: inv.due_date ? <DateTime value={inv.due_date} /> : 'on sending' },
            { label: 'GSTIN', value: inv.gst_number || 'No GST' },
            { label: 'Place of supply', value: inv.place_of_supply || '—' },
            inv.billing_source === 'zoho' ? { label: 'Zoho invoice', value: inv.external_reference || 'Generated on Zoho' } : null,
          ].filter(Boolean)}
        />

        {st === 'cancelled' && (
          <Notice tone="warn" title="Cancelled">
            <DateTime value={inv.cancelled_at} /> — {inv.cancellation_reason || 'no reason recorded'}
          </Notice>
        )}
        {st === 'draft' && (
          <Notice tone="info">A draft is not issued: it takes no payment and has no due date until it is sent. The monthly run may still update it.</Notice>
        )}

        <Tiles>
          <StatTile label="Grand total" value={<Money value={inv.grand_total} />} />
          <StatTile label="Received" value={<Money value={received} />} delta={`${payments.length} payment(s)`} />
          <StatTile label="Outstanding" value={st === 'cancelled' || st === 'draft' ? '—' : <Money value={due} />} family={st === 'overdue' ? 'offcycle' : undefined} />
          <StatTile label="Laptops" value={new Set(lines.filter((l) => !isSecurity(l)).map((l) => l.serial_id || l.ttspl_id || l.serial_number)).size} delta={`${counts.all} line(s)`} />
        </Tiles>

        <div className="c-split">
          <Section
            title="Lines"
            actions={(
              <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
                <Segmented
                  label="Show"
                  value={lineView}
                  onChange={setLineView}
                  options={[
                    { value: 'all', label: `All ${counts.all}` },
                    { value: 'rent', label: `Rent ${counts.rent}` },
                    { value: 'catchup', label: `Catch-up ${counts.catchup}` },
                    { value: 'security', label: `Security ${counts.security}` },
                  ]}
                />
                <div style={{ width: '220px' }}><Input placeholder="TTSPL, serial, model…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              </div>
            )}
          >
            <DataTable columns={lineCols} rows={shownLines} rowKey={(l, i) => `${l.serial_id || l.ttspl_id || 'l'}-${l.rent_start || ''}-${i}`} empty={<EmptyState title="No lines match" />} />
          </Section>

          <div className="c-stack">
            <Section title="Totals">
              <div className="c-totals">
                <div><span>Subtotal</span><span><Money value={inv.subtotal} /></span></div>
                {inv.is_intra_state === true && (
                  <>
                    <div><span>CGST {Number(inv.gst_percent) / 2}%</span><span><Money value={inv.cgst_amount} /></span></div>
                    <div><span>SGST {Number(inv.gst_percent) / 2}%</span><span><Money value={inv.sgst_amount} /></span></div>
                  </>
                )}
                {inv.is_intra_state === false && <div><span>IGST {inv.gst_percent}%</span><span><Money value={inv.igst_amount} /></span></div>}
                {(inv.is_intra_state === null || inv.is_intra_state === undefined) && <div><span>{gstLabel}</span><span><Money value={inv.gst_amount} /></span></div>}
                {Number(inv.credit_note_adjustment) > 0 && <div><span>Credit notes</span><span><Money value={-Number(inv.credit_note_adjustment)} /></span></div>}
                {Number(inv.security_deposit) > 0 && <div><span>Security deposit</span><span><Money value={inv.security_deposit} /></span></div>}
                <div className="is-grand"><span>Grand total</span><span><Money value={inv.grand_total} /></span></div>
                {Number(inv.amount_paid) > 0 && <div><span>Received</span><span><Money value={-Number(inv.amount_paid)} /></span></div>}
                {issued && <div className="is-grand"><span>Outstanding</span><span><Money value={due} /></span></div>}
              </div>
            </Section>
            <Section title="E-invoice / e-way bill">
              <div className="c-totals">
                <div><span>IRN</span><span>{inv.irn || 'not generated'}</span></div>
                <div><span>E-way bill</span><span>{inv.eway_bill_number || 'not generated'}</span></div>
              </div>
            </Section>
            {deposits.length > 0 && (
              <Section title="Security billed here">
                <DataTable
                  columns={[
                    { key: 't', header: 'Laptop', render: (d) => d.ttspl_id || `Serial ${d.serial_id || '—'}` },
                    { key: 's', header: 'Status', render: (d) => <MoneyChip status={d.status} /> },
                    { key: 'a', header: 'Amount', numeric: true, render: (d) => <Money value={d.amount} /> },
                  ]}
                  rows={deposits}
                  rowKey={(d) => d.deposit_id}
                />
              </Section>
            )}
          </div>
        </div>

        <Section
          title="Payments"
          actions={canEdit && issued && due > 0 ? <Button variant="primary" onClick={() => setDrawer('pay')}>Record payment</Button> : null}
        >
          <DataTable columns={payCols} rows={payments} rowKey={(p) => p.payment_id} empty={<EmptyState title="No payments recorded" body={issued ? 'Record each payment as it arrives.' : 'Payments are recorded once the invoice is sent.'} />} />
        </Section>

        <Section title="Credit notes">
          <DataTable columns={cnCols} rows={creditNotes} rowKey={(c) => c.credit_note_id} empty={<EmptyState title="No credit notes against this invoice" />} />
        </Section>

        <Section title="Timeline">
          {events.length ? <Timeline events={events} /> : <EmptyState title="Nothing recorded yet" body="Invoices raised before billing wrote to the event log have no history." />}
        </Section>
      </div>

      <RecordPaymentDrawer invoice={inv} open={drawer === 'pay'} onClose={() => setDrawer('')} onDone={load} />
      <MarkPaidDrawer invoice={inv} open={drawer === 'paid'} onClose={() => setDrawer('')} onDone={load} />
      <SendInvoiceDrawer invoice={inv} open={drawer === 'send'} onClose={() => setDrawer('')} onDone={load} />
      <ZohoDrawer invoice={inv} candidates={data.zoho_candidates || []} open={drawer === 'zoho'} onClose={() => setDrawer('')} onDone={load} />
      <CancelInvoiceDrawer invoice={inv} open={drawer === 'cancel'} onClose={() => setDrawer('')} onDone={load} />
    </DeskShell>
  );
}
