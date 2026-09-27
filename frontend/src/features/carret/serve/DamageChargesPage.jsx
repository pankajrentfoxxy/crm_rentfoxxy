import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, Input, Money, Notice, Segmented, Select, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  cancelDamageCase, damagePhotoBlob, decideDamageCase, fetchDamageCases, priceDamageCase, proposeDamageCase,
} from './serveApi';
import { errMsg } from './serveShared';

/**
 * Support → Damage charges (claude/carret-customers-returns-control.md, DM1).
 *   To price    — the warehouse prices each damaged / missing part
 *   To propose  — Sales / Accounts agree it with the customer and email the details
 *   To approve  — Accounts approve (or lower, waive, reject)
 * Approved charges go on the next invoice as "Damage charges" (Finance → Support
 * charges to bill); a sold laptop's go on a service order.
 */
const TABS = [
  { value: 'reported', label: 'To price' },
  { value: 'priced', label: 'To propose' },
  { value: 'proposed', label: 'To approve' },
  { value: 'approved', label: 'Approved' },
  { value: 'closed', label: 'Waived / rejected' },
];
const SOURCE = { technician_visit: 'Technician visit', repair_pickup: 'Repair pickup', return_pickup: 'Return pickup', warehouse_receive: 'Warehouse receive' };

function Photo({ path }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u = null;
    damagePhotoBlob(path).then((r) => { u = URL.createObjectURL(r.data); setUrl(u); }).catch(() => setUrl(null));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [path]);
  return url
    ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Damage" style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 'var(--d-radius)', border: '1px solid var(--rule)' }} /></a>
    : <span className="text-ink-3">photo…</span>;
}

export default function DamageChargesPage() {
  const { hasPermission } = usePermission();
  const canPrice = ['parts_inventory', 'support_part_challan', 'return_dc'].some((s) => hasPermission(s, 'edit'));
  const canPropose = ['damage_charges', 'customers', 'customer_billing'].some((s) => hasPermission(s, 'edit'));
  const canDecide = hasPermission('customer_billing', 'edit');
  const [tab, setTab] = useState('reported');
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    const req = tab === 'closed'
      ? Promise.all([fetchDamageCases({ status: 'waived' }), fetchDamageCases({ status: 'rejected' }), fetchDamageCases({ status: 'cancelled' })])
        .then((rs) => rs.flatMap((r) => r.data.data || []))
      : fetchDamageCases({ status: tab }).then(({ data }) => data.data || []);
    req.then(setRows).catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const openCase = (c) => {
    setOpen(c);
    setForm({
      prices: Object.fromEntries((c.lines || []).map((l) => [l.id, l.price ?? ''])),
      note: '', email: c.customer_email || '', sendEmail: true, decision: 'approve', amount: '',
    });
  };
  const run = async (fn) => {
    setBusy(true);
    try { const { data } = await fn(); toast.success(data.message); setOpen(null); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const cols = [
    { key: 'l', header: 'Laptop', render: (c) => <DocNumber value={c.asset_code} />, sub: (c) => SOURCE[c.source] },
    { key: 'c', header: 'Customer', render: (c) => (c.customer_id ? <Link to={`/carret/sell/customers/${c.customer_id}`} onClick={(e) => e.stopPropagation()}>{c.customer_name}</Link> : '—'), sub: (c) => (c.support_ticket_id ? `Ticket #${c.support_ticket_id}` : c.return_dc_number) },
    { key: 'p', header: 'Parts', render: (c) => (c.lines || []).map((l) => l.part_name).filter(Boolean).join(', '), sub: (c) => (c.lines || []).map((l) => l.issue).join('; ') },
    { key: 'a', header: 'Amount', numeric: true, render: (c) => (c.status === 'reported' ? '—' : <Money value={c.approved_amount ?? c.total} />), sub: (c) => (c.approved_amount != null && Number(c.approved_amount) !== Number(c.total) ? `priced ${Number(c.total).toLocaleString('en-IN')}` : null) },
    { key: 'w', header: 'Reported', render: (c) => <DateTime value={c.reported_at} />, sub: (c) => c.reported_by_name },
    { key: 'e', header: 'Customer email', render: (c) => (c.email_sent_at ? <DateTime value={c.email_sent_at} /> : (c.email_error ? <span className="text-ink-3">not sent</span> : '—')), sub: (c) => c.email_to || c.email_error },
  ];

  const total = open ? (open.lines || []).reduce((s, l) => s + (Number(form.prices?.[l.id]) || 0) * Number(l.quantity || 1), 0) : 0;
  return (
    <DeskShell title="Damage charges" breadcrumb="Support" subtitle="Damage found on customers' laptops — priced, agreed with the customer, approved and billed.">
      <div className="c-stack">
        <Segmented label="Show" value={tab} onChange={setTab} options={TABS} />
        {rows === null ? <EmptyState title="Loading…" /> : (
          <DataTable columns={cols} rows={rows} rowKey={(c) => c.id} onRowClick={openCase} empty={<EmptyState title="Nothing here" />} />
        )}
      </div>

      <Drawer
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open ? `Damage — ${open.asset_code} · ${open.customer_name || ''}` : ''}
        width="44rem"
        footer={open && (
          <>
            {['reported', 'priced'].includes(open.status) && <Button variant="quiet" disabled={busy} onClick={() => { const n = window.prompt('Why cancel this damage case?'); if (n) run(() => cancelDamageCase(open.id, n)); }}>Cancel case</Button>}
            {['reported', 'priced'].includes(open.status) && canPrice && <Button variant={open.status === 'reported' ? 'primary' : 'secondary'} disabled={busy} onClick={() => run(() => priceDamageCase(open.id, (open.lines || []).map((l) => ({ id: l.id, price: form.prices[l.id] }))))}>Save prices</Button>}
            {['priced', 'proposed'].includes(open.status) && canPropose && <Button variant={open.status === 'priced' ? 'primary' : 'secondary'} disabled={busy} onClick={() => run(() => proposeDamageCase(open.id, { note: form.note, email_to: form.email, send_email: form.sendEmail }))}>{open.status === 'proposed' ? 'Send again' : 'Propose to customer'}</Button>}
            {open.status === 'proposed' && canDecide && <Button variant="primary" disabled={busy} onClick={() => run(() => decideDamageCase(open.id, { decision: form.decision, amount: form.decision === 'approve' && form.amount !== '' ? form.amount : undefined, note: form.note }))}>{({ approve: 'Approve', waive: 'Waive', reject: 'Reject' })[form.decision]}</Button>}
          </>
        )}
      >
        {open && (
          <div className="c-stack">
            <p className="text-ink-3">{SOURCE[open.source]} · reported by {open.reported_by_name || '—'} on <DateTime value={open.reported_at} />{open.notes ? ` · ${open.notes}` : ''}</p>
            {(open.lines || []).map((l) => (
              <div key={l.id} className="c-stack" style={{ border: '1px solid var(--rule)', borderRadius: 'var(--d-radius)', padding: '10px', gap: '6px' }}>
                <div className="flex items-center" style={{ gap: '8px', justifyContent: 'space-between' }}>
                  <strong>{l.part_name}{Number(l.quantity) > 1 ? ` × ${l.quantity}` : ''}</strong>
                  {['reported', 'priced'].includes(open.status) && canPrice
                    ? <Input type="number" min="0" placeholder="Price ₹" value={form.prices?.[l.id] ?? ''} onChange={(e) => setForm({ ...form, prices: { ...form.prices, [l.id]: e.target.value } })} style={{ maxWidth: '9rem' }} />
                    : <Money value={l.price} />}
                </div>
                <span>{l.issue}</span>
                <div className="flex flex-wrap" style={{ gap: '6px' }}>{(l.photos || []).map((p) => <Photo key={p} path={p} />)}</div>
              </div>
            ))}
            <p><strong>Total: ₹{(open.status === 'reported' ? total : Number(open.total)).toLocaleString('en-IN')}</strong> + 18% GST</p>
            {open.proposal_note && <Notice tone="info" title="Agreed with the customer">{open.proposal_note}{open.proposed_by_name ? ` — ${open.proposed_by_name}` : ''}</Notice>}
            {open.email_error && <Notice tone="warn">Email not sent: {open.email_error}</Notice>}
            {['priced', 'proposed'].includes(open.status) && canPropose && (
              <>
                <Field label="Customer email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                <label className="flex items-center" style={{ gap: '6px' }}><input type="checkbox" checked={form.sendEmail} onChange={(e) => setForm({ ...form, sendEmail: e.target.checked })} /> Email the customer the parts, issues, photos and amounts</label>
              </>
            )}
            {open.status === 'proposed' && canDecide && (
              <>
                <Field label="Accounts decision">
                  <Select value={form.decision} onChange={(e) => setForm({ ...form, decision: e.target.value })} options={[{ value: 'approve', label: 'Approve — bill on the next invoice' }, { value: 'waive', label: 'Waive — no charge' }, { value: 'reject', label: 'Reject — customer disputes, drop it' }]} />
                </Field>
                {form.decision === 'approve' && <Field label="Agreed amount (₹, blank = priced total)"><Input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>}
              </>
            )}
            {(['priced', 'proposed'].includes(open.status) && (canPropose || canDecide)) && (
              <Field label={open.status === 'proposed' && canDecide ? 'Note (needed to waive, reject or lower)' : 'What was agreed with the customer'}><Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            )}
            {open.decision_note && <p className="text-ink-3">Decision: {open.decision_note}{open.decided_by_name ? ` — ${open.decided_by_name}` : ''}</p>}
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}
