import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Building2, Download, Tags } from 'lucide-react';
import { listSalesOrders } from '../../sales-pipeline/salesPipelineApi';
import { bulkUpdateCustomerType, exportCustomersExcel, exportCustomerAssetsExcel, getCustomerIds, getCustomers, updateCustomerStatus } from '../leadCrmApi';
import CustomerFormDrawer from '../components/CustomerFormDrawer';
import BulkCustomerTypeModal from '../components/BulkCustomerTypeModal';
import { PageHeader, StatCard, Button, ResponsiveTable } from '../../../components/ui/primitives';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import {
  CUSTOMER_TYPE_OPTIONS,
  customerTypeBadgeClass,
  customerTypeLabel,
} from '../../../utils/customerType';
import usePermission from '../../../hooks/usePermission';

const EXPORT_ROLES = new Set(['admin', 'super_admin']);
const TYPE_EDIT_ROLES = new Set(['admin', 'super_admin']);
const PAGE_SIZE = 25;

// Remembers page + filters so returning from a customer's detail restores the list
// position instead of resetting to page 1. (v2: default sort is newest-first / desc)
const LIST_STATE_KEY = 'lead-crm:customers:list-state-v3';

function readSavedListState() {
  try {
    return JSON.parse(sessionStorage.getItem(LIST_STATE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function formatSelectedCount(n) {
  return `${Number(n || 0).toLocaleString('en-IN')} Customer${n === 1 ? '' : 's'} Selected`;
}

function isCustomerActive(c) {
  return Number(c?.status ?? 1) === 1;
}

export default function CustomerListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { canEdit } = usePermission();
  const canEditCustomers = canEdit('customers');
  const canExportCustomers = EXPORT_ROLES.has(user?.role);
  const canBulkEditType = TYPE_EDIT_ROLES.has(user?.role);
  const saved = useMemo(() => {
    try {
      // Drop legacy list-state that defaulted to ascending.
      sessionStorage.removeItem('lead-crm:customers:list-state');
      sessionStorage.removeItem('lead-crm:customers:list-state-v2');
    } catch { /* ignore */ }
    return readSavedListState();
  }, []);
  const [customers, setCustomers] = useState([]);
  const [page, setPage] = useState(() => saved.page || 1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [search, setSearch] = useState(() => saved.search || '');
  const [sortDir, setSortDir] = useState('desc');
  const [kycFilter, setKycFilter] = useState(() => saved.kycFilter || '');
  const [customerType, setCustomerType] = useState(() => saved.customerType || 'all');
  const [statusFilter, setStatusFilter] = useState(() => saved.statusFilter || 'all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);
  const [activeOrderCounts, setActiveOrderCounts] = useState({});
  const [exporting, setExporting] = useState(false);
  const [exportingAssets, setExportingAssets] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [selectedMeta, setSelectedMeta] = useState(() => new Map());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState(null);

  const listFilterParams = useMemo(() => ({
    search: search || undefined,
    customer_type: customerType === 'all' ? undefined : customerType,
    kyc: kycFilter || undefined,
    status: statusFilter || 'all',
  }), [search, customerType, kycFilter, statusFilter]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedMeta(new Map());
    setSelectAllMatching(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await getCustomers({
        page,
        limit: PAGE_SIZE,
        sort_by: 'customer_id',
        sort_dir: sortDir,
        ...listFilterParams,
      });
      setCustomers(res.data?.customers || []);
      setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch {
      toast.error('Failed to load customers');
    }
  }, [page, sortDir, listFilterParams]);

  useEffect(() => { load(); }, [load]);

  // Persist page + filters so returning from a detail view restores this list.
  // Always start newest-first on a fresh visit; sortDir is persisted only after user toggles.
  useEffect(() => {
    try {
      sessionStorage.setItem(
        LIST_STATE_KEY,
        JSON.stringify({ page, search, sortDir, kycFilter, customerType, statusFilter })
      );
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [page, search, sortDir, kycFilter, customerType, statusFilter]);

  // Reset selection when filters/search change (not when paging)
  useEffect(() => {
    clearSelection();
  }, [search, customerType, kycFilter, statusFilter, clearSelection]);

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

  const pageIds = useMemo(
    () => customers.map((c) => c.customer_id),
    [customers]
  );

  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));

  const selectedCustomers = useMemo(() => {
    const list = [];
    selectedIds.forEach((id) => {
      const fromPage = customers.find((c) => c.customer_id === id);
      const fromMeta = selectedMeta.get(id);
      list.push(fromPage || fromMeta || { customer_id: id });
    });
    return list.sort((a, b) => Number(a.customer_id) - Number(b.customer_id));
  }, [selectedIds, selectedMeta, customers]);

  const mergeMeta = (rows) => {
    setSelectedMeta((prev) => {
      const next = new Map(prev);
      (rows || []).forEach((c) => {
        if (c?.customer_id != null) next.set(c.customer_id, c);
      });
      return next;
    });
  };

  const toggleOne = (customer, checked) => {
    const id = customer.customer_id;
    setSelectAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setSelectedMeta((prev) => {
      const next = new Map(prev);
      if (checked) next.set(id, customer);
      else next.delete(id);
      return next;
    });
  };

  const selectCurrentPage = () => {
    setSelectAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      customers.forEach((c) => next.add(c.customer_id));
      return next;
    });
    mergeMeta(customers);
  };

  const deselectCurrentPage = () => {
    setSelectAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => next.delete(id));
      return next;
    });
    setSelectedMeta((prev) => {
      const next = new Map(prev);
      pageIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const toggleCurrentPage = (checked) => {
    if (checked) selectCurrentPage();
    else deselectCurrentPage();
  };

  const selectAllMatchingCustomers = async () => {
    setSelectingAll(true);
    try {
      const res = await getCustomerIds(listFilterParams);
      const rows = res.data?.customers || [];
      const ids = res.data?.customer_ids || rows.map((c) => c.customer_id);
      setSelectedIds(new Set(ids));
      setSelectedMeta(new Map(rows.map((c) => [c.customer_id, c])));
      setSelectAllMatching(true);
      toast.success(formatSelectedCount(ids.length));
    } catch {
      toast.error('Failed to select matching customers');
    } finally {
      setSelectingAll(false);
    }
  };

  const stats = useMemo(() => ({
    total: pagination.total || customers.length,
    kyc: customers.filter((c) => c.kyc_verified).length,
    portal: customers.filter((c) => c.portal_enabled).length,
  }), [customers, pagination.total]);

  const handleToggleStatus = async (c) => {
    const active = isCustomerActive(c);
    const next = active ? 0 : 1;
    const label = active ? 'deactivate' : 'activate';
    if (!window.confirm(`${active ? 'Deactivate' : 'Activate'} ${c.company_name || c.customer_name || `customer #${c.customer_id}`}?\n\nInactive customers will not appear in SO, quotation, support, or other pickers.`)) {
      return;
    }
    setStatusBusyId(c.customer_id);
    try {
      const { data } = await updateCustomerStatus(c.customer_id, next);
      toast.success(data?.message || `Customer ${label}d`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to ${label} customer`);
    } finally {
      setStatusBusyId(null);
    }
  };

  const actionCell = (c) => {
    const active = isCustomerActive(c);
    return (
      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => navigate(`/lead-crm/customers/${c.customer_id}`)} className="text-blue-600 text-sm font-semibold">View</button>
        <button type="button" onClick={() => { setEditCustomer(c); setDrawerOpen(true); }} className="text-gray-600 text-sm font-semibold">Edit</button>
        {canEditCustomers ? (
          <button
            type="button"
            disabled={statusBusyId === c.customer_id}
            onClick={() => handleToggleStatus(c)}
            className={`text-sm font-semibold disabled:opacity-50 ${active ? 'text-amber-700' : 'text-emerald-700'}`}
          >
            {statusBusyId === c.customer_id ? '…' : (active ? 'Deactivate' : 'Activate')}
          </button>
        ) : null}
      </div>
    );
  };

  const statusBadge = (c) => (
    isCustomerActive(c) ? (
      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Active</span>
    ) : (
      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">Inactive</span>
    )
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

  const handleExportCustomerAssets = async () => {
    setExportingAssets(true);
    try {
      const response = await exportCustomerAssetsExcel();
      const blob = new Blob([response.data], {
        type: response.headers['content-type'] || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const disposition = response.headers['content-disposition'] || '';
      const match = /filename="?([^"]+)"?/.exec(disposition);
      a.href = url;
      a.download = match?.[1] || 'customer_assets_export.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Customer assets export downloaded');
    } catch {
      toast.error('Failed to export customer assets');
    } finally {
      setExportingAssets(false);
    }
  };

  const removeFromSelection = (customerId) => {
    setSelectAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(customerId);
      return next;
    });
    setSelectedMeta((prev) => {
      const next = new Map(prev);
      next.delete(customerId);
      return next;
    });
  };

  useEffect(() => {
    if (bulkModalOpen && selectedIds.size === 0) {
      setBulkModalOpen(false);
    }
  }, [bulkModalOpen, selectedIds]);

  const handleBulkTypeSave = async (nextType) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setBulkSaving(true);
    try {
      const { data } = await bulkUpdateCustomerType({
        customer_ids: ids,
        customer_type: nextType,
      });
      toast.success(data.message || `Updated ${data.updated_count} customer(s)`);
      setBulkModalOpen(false);
      clearSelection();
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Bulk update failed');
    } finally {
      setBulkSaving(false);
    }
  };

  const selectHeader = canBulkEditType ? (
    <input
      type="checkbox"
      checked={allPageSelected}
      ref={(el) => {
        if (el) el.indeterminate = somePageSelected && !allPageSelected;
      }}
      onChange={(e) => toggleCurrentPage(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      aria-label="Select current page"
      className="rounded border-slate-300"
      title="Select current page"
    />
  ) : null;

  const columns = [
    ...(canBulkEditType ? [{
      key: 'select',
      header: selectHeader,
      className: 'w-10',
      render: (c) => (
        <input
          type="checkbox"
          checked={selectedIds.has(c.customer_id)}
          onChange={(e) => toggleOne(c, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select customer ${c.customer_id}`}
          className="rounded border-slate-300"
        />
      ),
    }] : []),
    { key: 'id', header: 'ID', sortable: true, sortKey: 'customer_id', render: (c) => `#${c.customer_id}` },
    { key: 'company', header: 'Company', render: (c) => (
      <span className="font-medium inline-flex items-center gap-2 flex-wrap">
        {c.company_name || c.customer_name}
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${customerTypeBadgeClass(c.customer_type)}`}>
          {customerTypeLabel(c.customer_type)}
        </span>
        {statusBadge(c)}
      </span>
    ) },
    { key: 'contact', header: 'Contact', render: (c) => c.contact_person_name || c.customer_name },
    { key: 'phone', header: 'Phone', render: (c) => c.customer_number || c.phone },
    { key: 'email', header: 'Email', render: (c) => c.email || '—' },
    { key: 'gst', header: 'GST', render: (c) => <span className="text-xs">{c.gst_number || '—'}</span> },
    { key: 'city', header: 'City', render: (c) => c.billing_city || '—' },
    { key: 'status', header: 'Status', render: statusBadge },
    { key: 'items', header: 'Items', align: 'center', render: (c) => c.active_item_count ?? 0 },
    { key: 'orders', header: 'Active Orders', align: 'center', render: (c) => activeOrderCounts[c.customer_id] ?? 0 },
    { key: 'portal', header: 'Portal', render: (c) => <span className={`inline-block w-2 h-2 rounded-full ${c.portal_enabled ? 'bg-green-500' : 'bg-gray-300'}`} /> },
    { key: 'kyc', header: 'KYC', render: kycBadge },
    { key: 'actions', header: 'Actions', render: actionCell },
  ];

  const renderCard = (c) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          {canBulkEditType ? (
            <input
              type="checkbox"
              checked={selectedIds.has(c.customer_id)}
              onChange={(e) => toggleOne(c, e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              className="mt-1 rounded border-slate-300"
              aria-label={`Select customer ${c.customer_id}`}
            />
          ) : null}
          <span className="font-semibold text-slate-800 inline-flex items-center gap-2 flex-wrap">
            {c.company_name || c.customer_name}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${customerTypeBadgeClass(c.customer_type)}`}>
              {customerTypeLabel(c.customer_type)}
            </span>
            {statusBadge(c)}
          </span>
        </div>
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
            {canExportCustomers ? (
              <Button variant="secondary" icon={Download} disabled={exportingAssets} onClick={handleExportCustomerAssets}>
                {exportingAssets ? 'Exporting...' : 'Export Customer Assets'}
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
        <select value={customerType} onChange={(e) => { setCustomerType(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="all">All types</option>
          {CUSTOMER_TYPE_OPTIONS.filter((o) => o.value !== 'both').map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={kycFilter} onChange={(e) => { setKycFilter(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All KYC</option>
          <option value="verified">Verified</option>
          <option value="pending">Pending</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {canBulkEditType ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <button
            type="button"
            onClick={selectCurrentPage}
            disabled={!customers.length}
            className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-50"
          >
            Select Current Page
          </button>
          <button
            type="button"
            onClick={selectAllMatchingCustomers}
            disabled={selectingAll || !pagination.total}
            className="text-sm px-3 py-1.5 rounded-lg border border-teal-300 bg-white text-teal-800 hover:bg-teal-50 disabled:opacity-50 font-medium"
          >
            {selectingAll
              ? 'Selecting…'
              : `Select All Matching Customers${pagination.total ? ` (${pagination.total.toLocaleString('en-IN')})` : ''}`}
          </button>
          {selectAllMatching ? (
            <span className="text-xs text-teal-700">All matching filters selected</span>
          ) : null}
        </div>
      ) : null}

      {canBulkEditType && selectedIds.size > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3">
          <span className="text-sm font-semibold text-teal-900">
            {formatSelectedCount(selectedIds.size)}
          </span>
          <Button
            variant="secondary"
            icon={Tags}
            onClick={() => setBulkModalOpen(true)}
          >
            Edit type
          </Button>
          <button
            type="button"
            onClick={clearSelection}
            className="text-sm text-teal-800 hover:underline"
          >
            Clear selection
          </button>
        </div>
      ) : null}

      <ResponsiveTable
        columns={columns}
        rows={customers}
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
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, pagination.total)} of {pagination.total}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <span className="text-sm text-gray-600 py-2">Page {page} of {pagination.totalPages}</span>
            <Button variant="secondary" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <CustomerFormDrawer
        open={drawerOpen}
        customer={editCustomer}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => {
          // New customers sort newest-first — ensure page 1 + desc so they appear on top.
          if (!editCustomer) {
            setSortDir('desc');
            setPage(1);
            // If already on page 1 with desc, state won't change — refresh explicitly.
            if (page === 1 && sortDir === 'desc') load();
            return;
          }
          load();
        }}
      />
      <BulkCustomerTypeModal
        open={bulkModalOpen}
        customers={selectedCustomers}
        saving={bulkSaving}
        onClose={() => setBulkModalOpen(false)}
        onConfirm={handleBulkTypeSave}
        onRemove={removeFromSelection}
      />
    </div>
  );
}
