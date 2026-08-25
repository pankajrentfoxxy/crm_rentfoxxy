import React from 'react';
import { Link } from 'react-router-dom';
import DataTable from '../components/DataTable';
import FilterBar from '../components/FilterBar';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import useListQuery from '../hooks/useListQuery';
import { fmtDate } from '../utils/format';

const FILTER_FIELDS = [
  {
    key: 'status',
    label: 'Delivery Status',
    options: [
      { value: '', label: 'All statuses' },
      { value: 'pending', label: 'Pending' },
      { value: 'in_transit', label: 'In Transit' },
      { value: 'delivered', label: 'Delivered' },
      { value: 'rejected', label: 'Refused' },
    ],
  },
];

export default function DeliveriesPage() {
  const { rows, pagination, loading, error, filters, setFilters, setPage } = useListQuery('/deliveries', {
    resultKey: 'deliveries',
  });

  const columns = [
    {
      key: 'dc_number',
      label: 'DC Number',
      mobilePrimary: true,
      className: 'font-mono text-xs whitespace-nowrap',
    },
    {
      key: 'sales_order_number',
      label: 'SO Number',
      render: (r) => (r.sales_order_number ? (
        <Link
          to={`/orders/${encodeURIComponent(r.sales_order_number)}`}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs text-brand hover:underline"
        >
          {r.sales_order_number}
        </Link>
      ) : <span className="text-slate-400">—</span>),
    },
    { key: 'created_at', label: 'Raised On', render: (r) => fmtDate(r.created_at) },
    {
      key: 'dispatch_mode',
      label: 'Mode',
      render: (r) => <span className="capitalize">{r.dispatch_mode || '—'}</span>,
    },
    {
      key: 'tracking',
      label: 'Tracking',
      render: (r) => (
        <div className="text-xs">
          <p className="text-slate-700">{r.courier_name || '—'}</p>
          {r.awb_number && <p className="font-mono text-slate-500">{r.awb_number}</p>}
        </div>
      ),
    },
    { key: 'dispatched_at', label: 'Dispatched', render: (r) => fmtDate(r.dispatched_at) },
    { key: 'delivered_at', label: 'Delivered', render: (r) => fmtDate(r.delivered_at) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      label: 'Actions',
      mobileHidden: true,
      render: (r) => (
        <Link
          to={`/deliveries/${encodeURIComponent(r.dc_number)}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs px-2.5 py-1 border rounded-lg hover:bg-slate-50 whitespace-nowrap"
        >
          Track
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Deliveries</h1>
        <p className="text-sm text-slate-500 mt-1">Track every challan raised against your orders</p>
      </div>

      <FilterBar
        value={filters}
        onChange={setFilters}
        fields={FILTER_FIELDS}
        searchPlaceholder="Search by DC number, SO number or AWB…"
      />

      {error && (
        <p className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</p>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(r) => r.dc_number}
        rowLink={(r) => `/deliveries/${encodeURIComponent(r.dc_number)}`}
        emptyMessage="No deliveries match these filters"
      />

      <Pagination pagination={pagination} onChange={setPage} />
    </div>
  );
}
