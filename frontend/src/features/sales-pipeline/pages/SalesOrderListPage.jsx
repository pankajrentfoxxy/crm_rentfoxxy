import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, ClipboardList, Eye, Banknote, Truck, Ban } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { PageHeader, StatCard, Button, ResponsiveTable, SearchField, ListPagination, DateRangeFilter } from '../../../components/ui/primitives';
import PaymentModal from '../components/PaymentModal';
import SalesOrderForm from '../components/SalesOrderForm';
import DCForm from '../components/DCForm';
import { cancelSalesOrder, getSalesOrderMeta, listSalesOrders } from '../salesPipelineApi';
import { formatCurrency, formatDate, TYPE_STYLES, typeLabel } from '../salesPipelineUtils';
import {
  getSoScopeConfig,
  salesOrderDetailPath,
  soPermissionSectionsForGate,
} from '../salesOrderScope';
import { useUrlFilters, useDebouncedUrlSearch, listReturnState } from '../../../hooks/useUrlFilters';

const PAGE_SIZE = 25;
const SO_FILTER_DEFAULTS = {
  page: 1,
  search: '',
  dateFrom: '',
  dateTo: '',
  status: '',
  customerId: '',
};
const SO_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'cancelled', label: 'Cancelled' },
];

function soStatusLabel(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'cancelled') return 'Cancelled';
  return 'Pending';
}

function soStatusClass(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'cancelled') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-800';
}

function QtyPill({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-800',
    blue: 'bg-blue-100 text-blue-900',
    amber: 'bg-amber-100 text-amber-900',
    green: 'bg-emerald-100 text-emerald-800',
    teal: 'bg-teal-100 text-teal-900',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ${tones[tone] || tones.slate}`}>
      <span className="font-medium opacity-75">{label}</span>
      {value}
    </span>
  );
}

function fulfillmentFromRow(row) {
  const total = Number(row.laptop_qty ?? row.remaining_qty ?? 0);
  const delivered = Number(row.delivered_count ?? 0);
  const attached = Number(row.attached_count ?? 0);
  const dispatched = Number(row.dispatched_count ?? 0);
  const pending = Number(row.pending_qty ?? 0);
  return { total, delivered, attached, dispatched, pending };
}

/** Icon action with hover label (Visibility / Payments / LocalShipping style). */
function ActionIconButton({ label, onClick, icon: Icon, tone = 'slate' }) {
  const tones = {
    blue: 'text-blue-600 hover:bg-blue-50',
    teal: 'text-teal-700 hover:bg-teal-50',
    slate: 'text-slate-700 hover:bg-slate-100',
    red: 'text-red-600 hover:bg-red-50',
  };
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`group relative inline-flex items-center justify-center rounded-lg p-2 transition-colors ${tones[tone] || tones.slate}`}
    >
      <Icon className="w-5 h-5" strokeWidth={1.75} />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {label}
      </span>
    </button>
  );
}

export default function SalesOrderListPage({ scope }) {
  const scopeConfig = getSoScopeConfig(scope);
  const permissionSections = soPermissionSectionsForGate();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const { filters, setFilters } = useUrlFilters(SO_FILTER_DEFAULTS);
  const { page, dateFrom, dateTo, status: statusFilter, customerId } = filters;
  const { searchInput, setSearchInput, debouncedSearch: search } = useDebouncedUrlSearch(filters, setFilters);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [stats, setStats] = useState({
    orders: 0, total_laptops: 0, attached: 0, delivered: 0, dispatched: 0, pending: 0,
  });
  const [soDrawer, setSoDrawer] = useState(false);
  const [dcDrawer, setDcDrawer] = useState(false);
  const [paymentSo, setPaymentSo] = useState(null);
  const [prefillQuote, setPrefillQuote] = useState(location.state?.fromQuote || null);
  const [prefillSo, setPrefillSo] = useState(null);

  useEffect(() => {
    getSalesOrderMeta(scope ? { entity_scope: scope } : undefined)
      .then((res) => setCustomers(res.data?.customers || []))
      .catch(() => {});
  }, [scope]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSalesOrders({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        customer_id: customerId || undefined,
        status: statusFilter || undefined,
        entity_scope: scope || undefined,
      });
      setRows(res.data?.sales_orders || []);
      setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
      setStats(res.data?.stats || {
        orders: res.data?.pagination?.total || 0,
        total_laptops: 0, attached: 0, delivered: 0, dispatched: 0, pending: 0,
      });
    } catch {
      toast.error('Failed to load sales orders');
    } finally {
      setLoading(false);
    }
  }, [page, search, dateFrom, dateTo, customerId, statusFilter, scope]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (location.state?.fromQuote) {
      setPrefillQuote(location.state.fromQuote);
      setSoDrawer(true);
    }
  }, [location.state]);

  const handleCancel = useCallback(async (soNumber) => {
    if (!window.confirm(`Cancel sales order ${soNumber}? Attached laptops will be released back to inventory. This cannot be undone.`)) return;
    try {
      const res = await cancelSalesOrder(soNumber);
      toast.success(res.data?.message || 'Sales order cancelled');
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to cancel sales order');
    }
  }, [load]);

  const actionCell = (row) => {
    const cancelled = String(row.status || '').toLowerCase() === 'cancelled';
    const hasAttachedLaptops = Number(row.attached_count || 0) > 0;
    const { delivered, dispatched } = fulfillmentFromRow(row);
    const hasDc = (delivered + dispatched) > 0;
    return (
      <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <ActionIconButton
          label="View"
          icon={Eye}
          tone="blue"
          onClick={() => navigate(salesOrderDetailPath(row.sales_order_number, scope), { state: listReturnState(location) })}
        />
        {!cancelled && (
          <>
            {hasAttachedLaptops && (
              <PermissionGate section={[...permissionSections, 'delivery_challans']} action="create">
                <ActionIconButton
                  label="Create DC"
                  icon={Truck}
                  tone="teal"
                  onClick={() => { setPrefillSo(row.sales_order_number); setDcDrawer(true); }}
                />
              </PermissionGate>
            )}
            <PermissionGate section="payment_records" action="create">
              <ActionIconButton
                label="Record Payment"
                icon={Banknote}
                tone="slate"
                onClick={() => setPaymentSo(row.sales_order_number)}
              />
            </PermissionGate>
            {!hasDc && (
              <PermissionGate section={scopeConfig?.permissionSection || permissionSections} action="edit">
                <ActionIconButton
                  label="Cancel"
                  icon={Ban}
                  tone="red"
                  onClick={() => handleCancel(row.sales_order_number)}
                />
              </PermissionGate>
            )}
          </>
        )}
      </div>
    );
  };

  const columns = [
    { key: 'sales_order_number', header: 'SO #', render: (r) => (
      <span className="flex items-center gap-2">
        <span className="font-mono text-blue-700 font-semibold">{r.sales_order_number}</span>
        {String(r.status || '').toLowerCase() === 'cancelled' && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">Cancelled</span>
        )}
      </span>
    ) },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.created_at) },
    { key: 'dispatch_date', header: 'Dispatch Date', render: (r) => (
      <span className="text-sm font-medium text-slate-800">{formatDate(r.dispatch_date)}</span>
    ) },
    { key: 'customer_name', header: 'Customer' },
    { key: 'type', header: 'Type', render: (r) => <span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_STYLES[r.quotation_type]}`}>{typeLabel(r.quotation_type)}</span> },
    { key: 'laptop_qty', header: 'Laptop Qty', render: (r) => {
      const { total } = fulfillmentFromRow(r);
      return <span className="text-lg font-bold text-blue-700">{total}</span>;
    } },
    { key: 'delivered_count', header: 'Delivered', render: (r) => {
      const { delivered } = fulfillmentFromRow(r);
      return <span className="text-base font-bold text-emerald-700">{delivered}</span>;
    } },
    { key: 'attached_count', header: 'Attached', render: (r) => {
      const { attached } = fulfillmentFromRow(r);
      return <span className="text-base font-bold text-teal-700">{attached}</span>;
    } },
    { key: 'pending_qty', header: 'Pending', render: (r) => {
      const { pending } = fulfillmentFromRow(r);
      return <span className="text-base font-bold text-slate-800">{pending}</span>;
    } },
    { key: 'status', header: 'Status', render: (r) => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${soStatusClass(r.status)}`}>
        {soStatusLabel(r.status)}
      </span>
    ) },
    { key: 'total', header: 'Total', render: (r) => formatCurrency(r.total_value) },
    { key: 'actions', header: 'Actions', render: actionCell },
  ];

  const renderCard = (r) => {
    const { total, delivered, attached, dispatched, pending } = fulfillmentFromRow(r);
    return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="font-mono text-blue-700 font-semibold">{r.sales_order_number}</span>
          {String(r.status || '').toLowerCase() === 'cancelled' && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">Cancelled</span>
          )}
        </span>
        <span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_STYLES[r.quotation_type]}`}>{typeLabel(r.quotation_type)}</span>
      </div>
      <p className="font-medium text-slate-800">{r.customer_name}</p>
      <div className="flex flex-wrap gap-1">
        <QtyPill label="Total" value={total} tone="blue" />
        <QtyPill label="Delivered" value={delivered} tone="green" />
        <QtyPill label="Attached" value={attached} tone="teal" />
        <QtyPill label="Dispatched" value={dispatched} tone="amber" />
        <QtyPill label="Pending" value={pending} tone="slate" />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>{formatDate(r.created_at)}</span>
        {r.dispatch_date ? <span>Dispatch: {formatDate(r.dispatch_date)}</span> : null}
        <span className={`px-2 py-0.5 rounded-full font-semibold ${soStatusClass(r.status)}`}>{soStatusLabel(r.status)}</span>
        <span className="font-semibold text-slate-700">{formatCurrency(r.total_value)}</span>
      </div>
      <div className="pt-2 border-t border-slate-100">{actionCell(r)}</div>
    </div>
    );
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <PageHeader
        title={scopeConfig?.title || 'Sales Orders'}
        subtitle={scopeConfig?.subtitle || 'SO series'}
        icon={ClipboardList}
        actions={(
          <div className="flex items-center gap-3">
            {scopeConfig && (
              <span
                className="hidden sm:inline-flex items-center rounded-full px-3 py-1 text-sm font-bold text-white"
                style={{ backgroundColor: scopeConfig.brandColor }}
              >
                {scopeConfig.brandName}
              </span>
            )}
            <PermissionGate section={scopeConfig?.permissionSection || permissionSections} action="create">
              <Button icon={Plus} onClick={() => setSoDrawer(true)}>Create Sales Order</Button>
            </PermissionGate>
          </div>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <StatCard label="Orders (filtered)" value={stats.orders} tone="gray" />
        <StatCard label="Total laptops" value={stats.total_laptops} tone="blue" />
        <StatCard label="Delivered" value={stats.delivered} tone="green" />
        <StatCard label="Attached" value={stats.attached} tone="teal" />
        <StatCard label="Dispatched" value={stats.dispatched} tone="amber" />
        <StatCard label="Pending" value={stats.pending} tone="gray" />
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search SO #, customer, GST…"
        />
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Customer
          <select
            className="min-w-[180px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            value={customerId}
            onChange={(e) => setFilters({ customerId: e.target.value })}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {c.company_name || c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Status
          <select
            className="min-w-[140px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => setFilters({ status: e.target.value })}
          >
            {SO_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onRangeChange={(range) => setFilters(range)}
          onDateFromChange={(v) => setFilters({ dateFrom: v })}
          onDateToChange={(v) => setFilters({ dateTo: v })}
          fromLabel="Created from"
          toLabel="Created to"
        />
      </div>

      <ResponsiveTable
        columns={columns}
        rows={rows}
        keyField="sales_order_number"
        loading={loading}
        renderCard={renderCard}
        onRowClick={(r) => navigate(salesOrderDetailPath(r.sales_order_number, scope), { state: listReturnState(location) })}
      />

      <ListPagination
        page={page}
        totalPages={pagination.totalPages || 1}
        total={pagination.total || 0}
        pageSize={PAGE_SIZE}
        onPageChange={(p) => setFilters({ page: p })}
      />

      <SalesOrderForm
        open={soDrawer}
        onClose={() => setSoDrawer(false)}
        onSaved={load}
        prefillQuotation={prefillQuote}
        scope={scope}
      />
      <DCForm open={dcDrawer} onClose={() => { setDcDrawer(false); setPrefillSo(null); }} prefillSo={prefillSo} />
      <PaymentModal open={Boolean(paymentSo)} soNumber={paymentSo} onClose={() => setPaymentSo(null)} onSaved={load} />
    </div>
  );
}
