import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, Drawer, Field, FormGrid, Input, Notice, Select, Textarea,
} from '../../../components/carret';
import {
  MONTH_OPTIONS, cancelCreditNote, errMsg, generateCreditNotesBulk, listCoverage, yearOptions,
} from './moneyApi';

/** MD2 — withdraw a credit note, with a reason. */
export function CancelCreditNoteDrawer({ note, open, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setReason(''); }, [open]);
  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await cancelCreditNote(note.credit_note_id, reason.trim());
      toast.success(data.message || 'Credit note cancelled');
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Could not cancel the credit note'));
    } finally {
      setBusy(false);
    }
  };
  const applied = String(note?.status || '').toLowerCase() === 'applied';
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Cancel ${note?.credit_note_number || ''}`}
      footer={<Button variant="primary" disabled={busy || reason.trim().length < 5} onClick={submit}>{busy ? 'Cancelling…' : 'Cancel credit note'}</Button>}
    >
      <div className="c-stack">
        <Notice tone="warn">
          {applied
            ? 'This note is on a draft invoice: cancelling takes it off and the draft’s total goes back up. A note already on an issued invoice cannot be withdrawn.'
            : 'The note will not be applied to any invoice. The number stays used (it is never reissued).'}
        </Notice>
        <Field label="Reason" required hint="At least 5 characters">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

/** Draft return credit notes for unused prepaid days after warehouse returns. */
export function GenerateCreditNotesDrawer({ open, onClose, onDone }) {
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setMonth(String(now.getMonth() + 1));
    setYear(String(now.getFullYear()));
    setAll(false);
    setPicked(new Set());
    setQ('');
  }, [open]);

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
      const { data } = await generateCreditNotesBulk({
        month: Number(month), year: Number(year), all, customer_ids: all ? undefined : [...picked].map(Number),
      });
      const s = data.summary || {};
      toast.success([s.created ? `${s.created} created` : null, s.skipped ? `${s.skipped} with nothing new` : null, s.errors ? `${s.errors} failed` : null].filter(Boolean).join(', ') || 'No new credit notes');
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
      title="Generate return credit notes"
      width="36rem"
      footer={<Button variant="primary" disabled={busy || (!all && !picked.size)} onClick={submit}>{busy ? 'Generating…' : 'Generate drafts'}</Button>}
    >
      <div className="c-stack">
        <Notice tone="info">
          One draft note per customer for the unused prepaid days of laptops returned to the warehouse. Drafts need approval by someone other than the person who generated them.
        </Notice>
        <FormGrid cols={2}>
          <Field label="Month"><Select options={MONTH_OPTIONS} value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
          <Field label="Year"><Select options={yearOptions()} value={year} onChange={(e) => setYear(e.target.value)} /></Field>
        </FormGrid>
        <Checkbox label="All customers with laptops" checked={all} onChange={(e) => setAll(e.target.checked)} />
        {!all && (
          <div className="c-card">
            <div className="c-card-h"><h3>Customers ({picked.size} picked)</h3></div>
            <div className="c-card-b c-stack">
              <Input placeholder="Search customer" value={q} onChange={(e) => setQ(e.target.value)} />
              <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'grid', gap: '6px' }}>
                {!shown.length && <span className="text-ink-3">No customers with rental laptops for this month.</span>}
                {shown.map((r) => (
                  <Checkbox
                    key={r.customer_id}
                    checked={picked.has(String(r.customer_id))}
                    onChange={() => toggle(String(r.customer_id))}
                    label={`${r.customer_name} · ${r.asset_count} laptop(s) · ${r.returned_count || 0} returned`}
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
