import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, RotateCcw, Truck } from 'lucide-react';
import { PageHeader, Button, ResponsiveTable, ListPagination } from '../../../components/ui/primitives';
import { fetchReturnToVendorDcs } from '../vendorManagementApi';

const STATUS_CLASS = {
  draft: 'bg-slate-100 text-slate-700',
  dispatched: 'bg-blue-100 text-blue-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-700',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ReturnToVendorListPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchReturnToVendorDcs({
        status: status || undefined,
        page,
        limit,
      });
      setRows(res.data?.data || []);
      setTotal(res.data?.pagination?.total || 0);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load return DCs');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { load(); }, [load]);

  const columns = [
    {
      key: 'dc_number',
      header: 'Return DC',
      render: (r) => (
        <Link
          to={`/vendor-management/return-to-vendor/${encodeURIComponent(r.dc_number)}`}
          className="font-medium text-blue-600 hover:underline"
        >
          {r.dc_number}
        </Link>
      ),
    },
    { key: 'vendor_name', header: 'Vendor', render: (r) => r.vendor_name || '—' },
    { key: 'po_number', header: 'PO', render: (r) => r.po_number || '—' },
    {
      key: 'item_count',
      header: 'Laptops',
      render: (r) => r.item_count ?? '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_CLASS[r.status] || 'bg-slate-100'}`}>
          {r.status?.replace(/_/g, ' ')}
        </span>
      ),
    },
    { key: 'return_date', header: 'Return date', render: (r) => fmtDate(r.return_date) },
    { key: 'dispatched_at', header: 'Dispatched', render: (r) => fmtDate(r.dispatched_at) },
    { key: 'vendor_received_at', header: 'Vendor received', render: (r) => fmtDate(r.vendor_received_at) },
  ];

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Return to Vendor"
        subtitle="Return warehouse laptops to the original supplier with full traceability"
        actions={(
          <Link to="/vendor-management/return-to-vendor/new">
            <Button><Plus className="w-4 h-4" /> New Return</Button>
          </Link>
        )}
      />

      <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Truck className="w-5 h-5 text-slate-400" />
          <select
            className="border rounded-lg px-3 py-1.5 text-sm"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="dispatched">Dispatched</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button type="button" onClick={load} className="text-sm text-blue-600 inline-flex items-center gap-1 ml-auto">
            <RotateCcw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        <ResponsiveTable columns={columns} rows={rows} loading={loading} emptyMessage="No vendor return DCs yet" />
        <ListPagination page={page} pageSize={limit} total={total} onPageChange={setPage} />
      </div>
    </div>
  );
}
