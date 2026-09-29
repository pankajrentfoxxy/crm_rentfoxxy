import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FilterBar, Input, Money, Notice, Panel, Select,
  StatTile, StatusChip, Tabs, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  cancelDamageCase, damagePhotoBlob, decideDamageCase, fetchDamageCases, priceDamageCase, proposeDamageCase,
} from './serveApi';
import { errMsg } from './serveShared';

/**
 * Finance → Charges → Damage charges (claude/carret-customers-returns-control.md, DM1).
 *   To price    — the warehouse prices each damaged / missing part
 *   To propose  — Sales / Accounts agree it with the customer and email the details
 *   To approve  — Accounts approve (or lower, waive, reject)
 * Approved charges go on the next invoice as "Damage charges" (Finance → Support
 * charges to bill); a sold laptop's go on a service order.
 */
const TABS = [
  { key: 'reported', label: 'To price' },
  { key: 'priced', label: 'To propose' },
  { key: 'proposed', label: 'To approve' },
  { key: 'approved', label: 'Approved' },
  { key: 'closed', label: 'Waived / rejected' },
];
// The tiles and tab counts cover the four working queues; the closed tab has no count.
const OPEN_STATUSES = ['reported', 'priced', 'proposed', 'approved'];
const SOURCE = { technician_visit: 'Technician visit', repair_pickup: 'Repair pickup', return_pickup: 'Return pickup', warehouse_receive: 'Warehouse receive' };
// Case statuses on the shared chip: a known tone, the case's own words.
const CASE_CHIP = {
  reported: { status: 'pending', label: 'To price' },
  priced: { status: 'pending', label: 'Priced — to propose' },
  proposed: { status: 'pending_approval', label: 'Awaiting Accounts' },
  approved: { status: 'approved', label: 'Approved — to bill' },
  billed: { status: 'completed', label: 'Billed' },
  waived: { status: 'closed', label: 'Waived' },
  rejected: { status: 'rejected', label: 'Rejected' },
  cancelled: { status: 'cancelled', label: 'Cancelled' },
};
const caseChip = (s) => { const c = CASE_CHIP[s] || { status: s, label: undefined }; return <StatusChip status={c.status} label={c.label} />; };
const caseAmount = (c) => Number(c.approved_amount ?? c.total ?? 0);
const enc = encodeURIComponent;
const stop = (e) => e.stopPropagation();

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
  const [queues, setQueues] = useState(null); // { reported: [...], priced: [...], ... } for tiles and tab counts
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(null); // { row, reason }

  const load = useCallback(() => {
    setRows(null);
    const req = tab === 'closed'
      ? Promise.all([fetchDamageCases({ status: 'waived' }), fetchDamageCases({ status: 'rejected' }), fetchDamageCases({ status: 'cancelled' })])
        .then((rs) => rs.flatMap((r) => r.data.data || []))
      : fetchDamageCases({ status: tab }).then(({ data }) => data.data || []);
    req.then(setRows).catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  // The same list call per working queue, so the tiles count every queue and
  // not only the tab on screen. A failure leaves the tiles blank, not zero.
  const loadQueues = useCallback(() => {
    Promise.all(OPEN_STATUSES.map((st) => fetchDamageCases({ status: st }).then(({ data }) => [st, data.data || []])))
      .then((pairs) => setQueues(Object.fromEntries(pairs)))
      .catch(() => setQueues(null));
  }, []);
  useEffect(() => { loadQueues(); }, [loadQueues]);
  const reload = () => { load(); loadQueues(); };

  const openCase = (c) => {
    setOpen(c);
    setForm({
      prices: Object.fromEntries((c.lines || []).map((l) => [l.id, l.price ?? ''])),
      note: '', email: c.customer_email || '', sendEmail: true, decision: 'approve', amount: '',
    });
  };
  const run = async (fn) => {
    setBusy(true);
    try { const { data } = await fn(); toast.success(data.message); setOpen(null); setCancelling(null); reload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  // Search runs over the loaded tab: laptop, customer, ticket / return challan, part.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!rows || !q) return rows;
    return rows.filter((c) => [
      c.asset_code, c.customer_name, c.support_ticket_id && `#${c.support_ticket_id}`, c.return_dc_number,
      ...(c.lines || []).map((l) => l.part_name),
    ].some((v) => v && String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  const sum = (list) => (list || []).reduce((s, c) => s + caseAmount(c), 0);
  const count = (st) => (queues ? queues[st].length : null);

  const cols = [
    {
      key: 'l', header: 'Laptop',
      render: (c) => (c.asset_code ? <Link to={`/carret/stock/assets/${enc(c.asset_code)}`} onClick={stop}><DocNumber value={c.asset_code} /></Link> : '—'),
      sub: (c) => SOURCE[c.source],
    },
    { key: 'c', header: 'Customer', render: (c) => (c.customer_id ? <Link to={`/carret/sell/customers/${c.customer_id}`} onClick={stop}>{c.customer_name}</Link> : '—'), sub: (c) => (c.support_ticket_id ? `Ticket #${c.support_ticket_id}` : c.return_dc_number) },
    { key: 'p', header: 'Parts', render: (c) => (c.lines || []).map((l) => l.part_name).filter(Boolean).join(', '), sub: (c) => (c.lines || []).map((l) => l.issue).join('; ') },
    { key: 's', header: 'Status', render: (c) => caseChip(c.status), sub: (c) => c.decision_note || null },
    { key: 'a', header: 'Amount', numeric: true, render: (c) => (c.status === 'reported' ? '—' : <Money value={c.approved_amount ?? c.total} />), sub: (c) => (c.approved_amount != null && Number(c.approved_amount) !== Number(c.total) ? `priced ${Number(c.total).toLocaleString('en-IN')}` : null) },
    { key: 'w', header: 'Reported', render: (c) => <DateTime value={c.reported_at} />, sub: (c) => c.reported_by_name },
    { key: 'e', header: 'Customer email', render: (c) => (c.email_sent_at ? <DateTime value={c.email_sent_at} /> : (c.email_error ? <span className="text-ink-3">not sent</span> : '—')), sub: (c) => c.email_to || c.email_error },
  ];

  const tabs = TABS.map((t) => ({ ...t, count: OPEN_STATUSES.includes(t.key) ? count(t.key) : null }));
  const total = open ? (open.lines || []).reduce((s, l) => s + (Number(form.prices?.[l.id]) || 0) * Number(l.quantity || 1), 0) : 0;
  return (
    <DeskShell title="Damage Charges" breadcrumb="Finance" subtitle="Damage found on customers' laptops — priced, agreed with the customer, approved and billed.">
      <div className="c-stack">
        <div className="c-tiles">
          <StatTile label="To price" value={count('reported')} delta="warehouse sets part prices" />
          <StatTile label="To propose to the customer" value={count('priced')} delta={queues ? <Money value={sum(queues.priced)} /> : null} />
          <StatTile label="Awaiting Accounts" value={count('proposed')} delta={queues ? <Money value={sum(queues.proposed)} /> : null} family="moving" />
          <StatTile label="Approved — to bill" value={count('approved')} delta={queues ? <Money value={sum(queues.approved)} /> : null} family="earning" />
        </div>

        <Panel
          toolbar={(
            <>
              <Tabs tabs={tabs} value={tab} onChange={(v) => { setTab(v); setSearch(''); }} />
              <FilterBar
                filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: 'Laptop, customer, ticket or part' }]}
                values={{ search }}
                onChange={(k, v) => setSearch(v)}
                onClear={() => setSearch('')}
                count={shown ? `${shown.length} case${shown.length === 1 ? '' : 's'}` : '…'}
              />
            </>
          )}
        >
          {shown === null ? <EmptyState title="Loading…" /> : (
            <DataTable
              columns={cols}
              rows={shown}
              rowKey={(c) => c.id}
              onRowClick={openCase}
              empty={search
                ? <EmptyState title="No damage cases match" body="The search covers laptop, customer, ticket, return challan and part." action={<Button variant="quiet" onClick={() => setSearch('')}>Clear search</Button>} />
                : <EmptyState title="Nothing in this queue" />}
            />
          )}
        </Panel>
      </div>

      <Drawer
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open ? `Damage — ${open.asset_code} · ${open.customer_name || ''}` : ''}
        width="44rem"
        footer={open && (
          <>
            {['reported', 'priced'].includes(open.status) && <Button variant="quiet" disabled={busy} onClick={() => { setCancelling({ row: open, reason: '' }); setOpen(null); }}>Cancel case</Button>}
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
                <Checkbox checked={form.sendEmail} onChange={(e) => setForm({ ...form, sendEmail: e.target.checked })} label="Email the customer the parts, issues, photos and amounts" />
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

      {/* Cancelling needs a reason on record; it replaces the case drawer rather than stacking on it. */}
      <Drawer
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title={`Cancel damage case — ${cancelling?.row?.asset_code || ''}`}
        footer={(
          <Button variant="primary" disabled={busy || !cancelling?.reason.trim()} onClick={() => run(() => cancelDamageCase(cancelling.row.id, cancelling.reason.trim()))}>
            {busy ? 'Cancelling…' : 'Cancel case'}
          </Button>
        )}
      >
        {cancelling && (
          <div className="c-stack">
            <p>{cancelling.row.customer_name || '—'} · {(cancelling.row.lines || []).map((l) => l.part_name).filter(Boolean).join(', ')}</p>
            <Notice tone="warn">A cancelled case is not priced, proposed or billed. Report the damage again if it turns out to be real.</Notice>
            <Field label="Why cancel this damage case?" required>
              <Textarea rows={3} value={cancelling.reason} onChange={(e) => setCancelling({ ...cancelling, reason: e.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}
