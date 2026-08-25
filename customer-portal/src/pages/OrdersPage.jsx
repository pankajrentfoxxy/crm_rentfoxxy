import React from 'react';
import { Link } from 'react-router-dom';
import DataTable from '../components/DataTable';
import FilterBar from '../components/FilterBar';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import useListQuery from '../hooks/useListQuery';
import { fmtDate, inr } from '../utils/format';

const FILTER_FIELDS = [
  {
    key: 'order_type',
    label: 'Order Type',
    options: [
      { value: '', label: 'All types' },
      { value: 'standard', label: 'Sale / Rental / Demo' },
      { value: 'replacement', label: 'Replacement' },
    ],
  },
  {
    key: 'entity_scope',
    label: 'Category',
    options: [
      { value: '', label: 'All' },
      { value: 'rental', label: 'Rental & Demo' },
      { value: 'sale', label: 'Sale' },
    ],
  },
  {
    key: 'order_status',
    label: 'Order Status',
    options: [
      { value: '', label: 'All statuses' },
      { value: 'active', label: 'Active' },
      { value: 'pending', label: 'Pending' },
      { value: 'dispatched', label: 'Dispatched' },
      { value: 'delivered', label: 'Delivered' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
  {
    key: 'delivery_status',
    label: 'Delivery Status',
    options: [
      { value: '', label: 'All' },
      { value: 'not_dispatched', label: 'Not Dispatched' },
      { value: 'in_transit', label: 'In Transit / Partial' },
      { value: 'delivered', label: 'Delivered' },
    ],
  },
];

function ConfigCell({ items }) {
  if (!items?.length) return <span className="text-slate-400">—</span>;
  const [first, ...rest] = items;
  return (
    <div className="min-w-[180px]">
      <p className="font-medium text-slate-800">{first.label}</p>
      {first.config && <p className="text-xs text-slate-500">{first.config}</p>}
      {rest.length > 0 && (
        <p className="text-xs text-slate-400 mt-0.5">+{rest.length} more configuration{rest.length > 1 ? 's' : ''}</p>
      )}
    </div>
  );
}

export default function OrdersPage() {
  const { rows, pagination, loading, error, filters, setFilters, setPage } = useListQuery('/orders', {
    resultKey: 'orders',
  });

  const columns = [
    {
      key: 'sales_order_number',
      label: 'SO Number',
      mobilePrimary: true,
      className: 'font-mono text-xs whitespace-nowrap',
    },
    { key: 'order_type', label: 'Order Type', render: (r) => r.order_type },
    { key: 'order_date', label: 'Order Date', render: (r) => fmtDate(r.order_date) },
    {
      key: 'items',
      label: 'Laptop / Configuration',
      render: (r) => <ConfigCell items={r.items} />,
    },
    { key: 'quantity', label: 'Qty', render: (r) => r.quantity || 0 },
    {
      key: 'dc_numbers',
      label: 'DC Number',
      render: (r) => (r.dc_numbers?.length ? (
        <div className="space-y-0.5">
          {r.dc_numbers.map((dc) => (
            <Link
              key={dc}
              to={`/deliveries/${encodeURIComponent(dc)}`}
              onClick={(e) => e.stopPropagation()}
              className="block font-mono text-xs text-brand hover:underline"
            >
              {dc}
            </Link>
          ))}
        </div>
      ) : <span className="text-slate-400">—</span>),
    },
    {
      key: 'delivery_status',
      label: 'Delivery Status',
      render: (r) => <StatusBadge status={r.delivery_status} />,
    },
    {
      key: 'order_status',
      label: 'Order Status',
      render: (r) => <StatusBadge status={r.order_status} />,
    },
    {
      key: 'payment_status',
      label: 'Payment',
      render: (r) => (
        <div>
          <StatusBadge status={r.payment_status} />
          <p className="text-xs text-slate-500 mt-1">{inr(r.total_value)}</p>
        </div>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      mobileHidden: true,
      render: (r) => (
        <Link
          to={`/orders/${encodeURIComponent(r.sales_order_number)}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs px-2.5 py-1 border rounded-lg hover:bg-slate-50 whitespace-nowrap"
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Orders</h1>
        <p className="text-sm text-slate-500 mt-1">Every order placed on your account</p>
      </div>

      <FilterBar
        value={filters}
        onChange={setFilters}
        fields={FILTER_FIELDS}
        searchPlaceholder="Search by SO number…"
      />

      {error && (
        <p className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</p>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(r) => r.sales_order_number}
        rowLink={(r) => `/orders/${encodeURIComponent(r.sales_order_number)}`}
        emptyMessage="No orders match these filters"
      />

      <Pagination pagination={pagination} onChange={setPage} />
    </div>
  );
}
