import React, { useMemo, useState, useCallback } from 'react';
import DeskShell from '../../shells/DeskShell';
import {
  DataTable, FilterBar, StatusChip, DocNumber, DateTime, Money, EmptyState, Button,
} from '../../components/carret';
import { useProcureList } from './useProduce';

/**
 * Procure — Purchase Orders, Vendors, Vendor Returns, Vendor Repair, Spare
 * Parts Orders (Part 5.7).
 *
 * ONE component for all five, for the same reason Sell is one component: they
 * are the same shape, and a list per screen is how this codebase ended up with
 * two of everything.
 *
 * Purchase Orders carries a Received column that reads the real figure rather
 * than the ordered quantity, because "how much of this PO actually arrived" is
 * the question the screen exists to answer and the old list made you open the
 * PO to find out.
 */

const RESOURCES = {
  'purchase-orders': {
    title: 'Purchase Orders',
    path: '/vendor-management/purchase-orders',
    statuses: ['draft', 'pending', 'approved', 'partial', 'completed', 'cancelled'],
    columns: () => [
      { key: 'purchase_order_number', header: 'PO', render: (r) => <DocNumber value={r.purchase_order_number} /> },
      { key: 'vendor_name', header: 'Vendor', render: (r) => r.vendor_name || r.business_name || '—' },
      { key: 'purchase_order_type', header: 'Type', render: (r) => r.purchase_order_type || '—' },
      {
        key: 'received',
        header: 'Received',
        numeric: true,
        render: (r) => {
          const got = Number(r.received_qty ?? r.receivedQty ?? 0);
          const want = Number(r.total_qty ?? r.ordered_qty ?? 0);
          if (!want) return <span className="text-ink-3">—</span>;
          return (
            <span
              className="font-mono tabular-nums"
              style={{ color: got >= want ? 'var(--alert-good)' : got ? 'var(--alert-warn)' : 'var(--ink-3)' }}
            >
              {got} / {want}
            </span>
          );
        },
      },
      { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
      { key: 'total_amount', header: 'Value', numeric: true, render: (r) => <Money value={r.total_amount || r.grand_total} showZero={false} /> },
      { key: 'purchase_order_date', header: 'Raised', render: (r) => <DateTime value={r.purchase_order_date || r.created_at} /> },
    ],
  },
  vendors: {
    title: 'Vendors',
    path: '/vendor-management/vendors',
    statuses: [],
    columns: () => [
      {
        key: 'vendor_name',
        header: 'Vendor',
        render: (r) => r.business_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || `#${r.vendor_id}`,
      },
      { key: 'gst_number', header: 'GSTIN', render: (r) => (r.gst_number ? <DocNumber value={r.gst_number} /> : '—') },
      { key: 'email', header: 'Email', render: (r) => r.email || '—' },
      { key: 'mobile', header: 'Phone', render: (r) => r.mobile || r.phone || '—' },
      { key: 'city', header: 'City', render: (r) => r.city || '—' },
      { key: 'created_at', header: 'Onboarded', render: (r) => <DateTime value={r.created_at} /> },
    ],
  },
  'spare-parts-orders': {
    title: 'Spare Parts Orders',
    path: '/vendor-management/spare-parts-orders',
    statuses: ['draft', 'pending', 'approved', 'partial', 'completed', 'cancelled'],
    columns: () => [
      { key: 'purchase_order_number', header: 'SPO', render: (r) => <DocNumber value={r.purchase_order_number} /> },
      { key: 'vendor_name', header: 'Vendor', render: (r) => r.vendor_name || '—' },
      { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
      { key: 'total_amount', header: 'Value', numeric: true, render: (r) => <Money value={r.total_amount} showZero={false} /> },
      { key: 'purchase_order_date', header: 'Raised', render: (r) => <DateTime value={r.purchase_order_date || r.created_at} /> },
    ],
  },
  'replaced-products': {
    title: 'Vendor Returns & Replacements',
    path: '/vendor-management/replaced-products',
    statuses: [],
    columns: () => [
      { key: 'ttspl_id', header: 'Asset', render: (r) => <DocNumber value={r.ttspl_id || r.inventory_asset_code} /> },
      { key: 'serial_number', header: 'Serial', render: (r) => r.serial_number || '—' },
      { key: 'vendor_name', header: 'Vendor', render: (r) => r.vendor_name || '—' },
      { key: 'reason', header: 'Reason', render: (r) => r.reason || r.remarks || '—' },
      { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
      { key: 'created_at', header: 'Raised', render: (r) => <DateTime value={r.created_at} /> },
    ],
  },
  'vendor-repair-dcs': {
    title: 'Vendor Repair',
    path: '/vendor-repair/dc',
    statuses: ['draft', 'sent', 'partial', 'received', 'closed'],
    columns: () => [
      { key: 'dc_number', header: 'Repair DC', render: (r) => <DocNumber value={r.dc_number} /> },
      { key: 'vendor_name', header: 'Vendor', render: (r) => r.vendor_name || '—' },
      {
        key: 'units',
        header: 'Units',
        numeric: true,
        render: (r) => {
          const back = Number(r.received_count ?? 0);
          const sent = Number(r.item_count ?? r.total_items ?? 0);
          if (!sent) return <span className="text-ink-3">—</span>;
          return (
            <span
              className="font-mono tabular-nums"
              style={{ color: back >= sent ? 'var(--alert-good)' : 'var(--alert-warn)' }}
            >
              {back} / {sent} back
            </span>
          );
        },
      },
      { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
      { key: 'created_at', header: 'Sent', render: (r) => <DateTime value={r.created_at} /> },
    ],
  },
};

export default function ProcureListPage({ kind = 'purchase-orders' }) {
  const config = RESOURCES[kind] || RESOURCES['purchase-orders'];
  const [filters, setFilters] = useState({});

  const { loading, error, rows, total } = useProcureList(config.path, {
    status: filters.status || undefined,
    search: filters.search || undefined,
    limit: 100,
  });

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => setFilters({}), []);

  const filterDefs = useMemo(() => {
    const defs = [{ key: 'search', label: 'Search', type: 'search', placeholder: 'Number or vendor' }];
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
      breadcrumb="Procure"
      actions={<span className="font-mono text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>{total} shown</span>}
    >
      <div style={{ display: 'grid', gap: 'var(--d-pad-x)' }}>
        <FilterBar filters={filterDefs} values={filters} onChange={onFilter} onClear={onClear} />

        {loading && <EmptyState title="Loading…" />}
        {error && <EmptyState title={`Could not load ${config.title.toLowerCase()}`} body={error} />}
        {!loading && !error && (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r, i) => r.po_id || r.spo_id || r.vendor_id || r.dc_number || r.id || i}
            empty={(
              <EmptyState
                title={`No ${config.title.toLowerCase()} match`}
                body="Filters combine, so clearing one at a time will show what is excluding them."
                action={<Button variant="quiet" onClick={onClear}>Clear filters</Button>}
              />
            )}
          />
        )}
      </div>
    </DeskShell>
  );
}
