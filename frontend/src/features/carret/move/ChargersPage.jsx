import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, FilterBar, Panel, StatusChip, Tabs,
} from '../../../components/carret';
import { fetchChargerWarehouseQueue } from '../../dispatch-charger/dispatchChargerApi';
import { usePermission } from '../../../hooks/usePermission';
import ChargerHandoverDrawer from './ChargerHandoverDrawer';
import { CHARGER_STATUS, chargerStatusLabel, errText, laptopConfig, laptopName } from './chargerShared';

/**
 * Movement → Chargers to hand over. The warehouse's list for one step of Order
 * to delivery: Dispatch QC asked for a charger kit for a laptop on an order.
 *
 * Every row carries what the warehouse must see before a kit leaves the shelf —
 * the laptop, the order and customer, and who asked — and "Hand over" appears
 * only when the server says the request is complete (same rule it enforces).
 * The same handover opens from the sales order and the Dispatch QC ticket.
 */
const TABS = [
  { key: 'pending', label: 'To hand over' },
  { key: 'handed_over', label: 'Handed over' },
  { key: 'attached', label: 'Attached' },
  { key: 'all', label: 'All' },
];

export default function ChargersPage() {
  const { hasPermission } = usePermission();
  const canHandOver = hasPermission('dispatch_charger_warehouse', 'edit');
  const [tab, setTab] = useState('pending');
  const [search, setSearch] = useState('');
  const [state, setState] = useState({ loading: true, rows: [], error: null });
  // ?request= opens one request straight away (from the Dispatch QC ticket).
  const [params] = useSearchParams();
  const [open, setOpen] = useState(() => Number(params.get('request')) || null);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return fetchChargerWarehouseQueue(tab, { search: search || undefined })
      .then(({ data }) => setState({ loading: false, rows: data?.data || [], error: null }))
      .catch((e) => setState({ loading: false, rows: [], error: errText(e, 'Could not load charger requests.') }));
  }, [tab, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const blocked = state.rows.filter((r) => r.status === 'pending' && !r.can_hand_over).length;

  const columns = useMemo(() => [
    {
      key: 'laptop', header: 'Laptop',
      render: (r) => (r.ttspl_id
        ? <Link to={`/carret/stock/assets/${encodeURIComponent(r.ttspl_id)}`} onClick={(e) => e.stopPropagation()}><DocNumber value={r.ttspl_id} /></Link>
        : <span style={{ color: 'var(--alert-crit)' }}>TTSPL missing</span>),
      sub: (r) => [r.serial_number, laptopName(r)].filter(Boolean).join(' · ') || null,
    },
    { key: 'cfg', header: 'Configuration', render: (r) => laptopConfig(r) || <span className="text-ink-3">—</span> },
    {
      key: 'so', header: 'Order',
      render: (r) => (r.sales_order_number
        ? <Link to={`/carret/sell/sales-orders/${encodeURIComponent(r.sales_order_number)}`} onClick={(e) => e.stopPropagation()}><DocNumber value={r.sales_order_number} /></Link>
        : <span style={{ color: 'var(--alert-crit)' }}>SO missing</span>),
      sub: (r) => r.customer_name || null,
    },
    {
      key: 'req', header: 'Requested by',
      render: (r) => r.requested_by_name || <span style={{ color: 'var(--alert-crit)' }}>Unknown</span>,
      sub: (r) => r.request_number,
    },
    { key: 'at', header: 'Asked', render: (r) => <DateTime value={r.requested_at} /> },
    {
      key: 'st', header: 'Status',
      render: (r) => <StatusChip status={CHARGER_STATUS[r.status]?.chip || r.status} label={chargerStatusLabel(r.status)} />,
      sub: (r) => (r.status === 'pending' && r.handover_blockers?.length
        ? r.handover_blockers.join(' · ')
        : [r.adapter_label, r.cable_label].filter(Boolean).join(' + ') || null),
    },
    {
      key: 'act', header: '', align: 'right',
      render: (r) => (r.status === 'pending' && r.can_hand_over && canHandOver
        ? <Button variant="primary" onClick={(e) => { e.stopPropagation(); setOpen(r.request_id); }}>Hand over</Button>
        : <Button variant="quiet" onClick={(e) => { e.stopPropagation(); setOpen(r.request_id); }}>Open</Button>),
    },
  ], [canHandOver]);

  return (
    <DeskShell
      title="Chargers to hand over"
      breadcrumb="Movement"
      subtitle="Charger kits Dispatch QC asked for — adapter plus power cable for a laptop going out on an order."
    >
      <Panel
        toolbar={(
          <>
            <Tabs tabs={TABS} value={tab} onChange={setTab} />
            <FilterBar
              filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: 'TTSPL, serial, SO, customer, requester' }]}
              values={{ search }}
              onChange={(k, v) => setSearch(v)}
              onClear={() => setSearch('')}
              count={`${state.rows.length} requests${blocked ? ` · ${blocked} missing details` : ''}`}
            />
          </>
        )}
      >
        {state.loading && <EmptyState title="Loading…" />}
        {state.error && <EmptyState title="Could not load charger requests" body={state.error} />}
        {!state.loading && !state.error && (
          <DataTable
            columns={columns}
            rows={state.rows}
            rowKey={(r) => r.request_id}
            onRowClick={(r) => setOpen(r.request_id)}
            empty={<EmptyState title={tab === 'pending' ? 'Nothing to hand over' : 'No charger requests here'} body="Requests are raised at Dispatch QC when a laptop needs a charger." />}
          />
        )}
      </Panel>
      <ChargerHandoverDrawer requestId={open} onClose={() => setOpen(null)} onDone={load} />
    </DeskShell>
  );
}
