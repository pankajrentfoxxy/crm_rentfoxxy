import React, { useEffect, useState } from 'react';
import {
  Checkbox, DataTable, DateTime, DocNumber, Field, Money, Notice, Section, Textarea,
} from '../../../../components/carret';
import { fetchNumberChanges } from './gstApi';

export const REPLACE_REASON_MIN = 5;

export const errMsg = (e, fallback = 'Something went wrong') => e?.response?.data?.message || e?.message || fallback;
export const errCode = (e) => e?.response?.data?.code || null;

export const dcPath = (dc) => `/carret/move/challans/${encodeURIComponent(dc)}`;
export const soPath = (so) => `/carret/sell/sales-orders/${encodeURIComponent(so)}`;

export const sameNumber = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
/** True when `next` would change a number already on file. */
export const isReplacing = (current, next) => Boolean(String(current || '').trim() && String(next || '').trim() && !sameNumber(current, next));

export const humanise = (s) => String(s || '').replace(/_/g, ' ');

/** A queue row's amount: the invoice total with its GST split, or the old estimate when billing could not be resolved. */
export function InvoiceAmount({ row, estimate }) {
  const inv = row?.invoice;
  if (!inv) {
    return (
      <span title="Billing could not be resolved for this document">
        <Money value={estimate} /> <span className="text-ink-3">estimate</span>
      </span>
    );
  }
  return <Money value={inv.grand_total} />;
}

export function invoiceSub(row) {
  const inv = row?.invoice;
  if (!inv) return null;
  const split = inv.gst_type === 'inter' ? `IGST ${fmt(inv.igst)}` : `CGST+SGST ${fmt(inv.cgst + inv.sgst)}`;
  return `${fmt(inv.subtotal)} + ${split}${inv.place_of_supply_known ? '' : ' (state unknown)'}`;
}

const NUM = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt = (n) => `₹${NUM.format(Number(n || 0))}`;

/** The reason box shown whenever a number on file is being replaced. */
export function ReplaceReason({ changes = [], value, onChange }) {
  if (!changes.length) return null;
  const short = value.trim().length < REPLACE_REASON_MIN;
  return (
    <Notice tone="serious" title="You are replacing a number already on file">
      <ul style={{ margin: '4px 0 8px', paddingLeft: '18px' }}>
        {changes.map((c) => (
          <li key={c.label}>{c.label}: <span className="font-mono">{c.from}</span> → <span className="font-mono">{c.to}</span></li>
        ))}
      </ul>
      <Field label="Reason for replacing" required error={value && short ? `At least ${REPLACE_REASON_MIN} characters` : null} hint="Kept in the document's number history.">
        <Textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
    </Notice>
  );
}

/** Shown after the server says the invoice number is already on this customer's other documents. */
export function SharedInvoiceConfirm({ ask, checked, onChange }) {
  if (!ask) return null;
  return (
    <Notice tone="warn" title="This invoice number is already used">
      <p style={{ margin: '0 0 8px' }}>{ask.message}</p>
      <Checkbox
        label="Yes — one invoice covers these documents"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </Notice>
  );
}

/** Attach / replace history of one document's numbers (migration 375). */
export function NumberHistory({ docType, docNumber }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    fetchNumberChanges(docType, docNumber)
      .then(({ data }) => { if (live) setRows(data.data || []); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [docType, docNumber]);
  if (!rows || !rows.length) return null;
  return (
    <Section title="Number history">
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: 'changed_at', header: 'When', render: (r) => <DateTime value={r.changed_at} format="datetime" />, sub: (r) => r.changed_by_name || null },
          { key: 'field', header: 'Number', render: (r) => humanise(r.field) },
          { key: 'action', header: 'Change', render: (r) => (r.action === 'replace' ? <>was <DocNumber value={r.old_value} /></> : 'attached') },
          { key: 'new_value', header: 'Now', render: (r) => <DocNumber value={r.new_value} />, sub: (r) => r.reason || null },
        ]}
      />
    </Section>
  );
}
