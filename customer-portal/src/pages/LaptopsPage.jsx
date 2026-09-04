import React from 'react';
import { Link } from 'react-router-dom';
import DataTable from '../components/DataTable';
import FilterBar from '../components/FilterBar';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import useListQuery from '../hooks/useListQuery';
import { useAuth } from '../context/AuthContext';
import { fmtDate, inr } from '../utils/format';

const LIFECYCLE_TABS = [
  { value: 'active', label: 'Currently with me' },
  { value: 'delivered', label: 'Delivered to date' },
  { value: 'returned', label: 'Returned' },
];

export default function LaptopsPage() {
  const { readOnly } = useAuth();
  const { rows, pagination, loading, error, filters, setFilters, setPage } = useListQuery('/laptops', {
    defaults: { lifecycle: 'active' },
    resultKey: 'laptops',
  });

  const isReturned = filters.lifecycle === 'returned';
  const isDelivered = filters.lifecycle === 'delivered';

  const columns = [
    {
      key: 'ttspl_id',
      label: 'TTSPL ID',
      mobilePrimary: true,
      className: 'font-mono text-xs whitespace-nowrap',
      render: (r) => r.ttspl_id || '—',
    },
    {
      key: 'serial_number',
      label: 'Serial Number',
      className: 'font-mono text-xs',
      render: (r) => r.serial_number || '—',
    },
    {
      key: 'laptop',
      label: 'Laptop',
      render: (r) => [r.brand, r.model].filter(Boolean).join(' ') || '—',
    },
    {
      key: 'config',
      label: 'Configuration',
      render: (r) => <span className="text-slate-600">{r.config || '—'}</span>,
    },
    {
      key: 'dc_number',
      label: 'DC Number',
      render: (r) => (r.dc_number ? (
        <Link
          to={`/deliveries/${encodeURIComponent(r.dc_number)}`}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs text-brand hover:underline"
        >
          {r.dc_number}
        </Link>
      ) : <span className="text-slate-400">—</span>),
    },
    {
      key: 'date',
      label: isReturned ? 'Returned On' : 'Delivered On',
      render: (r) => fmtDate(isReturned ? r.returned_at : (r.delivered_at || r.dispatch_date)),
    },
    {
      key: 'monthly_rate',
      label: 'Monthly Rate',
      render: (r) => (r.monthly_rate ? inr(r.monthly_rate) : '—'),
    },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      label: 'Actions',
      mobileHidden: true,
      render: (r) => (isReturned || readOnly ? <span className="text-slate-400 text-xs">—</span> : (
        <div className="flex gap-1.5 whitespace-nowrap">
          <Link
            to={`/support/new?ttspl=${encodeURIComponent(r.ttspl_id || '')}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs px-2.5 py-1 border rounded-lg hover:bg-slate-50"
          >
            Raise Ticket
          </Link>
          <Link
            to={`/support/new?ttspl=${encodeURIComponent(r.ttspl_id || '')}&type=${encodeURIComponent('Return Request')}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs px-2.5 py-1 border rounded-lg hover:bg-slate-50"
          >
            Return
          </Link>
        </div>
      )),
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">My Laptops</h1>
        <p className="text-sm text-slate-500 mt-1">
          {isDelivered
            ? 'Every laptop delivered on a challan — matches the dashboard Delivered Laptops count'
            : 'Laptops deployed on your account'}
        </p>
      </div>

      <div className="flex gap-2">
        {LIFECYCLE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setFilters({ ...filters, lifecycle: tab.value, page: 1 })}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              filters.lifecycle === tab.value ? 'bg-brand text-white' : 'bg-white border'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <FilterBar
        value={filters}
        onChange={setFilters}
        searchPlaceholder="Search by TTSPL, serial, brand, model or DC…"
      />

      {error && (
        <p className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</p>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(r) => r.ttspl_id || r.serial_number || r.dc_number}
        emptyMessage={isReturned ? 'No returned laptops yet' : 'No laptops are currently assigned to you'}
      />

      <Pagination pagination={pagination} onChange={setPage} />
    </div>
  );
}
