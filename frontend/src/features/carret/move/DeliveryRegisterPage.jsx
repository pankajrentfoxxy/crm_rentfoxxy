import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, FilterBar, Panel, StatusChip, Tabs,
} from '../../../components/carret';
import { listDeliveryFlow } from '../../sales-pipeline/salesPipelineApi';

/**
 * Move → Delivery register: every challan that has left the gate, by how it
 * travels, until it is delivered or comes back. A row opens the challan, where
 * the OTP, proof of delivery, refusal and warehouse receipt are all actioned.
 *
 * Reads GET /delivery-flow — the same list the old register and technician
 * bucket use — so what is on the way is counted one way everywhere.
 */
const TABS = [
  { key: 'active', label: 'On the way' },
  { key: 'inhouse', label: 'By hand' },
  { key: 'courier', label: 'Courier' },
  { key: 'porter', label: 'Porter' },
  { key: 'awaiting_warehouse_return', label: 'Refused — coming back' },
  { key: 'warehouse_received', label: 'Refused — received' },
  { key: 'delivered', label: 'Delivered' },
];
const MODE = { inhouse: 'By hand', courier: 'Courier', porter: 'Porter' };

export default function DeliveryRegisterPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, rows: [], total: 0, pages: 1, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      listDeliveryFlow({ status: tab, search: search || undefined, page, limit: 25, movement: 'outbound' })
        .then(({ data }) => { if (!cancelled) setState({ loading: false, rows: data?.items || [], total: data?.pagination?.total ?? (data?.items || []).length, pages: data?.pagination?.totalPages || 1, error: null }); })
        .catch((e) => { if (!cancelled) setState({ loading: false, rows: [], total: 0, pages: 1, error: e?.response?.data?.message || 'Could not load the register.' }); });
    }, search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [tab, search, page]);

  const columns = useMemo(() => [
    { key: 'dc', header: 'Challan', render: (r) => <DocNumber value={r.dc_number} />, sub: (r) => r.sales_order_number },
    { key: 'c', header: 'Customer', render: (r) => r.customer_name, sub: (r) => r.customer_phone || null },
    {
      key: 'm', header: 'Travels by',
      render: (r) => MODE[r.dispatch_mode] || r.dispatch_mode || '—',
      sub: (r) => (r.dispatch_mode === 'courier' ? [r.courier_name, r.awb_number].filter(Boolean).join(' · ') : r.dispatch_mode === 'porter' ? r.porter_tracking_id : r.technician_name) || null,
    },
    { key: 'o', header: 'Left the gate', render: (r) => <DateTime value={r.dispatched_at} /> },
    {
      key: 'otp', header: 'OTP',
      render: (r) => (r.otp_verified_at ? <StatusChip status="approved" title="OTP verified" /> : r.otp_sent_at ? <StatusChip status="sent" title="OTP sent" /> : <span className="text-ink-3">—</span>),
    },
    { key: 's', header: 'Status', render: (r) => <StatusChip status={r.status} />, sub: (r) => r.refusal_stage_label || (r.delivered_at ? new Date(r.delivered_at).toLocaleString() : null) },
  ], []);

  return (
    <DeskShell title="Delivery register" breadcrumb="Move" subtitle="Everything that has left the gate, until it is delivered or back in stock.">
      <Panel
        toolbar={(
          <>
            <Tabs tabs={TABS} value={tab} onChange={(v) => { setTab(v); setPage(1); }} />
            <FilterBar
              filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: 'Challan, customer or AWB' }]}
              values={{ search }}
              onChange={(k, v) => { setSearch(v); setPage(1); }}
              onClear={() => setSearch('')}
              count={`${state.total} challans`}
            />
          </>
        )}
      >
        {state.loading && <EmptyState title="Loading…" />}
        {state.error && <EmptyState title="Could not load the register" body={state.error} />}
        {!state.loading && !state.error && (
          <DataTable
            columns={columns}
            rows={state.rows}
            rowKey={(r) => r.dc_number}
            onRowClick={(r) => navigate(`/carret/move/challans/${encodeURIComponent(r.dc_number)}`)}
            empty={<EmptyState title="Nothing here" />}
          />
        )}
        {state.pages > 1 && (
          <div className="c-toolbar" style={{ borderTop: '1px solid var(--rule)', borderBottom: 0 }}>
            <Button variant="quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="font-ui text-ink-3">Page {page} of {state.pages}</span>
            <Button variant="quiet" disabled={page >= state.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </Panel>
    </DeskShell>
  );
}
