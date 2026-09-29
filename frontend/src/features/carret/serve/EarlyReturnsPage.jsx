import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FilterBar, Input, Money, Notice, Panel, Select, StatTile,
  StatusChip, Tabs, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { cancelEarlyReturn, decideEarlyReturn, fetchEarlyReturns, proposeEarlyReturn } from './serveApi';
import { errMsg } from './serveShared';
import { fmtDay } from './TermsBadge';

const SO_SECTIONS = ['sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement'];
// Request statuses on the shared chip: a known tone, the request's own words.
const STATUS_CHIP = {
  pending_sales: { status: 'pending', label: 'Waiting for Sales' },
  pending_accounts: { status: 'pending_approval', label: 'Waiting for Accounts' },
  approved: { status: 'approved', label: 'Approved — pickup can be made' },
  rejected: { status: 'rejected', label: 'Rejected' },
  cancelled: { status: 'cancelled', label: 'Withdrawn' },
  used: { status: 'completed', label: 'Pickup made' },
};
const TABS = [
  { key: 'open', label: 'Open' }, { key: 'used', label: 'Picked up' }, { key: 'rejected', label: 'Rejected' }, { key: 'all', label: 'All' },
];
const PROPOSAL = { full: 'Full remaining rent', negotiated: 'Negotiated', waive: 'Waived' };
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const chargeOf = (r) => Number(r.approved_amount ?? r.proposed_amount ?? r.full_amount ?? 0);
const enc = encodeURIComponent;

/**
 * Finance → Early returns before lock-in ends (claude/carret-lockin-warranty.md, L3–L4).
 * Support raises one from the ticket; Sales agrees the charge with the customer
 * (full remaining rent / negotiated / waive); Accounts approve or reject. The
 * approved amount lands on Finance → Support charges to bill for the next invoice,
 * and only then can Support create the return pickup.
 */
export default function EarlyReturnsPage() {
  const { hasPermission } = usePermission();
  const canPropose = SO_SECTIONS.some((s) => hasPermission(s, 'edit'));
  const canDecide = hasPermission('customer_billing', 'edit');
  const [tab, setTab] = useState('open');
  const [rows, setRows] = useState(null);
  const [openRows, setOpenRows] = useState(null); // the open list, always — the tiles read it whatever the tab
  const [search, setSearch] = useState('');
  const [act, setAct] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    fetchEarlyReturns({ status: tab === 'all' ? undefined : tab })
      .then(({ data }) => setRows(data.data || []))
      .catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const loadOpen = useCallback(() => {
    fetchEarlyReturns({ status: 'open' }).then(({ data }) => setOpenRows(data.data || [])).catch(() => setOpenRows(null));
  }, []);
  useEffect(() => { loadOpen(); }, [loadOpen]);

  const submit = async () => {
    setBusy(true);
    try {
      let res;
      if (act.kind === 'propose') {
        res = await proposeEarlyReturn(act.row.id, { proposal: act.proposal, amount: act.amount, note: act.note });
      } else if (act.kind === 'decide') {
        res = await decideEarlyReturn(act.row.id, { approve: act.approve, note: act.note });
      } else {
        res = await cancelEarlyReturn(act.row.id, act.note);
      }
      toast.success(res.data.message);
      setAct(null);
      load();
      loadOpen();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  // Search runs over the loaded tab: laptop, model, customer, ticket.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!rows || !q) return rows;
    return rows.filter((r) => [r.asset_code, r.model_name, r.customer_name, r.support_ticket_id && `#${r.support_ticket_id}`]
      .some((v) => v && String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  const tile = (status) => {
    if (!openRows) return { n: null, amount: null };
    const list = openRows.filter((r) => r.status === status);
    return { n: list.length, amount: <Money value={list.reduce((s, r) => s + chargeOf(r), 0)} /> };
  };
  const sales = tile('pending_sales');
  const accounts = tile('pending_accounts');
  const approved = tile('approved');

  const actions = (r) => (
    <div className="c-row-actions">
      {canPropose && ['pending_sales', 'pending_accounts'].includes(r.status) && (
        <Button variant={r.status === 'pending_sales' ? 'primary' : 'secondary'} onClick={() => setAct({ kind: 'propose', row: r, proposal: r.proposal || 'full', amount: r.proposed_amount ?? '', note: r.sales_note || '' })}>
          {r.status === 'pending_sales' ? 'Propose' : 'Change'}
        </Button>
      )}
      {canDecide && r.status === 'pending_accounts' && (
        <Button variant="primary" onClick={() => setAct({ kind: 'decide', row: r, approve: true, note: '' })}>Decide</Button>
      )}
      {['pending_sales', 'pending_accounts', 'approved'].includes(r.status) && (canPropose || canDecide) && (
        <Button variant="quiet" onClick={() => setAct({ kind: 'cancel', row: r, note: '' })}>Withdraw</Button>
      )}
    </div>
  );

  const cols = [
    {
      key: 'l', header: 'Laptop',
      render: (r) => (r.asset_code ? <Link to={`/carret/stock/assets/${enc(r.asset_code)}`}><DocNumber value={r.asset_code} /></Link> : '—'),
      sub: (r) => r.model_name,
    },
    { key: 'c', header: 'Customer', render: (r) => r.customer_name, sub: (r) => (r.support_ticket_id ? <Link to={`/carret/serve/tickets/${r.support_ticket_id}`}>Ticket #{r.support_ticket_id}</Link> : null) },
    { key: 'k', header: 'Lock-in', render: (r) => `till ${fmtDay(r.lock_in_end_date)}`, sub: (r) => `return ${fmtDay(r.planned_return_date)} · ${r.remaining_days} days early · ${money(r.monthly_rate)}/month` },
    {
      key: 'a',
      header: 'Charge',
      numeric: true,
      render: (r) => <Money value={r.approved_amount ?? r.proposed_amount ?? r.full_amount} />,
      sub: (r) => (r.proposal ? `${PROPOSAL[r.proposal]} (full ${money(r.full_amount)})` : 'full remaining rent'),
    },
    {
      key: 's', header: 'Status',
      render: (r) => { const c = STATUS_CHIP[r.status] || { status: r.status }; return <StatusChip status={c.status} label={c.label} />; },
      sub: (r) => r.accounts_note || r.sales_note || r.reason,
    },
    { key: 'w', header: 'Raised', render: (r) => <DateTime value={r.created_at} />, sub: (r) => r.requested_by_name },
    { key: 'x', header: '', render: actions },
  ];

  const row = act?.row;
  return (
    <DeskShell title="Early Returns (lock-in)" breadcrumb="Finance" subtitle="Laptops coming back before their lock-in ends — Sales agrees the charge, Accounts approve it.">
      <div className="c-stack">
        <div className="c-tiles">
          <StatTile label="Waiting for Sales" value={sales.n} delta={sales.amount} />
          <StatTile label="Waiting for Accounts" value={accounts.n} delta={accounts.amount} family="moving" />
          <StatTile label="Approved — charge to bill" value={approved.n} delta={approved.amount} family="earning" />
        </div>

        <Notice tone="info">
          Full charge = remaining days × monthly rent ÷ 30. The approved amount goes on the next invoice (Finance → Support charges to bill).
        </Notice>

        <Panel
          toolbar={(
            <>
              <Tabs tabs={TABS.map((t) => ({ ...t, count: t.key === 'open' && openRows ? openRows.length : null }))} value={tab} onChange={(v) => { setTab(v); setSearch(''); }} />
              <FilterBar
                filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: 'Laptop, model, customer or ticket' }]}
                values={{ search }}
                onChange={(k, v) => setSearch(v)}
                onClear={() => setSearch('')}
                count={shown ? `${shown.length} request${shown.length === 1 ? '' : 's'}` : '…'}
              />
            </>
          )}
        >
          {shown === null ? <EmptyState title="Loading…" /> : (
            <DataTable
              columns={cols}
              rows={shown}
              rowKey={(r) => r.id}
              empty={search
                ? <EmptyState title="No early returns match" body="The search covers laptop, model, customer and ticket." action={<Button variant="quiet" onClick={() => setSearch('')}>Clear search</Button>} />
                : <EmptyState title="No early returns here" />}
            />
          )}
        </Panel>
      </div>

      <Drawer
        open={Boolean(act)}
        onClose={() => setAct(null)}
        title={act?.kind === 'propose' ? `Sales proposal — ${row?.asset_code}` : act?.kind === 'decide' ? `Accounts decision — ${row?.asset_code}` : `Withdraw — ${row?.asset_code}`}
        footer={<Button variant="primary" disabled={busy} onClick={submit}>{act?.kind === 'propose' ? 'Send to Accounts' : act?.kind === 'decide' ? (act?.approve ? 'Approve' : 'Reject') : 'Withdraw'}</Button>}
      >
        {act && (
          <div className="c-stack">
            <p>
              {row.customer_name} · lock-in till {fmtDay(row.lock_in_end_date)} · returning {fmtDay(row.planned_return_date)}
              {' '}({row.remaining_days} days early) at {money(row.monthly_rate)}/month. Full remaining rent: <strong>{money(row.full_amount)}</strong>.
            </p>
            <p className="text-ink-3">Reason: {row.reason}</p>
            {act.kind === 'propose' && (
              <>
                <Field label="What the customer pays" required>
                  <Select value={act.proposal} onChange={(e) => setAct({ ...act, proposal: e.target.value })} options={[
                    { value: 'full', label: `Full remaining rent (${money(row.full_amount)})` },
                    { value: 'negotiated', label: 'Negotiated amount' },
                    { value: 'waive', label: 'Waive — no charge' },
                  ]} />
                </Field>
                {act.proposal === 'negotiated' && (
                  <Field label="Agreed amount (₹, before GST)" required><Input type="number" min="0" max={row.full_amount} value={act.amount} onChange={(e) => setAct({ ...act, amount: e.target.value })} /></Field>
                )}
                <Field label="Note for Accounts" required={act.proposal !== 'full'}><Textarea rows={3} value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} /></Field>
              </>
            )}
            {act.kind === 'decide' && (
              <>
                <p>Sales proposed: <strong>{PROPOSAL[row.proposal]} — {money(row.proposed_amount)}</strong>{row.sales_note ? ` · “${row.sales_note}”` : ''} ({row.proposed_by_name})</p>
                <Field label="Decision" required>
                  <Select value={act.approve ? 'yes' : 'no'} onChange={(e) => setAct({ ...act, approve: e.target.value === 'yes' })} options={[
                    { value: 'yes', label: Number(row.proposed_amount) > 0 ? `Approve — bill ${money(row.proposed_amount)} + 18% GST on the next invoice` : 'Approve — no charge' },
                    { value: 'no', label: 'Reject — the customer keeps the laptop to the lock-in end' },
                  ]} />
                </Field>
                <Field label="Note" required={!act.approve}><Textarea rows={3} value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} /></Field>
              </>
            )}
            {act.kind === 'cancel' && (
              <Field label="Why"><Textarea rows={3} value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} /></Field>
            )}
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}
