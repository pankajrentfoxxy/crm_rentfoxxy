import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, Input, Panel, StatusChip, Tabs,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { fetchVendors } from '../../vendor-management/vendorManagementApi';
import { VENDOR_STATUSES, errMsg, vendorName } from './procureShared';

/**
 * Procure → Vendors.
 *
 * Status is a tab, not a filter hidden in a dropdown: a pending vendor cannot
 * take a PO, so "who is waiting for approval" is the first question. Vendors
 * whose bank details are the imported placeholder are flagged in the list —
 * accounts cannot pay them until someone fixes it.
 */
const PAGE = 50;

export default function VendorsListPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canCreate = hasPermission('vendor_management', 'create');

  const [status, setStatus] = useState('approved');
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
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchVendors({ status: status === 'all' ? undefined : status, search: q || undefined, page, limit: PAGE })
      .then(({ data }) => {
        if (off) return;
        setState({
          loading: false, error: null, rows: data.data || [], counts: data.counts || {},
          total: data.pagination?.total || 0, pages: data.pagination?.totalPages || 1,
        });
      })
      .catch((e) => !off && setState((s) => ({ ...s, loading: false, error: errMsg(e, 'Could not load vendors.') })));
    return () => { off = true; };
  }, [status, q, page]);

  const all = Object.values(state.counts).reduce((n, c) => n + c, 0);
  const tabs = [
    ...VENDOR_STATUSES.map((s) => ({ key: s.key, label: s.label, count: state.counts[s.key] ?? 0 })),
    { key: 'all', label: 'All', count: all },
  ];

  const columns = [
    {
      key: 'name',
      header: 'Vendor',
      render: (r) => vendorName(r),
      sub: (r) => [r.contact_person_name, r.city].filter(Boolean).join(' · ') || null,
    },
    { key: 'gst', header: 'GSTIN', render: (r) => (r.gst_number ? <DocNumber value={r.gst_number} /> : <span className="text-ink-3">none</span>) },
    { key: 'phone', header: 'Phone', render: (r) => r.phone || r.number || '—', sub: (r) => r.email || null },
    {
      key: 'bank',
      header: 'Bank',
      render: (r) => (r.bank_details_ok
        ? <span style={{ color: 'var(--alert-good)' }}>✓ OK</span>
        : <span style={{ color: 'var(--alert-warn)' }} title="IFSC or account number is missing or a placeholder">⚠ Needs fixing</span>),
    },
    {
      key: 'portal',
      header: 'Portal',
      render: (r) => (r.vendor_portal_enabled === false ? <span className="text-ink-3">Off</span> : (r.vendor_portal_last_login ? <>Used <DateTime value={r.vendor_portal_last_login} /></> : 'Never signed in')),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status || 'approved'} /> },
  ];

  return (
    <DeskShell
      title="Vendors"
      breadcrumb="Procure"
      subtitle="Who we buy and rent laptops and parts from."
      actions={canCreate && <Button variant="primary" onClick={() => navigate('/carret/procure/vendors/new')}>Add vendor</Button>}
    >
      <div className="c-stack">
        <Tabs tabs={tabs} value={status} onChange={(k) => { setStatus(k); setPage(1); }} />
        <Panel
          toolbar={(
            <div className="flex items-center flex-wrap" style={{ gap: '12px', width: '100%' }}>
              <Input
                type="search"
                placeholder="Name, email, phone or GSTIN"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ maxWidth: '22rem' }}
                aria-label="Search vendors"
              />
              <span className="text-ink-3" style={{ marginLeft: 'auto' }}>{state.total} vendors</span>
            </div>
          )}
        >
          {state.error && <EmptyState title="Could not load vendors" body={state.error} />}
          {!state.error && (
            <DataTable
              columns={columns}
              rows={state.rows}
              rowKey={(r) => r.vendor_id}
              onRowClick={(r) => navigate(`/carret/procure/vendors/${r.vendor_id}`)}
              empty={<EmptyState title={state.loading ? 'Loading…' : 'No vendors match'} body={q ? 'Try a shorter search, or another tab.' : undefined} />}
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
    </DeskShell>
  );
}
