import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, ClipboardList } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { PageHeader, StatCard, Button, ResponsiveTable, SearchField, ListPagination } from '../../../components/ui/primitives';
import PaymentModal from '../components/PaymentModal';
import SalesOrderForm from '../components/SalesOrderForm';
import DCForm from '../components/DCForm';
import { cancelSalesOrder, listSalesOrders } from '../salesPipelineApi';
import { formatCurrency, formatDate, TYPE_STYLES, typeLabel, salesOrderDetailPath } from '../salesPipelineUtils';
import useDebouncedValue from '../../../hooks/useDebouncedValue';

const PAGE_SIZE = 25;

export default function SalesOrderListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 320);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [soDrawer, setSoDrawer] = useState(false);
  const [dcDrawer, setDcDrawer] = useState(false);
  const [paymentSo, setPaymentSo] = useState(null);
  const [prefillQuote, setPrefillQuote] = useState(location.state?.fromQuote || null);
  const [prefillSo, setPrefillSo] = useState(null);

  useEffect(() => { setPage(1); }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSalesOrders({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
      });
      setRows(res.data?.sales_orders || []);
      setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch {
      toast.error('Failed to load sales orders');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (location.state?.fromQuote) {
      setPrefillQuote(location.state.fromQuote);
      setSoDrawer(true);
    }
  }, [location.state]);

  const stats = useMemo(() => ({
    total: pagination.total || rows.length,
    pending: rows.filter((r) => !r.dc_count).length,
    withDc: rows.filter((r) => r.dc_count > 0).length,
  }), [rows, pagination.total]);

  const handleCancel = useCallback(async (soNumber) => {
    if (!window.confirm(`Cancel sales order ${soNumber}? This cannot be undone and the order will not proceed to delivery.`)) return;
    try {
      await cancelSalesOrder(soNumber);
      toast.success('Sales order cancelled');
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to cancel sales order');
    }
  }, [load]);

  const actionCell = (row) => {
    const cancelled = String(row.status || '').toLowerCase() === 'cancelled';
    return (
      <div className="flex flex-wrap items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="text-blue-600 text-sm font-semibold" onClick={() => navigate(salesOrderDetailPath(row.sales_order_number))}>View</button>
        {!cancelled && (
          <>
            <PermissionGate section="delivery_challans" action="create">
              <button type="button" className="text-sm text-teal-700 font-semibold" onClick={() => { setPrefillSo(row.sales_order_number); setDcDrawer(true); }}>Create DC</button>
            </PermissionGate>
            <PermissionGate section="payment_records" action="create">
              <button type="button" className="text-sm text-gray-700 font-semibold" onClick={() => setPaymentSo(row.sales_order_number)}>Record Payment</button>
            </PermissionGate>
            <PermissionGate section="sales_orders_doc" action="edit">
              <button type="button" className="text-sm text-red-600 font-semibold" onClick={() => handleCancel(row.sales_order_number)}>Cancel</button>
            </PermissionGate>
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
    { key: 'customer_name', header: 'Customer' },
    { key: 'type', header: 'Type', render: (r) => <span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_STYLES[r.quotation_type]}`}>{typeLabel(r.quotation_type)}</span> },
    { key: 'total', header: 'Total', render: (r) => formatCurrency(r.total_value) },
    { key: 'dc', header: 'DC', render: (r) => <span className="bg-gray-100 px-2 py-0.5 rounded-full text-xs">{r.dc_count || 0}</span> },
    { key: 'actions', header: 'Actions', render: actionCell },
  ];

  const renderCard = (r) => (
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>{formatDate(r.created_at)}</span>
        <span className="font-semibold text-slate-700">{formatCurrency(r.total_value)}</span>
        <span>DC: {r.dc_count || 0}</span>
      </div>
      <div className="pt-2 border-t border-slate-100">{actionCell(r)}</div>
    </div>
  );

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <PageHeader
        title="Sales Orders"
        subtitle="SO-* series"
        icon={ClipboardList}
        actions={(
          <PermissionGate section="sales_orders_doc" action="create">
            <Button icon={Plus} onClick={() => setSoDrawer(true)}>Create Sales Order</Button>
          </PermissionGate>
        )}
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard label="Total" value={stats.total} tone="gray" />
        <StatCard label="Awaiting DC (page)" value={stats.pending} tone="amber" />
        <StatCard label="With DC (page)" value={stats.withDc} tone="green" />
      </div>

      <div className="mb-4">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search SO #, customer, GST…"
        />
      </div>

      <ResponsiveTable
        columns={columns}
        rows={rows}
        keyField="sales_order_number"
        loading={loading}
        renderCard={renderCard}
        onRowClick={(r) => navigate(salesOrderDetailPath(r.sales_order_number))}
      />

      <ListPagination
        page={page}
        totalPages={pagination.totalPages || 1}
        total={pagination.total || 0}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />

      <SalesOrderForm open={soDrawer} onClose={() => setSoDrawer(false)} onSaved={load} prefillQuotation={prefillQuote} />
      <DCForm open={dcDrawer} onClose={() => { setDcDrawer(false); setPrefillSo(null); }} prefillSo={prefillSo} />
      <PaymentModal open={Boolean(paymentSo)} soNumber={paymentSo} onClose={() => setPaymentSo(null)} onSaved={load} />
    </div>
  );
}
