import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, Notice, Panel, StatusChip,
} from '../../../components/carret';
import { acceptDispatchWorkflow, fetchDispatchPendingOrders } from '../../../utils/dispatchWorkflowApi';
import { usePermission } from '../../../hooks/usePermission';
import { configText } from '../sell/LineItemsEditor';
import { errText } from './chargerShared';

/**
 * Movement → Orders to accept. Step 0 of Order to delivery: a new sales order
 * is assigned round-robin to a dispatch user, who must accept it before the
 * clock runs out. Accepting opens the order, where laptops are attached.
 *
 * Same API as the old Pending Dispatch screen (/dispatch-workflow/pending-orders
 * and /:so/accept). The server returns rows only to dispatch and super admin,
 * and to a dispatch user only the orders assigned to them.
 */
const POLL_MS = 30000;

function dueText(due, now) {
  if (!due) return null;
  const ms = new Date(due).getTime() - now;
  const mins = Math.round(Math.abs(ms) / 60000);
  const span = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} m` : `${mins} m`;
  return ms < 0 ? `${span} overdue` : `${span} left`;
}

export default function OrdersToAcceptPage() {
  const navigate = useNavigate();
  const { hasPermission, user } = usePermission();
  const canAccept = ['dispatch_pending_orders', 'dispatch_workflow'].some((s) => hasPermission(s, 'edit'));
  const [state, setState] = useState({ loading: true, rows: [], error: null });
  const [busy, setBusy] = useState(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => fetchDispatchPendingOrders()
    .then(({ data }) => setState({ loading: false, rows: data?.orders || [], error: null }))
    .catch((e) => setState({ loading: false, rows: [], error: errText(e, 'Could not load orders to accept.') })), []);

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load]);

  const accept = async (r) => {
    setBusy(r.sales_order_number);
    try {
      await acceptDispatchWorkflow(r.sales_order_number);
      toast.success(`${r.sales_order_number} accepted — attach the laptops`);
      navigate(`/carret/sell/sales-orders/${encodeURIComponent(r.sales_order_number)}`);
    } catch (e) {
      toast.error(errText(e, 'Could not accept the order'));
      load();
    } finally {
      setBusy(null);
    }
  };

  const columns = useMemo(() => [
    {
      key: 'so', header: 'Sales order',
      render: (r) => <Link to={`/carret/sell/sales-orders/${encodeURIComponent(r.sales_order_number)}`}><DocNumber value={r.sales_order_number} /></Link>,
      sub: (r) => [r.order_type === 'sale' || r.order_type === 'sales' ? 'Sale' : 'Rental', r.entity_code].filter(Boolean).join(' · '),
    },
    { key: 'c', header: 'Customer', render: (r) => r.customer_name || '—' },
    {
      key: 'cfg', header: 'Laptops',
      render: (r) => {
        const lines = r.lines || [];
        if (!lines.length) return configText(r) || '—';
        return (
          <span className="c-stack" style={{ gap: '2px' }}>
            {lines.map((l, i) => (
              <span key={l.id || i}>{`${l.main_qty || l.quantity || 0} × ${configText(l) || 'Laptop'}`}</span>
            ))}
          </span>
        );
      },
    },
    { key: 'to', header: 'Assigned to', render: (r) => r.assigned_user_name || '—', sub: (r) => (r.assigned_at ? new Date(r.assigned_at).toLocaleString('en-IN') : null) },
    {
      key: 'due', header: 'Accept by',
      render: (r) => (r.acceptance_due_at
        ? <span style={{ color: r.priority === 'critical' ? 'var(--alert-crit)' : r.priority === 'high' ? 'var(--alert-warn)' : undefined }}><DateTime value={r.acceptance_due_at} /></span>
        : '—'),
      sub: (r) => dueText(r.acceptance_due_at, now),
    },
    {
      key: 'p', header: 'Priority',
      render: (r) => <StatusChip status={r.priority === 'critical' ? 'overdue' : r.priority === 'high' ? 'pending' : 'sent'} label={r.priority === 'critical' ? 'Overdue' : r.priority === 'high' ? 'Due soon' : 'Normal'} />,
      sub: (r) => r.last_decline_remark || (r.alert_snoozed_until ? `Snoozed until ${new Date(r.alert_snoozed_until).toLocaleTimeString('en-IN')}` : null),
    },
    {
      key: 'a', header: '', align: 'right',
      render: (r) => (canAccept
        ? <Button variant="primary" onClick={() => accept(r)} disabled={busy === r.sales_order_number}>{busy === r.sales_order_number ? '…' : 'Accept'}</Button>
        : <span className="text-ink-3">View only</span>),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canAccept, busy, now]);

  const notDispatch = user?.role !== 'dispatch' && user?.role !== 'super_admin';

  return (
    <DeskShell title="Orders to accept" breadcrumb="Movement" subtitle="New sales orders assigned to dispatch. Accept each one before its time runs out, then attach laptops on the order.">
      <div className="c-stack">
        {notDispatch && (
          <Notice tone="info" title="Dispatch team only">Orders are assigned to dispatch users; this list is empty for other roles. Accept an order from its record instead.</Notice>
        )}
        <Panel
          toolbar={(
            <div className="flex items-center" style={{ gap: '12px', width: '100%' }}>
              <span className="font-ui text-ink-2" style={{ fontSize: 'var(--d-sm)' }}>{state.rows.length} waiting · refreshes every 30 s</span>
              <Button variant="quiet" onClick={load} className="ml-auto">Refresh</Button>
            </div>
          )}
        >
          {state.loading && <EmptyState title="Loading…" />}
          {state.error && <EmptyState title="Could not load orders" body={state.error} />}
          {!state.loading && !state.error && (
            <DataTable
              columns={columns}
              rows={state.rows}
              rowKey={(r) => r.id || r.sales_order_number}
              empty={<EmptyState title="Nothing waiting" body="No sales order assigned to you is waiting for acceptance." />}
            />
          )}
        </Panel>
      </div>
    </DeskShell>
  );
}
