import React, { useMemo, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import DeskShell from '../../shells/DeskShell';
import {
  DataTable, Panel, Timeline, EmptyState, Button, Money, DateTime, DocNumber, StatTile,
} from '../../components/carret';
import { useInvoiceTimeline, useInvoicePayments, cancelInvoice } from './useMoney';

/**
 * Invoice record (Part 6.4).
 *
 * Two of the three panels here are the visible half of Part 6.2:
 *
 *   Timeline  BL11 — billing wrote zero audit rows. Generation, send, mark-paid,
 *             approval and cancellation all left no trace, so "who sent this"
 *             and "why was this cancelled" had no answer. It reads the single
 *             events table from Part 2.1, not a billing-specific audit log.
 *   Payments  BL18 — the payment ledger has worked for months with nothing in
 *             the UI calling it. Partial payments could only be entered by
 *             hitting the API directly.
 *
 * And cancelling is BL13: 'cancelled' was filtered on in three places and set
 * nowhere, so every correction was a direct database write with no reason and
 * no trail.
 */

function CancelPanel({ invoiceId, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await cancelInvoice(invoiceId, reason.trim());
      setOpen(false);
      setReason('');
      onDone?.();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not cancel this invoice');
    } finally {
      setBusy(false);
    }
  }, [invoiceId, reason, onDone]);

  if (!open) {
    return <Button variant="quiet" onClick={() => setOpen(true)}>Cancel invoice</Button>;
  }

  return (
    <div
      className="border border-rule bg-surface"
      style={{ padding: 'var(--d-pad-x)', borderRadius: 'var(--d-radius)', display: 'grid', gap: 'var(--d-gap)' }}
    >
      <p className="font-ui text-ink-2 m-0" style={{ fontSize: 'var(--d-sm)' }}>
        Cancelling withdraws a statutory document. An invoice with payment against it cannot be
        cancelled — raise a credit note instead. The reason is stored and appears on the timeline.
      </p>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this being cancelled?"
        className="border border-rule bg-surface text-ink font-ui"
        style={{ padding: 'var(--d-pad-y) var(--d-pad-x)', borderRadius: 'var(--d-radius)' }}
      />
      {error ? (
        <p className="m-0 font-ui" style={{ color: 'var(--alert-crit)', fontSize: 'var(--d-sm)' }}>{error}</p>
      ) : null}
      <div className="flex" style={{ gap: 'var(--d-gap)' }}>
        <Button variant="primary" onClick={submit} disabled={busy || reason.trim().length < 5}>
          {busy ? 'Cancelling…' : 'Confirm cancellation'}
        </Button>
        <Button variant="quiet" onClick={() => { setOpen(false); setError(''); }}>Keep it</Button>
      </div>
    </div>
  );
}

export default function InvoiceRecordPage() {
  const { invoiceId } = useParams();
  const timeline = useInvoiceTimeline(invoiceId);
  const ledger = useInvoicePayments(invoiceId);

  const paid = useMemo(
    () => ledger.payments.reduce((a, p) => a + Number(p.amount || 0), 0),
    [ledger.payments]
  );

  const paymentColumns = useMemo(() => [
    { key: 'payment_date', header: 'Date', render: (r) => <DateTime value={r.payment_date} /> },
    { key: 'amount', header: 'Amount', numeric: true, render: (r) => <Money value={r.amount} /> },
    { key: 'method', header: 'Method', render: (r) => r.method || '—' },
    { key: 'reference', header: 'Reference', render: (r) => (r.reference ? <DocNumber value={r.reference} /> : '—') },
    { key: 'notes', header: 'Notes', render: (r) => r.notes || '—' },
  ], []);

  return (
    <DeskShell
      title={`Invoice #${invoiceId}`}
      breadcrumb="Money / Customer Invoices"
      subtitle="Payments received against this invoice, its history, and corrections."
    >
      <div style={{ display: 'grid', gap: '16px' }}>
        <div
          style={{
            display: 'grid',
            gap: '12px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          <StatTile label="Payments recorded" value={ledger.loading ? null : ledger.payments.length} />
          <StatTile label="Received" value={ledger.loading ? null : <Money value={paid} showZero />} />
          <StatTile label="Timeline entries" value={timeline.loading ? null : timeline.events.length} />
        </div>

        <Panel title="Payments">
          {ledger.loading && <EmptyState title="Loading…" />}
          {ledger.error && <EmptyState title="Could not load payments" body={ledger.error} />}
          {!ledger.loading && !ledger.error && (
            <DataTable
              columns={paymentColumns}
              rows={ledger.payments}
              rowKey={(r, i) => r.payment_id || i}
              empty={<EmptyState
                title="No payments recorded"
                body="The ledger behind this screen has worked for months with nothing calling it. Partial payments used to be enterable only through the API."
              />}
            />
          )}
        </Panel>

        <Panel title="Timeline">
          {timeline.loading && <EmptyState title="Loading…" />}
          {timeline.error && <EmptyState title="Could not load the timeline" body={timeline.error} />}
          {!timeline.loading && !timeline.error && (
            timeline.events.length
              // The Timeline component takes events table rows as they come —
              // occurred_at, actor_name, event_type, from_state, to_state. No
              // reshaping: it was built against that shape in Part 1.
              ? <div className="c-card-b"><Timeline events={timeline.events} /></div>
              : (
                <EmptyState
                  title="Nothing recorded yet"
                  body="Billing only began writing to the event spine in Part 6.2, so invoices raised before then have no history. Anything that happens from here appears."
                />
              )
          )}
        </Panel>

        <Panel title="Correct this invoice">
          <div className="c-card-b">
            <CancelPanel invoiceId={invoiceId} onDone={() => { timeline.refresh(); ledger.refresh(); }} />
          </div>
        </Panel>
      </div>
    </DeskShell>
  );
}
