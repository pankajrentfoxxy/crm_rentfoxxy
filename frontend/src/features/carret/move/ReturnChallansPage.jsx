import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, Input, Segmented, StatTile, StatusChip,
} from '../../../components/carret';
import api from '../../../utils/api';

/**
 * Movement → Return challans (claude/carret-customers-returns-control.md, step 2).
 * Every Return DC (customer → us). Open = not yet collected / on the way;
 * Awaiting warehouse = collected, not yet received (rent still runs until the
 * warehouse receives it — RT1). Replaces the list-only view whose "Received" tab
 * filtered nothing and whose rows lost the RDC.
 */
const TABS = [
  { value: 'open', label: 'Open', params: { status: 'pending,in_transit' } },
  { value: 'warehouse', label: 'Awaiting warehouse', params: { warehouse_receive: 'pending' } },
  { value: 'received', label: 'Received', params: { status: 'delivered' } },
  { value: 'cancelled', label: 'Cancelled', params: { status: 'cancelled' } },
  { value: 'all', label: 'All', params: {} },
];
const LIMIT = 50;
const errMsg = (e) => e?.response?.data?.message || e?.message || 'That did not work.';

export default function ReturnChallansPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('open');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 350); return () => clearTimeout(t); }, [q]);
  const load = useCallback(() => {
    setRes(null);
    const t = TABS.find((x) => x.value === tab);
    api.get('/sales-management/return-dc', { params: { ...t.params, search: search || undefined, page, limit: LIMIT } })
      .then(({ data }) => setRes(data))
      .catch((e) => { setRes({ rows: [], stats: {} }); toast.error(errMsg(e)); });
  }, [tab, search, page]);
  useEffect(() => { load(); }, [load]);

  const rows = res?.return_dcs || res?.rows || [];
  const st = res?.stats || {};
  const total = res?.pagination?.total ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const cols = [
    { key: 'n', header: 'Return challan', render: (r) => <DocNumber value={r.return_dc_number} />, sub: (r) => ({ return: 'Return', repair: 'Repair' }[r.pickup_type] || r.reason || null) },
    { key: 'c', header: 'Customer', render: (r) => r.customer_name || (r.customer_id ? `#${r.customer_id}` : '—'), sub: (r) => r.city },
    { key: 'u', header: 'Laptops', numeric: true, render: (r) => r.unit_count || r.quantity || '—', sub: (r) => r.ttspl_id },
    { key: 's', header: 'Status', render: (r) => <StatusChip status={r.status === 'in_transit' ? 'dispatched' : r.status} label={({ pending: 'To collect', in_transit: 'On the way', shipped: 'On the way', reached: 'Reached', delivered: 'Received', cancelled: 'Cancelled' })[r.status]} />, sub: (r) => (r.warehouse_receive_pending && r.status !== 'cancelled' ? 'warehouse not received' : null) },
    { key: 't', header: 'Collected by', render: (r) => r.technician_name || r.dispatch_mode || '—', sub: (r) => (r.customer_otp_verified_at ? 'OTP verified' : null) },
    { key: 'd', header: 'Raised', render: (r) => <DateTime value={r.created_at} />, sub: (r) => r.original_dc_number },
  ];
  return (
    <DeskShell title="Return challans" breadcrumb="Movement" subtitle="Laptops coming back from customers — collected, received at the warehouse, and what was found.">
      <div className="c-stack">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
          <StatTile label="To collect" value={st.pending ?? 0} />
          <StatTile label="On the way" value={(st.in_transit ?? 0)} />
          <StatTile label="Awaiting warehouse" value={st.warehouse_pending ?? 0} />
          <StatTile label="Received" value={st.delivered ?? 0} />
        </div>
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Segmented label="Show" value={tab} onChange={(v) => { setTab(v); setPage(1); }} options={TABS.map(({ value, label }) => ({ value, label }))} />
          <Input type="search" placeholder="RDC, customer, TTSPL" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '18rem' }} />
        </div>
        {res === null ? <EmptyState title="Loading…" /> : (
          <DataTable columns={cols} rows={rows} rowKey={(r) => r.return_dc_number} onRowClick={(r) => navigate(`/carret/move/return-challans/${encodeURIComponent(r.return_dc_number)}`)} empty={<EmptyState title="No return challans here" />} />
        )}
        {pages > 1 && (
          <div className="flex items-center" style={{ gap: '8px' }}>
            <Button variant="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="text-ink-3">Page {page} of {pages}</span>
            <Button variant="quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </div>
    </DeskShell>
  );
}
