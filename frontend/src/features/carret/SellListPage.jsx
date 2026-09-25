import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import DeskShell from '../../shells/DeskShell';
import {
  DataTable, FilterBar, Panel, StatusChip, DocNumber, DateTime, Money, EmptyState, Button, Segmented, Tabs,
} from '../../components/carret';
import { usePermission } from '../../hooks/usePermission';
import { SO_SECTIONS } from './sell/sellShared';
import { ENTITIES } from '../../config/entities';
import { useSellList } from './useSell';

/**
 * Sell — Quotations, Sales Orders and Customers (Part 4.5).
 *
 * ONE component for the three lists, because they are the same shape and
 * splitting them is how this codebase ended up with two of everything.
 *
 * THE ENTITY SPLIT IS A FILTER, NOT A BRANCH (Decision 1). RentFoxxy and
 * Gorefurbo sit side by side in one list with a toggle above it. Two menu
 * branches would mean a laptop crossing books crosses sections, and someone
 * asking "what did we ship this month" would have to open two screens and add
 * them up.
 *
 * The sale book's label comes from config/entities.js — the brand name is not
 * settled, and renaming it must cost one string rather than a repaint.
 */
const typeLabel = (t) => ({ sale: 'Sale', sales: 'Sale', rental: 'Rental', demo: 'Demo' }[String(t || '').toLowerCase()] || t || '—');

const RESOURCES = {
  quotations: {
    title: 'Quotations',
    subtitle: 'Quotations across both books, from raised to accepted.',
    resource: 'quotations',
    tabs: [
      { key: '', label: 'All' }, { key: 'pending', label: 'Draft' }, { key: 'sent', label: 'Sent' },
      { key: 'approved', label: 'Approved' }, { key: 'accepted', label: 'Accepted' }, { key: 'rejected', label: 'Rejected' },
    ],
    create: { label: 'New quotation', to: '/carret/sell/quotations/new', section: ['sales_quotations'] },
    open: (r) => `/carret/sell/quotations/${encodeURIComponent(r.quotation_number)}`,
    columns: () => [
      { key: 'quotation_number', header: 'Quotation', render: (r) => <DocNumber value={r.quotation_number} /> },
      { key: 'customer_name', header: 'Customer', render: (r) => r.company_name || r.customer_name, sub: (r) => r.contact_name || null },
      { key: 'quotation_type', header: 'Type', render: (r) => typeLabel(r.quotation_type) },
      { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status === 'pending' ? 'draft' : r.status} /> },
      { key: 'total', header: 'Value', numeric: true, render: (r) => <Money value={r.total_value} showZero={false} /> },
      { key: 'created_at', header: 'Raised', render: (r) => <DateTime value={r.created_at} /> },
    ],
  },
  'sales-orders': {
    title: 'Sales Orders',
    subtitle: 'Confirmed orders, and the quotation each one came from.',
    resource: 'sales-orders',
    tabs: [
      { key: '', label: 'All' }, { key: 'pending', label: 'Open' }, { key: 'dispatched', label: 'Dispatched' },
      { key: 'delivered', label: 'Delivered' }, { key: 'cancelled', label: 'Cancelled' },
    ],
    create: { label: 'New sales order', to: '/carret/sell/sales-orders/new', section: SO_SECTIONS },
    open: (r) => `/carret/sell/sales-orders/${encodeURIComponent(r.sales_order_number)}`,
    columns: () => [
      { key: 'sales_order_number', header: 'Order', render: (r) => <DocNumber value={r.sales_order_number} /> },
      { key: 'customer_name', header: 'Customer' },
      {
        key: 'quotation_number',
        header: 'Quotation',
        // Part 4.3 made this meaningful: a supplied quotation must exist and be
        // accepted. 'N/A' is the honest display for an order raised without one,
        // which is 4,827 of 4,828 existing orders.
        render: (r) => (r.quotation_number && r.quotation_number !== 'N/A'
          ? <DocNumber value={r.quotation_number} />
          : <span className="text-ink-3 font-ui">no quotation</span>),
      },
      { key: 'quotation_type', header: 'Type', render: (r) => (r.is_replacement_order ? 'Replacement' : typeLabel(r.quotation_type)) },
      {
        key: 'progress',
        header: 'Laptops',
        render: (r) => `${r.delivered_count || 0} delivered · ${r.attached_count || 0} attached of ${r.laptop_qty || 0}`,
      },
      { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status === 'pending' ? 'confirmed' : r.status} /> },
      { key: 'total', header: 'Value', numeric: true, render: (r) => <Money value={r.total_value} showZero={false} /> },
      { key: 'created_at', header: 'Raised', render: (r) => <DateTime value={r.created_at} /> },
    ],
  },
  customers: {
    title: 'Customers',
    subtitle: 'B2B accounts with GST registration and contact details.',
    resource: 'customers',
    tabs: [],
    columns: () => [
      { key: 'customer_name', header: 'Customer', sub: (r) => (r.customer_id ? `#${r.customer_id}` : null) },
      { key: 'gst_number', header: 'GSTIN', render: (r) => (r.gst_number ? <DocNumber value={r.gst_number} /> : '—') },
      { key: 'email', header: 'Email' },
      { key: 'phone', header: 'Phone' },
      { key: 'created_at', header: 'Onboarded', render: (r) => <DateTime value={r.created_at} /> },
    ],
  },
};

export default function SellListPage({ kind = 'sales-orders' }) {
  const config = RESOURCES[kind] || RESOURCES['sales-orders'];
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [entity, setEntity] = useState('');
  const [filters, setFilters] = useState({});
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const { loading, error, rows, total, pages } = useSellList(config.resource, {
    entity,
    status,
    search: filters.search || '',
    page,
  });

  const onFilter = useCallback((k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); }, []);
  const onClear = useCallback(() => { setFilters({}); setEntity(''); setStatus(''); setPage(1); }, []);
  const canCreate = config.create && config.create.section.some((s) => hasPermission(s, 'create'));

  const filterDefs = useMemo(
    () => [{ key: 'search', label: 'Search', type: 'search', placeholder: 'Number or customer' }],
    []
  );

  const columns = useMemo(() => config.columns(), [config]);

  return (
    <DeskShell
      title={config.title}
      breadcrumb="Sell"
      subtitle={config.subtitle}
      actions={canCreate && (
        <Button variant="primary" onClick={() => navigate(config.create.to)}>
          <Plus size={16} aria-hidden="true" /> {config.create.label}
        </Button>
      )}
    >
      <div style={{ display: 'grid', gap: '16px' }}>
        {/* The books, side by side. Decision 1: a filter inside Sell, never two
            branches of the menu. */}
        <div className="flex flex-wrap items-center" style={{ gap: '10px' }}>
          <span className="font-ui text-ink-3" style={{ fontSize: '13.5px', fontWeight: 500 }}>Book</span>
          <Segmented
            label="Book"
            value={entity}
            onChange={(v) => { setEntity(v); setPage(1); }}
            options={[
              { value: '', label: 'Both' },
              ...Object.values(ENTITIES).map((e) => ({
                value: e.code,
                label: e.label,
                icon: (
                  <span
                    aria-hidden="true"
                    style={{ display: 'inline-block', width: '4px', height: '14px', borderRadius: '2px', background: `var(${e.edgeVar})` }}
                  />
                ),
              })),
            ]}
          />
        </div>

        <Panel
          entity={Object.values(ENTITIES).find((e) => e.code === entity)?.key}
          toolbar={(
            <>
            {config.tabs.length > 0 && (
              <Tabs tabs={config.tabs} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
            )}
            <FilterBar
              filters={filterDefs}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={`${total} ${config.title.toLowerCase()}`}
            />
            </>
          )}
        >
          {loading && <EmptyState title="Loading…" />}
          {error && <EmptyState title={`Could not load ${config.title.toLowerCase()}`} body={error} />}
          {!loading && !error && (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r, i) => r.quotation_number || r.sales_order_number || r.customer_id || i}
              onRowClick={config.open ? (r) => navigate(config.open(r)) : undefined}
              empty={<EmptyState
                title={`No ${config.title.toLowerCase()} match`}
                body="Filters combine, so clearing one at a time will show what is excluding them."
                action={<Button variant="quiet" onClick={onClear}>Clear filters</Button>}
              />}
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
      </div>
    </DeskShell>
  );
}
