import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, Input, Money, Notice, Segmented, Select, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { cancelEarlyReturn, decideEarlyReturn, fetchEarlyReturns, proposeEarlyReturn } from './serveApi';
import { errMsg } from './serveShared';
import { fmtDay } from './TermsBadge';

const SO_SECTIONS = ['sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement'];
const LABEL = {
  pending_sales: 'Waiting for Sales', pending_accounts: 'Waiting for Accounts', approved: 'Approved — pickup can be made',
  rejected: 'Rejected', cancelled: 'Withdrawn', used: 'Pickup made',
};
const PROPOSAL = { full: 'Full remaining rent', negotiated: 'Negotiated', waive: 'Waived' };
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Early returns before lock-in ends (claude/carret-lockin-warranty.md, L3–L4).
 * Support raises one from the ticket; Sales agrees the charge with the customer
 * (full remaining rent / negotiated / waive); Accounts approve or reject. The
 * approved amount lands on Money → Support charges to bill for the next invoice,
 * and only then can Support create the return pickup.
 */
export default function EarlyReturnsPage() {
  const { hasPermission } = usePermission();
  const canPropose = SO_SECTIONS.some((s) => hasPermission(s, 'edit'));
  const canDecide = hasPermission('customer_billing', 'edit');
  const [tab, setTab] = useState('open');
  const [rows, setRows] = useState(null);
  const [act, setAct] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    fetchEarlyReturns({ status: tab === 'all' ? undefined : tab })
      .then(({ data }) => setRows(data.data || []))
      .catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [tab]);
  useEffect(() => { load(); }, [load]);

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
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const actions = (r) => (
    <div className="flex" style={{ gap: '6px', justifyContent: 'flex-end' }}>
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
    { key: 'l', header: 'Laptop', render: (r) => <DocNumber value={r.asset_code} />, sub: (r) => r.model_name },
    { key: 'c', header: 'Customer', render: (r) => r.customer_name, sub: (r) => (r.support_ticket_id ? <Link to={`/carret/serve/tickets/${r.support_ticket_id}`}>Ticket #{r.support_ticket_id}</Link> : null) },
    { key: 'k', header: 'Lock-in', render: (r) => `till ${fmtDay(r.lock_in_end_date)}`, sub: (r) => `return ${fmtDay(r.planned_return_date)} · ${r.remaining_days} days early · ${money(r.monthly_rate)}/month` },
    {
      key: 'a',
      header: 'Charge',
      numeric: true,
      render: (r) => <Money value={r.approved_amount ?? r.proposed_amount ?? r.full_amount} />,
      sub: (r) => (r.proposal ? `${PROPOSAL[r.proposal]} (full ${money(r.full_amount)})` : 'full remaining rent'),
    },
    { key: 's', header: 'Status', render: (r) => LABEL[r.status] || r.status, sub: (r) => r.accounts_note || r.sales_note || r.reason },
    { key: 'w', header: 'Raised', render: (r) => <DateTime value={r.created_at} />, sub: (r) => r.requested_by_name },
    { key: 'x', header: '', render: actions },
  ];

  const row = act?.row;
  return (
    <DeskShell title="Early returns (lock-in)" breadcrumb="Sell">
      <div className="c-stack">
        <Notice tone="info">
          A laptop returned before its lock-in ends needs Sales to agree the charge with the customer and Accounts to approve it.
          Full charge = remaining days × monthly rent ÷ 30. The approved amount goes on the next invoice (Money → Support charges to bill).
        </Notice>
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'open', label: 'Open' }, { value: 'used', label: 'Picked up' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' },
          ]}
        />
        {rows === null ? <EmptyState title="Loading…" /> : (
          <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} empty={<EmptyState title="No early returns" />} />
        )}
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
