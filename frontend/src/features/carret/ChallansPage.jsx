import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import DeskShell from '../../shells/DeskShell';
import {
  DataTable, FilterBar, Panel, StatusChip, DocNumber, DateTime, EmptyState, Button, Tabs,
} from '../../components/carret';
import { usePermission } from '../../hooks/usePermission';
import { useChallans } from './useDeliveryChallans';

/**
 * Move → Delivery Challans and Return Challans (Part 3.7).
 *
 * Outbound: the tabs follow the challan through its life — waiting at the
 * gate, on the way, delivered, refused — and the badges say what is holding a
 * challan back (Dispatch QC, e-way bill) without opening it. A row opens the
 * challan record, where every step is actioned.
 *
 * Return challans read their own endpoint (/return-dc); returns from rental
 * are the next process after this one, so their rows still open the old page.
 */
const OUT_TABS = [
  { key: '', label: 'All' },
  { key: 'dispatch_ready', label: 'Waiting for the gate' },
  { key: 'in_transit', label: 'On the way' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'rejected', label: 'Refused' },
];
const RET_TABS = [
  { key: '', label: 'All' },
  { key: 'pending', label: 'Open' },
  { key: 'received', label: 'Received' },
];
const MODE = { inhouse: 'By hand', courier: 'Courier', porter: 'Porter' };

const qcBadge = (q) => {
  if (!q || !q.total_count) return <span className="text-ink-3">—</span>;
  if (q.any_failed) return <StatusChip status="rejected" title={`${q.failed_count} failed`} />;
  if (q.all_passed) return <StatusChip status="approved" title="All passed" />;
  return <StatusChip status="pending" title={`${q.pending_count} of ${q.total_count} pending`} />;
};

export default function ChallansPage({ movement = 'outbound' }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const isReturn = movement === 'return';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const { loading, error, rows, total, pages, stats } = useChallans({ movement, status, search, page });

  const onFilter = useCallback((k, v) => { if (k === 'search') { setSearch(v); setPage(1); } }, []);
  const onClear = useCallback(() => { setSearch(''); setStatus(''); setPage(1); }, []);

  const tabs = useMemo(() => (isReturn ? RET_TABS : OUT_TABS.map((t) => ({
    ...t,
    count: stats ? (t.key === '' ? stats.total_delivery_challans : stats[t.key]) : undefined,
  }))), [isReturn, stats]);

  const columns = useMemo(() => (isReturn ? [
    { key: 'rdc', header: 'Return challan', render: (r) => <DocNumber value={r.return_dc_number || r.rdc_number} /> },
    { key: 'customer_name', header: 'Customer' },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
    { key: 'created_at', header: 'Raised', render: (r) => <DateTime value={r.created_at} /> },
  ] : [
    {
      key: 'dc_number', header: 'Challan',
      render: (r) => <DocNumber value={r.dc_number} />,
      sub: (r) => [r.sales_order_number, r.order_type === 'sale' ? 'Sale' : null, r.dc_purpose === 'service_return' ? 'Service' : null].filter(Boolean).join(' · '),
    },
    { key: 'customer_name', header: 'Customer' },
    { key: 'mode', header: 'Mode', render: (r) => MODE[r.dispatch_mode] || r.dispatch_mode || '—', sub: (r) => r.awb_number || r.delivery_person_name || null },
    { key: 'qc', header: 'Dispatch QC', render: (r) => qcBadge(r.qc_status) },
    {
      key: 'eway', header: 'E-way',
      render: (r) => (r.eway_required
        ? (r.eway_bill_number ? <StatusChip status="approved" title={r.eway_bill_number} /> : <StatusChip status="overdue" title="E-way bill missing — the gate will refuse" />)
        : <span className="text-ink-3">—</span>),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
    { key: 'created_at', header: 'Created', render: (r) => <DateTime value={r.created_at} />, sub: (r) => (r.dispatched_at ? `out ${new Date(r.dispatched_at).toLocaleDateString()}` : null) },
  ]), [isReturn]);

  const open = (r) => (isReturn
    // Returns are the next process; until then the old list (with its drawer) is the record.
    ? navigate('/sales-pipeline/return-dc')
    : navigate(`/carret/move/challans/${encodeURIComponent(r.dc_number)}`));

  return (
    <DeskShell
      title={isReturn ? 'Return Challans' : 'Delivery Challans'}
      breadcrumb="Move"
      subtitle={isReturn ? 'Units coming back in from customers, one challan at a time.' : 'Challans leaving the warehouse — what is ready for the gate, what is on the way, what came back.'}
      actions={!isReturn && hasPermission('delivery_challans', 'create') && (
        <Button variant="primary" onClick={() => navigate('/carret/move/challans/new')}><Plus size={16} aria-hidden="true" /> New challan</Button>
      )}
    >
      <Panel
        toolbar={(
          <>
            <Tabs tabs={tabs} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
            <FilterBar
              filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: isReturn ? 'Return challan or customer' : 'Challan, order, customer or GSTIN' }]}
              values={{ search }}
              onChange={onFilter}
              onClear={onClear}
              count={`${total} challans`}
            />
          </>
        )}
      >
        {loading && <EmptyState title="Loading…" />}
        {error && <EmptyState title="Could not load challans" body={error} />}
        {!loading && !error && (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r, i) => r.dc_number || r.return_dc_number || r.rdc_number || i}
            onRowClick={open}
            empty={<EmptyState title="No challans match" action={<Button variant="quiet" onClick={onClear}>Clear filters</Button>} />}
          />
        )}
        {pages > 1 && (
          <div className="c-toolbar" style={{ borderTop: '1px solid var(--rule)', borderBottom: 0 }}>
            <Button variant="quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="font-ui text-ink-3">Page {page} of {pages}</span>
            <Button variant="quiet" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </Panel>
    </DeskShell>
  );
}
