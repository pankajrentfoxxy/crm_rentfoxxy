import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { PageHeader, StatCard, Button, ResponsiveTable, SearchField, ListPagination, DateRangeFilter } from '../../../components/ui/primitives';
import DCForm from '../components/DCForm';
import DispatchModal from '../components/DispatchModal';
import QcStatusBadge from '../components/QcStatusBadge';
import { listDCs } from '../salesPipelineApi';
import { DC_STATUS_STYLES, DISPATCH_MODE_STYLES, formatDate, statusLabel, deliveryChallanDetailPath } from '../salesPipelineUtils';
import { useUrlFilters, useDebouncedUrlSearch, listReturnState } from '../../../hooks/useUrlFilters';

const TABS = ['all', 'pending', 'in_transit', 'delivered', 'rejected'];
const PAGE_SIZE = 25;
const DC_FILTER_DEFAULTS = {
  page: 1,
  search: '',
  dateFrom: '',
  dateTo: '',
  tab: 'all',
};

export default function DeliveryChallanListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { filters, setFilters } = useUrlFilters(DC_FILTER_DEFAULTS);
  const { page, dateFrom, dateTo, tab } = filters;
  const { searchInput, setSearchInput, debouncedSearch: search } = useDebouncedUrlSearch(filters, setFilters);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total_delivery_challans: 0,
    total_laptops: 0,
    total: 0,
    pending: 0,
    in_transit: 0,
    delivered: 0,
    rejected: 0,
  });
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [dcDrawer, setDcDrawer] = useState(false);
  const [dispatchDc, setDispatchDc] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDCs({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        status: tab !== 'all' ? tab : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      const list = res.data?.delivery_challans || [];
      setRows(list);
      setStats(res.data?.stats || {
        total_delivery_challans: res.data?.pagination?.total || list.length,
        total_laptops: 0,
        total: res.data?.pagination?.total || list.length,
        pending: 0,
        in_transit: 0,
        delivered: 0,
        rejected: 0,
      });
      setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch {
      toast.error('Failed to load delivery challans');
    } finally {
      setLoading(false);
    }
  }, [tab, page, search, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const formatCount = (n) => Number(n || 0).toLocaleString('en-IN');

  const dispatchCell = (row) => {
    const qc = row.qc_status;
    const canDispatch = (row.status === 'pending' || !row.status) && qc?.all_passed;
    return (
      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="text-blue-600 text-sm font-semibold" onClick={() => navigate(deliveryChallanDetailPath(row.dc_number), { state: listReturnState(location) })}>View</button>
        {canDispatch && (
          <PermissionGate section="dispatch_ops" action="edit">
            <button type="button" className="text-sm text-teal-700 font-semibold" onClick={() => setDispatchDc(row.dc_number)}>Dispatch</button>
          </PermissionGate>
        )}
      </div>
    );
  };

  const columns = [
    { key: 'dc_number', header: 'DC #', render: (r) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-blue-700 font-semibold">{r.dc_number}</span>
        {r.dc_purpose === 'service_return' && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-teal-100 text-teal-800">Service Return</span>
        )}
        {r.dc_purpose === 'replacement' && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-800">Replacement</span>
        )}
      </span>
    ) },
    { key: 'date', header: 'Created', render: (r) => formatDate(r.created_at) },
    { key: 'dispatch_date', header: 'Dispatch Date', render: (r) => (
      <span className="text-sm font-medium text-slate-800">{formatDate(r.dispatched_at)}</span>
    ) },
    { key: 'customer_name', header: 'Customer' },
    { key: 'so', header: 'SO #', render: (r) => <span className="font-mono text-xs">{r.sales_order_number || '—'}</span> },
    { key: 'dispatch', header: 'Dispatch', render: (r) => (r.dispatch_mode ? <span className={`px-2 py-0.5 rounded-full text-xs ${DISPATCH_MODE_STYLES[r.dispatch_mode]}`}>{r.dispatch_mode}</span> : '—') },
    {
      key: 'qc',
      header: 'QC',
      render: (r) => {
        const qc = r.qc_status;
        return (
          <QcStatusBadge
            allPassed={qc?.all_passed}
            pendingCount={qc?.pending_count}
            failedCount={qc?.failed_count}
            totalCount={qc?.total_count}
          />
        );
      },
    },
    { key: 'status', header: 'Status', render: (r) => <span className={`px-2 py-0.5 rounded-full text-xs ${DC_STATUS_STYLES[r.status || 'pending']}`}>{statusLabel(r.status || 'pending')}</span> },
    { key: 'actions', header: 'Actions', render: dispatchCell },
  ];

  const renderCard = (r) => {
    const qc = r.qc_status;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-blue-700 font-semibold">{r.dc_number}</span>
          <span className={`px-2 py-0.5 rounded-full text-xs ${DC_STATUS_STYLES[r.status || 'pending']}`}>{statusLabel(r.status || 'pending')}</span>
        </div>
        <p className="font-medium text-slate-800">{r.customer_name}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{formatDate(r.created_at)}</span>
          {r.dispatched_at ? <span>Dispatch: {formatDate(r.dispatched_at)}</span> : null}
          {r.sales_order_number && <span className="font-mono">SO {r.sales_order_number}</span>}
          {r.dispatch_mode && <span className={`px-2 py-0.5 rounded-full ${DISPATCH_MODE_STYLES[r.dispatch_mode]}`}>{r.dispatch_mode}</span>}
        </div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <QcStatusBadge
            allPassed={qc?.all_passed}
            pendingCount={qc?.pending_count}
            failedCount={qc?.failed_count}
            totalCount={qc?.total_count}
          />
          {dispatchCell(r)}
        </div>
      </div>
    );
  };

  const dispatchQc = dispatchDc ? rows.find((r) => r.dc_number === dispatchDc)?.qc_status : null;

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <PageHeader
        title="Delivery Challans"
        subtitle="DC-* series"
        icon={Truck}
        actions={(
          <PermissionGate section="delivery_challans" action="create">
            <Button icon={Plus} onClick={() => setDcDrawer(true)}>Create DC</Button>
          </PermissionGate>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <StatCard label="Total Delivery Challans" value={formatCount(stats.total_delivery_challans)} tone="gray" />
        <StatCard label="Total Laptops" value={formatCount(stats.total_laptops)} tone="blue" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <StatCard label="Total" value={formatCount(stats.total)} tone="gray" />
        <StatCard label="Pending" value={formatCount(stats.pending)} tone="amber" />
        <StatCard label="In Transit" value={formatCount(stats.in_transit)} tone="blue" />
        <StatCard label="Delivered" value={formatCount(stats.delivered)} tone="green" />
        <StatCard label="Rejected" value={formatCount(stats.rejected)} tone="red" />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setFilters({ tab: t })} className={`px-3 min-h-[36px] rounded-full text-xs font-medium capitalize ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>{t.replace('_', ' ')}</button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search DC #, SO #, customer, GST…"
        />
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
        keyField="dc_number"
        loading={loading}
        renderCard={renderCard}
        onRowClick={(r) => navigate(deliveryChallanDetailPath(r.dc_number), { state: listReturnState(location) })}
      />

      <ListPagination
        page={page}
        totalPages={pagination.totalPages || 1}
        total={pagination.total || 0}
        pageSize={PAGE_SIZE}
        onPageChange={(p) => setFilters({ page: p })}
      />

      <DCForm open={dcDrawer} onClose={() => setDcDrawer(false)} />
      <DispatchModal
        open={Boolean(dispatchDc)}
        dcNumber={dispatchDc}
        qcBlocked={dispatchDc && !dispatchQc?.all_passed}
        onClose={() => setDispatchDc(null)}
        onDispatched={load}
      />
    </div>
  );
}
