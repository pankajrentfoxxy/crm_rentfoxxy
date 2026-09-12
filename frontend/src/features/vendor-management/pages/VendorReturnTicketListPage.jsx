import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, RotateCcw, Ticket } from 'lucide-react';
import { PageHeader, Button, ResponsiveTable, ListPagination } from '../../../components/ui/primitives';
import { fetchVendorReturnTickets } from '../vendorManagementApi';

const STATUS_CLASS = {
  requested: 'bg-slate-100 text-slate-700',
  notified: 'bg-blue-100 text-blue-800',
  partially_picked: 'bg-amber-100 text-amber-800',
  picked: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABEL = {
  requested: 'Return Requested',
  notified: 'Vendor Notified · Pending Pickup',
  partially_picked: 'Partially Picked Up',
  picked: 'Pickup Completed',
  completed: 'Return Completed',
  cancelled: 'Cancelled',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function VendorReturnTicketListPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchVendorReturnTickets({
        status: status || undefined,
        page,
        limit,
      });
      setRows(res.data?.data || []);
      setTotal(res.data?.pagination?.total || 0);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load return tickets');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { load(); }, [load]);

  const columns = [
    {
      key: 'ticket_number',
      header: 'Ticket',
      render: (r) => (
        <Link
          to={`/vendor-management/return-ticket/${encodeURIComponent(r.ticket_number)}`}
          className="font-medium text-blue-600 hover:underline"
        >
          {r.ticket_number}
        </Link>
      ),
    },
    { key: 'vendor_name', header: 'Vendor', render: (r) => r.vendor_name || '—' },
    { key: 'item_count', header: 'Laptops', render: (r) => r.item_count ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASS[r.status] || 'bg-slate-100'}`}>
          {STATUS_LABEL[r.status] || r.status}
        </span>
      ),
    },
    { key: 'request_date', header: 'Requested', render: (r) => fmtDate(r.request_date) },
    { key: 'vendor_notified_at', header: 'Notified', render: (r) => fmtDate(r.vendor_notified_at) },
  ];

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Vendor Return Ticket"
        subtitle="Stop rental first, then create a return DC when the vendor collects"
        actions={(
          <Link to="/vendor-management/return-ticket/new">
            <Button><Plus className="w-4 h-4" /> New ticket</Button>
          </Link>
        )}
      />

      <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Ticket className="w-5 h-5 text-slate-400" />
          <select
            className="border rounded-lg px-3 py-1.5 text-sm"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          >
            <option value="">All statuses</option>
            <option value="requested">Return Requested</option>
            <option value="notified">Vendor Notified</option>
            <option value="partially_picked">Partially Picked Up</option>
            <option value="picked">Pickup Completed</option>
            <option value="completed">Return Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button type="button" onClick={load} className="text-sm text-blue-600 inline-flex items-center gap-1 ml-auto">
            <RotateCcw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        <ResponsiveTable columns={columns} rows={rows} loading={loading} emptyMessage="No vendor return tickets yet" />
        <ListPagination page={page} pageSize={limit} total={total} onPageChange={setPage} />
      </div>
    </div>
  );
}
