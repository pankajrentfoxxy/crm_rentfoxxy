import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, Input, Money, Panel, Select, StatusChip, Tabs,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { fetchPurchaseOrders, fetchSpareOrders } from '../../vendor-management/vendorManagementApi';
import SparePartsPoFormModal from '../../vendor-management/components/SparePartsPoFormModal';
import { errMsg } from './procureShared';
import {
  PO_TABS, PO_TYPES, SPO_TABS, poQty, poStatus, poStatusLabel, poTypeLabel, spoStatusLabel,
} from './poShared';

/**
 * Procure → Purchase orders.
 *
 * Tabs follow the process (draft → approval → with the vendor → receiving →
 * done), so each person opens the tab that is theirs: managers "Waiting
 * approval", the warehouse "With vendor" and "Receiving". The Received column
 * is the real count, not the ordered quantity.
 */
const PAGE = 50;

export default function PurchaseOrdersListPage({ kind = 'laptop' }) {
  const spare = kind === 'spare';
  const TABS = spare ? SPO_TABS : PO_TABS;
  const label = spare ? spoStatusLabel : poStatusLabel;
  const recordPath = spare ? '/carret/procure/spare-parts-orders' : '/carret/procure/purchase-orders';
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canCreate = spare
    ? ['vendor_management', 'parts_procurement'].some((s) => hasPermission(s, 'create'))
    : hasPermission('vendor_management', 'create');
  const [newSpare, setNewSpare] = useState(false);
  const [reload, setReload] = useState(0);

  const [tab, setTab] = useState('open');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: null, rows: [], counts: {}, total: 0, pages: 1 });

  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let off = false;
    const statuses = TABS.find((t) => t.key === tab)?.statuses || [];
    setState((s) => ({ ...s, loading: true, error: null }));
    (spare ? fetchSpareOrders : fetchPurchaseOrders)({
      status: statuses.length ? statuses.join(',') : undefined,
      purchase_order_type: type || undefined,
      search: q || undefined,
      page,
      limit: PAGE,
    })
      .then(({ data }) => !off && setState({
        loading: false, error: null, rows: data.data || [], counts: data.counts || {},
        total: data.pagination?.total || 0, pages: data.pagination?.totalPages || 1,
      }))
      .catch((e) => !off && setState((s) => ({ ...s, loading: false, error: errMsg(e, 'Could not load purchase orders.') })));
    return () => { off = true; };
  }, [tab, type, q, page, spare, TABS, reload]);

  const count = (t) => (t.statuses.length
    ? t.statuses.reduce((n, s) => n + (state.counts[s] || 0), 0)
    : Object.values(state.counts).reduce((n, c) => n + c, 0));

  const columns = [
    { key: 'no', header: 'PO', render: (r) => <DocNumber value={r.purchase_order_number} />, sub: (r) => (Number(r.amendment_no) > 0 ? `Amendment ${r.amendment_no}` : null) },
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor_display_name || r.vendor_business_name || '—' },
    spare
      ? { key: 'parts', header: 'Parts', render: (r) => (r.line_items || []).map((l) => l.spare_part_name || l.part_name).filter(Boolean).slice(0, 3).join(', ') || '—' }
      : { key: 'type', header: 'Type', render: (r) => poTypeLabel(r.purchase_order_type) },
    {
      key: 'recv',
      header: 'Received',
      numeric: true,
      render: (r) => {
        const q2 = poQty(r);
        if (!q2.ordered) return '—';
        return <span className="font-mono" style={{ color: q2.received >= q2.ordered ? 'var(--alert-good)' : q2.received ? 'var(--alert-warn)' : 'var(--ink-3)' }}>{q2.received} / {q2.ordered}</span>;
      },
    },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={poStatus(r) === 'pending' && spare ? 'pending_approval' : poStatus(r)} label={label(poStatus(r))} /> },
    { key: 'value', header: 'Value', numeric: true, render: (r) => <Money value={r.total_amount} showZero={false} />, sub: (r) => (['rental_purchase', 'rent_to_own'].includes(r.purchase_order_type) ? 'per month' : null) },
    { key: 'date', header: 'Date', render: (r) => <DateTime value={r.purchase_order_date || r.created_at} />, sub: (r) => (r.expected_delivery_date ? <>due <DateTime value={r.expected_delivery_date} /></> : null) },
  ];

  return (
    <DeskShell
      title={spare ? 'Spare-parts orders' : 'Purchase orders'}
      breadcrumb="Procure"
      subtitle={spare ? 'Parts we buy for the floor and for support, from draft to received.' : 'Laptops we buy or rent from vendors, from draft to received.'}
      actions={canCreate && (
        <Button variant="primary" onClick={() => (spare ? setNewSpare(true) : navigate('/carret/procure/purchase-orders/new'))}>
          {spare ? 'New spare-parts order' : 'New purchase order'}
        </Button>
      )}
    >
      <div className="c-stack">
        <Tabs tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: count(t) }))} value={tab} onChange={(k) => { setTab(k); setPage(1); }} />
        <Panel
          toolbar={(
            <div className="flex items-center flex-wrap" style={{ gap: '12px', width: '100%' }}>
              <Input type="search" placeholder="PO number, vendor or remarks" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: '20rem' }} aria-label="Search purchase orders" />
              {!spare && <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} placeholder="All types" options={PO_TYPES} style={{ maxWidth: '12rem' }} aria-label="Type" />}
              <span className="text-ink-3" style={{ marginLeft: 'auto' }}>{state.total} orders</span>
            </div>
          )}
        >
          {state.error && <EmptyState title="Could not load purchase orders" body={state.error} />}
          {!state.error && (
            <DataTable
              columns={columns}
              rows={state.rows}
              rowKey={(r) => r.po_id || r.spo_id}
              onRowClick={(r) => navigate(`${recordPath}/${spare ? r.spo_id : r.po_id}`)}
              empty={<EmptyState title={state.loading ? 'Loading…' : 'No purchase orders here'} />}
            />
          )}
          {state.pages > 1 && (
            <div className="flex items-center justify-end" style={{ gap: '8px', padding: '12px' }}>
              <Button variant="quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-ink-3">Page {page} of {state.pages}</span>
              <Button variant="quiet" disabled={page >= state.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </Panel>
      </div>
      {spare && (
        <SparePartsPoFormModal
          open={newSpare}
          onClose={() => setNewSpare(false)}
          onSaved={(saved) => { setReload((n) => n + 1); if (saved?.spo_id) navigate(`${recordPath}/${saved.spo_id}`); }}
        />
      )}
    </DeskShell>
  );
}
