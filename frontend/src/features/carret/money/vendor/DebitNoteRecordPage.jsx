import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, FlowSteps, FormGrid, Input,
  KeyValue, Money, Notice, Section, Textarea, Timeline,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import {
  DN_STATUS_LABEL, approveDebitNote, cancelDebitNote, dnChipStatus, errMsg, isDraftNote, setDebitNoteAmount, useDebitNote,
} from './vendorMoneyApi';

/**
 * Finance → Vendors → one debit note (MD6).
 *
 *   Pending    set the amount (a return / repair draft starts at Rs 0), then
 *              someone approves it — a Rs 0 note cannot be approved
 *   Approved   deducted from the vendor's next bill generated for a month
 *              ending on or after the day it was raised
 *   Cancel     a pending note, or an approved one no bill has deducted yet
 */
function parseTtspl(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch (_) { return []; }
}

function AmountDrawer({ open, onClose, note, onDone }) {
  const [form, setForm] = useState({
    quantity: note.quantity ? String(note.quantity) : '1',
    unit_rate: Number(note.unit_rate) > 0 ? String(note.unit_rate) : '',
    amount: Number(note.amount) > 0 ? String(note.amount) : '',
    description: note.description || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const amount = form.amount !== '' ? Number(form.amount) : (Number(form.quantity) || 0) * (Number(form.unit_rate) || 0);

  const save = async () => {
    setBusy(true);
    try {
      await setDebitNoteAmount(note.debit_note_id, {
        amount: form.amount === '' ? undefined : Number(form.amount),
        quantity: form.quantity === '' ? undefined : Number(form.quantity),
        unit_rate: form.unit_rate === '' ? undefined : Number(form.unit_rate),
        description: form.description,
      });
      toast.success('Amount set — it can now be approved');
      onDone();
    } catch (e) {
      toast.error(errMsg(e, 'Could not set the amount.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Amount for ${note.debit_note_number}`}
      footer={<Button variant="primary" disabled={busy || !(amount > 0)} onClick={save}>{busy ? 'Saving…' : `Set ₹${amount.toFixed(2)}`}</Button>}
    >
      <FormGrid cols={1}>
        <Field label="Units"><Input type="number" min="0" step="1" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field>
        <Field label="Rate per unit"><Input type="number" min="0" step="0.01" value={form.unit_rate} onChange={(e) => set('unit_rate', e.target.value)} /></Field>
        <Field label="Amount" hint={form.amount === '' ? 'Blank = units × rate.' : null}>
          <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
        </Field>
        <Field label="Description"><Textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
      </FormGrid>
    </Drawer>
  );
}

function CancelDrawer({ open, onClose, note, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await cancelDebitNote(note.debit_note_id, reason.trim());
      toast.success(`${note.debit_note_number} cancelled`);
      onDone();
    } catch (e) {
      toast.error(errMsg(e, 'Could not cancel the note.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Cancel ${note.debit_note_number}`}
      footer={<Button variant="primary" disabled={busy || reason.trim().length < 5} onClick={go}>{busy ? 'Cancelling…' : 'Cancel the note'}</Button>}
    >
      <p style={{ marginBottom: '12px' }}>The note stays on record as cancelled and is never deducted.</p>
      <Field label="Reason" required hint="At least 5 characters."><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Drawer>
  );
}

export default function DebitNoteRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canSetAmount = hasPermission('debit_notes', 'create');
  const canDecide = hasPermission('debit_notes', 'edit');
  const canSeeBills = hasPermission('vendor_billing_mgmt', 'view');
  const { loading, error, note, events, refresh } = useDebitNote(id);
  const [drawer, setDrawer] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (error) {
    return (
      <DeskShell title="Debit note" breadcrumb="Finance / Vendors / Debit notes">
        <EmptyState title="Could not load this debit note" body={error} action={<Button onClick={() => navigate('/carret/money/debit-notes')}>Back</Button>} />
      </DeskShell>
    );
  }
  if (loading && !note) return <DeskShell title="Debit note" breadcrumb="Finance / Vendors / Debit notes"><EmptyState title="Loading…" /></DeskShell>;
  if (!note) return null;

  const st = note.status || 'pending';
  const draft = isDraftNote(note);
  const ttspl = parseTtspl(note.ttspl_ids);

  const approve = async () => {
    setBusy(true);
    try {
      await approveDebitNote(note.debit_note_id);
      toast.success('Approved — it comes off the vendor’s next bill');
      refresh();
    } catch (e) {
      toast.error(errMsg(e, 'Could not approve the note.'));
    } finally {
      setBusy(false);
    }
  };

  const flow = [
    { key: 'r', label: 'Raised', sub: note.created_by_name || null, state: 'done' },
    { key: 'a', label: 'Amount set', sub: note.amount_set_by_name || null, state: draft ? 'current' : 'done' },
    { key: 'p', label: 'Approved', sub: note.approved_by_name || null, state: st === 'pending' ? (draft ? 'todo' : 'current') : 'done' },
    {
      key: 'b', label: 'Deducted on a bill', sub: note.adjusted_in_bill_number || null,
      state: st === 'adjusted' ? 'done' : (st === 'approved' ? 'current' : 'todo'),
    },
  ].map((s) => (st === 'cancelled' && s.state !== 'done' ? { ...s, state: 'blocked' } : s));

  let next = null;
  if (st === 'cancelled') {
    next = <Notice tone="serious" title="Cancelled">{note.cancellation_reason || 'No reason recorded.'}{note.cancelled_by_name && ` — ${note.cancelled_by_name}`}{note.cancelled_at && <>, <DateTime value={note.cancelled_at} /></>}</Notice>;
  } else if (draft) {
    next = (
      <Notice tone="warn" title="Draft at Rs 0" action={canSetAmount && <Button variant="primary" onClick={() => setDrawer('amount')}>Set amount</Button>}>
        Set what the vendor owes for this laptop; then someone approves it. A Rs 0 note cannot be approved.
      </Notice>
    );
  } else if (st === 'pending') {
    next = (
      <Notice
        tone="info"
        title="Waiting for approval"
        action={(
          <div className="flex" style={{ gap: '8px' }}>
            {canSetAmount && <Button onClick={() => setDrawer('amount')}>Change amount</Button>}
            {canDecide && <Button variant="primary" disabled={busy} onClick={() => setConfirm(true)}>{busy ? 'Approving…' : 'Approve'}</Button>}
          </div>
        )}
      >
        Once approved, it is deducted from this vendor&apos;s next bill for a month ending on or after <DateTime value={note.created_at} />.
      </Notice>
    );
  } else if (st === 'approved') {
    next = <Notice tone="info" title="Approved — waiting for the next bill">It is deducted automatically when the vendor&apos;s next bill is generated.</Notice>;
  } else if (st === 'adjusted') {
    next = (
      <Notice
        tone="good"
        title={`Deducted on ${note.adjusted_in_bill_number || 'a vendor bill'}`}
        action={canSeeBills && note.adjusted_in_bill_id && <Button onClick={() => navigate(`/carret/money/vendor-bills/${note.adjusted_in_bill_id}`)}>Open the bill</Button>}
      >
        To undo it, cancel that bill (only while unpaid) — the note then waits for the next bill.
      </Notice>
    );
  }

  const cancellable = canDecide && ['pending', 'approved'].includes(st) && !note.adjusted_in_bill_id;

  return (
    <DeskShell title={note.debit_note_number} breadcrumb="Finance / Vendors / Debit notes" subtitle={note.vendor_name}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={note.debit_note_number}
          type="Debit note"
          status={draft ? 'draft' : dnChipStatus(st)}
          actions={cancellable && <Button variant="quiet" onClick={() => setDrawer('cancel')}>Cancel note</Button>}
          meta={[
            { label: 'Vendor', value: note.vendor_name },
            { label: 'Amount', value: <Money value={note.amount} /> },
            { label: 'Status', value: draft ? 'Draft — set the amount' : (DN_STATUS_LABEL[st] || st) },
            { label: 'Raised', value: <DateTime value={note.created_at} /> },
            { label: 'Purchase order', value: note.po_number || '—' },
            { label: 'From', value: note.source ? String(note.source).replace(/_/g, ' ') : 'manual' },
          ]}
        />
        <FlowSteps steps={flow} />
        {next}

        <Section title="Details">
          <KeyValue
            cols={2}
            items={[
              { label: 'Reason', value: note.reason },
              { label: 'Laptops', value: ttspl.length ? ttspl.map((t) => <span key={t} style={{ marginRight: '8px' }}><DocNumber value={t} /></span>) : '—' },
              { label: 'Units', value: note.quantity },
              { label: 'Rate per unit', value: Number(note.unit_rate) > 0 ? <Money value={note.unit_rate} /> : '—' },
              { label: 'Reference', value: note.source_ref || '—' },
              { label: 'Description', value: note.description },
            ]}
          />
        </Section>

        <Section title="Timeline">
          {events.length ? <Timeline events={events} /> : <EmptyState title="No recorded events" body="Notes raised before the trail existed have none." />}
        </Section>
      </div>

      {drawer === 'amount' && <AmountDrawer open onClose={() => setDrawer('')} note={note} onDone={() => { setDrawer(''); refresh(); }} />}
      {drawer === 'cancel' && <CancelDrawer open onClose={() => setDrawer('')} note={note} onDone={() => { setDrawer(''); refresh(); }} />}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={approve}
        title={`Approve ${note.debit_note_number}?`}
        body={`₹${Number(note.amount || 0).toFixed(2)} will be deducted from ${note.vendor_name}'s next vendor bill.`}
        confirmLabel="Approve"
        tone="good"
      />
    </DeskShell>
  );
}
