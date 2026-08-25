import React from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import DataTable from '../components/DataTable';
import FilterBar from '../components/FilterBar';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import useListQuery from '../hooks/useListQuery';
import { useAuth } from '../context/AuthContext';
import { fmtDate, fmtDateTime } from '../utils/format';

const FILTER_FIELDS = [
  {
    key: 'ticket_type',
    label: 'Ticket Type',
    options: [
      { value: '', label: 'All types' },
      { value: 'complaint', label: 'Complaint' },
      { value: 'pickup', label: 'Pickup / Return' },
      { value: 'replacement', label: 'Replacement' },
    ],
  },
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: '', label: 'All statuses' },
      { value: 'open', label: 'Open' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'closed', label: 'Closed' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
  {
    key: 'stage',
    label: 'Stage',
    options: [
      { value: '', label: 'All stages' },
      { value: 'received', label: 'Received' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'picked_up', label: 'Device Picked Up' },
      { value: 'at_service_centre', label: 'At Service Centre' },
      { value: 'replacement_in_progress', label: 'Replacement In Progress' },
      { value: 'out_for_delivery', label: 'Out for Delivery' },
      { value: 'resolved', label: 'Resolved' },
      { value: 'closed', label: 'Closed' },
    ],
  },
];

const EXTRA_SEARCH = [
  { key: 'ttspl', label: 'TTSPL', placeholder: 'TTSPL id' },
  { key: 'serial', label: 'Serial Number', placeholder: 'Serial no.' },
];

export default function SupportTicketsPage() {
  const { readOnly } = useAuth();
  const { rows, pagination, loading, error, filters, setFilters, setPage } = useListQuery('/tickets', {
    resultKey: 'tickets',
  });

  const columns = [
    {
      key: 'ticket_number',
      label: 'Ticket #',
      mobilePrimary: true,
      className: 'font-mono text-xs whitespace-nowrap',
    },
    { key: 'ticket_type', label: 'Type', render: (r) => <span className="capitalize">{r.ticket_type}</span> },
    { key: 'ttspl_id', label: 'TTSPL', className: 'font-mono text-xs', render: (r) => r.ttspl_id || '—' },
    {
      key: 'serial_number',
      label: 'Serial Number',
      className: 'font-mono text-xs',
      render: (r) => r.serial_number || '—',
    },
    {
      key: 'subject',
      label: 'Issue / Subject',
      render: (r) => <span className="block max-w-[260px] truncate" title={r.subject}>{r.subject}</span>,
    },
    { key: 'created_at', label: 'Created', render: (r) => fmtDate(r.created_at) },
    {
      key: 'stage',
      label: 'Current Stage',
      render: (r) => <StatusBadge status={r.stage} label={r.stage_label} />,
    },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'last_updated',
      label: 'Last Updated',
      mobileHidden: true,
      render: (r) => <span className="text-xs">{fmtDateTime(r.last_updated)}</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      mobileHidden: true,
      render: (r) => (
        <Link
          to={`/support/tickets/${r.ticket_id}`}
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Support Tickets</h1>
          <p className="text-sm text-slate-500 mt-1">Track every request raised on your account</p>
        </div>
        {!readOnly && (
          <Link
            to="/support/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand text-white rounded-lg text-sm font-semibold"
          >
            <Plus className="w-4 h-4" />
            Create Support Ticket
          </Link>
        )}
      </div>

      <FilterBar
        value={filters}
        onChange={setFilters}
        fields={FILTER_FIELDS}
        extraSearchFields={EXTRA_SEARCH}
        searchPlaceholder="Search by ticket number or subject…"
      />

      {error && (
        <p className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</p>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(r) => r.ticket_id}
        rowLink={(r) => `/support/tickets/${r.ticket_id}`}
        emptyMessage="No tickets match these filters"
      />

      <Pagination pagination={pagination} onChange={setPage} />
    </div>
  );
}
