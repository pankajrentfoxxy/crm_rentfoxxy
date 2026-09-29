import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, Input, Money, Notice, Segmented, StatusChip,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { SO_SECTIONS } from './sellShared';

/**
 * Sell → Demo agreements (old: /sales-pipeline/demo, same API).
 *
 * A demo laptop is free for 7 days after delivery. By the decision date Sales
 * records what the customer does:
 *   Keep    → the laptop becomes a rental from the billing start date
 *             (POST /demo/agreements/:id/decide { decision: 'keep' }).
 *   Return  → a high-priority support pickup ticket is raised; the pickup flow
 *             brings the laptop back to stock.
 * API: GET /demo/agreements (demo_management view), decide (demo_management edit).
 */
const FILTERS = [
  { value: 'pending', label: 'Waiting for a decision' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'decided', label: 'Decided' },
  { value: '', label: 'All' },
];
const enc = encodeURIComponent;

/** Local YYYY-MM-DD (toISOString shifts the day in IST). */
function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function decisionChip(r) {
  if (r.decision === 'keep') return <StatusChip status="active" label="Kept — on rent" />;
  if (r.decision === 'return') return <StatusChip status="closed" label="Returning — pickup raised" />;
  if (r.is_overdue) return <StatusChip status="overdue" label="Decision overdue" />;
  return <StatusChip status="pending" label="Waiting for a decision" />;
}

export default function DemoAgreementsPage() {
  const { hasPermission } = usePermission();
  const canDecide = hasPermission('demo_management', 'edit');
  const canOpenSo = SO_SECTIONS.some((s) => hasPermission(s, 'view'));
  const canOpenCustomer = ['customers', 'customer_management'].some((s) => hasPermission(s, 'view'));

  const [filter, setFilter] = useState('pending');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(null);
  const [keep, setKeep] = useState(null); // { row, start, rate }
  const [returning, setReturning] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(() => {
    setRows(null);
    api.get('/demo/agreements', { params: { status: filter || undefined, search: search || undefined } })
      .then(({ data }) => setRows(data?.data || []))
      .catch((e) => { setRows([]); toast.error(e?.response?.data?.message || 'Could not load demo agreements'); });
  }, [filter, search]);
  useEffect(() => { load(); }, [load]);

  // Open work: soonest decision first (the server's order). Decided / all: newest first.
  const shown = useMemo(() => {
    if (!rows) return rows;
    if (filter === 'pending' || filter === 'overdue') return rows;
    const at = (r) => new Date(r.decided_at || r.created_at || 0).getTime();
    return [...rows].sort((a, b) => at(b) - at(a));
  }, [rows, filter]);

  const decide = async (row, body, ok) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/demo/agreements/${row.demo_id}/decide`, body);
      toast.success(ok || data?.message || 'Saved');
      setKeep(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const submitKeep = () => {
    if (!keep.start) { toast.error('Pick the billing start date'); return; }
    if (keep.rate !== '' && !(Number(keep.rate) > 0)) { toast.error('Monthly rate must be more than zero'); return; }
    decide(keep.row, { decision: 'keep', rent_start_date: keep.start, monthly_rate: keep.rate === '' ? undefined : Number(keep.rate) }, 'Demo kept — the laptop is now on rent');
  };

  const columns = [
    {
      key: 'l', header: 'Laptop',
      render: (r) => (r.ttspl_id
        ? <Link to={`/carret/stock/assets/${enc(r.ttspl_id)}`}><DocNumber value={r.ttspl_id} /></Link>
        : '—'),
      sub: (r) => r.serial_number || null,
    },
    {
      key: 'c', header: 'Customer',
      render: (r) => {
        const name = r.company_name || r.customer_name || (r.customer_id ? `#${r.customer_id}` : '—');
        return canOpenCustomer && r.customer_id ? <Link to={`/carret/sell/customers/${r.customer_id}`}>{name}</Link> : name;
      },
    },
    {
      key: 'o', header: 'Order / challan',
      render: (r) => (r.sales_order_number
        ? (canOpenSo ? <Link to={`/carret/sell/sales-orders/${enc(r.sales_order_number)}`}><DocNumber value={r.sales_order_number} /></Link> : <DocNumber value={r.sales_order_number} />)
        : '—'),
      sub: (r) => (r.dc_number ? <Link to={`/carret/move/challans/${enc(r.dc_number)}`}>{r.dc_number}</Link> : null),
    },
    { key: 'd', header: 'Delivered', render: (r) => (r.delivered_at ? <DateTime value={r.delivered_at} /> : '—') },
    { key: 'due', header: 'Decide by', render: (r) => (r.decision_due_at ? <DateTime value={r.decision_due_at} /> : '—') },
    {
      key: 's', header: 'Status', render: decisionChip,
      sub: (r) => {
        if (r.decision === 'keep') return r.rent_start_date ? `Billing from ${String(r.rent_start_date).slice(0, 10)}` : null;
        if (r.decision === 'return' && r.pickup_ticket_id) return <Link to={`/carret/serve/tickets/${r.pickup_ticket_id}`}>Pickup ticket #{r.pickup_ticket_id}</Link>;
        return null;
      },
    },
    { key: 'rate', header: 'Rent / month', numeric: true, render: (r) => <Money value={r.rent_monthly_rate} showZero={false} /> },
    {
      key: 'a', header: '', align: 'right',
      render: (r) => canDecide && r.decision === 'pending' && (
        <div className="flex" style={{ gap: '6px', justifyContent: 'flex-end' }}>
          <Button variant="primary" onClick={(e) => { e.stopPropagation(); setKeep({ row: r, start: todayYmd(), rate: r.rent_monthly_rate ? String(r.rent_monthly_rate) : '' }); }}>Keep</Button>
          <Button variant="quiet" onClick={(e) => { e.stopPropagation(); setReturning(r); }}>Return</Button>
        </div>
      ),
    },
  ];

  return (
    <DeskShell title="Demo agreements" breadcrumb="Sell" subtitle="Demo laptops are free for 7 days after delivery; then the customer keeps it on rent or it comes back.">
      <div className="c-stack">
        <Notice tone="info">
          Keep turns the demo into a rental from the billing start date you pick. Return raises a support pickup ticket; the laptop comes back through the normal pickup.
        </Notice>
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Segmented label="Show" value={filter} onChange={setFilter} options={FILTERS} />
          <Input type="search" placeholder="Customer, TTSPL or serial" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: '16rem', marginLeft: 'auto' }} aria-label="Search" />
        </div>
        {shown === null ? <EmptyState title="Loading…" /> : (
          <DataTable columns={columns} rows={shown} rowKey={(r) => r.demo_id} empty={<EmptyState title="No demo agreements" />} />
        )}
      </div>

      <Drawer
        open={Boolean(keep)}
        onClose={() => setKeep(null)}
        title={`Keep — ${keep?.row?.ttspl_id || 'demo'} goes on rent`}
        footer={<Button variant="primary" disabled={busy} onClick={submitKeep}>{busy ? 'Saving…' : 'Convert to rental'}</Button>}
      >
        {keep && (
          <div className="c-stack">
            <p>{keep.row.company_name || keep.row.customer_name}</p>
            <Field label="Billing starts on" required>
              <Input type="date" value={keep.start} onChange={(e) => setKeep({ ...keep, start: e.target.value })} />
            </Field>
            <Field label="Monthly rent (₹, before GST)" hint="Leave empty to use the rate already on the laptop.">
              <Input type="number" min="1" step="0.01" value={keep.rate} onChange={(e) => setKeep({ ...keep, rate: e.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={Boolean(returning)}
        onClose={() => setReturning(null)}
        onConfirm={() => decide(returning, { decision: 'return' }, 'Pickup ticket raised')}
        title={`Return ${returning?.ttspl_id || 'this demo'}?`}
        body="A high-priority pickup ticket is raised in Support. The laptop comes back to stock through the pickup."
        confirmLabel="Raise pickup"
      />
    </DeskShell>
  );
}
