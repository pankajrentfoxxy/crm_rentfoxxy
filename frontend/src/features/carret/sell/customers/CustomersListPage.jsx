import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, EmptyState, Input, Money, Segmented, Select, StatTile,
} from '../../../../components/carret';
import { errMsg, fetchCustomers, TAG_LABEL } from './customersApi';

/**
 * Sell → Customers (claude/carret-customers-returns-control.md, step 1).
 * Every customer with their tag — Rental / Sales / Rental + Sales, which follows
 * what they order (migration 355) — and what they hold and owe: laptops on
 * rent, bought, returns, monthly rent, security held, outstanding.
 */
const LIMIT = 50;
const TAG_TONE = { rental: 'var(--lc-earning)', sales: 'var(--lc-moving)', both: 'var(--ink)' };

export function TagBadge({ type, source }) {
  if (!type) return null;
  return (
    <span className="c-chip font-ui" style={{ color: TAG_TONE[type], border: '1px solid currentColor', background: 'transparent' }} title={source === 'manual' ? 'Set by an admin' : 'Follows their orders'}>
      {TAG_LABEL[type] || type}{source === 'manual' ? ' ·' : ''}
    </span>
  );
}

export default function CustomersListPage() {
  const navigate = useNavigate();
  const [tag, setTag] = useState('');
  const [activity, setActivity] = useState('');
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);

  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 350); return () => clearTimeout(t); }, [q]);
  const load = useCallback(() => {
    setRes(null);
    fetchCustomers({ tag: tag || undefined, activity: activity || undefined, status, search: search || undefined, page, limit: LIMIT })
      .then(({ data }) => setRes(data))
      .catch((e) => { setRes({ data: [], total: 0, summary: {} }); toast.error(errMsg(e)); });
  }, [tag, activity, status, search, page]);
  useEffect(() => { load(); }, [load]);

  const cols = [
    { key: 'n', header: 'Customer', render: (r) => <strong>{r.display_name}</strong>, sub: (r) => [`#${r.customer_id}`, r.billing_city, r.gst_no].filter(Boolean).join(' · ') },
    { key: 't', header: 'Tag', render: (r) => <TagBadge type={r.customer_type} source={r.customer_type_source} /> },
    { key: 'r', header: 'On rent', numeric: true, render: (r) => r.rented_count || '—', sub: (r) => [r.demo_count ? `${r.demo_count} demo` : null, r.on_the_way_count ? `${r.on_the_way_count} on the way` : null].filter(Boolean).join(' · ') || null },
    { key: 'm', header: 'Rent / month', numeric: true, render: (r) => <Money value={r.monthly_rent} showZero={false} /> },
    { key: 's', header: 'Bought', numeric: true, render: (r) => r.sold_count || '—' },
    { key: 'x', header: 'Returns', numeric: true, render: (r) => r.return_count || '—' },
    { key: 'd', header: 'Security held', numeric: true, render: (r) => <Money value={r.security_held} showZero={false} /> },
    { key: 'o', header: 'Outstanding', numeric: true, render: (r) => <Money value={r.outstanding} showZero={false} /> },
    { key: 'c', header: 'Contact', render: (r) => r.phone || '—', sub: (r) => r.email },
  ];
  const s = res?.summary || {};
  const pages = res ? Math.max(1, Math.ceil((res.total || 0) / LIMIT)) : 1;

  return (
    <DeskShell title="Customers" breadcrumb="Sell" subtitle="Who they are, what they rent and bought, and what they owe.">
      <div className="c-stack">
        {res && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
            <StatTile label="Customers" value={res.total} />
            <StatTile label="Rental" value={s.rental ?? 0} />
            <StatTile label="Sales" value={s.sales ?? 0} />
            <StatTile label="Rental + Sales" value={s.both ?? 0} />
            <StatTile label="Laptops on rent" value={(s.laptops_on_rent ?? 0).toLocaleString('en-IN')} />
            <StatTile label="Rent / month" value={<Money value={s.monthly_rent} />} />
          </div>
        )}
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Segmented label="Tag" value={tag} onChange={(v) => { setTag(v); setPage(1); }} options={[{ value: '', label: 'All' }, { value: 'rental', label: 'Rental' }, { value: 'sales', label: 'Sales' }, { value: 'both', label: 'Rental + Sales' }]} />
          <Input type="search" placeholder="Name, company, phone, email, GST or #id" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '20rem' }} />
          <Select value={activity} onChange={(e) => { setActivity(e.target.value); setPage(1); }} placeholder="Any activity" options={[{ value: 'renting', label: 'Renting now' }, { value: 'bought', label: 'Bought laptops' }, { value: 'returned', label: 'Returned laptops' }, { value: 'owes', label: 'Money outstanding' }, { value: 'none', label: 'No laptops yet' }]} style={{ maxWidth: '12rem' }} />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' }]} style={{ maxWidth: '9rem' }} />
        </div>
        {res === null ? <EmptyState title="Loading…" /> : (
          <DataTable columns={cols} rows={res.data || []} rowKey={(r) => r.customer_id} onRowClick={(r) => navigate(`/carret/sell/customers/${r.customer_id}`)} empty={<EmptyState title="No customers match" />} />
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
