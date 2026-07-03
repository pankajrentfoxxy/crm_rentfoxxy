import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Building2, Download } from 'lucide-react';
import { listSalesOrders } from '../../sales-pipeline/salesPipelineApi';
import { exportCustomersExcel, getCustomers } from '../leadCrmApi';
import CustomerFormDrawer from '../components/CustomerFormDrawer';
import { PageHeader, StatCard, Button, ResponsiveTable } from '../../../components/ui/primitives';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';

const EXPORT_ROLES = new Set(['admin', 'super_admin']);

export default function CustomerListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canExportCustomers = EXPORT_ROLES.has(user?.role);
  const [customers, setCustomers] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [kycFilter, setKycFilter] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);
  const [activeOrderCounts, setActiveOrderCounts] = useState({});
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getCustomers({
        page,
        limit: 25,
        search: search || undefined,
        sort_by: 'customer_id',
        sort_dir: sortDir,
      });
      setCustomers(res.data?.customers || []);
      setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch {
      toast.error('Failed to load customers');
    }
  }, [page, search, sortDir]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    listSalesOrders({ limit: 500 })
      .then((res) => {
        const counts = {};
        (res.data?.sales_orders || []).forEach((so) => {
          if (!so.customer_id) return;
          const qty = Number(so.remaining_qty ?? 0);
          if (qty > 0) {
            counts[so.customer_id] = (counts[so.customer_id] || 0) + 1;
          }
        });
        setActiveOrderCounts(counts);
      })
      .catch(() => setActiveOrderCounts({}));
  }, []);

  const filtered = useMemo(() => {
    if (kycFilter === 'verified') return customers.filter((c) => c.kyc_verified);
    if (kycFilter === 'pending') return customers.filter((c) => !c.kyc_verified);
    return customers;
  }, [customers, kycFilter]);

  const stats = useMemo(() => ({
    total: pagination.total || customers.length,
    kyc: customers.filter((c) => c.kyc_verified).length,
    portal: customers.filter((c) => c.portal_enabled).length,
  }), [customers, pagination.total]);

  const actionCell = (c) => (
    <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => navigate(`/lead-crm/customers/${c.customer_id}`)} className="text-blue-600 text-sm font-semibold">View</button>
      <button type="button" onClick={() => { setEditCustomer(c); setDrawerOpen(true); }} className="text-gray-600 text-sm font-semibold">Edit</button>
    </div>
  );

  const kycBadge = (c) => (
    <span className={`text-xs px-2 py-0.5 rounded-full ${c.kyc_verified ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
      {c.kyc_verified ? 'Verified' : 'Pending'}
    </span>
  );

  const toggleSort = () => {
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    setPage(1);
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const response = await exportCustomersExcel({ search: search || undefined });
      const blob = new Blob([response.data], {
        type: response.headers['content-type'] || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const disposition = response.headers['content-disposition'] || '';
      const match = /filename="?([^"]+)"?/.exec(disposition);
      a.href = url;
      a.download = match?.[1] || 'customers_export.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Customer export downloaded');
    } catch {
      toast.error('Failed to export customers');
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    { key: 'id', header: 'ID', sortable: true, sortKey: 'customer_id', render: (c) => `#${c.customer_id}` },
    { key: 'company', header: 'Company', render: (c) => <span className="font-medium">{c.company_name || c.customer_name}</span> },
    { key: 'contact', header: 'Contact', render: (c) => c.contact_person_name || c.customer_name },
    { key: 'phone', header: 'Phone', render: (c) => c.customer_number || c.phone },
    { key: 'email', header: 'Email', render: (c) => c.email || '—' },
    { key: 'gst', header: 'GST', render: (c) => <span className="text-xs">{c.gst_number || '—'}</span> },
    { key: 'city', header: 'City', render: (c) => c.billing_city || '—' },
    { key: 'items', header: 'Items', align: 'center', render: (c) => c.active_item_count ?? 0 },
    { key: 'orders', header: 'Active Orders', align: 'center', render: (c) => activeOrderCounts[c.customer_id] ?? 0 },
    { key: 'portal', header: 'Portal', render: (c) => <span className={`inline-block w-2 h-2 rounded-full ${c.portal_enabled ? 'bg-green-500' : 'bg-gray-300'}`} /> },
    { key: 'kyc', header: 'KYC', render: kycBadge },
    { key: 'actions', header: 'Actions', render: actionCell },
  ];

  const renderCard = (c) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-800">{c.company_name || c.customer_name}</span>
        {kycBadge(c)}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>#{c.customer_id}</span>
        <span>{c.contact_person_name || c.customer_name}</span>
        <span>{c.customer_number || c.phone}</span>
        {c.billing_city && <span>{c.billing_city}</span>}
        <span>Items: {c.active_item_count ?? 0}</span>
        <span>Active orders: {activeOrderCounts[c.customer_id] ?? 0}</span>
      </div>
      <div className="pt-2 border-t border-slate-100">{actionCell(c)}</div>
    </div>
  );

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Customers"
        subtitle="Manage customer profiles and KYC"
        icon={Building2}
        actions={(
          <div className="flex flex-wrap gap-2">
            {canExportCustomers ? (
              <Button variant="secondary" icon={Download} disabled={exporting} onClick={handleExportExcel}>
                {exporting ? 'Exporting...' : 'Export Excel'}
              </Button>
            ) : null}
            <Button icon={Plus} onClick={() => { setEditCustomer(null); setDrawerOpen(true); }}>Add Customer</Button>
          </div>
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total" value={stats.total} tone="gray" />
        <StatCard label="KYC Verified" value={stats.kyc} tone="green" />
        <StatCard label="Portal Enabled" value={stats.portal} tone="blue" />
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input placeholder="Search..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]" />
        <select value={kycFilter} onChange={(e) => setKycFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All KYC</option>
          <option value="verified">Verified</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      <ResponsiveTable
        columns={columns}
        rows={filtered}
        keyField="customer_id"
        renderCard={renderCard}
        onRowClick={(c) => navigate(`/lead-crm/customers/${c.customer_id}`)}
        sortKey="customer_id"
        sortDirection={sortDir}
        onSort={toggleSort}
      />

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, pagination.total)} of {pagination.total}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <span className="text-sm text-gray-600 py-2">Page {page} of {pagination.totalPages}</span>
            <Button variant="secondary" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <CustomerFormDrawer open={drawerOpen} customer={editCustomer} onClose={() => setDrawerOpen(false)} onSaved={() => load()} />
    </div>
  );
}
