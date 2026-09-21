import React, { useState, useMemo, useCallback } from 'react';
import DeskShell from '../../shells/DeskShell';
import {
  DataTable, FilterBar, StatusChip, DocNumber, DateTime, Money, EmptyState, Button, EntityEdge,
} from '../../components/carret';
import { ENTITIES, ENTITY } from '../../config/entities';
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
const RESOURCES = {
  quotations: {
    title: 'Quotations',
    resource: 'quotations',
    statuses: ['pending', 'sent', 'accepted', 'approved', 'rejected'],
    columns: (nav) => [
      { key: 'quotation_number', header: 'Quotation', render: (r) => <DocNumber value={r.quotation_number} /> },
      { key: 'customer_name', header: 'Customer' },
      { key: 'quotation_type', header: 'Type' },
      { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
      { key: 'total', header: 'Value', numeric: true, render: (r) => <Money value={r.total || r.grand_total} showZero={false} /> },
      { key: 'created_at', header: 'Raised', render: (r) => <DateTime value={r.created_at} /> },
    ],
  },
  'sales-orders': {
    title: 'Sales Orders',
    resource: 'sales-orders',
    statuses: ['pending', 'confirmed', 'dispatched', 'delivered', 'cancelled'],
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
      { key: 'quotation_type', header: 'Type' },
      { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
      { key: 'created_at', header: 'Raised', render: (r) => <DateTime value={r.created_at} /> },
    ],
  },
  customers: {
    title: 'Customers',
    resource: 'customers',
    statuses: [],
    columns: () => [
      { key: 'customer_name', header: 'Customer' },
      { key: 'gst_number', header: 'GSTIN', render: (r) => (r.gst_number ? <DocNumber value={r.gst_number} /> : '—') },
      { key: 'customer_email', header: 'Email' },
      { key: 'customer_mobile', header: 'Phone' },
      { key: 'created_at', header: 'Onboarded', render: (r) => <DateTime value={r.created_at} /> },
    ],
  },
};

export default function SellListPage({ kind = 'sales-orders' }) {
  const config = RESOURCES[kind] || RESOURCES['sales-orders'];
  const [entity, setEntity] = useState('');
  const [filters, setFilters] = useState({});

  const { loading, error, rows, total } = useSellList(config.resource, {
    entity,
    status: filters.status || '',
    search: filters.search || '',
  });

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => { setFilters({}); setEntity(''); }, []);

  const filterDefs = useMemo(() => {
    const defs = [{ key: 'search', label: 'Search', type: 'search', placeholder: 'Number or customer' }];
    if (config.statuses.length) {
      defs.push({
        key: 'status',
        label: 'Status',
        options: config.statuses.map((s) => ({ value: s, label: s.replace(/_/g, ' ') })),
      });
    }
    return defs;
  }, [config.statuses]);

  const columns = useMemo(() => config.columns(), [config]);

  return (
    <DeskShell
      title={config.title}
      breadcrumb="Sell"
      actions={<span className="font-mono text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>{total} shown</span>}
    >
      <div style={{ display: 'grid', gap: 'var(--d-pad-x)' }}>
        {/* The books, side by side. Decision 1: a filter inside Sell, never two
            branches of the menu. */}
        <div className="flex flex-wrap items-center" style={{ gap: 'var(--d-gap)' }}>
          <span className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>Book</span>
          <Button variant={entity === '' ? 'primary' : 'secondary'} onClick={() => setEntity('')}>
            Both
          </Button>
          {Object.values(ENTITIES).map((e) => (
            <Button
              key={e.key}
              variant={entity === e.code ? 'primary' : 'secondary'}
              onClick={() => setEntity(e.code)}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block', width: '4px', height: '1em',
                  background: `var(${e.edgeVar})`, marginRight: 'var(--d-gap)',
                }}
              />
              {e.label}
            </Button>
          ))}
        </div>

        <FilterBar filters={filterDefs} values={filters} onChange={onFilter} onClear={onClear} />

        {loading && <EmptyState title="Loading…" />}
        {error && <EmptyState title={`Could not load ${config.title.toLowerCase()}`} body={error} />}
        {!loading && !error && (
          <EntityEdge entity={entity === ENTITIES[ENTITY.SALE].code ? ENTITY.SALE : ENTITY.RENTAL}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r, i) => r.quotation_number || r.sales_order_number || r.customer_id || i}
              empty={<EmptyState
                title={`No ${config.title.toLowerCase()} match`}
                body="Filters combine, so clearing one at a time will show what is excluding them."
                action={<Button variant="quiet" onClick={onClear}>Clear filters</Button>}
              />}
            />
          </EntityEdge>
        )}
      </div>
    </DeskShell>
  );
}
