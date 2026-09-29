import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, FlowSteps, FormGrid,
  Input, KeyValue, Money, Notice, Section, Select, StatusChip, Textarea, Timeline,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import { useAuth } from '../../../../context/AuthContext';
import {
  BILL_STATUS_LABEL, DN_STATUS_LABEL, PAYMENT_METHODS, approveVendorBill, billChipStatus, cancelVendorBill,
  dnChipStatus, downloadVendorBillPdf, errMsg, monthLabel, outstandingOf, recordVendorPayment, todayIst, useVendorBill,
} from './vendorMoneyApi';

/**
 * Finance → Vendors → one vendor bill. Replaces vendor-billing/VendorBillDetailPage.
 *
 *   Generated   someone other than the generator approves it (maker-checker)
 *   Approved    payments recorded against it, never more than is still owed
 *   Cancel      only while nothing is paid; its debit notes go back to the next bill
 */
function parseLines(bill) {
  const raw = bill?.line_items;
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch (_) { return []; }
}

const LINE_COLS = [
  { key: 'ttspl', header: 'Asset', render: (l) => <DocNumber value={l.ttspl_id || '—'} />, sub: (l) => l.serial_number },
  { key: 'from', header: 'Rent from', render: (l) => <DateTime value={l.rent_start || l.received_date} /> },
  { key: 'to', header: 'Rent to', render: (l) => <DateTime value={l.rent_end} />, sub: (l) => (l.is_returned ? 'returned' : null) },
  { key: 'days', header: 'Days', numeric: true, render: (l) => l.days_in_month ?? '—', sub: (l) => (Number(l.paused_days) > 0 ? `${l.paused_days} at vendor` : null) },
  { key: 'rate', header: 'Monthly rate', numeric: true, render: (l) => <Money value={l.monthly_rate} /> },
  { key: 'amt', header: 'Amount', numeric: true, render: (l) => <Money value={l.amount} /> },
];

const PAY_COLS = [
  { key: 'd', header: 'Paid on', render: (p) => <DateTime value={p.payment_date} /> },
  { key: 'm', header: 'Method', render: (p) => (p.method || '—').toUpperCase() },
  { key: 'r', header: 'Reference', render: (p) => p.reference || '—', sub: (p) => p.notes || null },
  { key: 'a', header: 'Amount', numeric: true, render: (p) => <Money value={p.amount} /> },
];

function PaymentDrawer({ open, onClose, bill, onDone }) {
  const owed = outstandingOf(bill);
  const [form, setForm] = useState({ amount: owed ? owed.toFixed(2) : '', payment_date: todayIst(), method: 'neft', reference: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const amt = Number(form.amount);
  const tooMuch = amt > owed + 0.001;

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await recordVendorPayment(bill.bill_id, {
        amount: amt,
        payment_date: form.payment_date,
        method: form.method,
        reference: form.reference.trim() || null,
        notes: form.notes.trim() || null,
      });
      toast.success(data.status === 'paid' ? 'Paid in full' : 'Payment recorded');
      onDone();
    } catch (e) {
      toast.error(errMsg(e, 'Could not record the payment.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Pay ${bill.bill_number}`}
      footer={(
        <Button variant="primary" disabled={busy || !(amt > 0) || tooMuch || !form.payment_date} onClick={save}>
          {busy ? 'Saving…' : 'Record payment'}
        </Button>
      )}
    >
      <FormGrid cols={1}>
        <Field label="Amount" required hint={`Still owed: ₹${owed.toFixed(2)}`} error={tooMuch ? 'More than is still owed.' : null}>
          <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
        </Field>
        <Field label="Paid on" required>
          <Input type="date" max={todayIst()} value={form.payment_date} onChange={(e) => set('payment_date', e.target.value)} />
        </Field>
        <Field label="Method">
          <Select value={form.method} onChange={(e) => set('method', e.target.value)} options={PAYMENT_METHODS} />
        </Field>
        <Field label="Reference" hint="UTR, cheque number…">
          <Input value={form.reference} maxLength={120} onChange={(e) => set('reference', e.target.value)} />
        </Field>
        <Field label="Note">
          <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
    </Drawer>
  );
}

function CancelDrawer({ open, onClose, bill, releasing, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await cancelVendorBill(bill.bill_id, reason.trim());
      toast.success(`${bill.bill_number} cancelled`);
      onDone();
    } catch (e) {
      toast.error(errMsg(e, 'Could not cancel the bill.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Cancel ${bill.bill_number}`}
      footer={<Button variant="primary" disabled={busy || reason.trim().length < 5} onClick={go}>{busy ? 'Cancelling…' : 'Cancel the bill'}</Button>}
    >
      <Notice tone="warn" title="The bill stays on record as cancelled">
        {monthLabel(bill.bill_month, bill.bill_year)} can then be generated again for this vendor.
        {releasing > 0 && ` Its ${releasing} debit note(s) go back to waiting for the next bill.`}
      </Notice>
      <div style={{ marginTop: '12px' }}>
        <Field label="Reason" required hint="At least 5 characters. Shown on the bill's timeline.">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

export default function VendorBillRecordPage() {
  const { billId } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const { user } = useAuth() || {};
  const canEdit = hasPermission('vendor_billing_mgmt', 'edit');
  const canCancel = hasPermission('vendor_billing_mgmt', 'delete');
  const canSeeNotes = hasPermission('debit_notes', 'view');
  const { loading, error, bill, debitNotes, payments, events, refresh } = useVendorBill(billId);
  const [drawer, setDrawer] = useState('');
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [busy, setBusy] = useState('');

  const lines = useMemo(() => parseLines(bill), [bill]);

  if (error) {
    return (
      <DeskShell title="Vendor bill" breadcrumb="Finance / Vendors / Vendor bills">
        <EmptyState title="Could not load this bill" body={error} action={<Button onClick={() => navigate('/carret/money/vendor-bills')}>Back</Button>} />
      </DeskShell>
    );
  }
  if (loading && !bill) {
    return <DeskShell title="Vendor bill" breadcrumb="Finance / Vendors / Vendor bills"><EmptyState title="Loading…" /></DeskShell>;
  }
  if (!bill) return null;

  const st = bill.status;
  const owed = outstandingOf(bill);
  const paid = Number(bill.amount_paid || 0);
  const isMaker = bill.generated_by && Number(bill.generated_by) === Number(user?.user_id);
  const canApproveHere = canEdit && st === 'generated' && !isMaker;
  const canPay = canEdit && ['approved', 'partially_paid'].includes(st) && owed > 0;
  const cancellable = canCancel && ['generated', 'approved', 'disputed'].includes(st) && paid <= 0;

  const approve = async () => {
    setBusy('approve');
    try {
      await approveVendorBill(bill.bill_id);
      toast.success('Approved — it can now be paid');
      refresh();
    } catch (e) {
      toast.error(errMsg(e, 'Could not approve the bill.'));
    } finally {
      setBusy('');
    }
  };
  const pdf = async () => {
    setBusy('pdf');
    try { await downloadVendorBillPdf(bill); } catch (e) { toast.error(errMsg(e, 'Could not download the PDF.')); } finally { setBusy(''); }
  };

  const flow = [
    { key: 'g', label: 'Generated', sub: bill.generated_by_name || null, state: 'done' },
    { key: 'a', label: 'Approved', sub: bill.approved_by_name || null, state: st === 'generated' ? 'current' : 'done' },
    { key: 'p', label: 'Paid', sub: paid > 0 && st !== 'paid' ? 'part paid' : null, state: st === 'paid' ? 'done' : (['approved', 'partially_paid'].includes(st) ? 'current' : 'todo') },
  ].map((s) => (st === 'cancelled' || st === 'disputed' ? { ...s, state: s.state === 'done' ? 'done' : 'blocked' } : s));

  const gstItems = bill.is_intra_state === true
    ? [{ label: 'CGST 9%', value: <Money value={bill.cgst_amount} /> }, { label: 'SGST 9%', value: <Money value={bill.sgst_amount} /> }]
    : bill.is_intra_state === false
      ? [{ label: 'IGST 18%', value: <Money value={bill.igst_amount} /> }]
      : [{ label: 'GST 18% (not split — raised before the split)', value: <Money value={bill.gst_amount} /> }];

  let next = null;
  if (st === 'cancelled') {
    next = <Notice tone="serious" title="Cancelled">{bill.cancellation_reason || 'No reason recorded.'} {bill.cancelled_by_name && `— ${bill.cancelled_by_name}`}{bill.cancelled_at && <>, <DateTime value={bill.cancelled_at} /></>}</Notice>;
  } else if (st === 'generated') {
    next = (
      <Notice
        tone={isMaker ? 'warn' : 'info'}
        title="Waiting for approval"
        action={canApproveHere && <Button variant="primary" disabled={busy === 'approve'} onClick={() => setConfirmApprove(true)}>{busy === 'approve' ? 'Approving…' : 'Approve'}</Button>}
      >
        {isMaker
          ? 'You generated this bill, so someone else must approve it.'
          : 'Check the laptops, days and rates below. Once approved it can be paid.'}
      </Notice>
    );
  } else if (canPay || ['approved', 'partially_paid'].includes(st)) {
    next = (
      <Notice
        tone="info"
        title={`₹${owed.toFixed(2)} still owed`}
        action={canPay && <Button variant="primary" onClick={() => setDrawer('pay')}>Record payment</Button>}
      >
        Approved{bill.approved_by_name ? ` by ${bill.approved_by_name}` : ''}. A payment cannot be more than what is still owed.
      </Notice>
    );
  } else if (st === 'paid') {
    next = <Notice tone="good" title="Paid in full">{bill.payment_date && <>Last payment <DateTime value={bill.payment_date} />{bill.payment_reference ? ` · ${bill.payment_reference}` : ''}.</>}</Notice>;
  }

  return (
    <DeskShell title={bill.bill_number} breadcrumb="Finance / Vendors / Vendor bills" subtitle={bill.vendor_name}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={bill.bill_number}
          type="Vendor bill"
          status={billChipStatus(st)}
          actions={(
            <>
              <Button disabled={busy === 'pdf'} onClick={pdf}>{busy === 'pdf' ? 'Preparing…' : 'PDF'}</Button>
              {cancellable && <Button variant="quiet" onClick={() => setDrawer('cancel')}>Cancel bill</Button>}
            </>
          )}
          meta={[
            { label: 'Vendor', value: bill.vendor_name },
            { label: 'Month', value: monthLabel(bill.bill_month, bill.bill_year) },
            { label: 'Period', value: <><DateTime value={bill.from_date} /> – <DateTime value={bill.to_date} /></> },
            { label: 'Vendor GSTIN', value: bill.gst_number || '—' },
            { label: 'Vendor state', value: bill.place_of_supply || bill.vendor_state || '—' },
            { label: 'Status', value: BILL_STATUS_LABEL[st] || st },
          ]}
        />
        <FlowSteps steps={flow} />
        {next}

        <Section title="Totals">
          <KeyValue
            cols={3}
            items={[
              { label: `Rent (${lines.length} laptop${lines.length === 1 ? '' : 's'})`, value: <Money value={bill.subtotal} /> },
              ...gstItems,
              { label: 'Debit notes deducted', value: Number(bill.debit_note_adjustment) > 0 ? <Money value={-Number(bill.debit_note_adjustment)} /> : '—' },
              { label: 'Payable', value: <strong><Money value={bill.total_payable} /></strong> },
              { label: 'Paid', value: <Money value={paid} /> },
              { label: 'Still owed', value: st === 'cancelled' ? '—' : <Money value={owed} /> },
            ]}
          />
        </Section>

        <Section title={`Laptops · ${lines.length}`}>
          <DataTable columns={LINE_COLS} rows={lines} rowKey={(l, i) => `${l.serial_id || l.ttspl_id}-${i}`} empty={<EmptyState title="No laptop lines on this bill" />} />
        </Section>

        <Section title={`Debit notes deducted · ${debitNotes.length}`}>
          <DataTable
            columns={[
              { key: 'n', header: 'Debit note', render: (d) => <DocNumber value={d.debit_note_number} />, sub: (d) => d.reason },
              { key: 's', header: 'Status', render: (d) => <StatusChip status={dnChipStatus(d.status)} label={DN_STATUS_LABEL[d.status] || d.status} /> },
              { key: 'r', header: 'Raised', render: (d) => <DateTime value={d.created_at} /> },
              { key: 'a', header: 'Amount', numeric: true, render: (d) => <Money value={d.amount} /> },
            ]}
            rows={debitNotes}
            rowKey={(d) => d.debit_note_id}
            onRowClick={canSeeNotes ? (d) => navigate(`/carret/money/debit-notes/${d.debit_note_id}`) : undefined}
            empty={<EmptyState title="None" body="Approved debit notes raised up to the month end are deducted when the bill is generated." />}
          />
        </Section>

        <Section title={`Payments · ${payments.length}`}>
          <DataTable columns={PAY_COLS} rows={payments} rowKey={(p) => p.payment_id} empty={<EmptyState title="No payments yet" />} />
        </Section>

        <Section title="Timeline">
          {events.length ? <Timeline events={events} /> : <EmptyState title="No recorded events" body="Bills generated before the event trail existed have none." />}
        </Section>
      </div>

      {drawer === 'pay' && <PaymentDrawer open onClose={() => setDrawer('')} bill={bill} onDone={() => { setDrawer(''); refresh(); }} />}
      {drawer === 'cancel' && (
        <CancelDrawer open onClose={() => setDrawer('')} bill={bill} releasing={debitNotes.length} onDone={() => { setDrawer(''); refresh(); }} />
      )}
      <ConfirmDialog
        open={confirmApprove}
        onClose={() => setConfirmApprove(false)}
        onConfirm={approve}
        title={`Approve ${bill.bill_number}?`}
        body={`₹${Number(bill.total_payable || 0).toFixed(2)} to ${bill.vendor_name} for ${monthLabel(bill.bill_month, bill.bill_year)}. Once approved it can be paid.`}
        confirmLabel="Approve"
        tone="good"
      />
    </DeskShell>
  );
}
