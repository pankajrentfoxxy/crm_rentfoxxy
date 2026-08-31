import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, FileText, KeyRound, PackageCheck, RotateCcw, Search } from 'lucide-react';
import ReturnDcDetailModal from '../components/ReturnDcDetailModal';
import { exportReturnDcLaptops, listReturnDCs } from '../salesPipelineApi';
import { DC_STATUS_STYLES, downloadBlob, formatDate, statusLabel } from '../salesPipelineUtils';
import { getBackendOrigin } from '../../../utils/api';
import { PageHeader, StatCard, Button, ResponsiveTable, DateRangeFilter } from '../../../components/ui/primitives';
import { useUrlFilters, useDebouncedUrlSearch } from '../../../hooks/useUrlFilters';
import MultiSelectFilter from '../../lead-crm/components/MultiSelectFilter';

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];
const RDC_FILTER_DEFAULTS = { page: 1, search: '', dateFrom: '', dateTo: '', statuses: '', tab: '' };

function parseStatuses(raw, fallbackTab) {
  const fromStatuses = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => STATUS_OPTIONS.some((o) => o.value === s));
  if (fromStatuses.length) return fromStatuses;
  if (fallbackTab && STATUS_OPTIONS.some((o) => o.value === fallbackTab)) return [fallbackTab];
  return [];
}

function pdfUrl(p) {
  if (!p) return null;
  if (p.startsWith('http')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/${p.replace(/^\/?/, '')}`;
}

export default function ReturnDcListPage() {
  const { filters, setFilters } = useUrlFilters(RDC_FILTER_DEFAULTS);
  const { page, dateFrom, dateTo, statuses, tab } = filters;
  const selectedStatuses = parseStatuses(statuses, tab);
  const statusParam = selectedStatuses.join(',') || 'all';
  const { searchInput, setSearchInput, debouncedSearch: search } = useDebouncedUrlSearch(filters, setFilters);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, pending: 0, in_transit: 0, delivered: 0, cancelled: 0 });
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [detailRdc, setDetailRdc] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listReturnDCs({
        page,
        limit: PAGE_SIZE,
        search: search.trim() || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        status: statusParam,
      });
      setRows(res.data?.return_dcs || res.data?.rows || []);
      setStats(res.data?.stats || { total: 0, pending: 0, in_transit: 0, delivered: 0, cancelled: 0 });
      setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch {
      toast.error('Failed to load return DCs');
    } finally {
      setLoading(false);
    }
  }, [page, search, dateFrom, dateTo, statusParam]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const q = String(search || '').trim();
    if (/^RDC\d+$/i.test(q)) setDetailRdc(q.toUpperCase());
  }, [search]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await exportReturnDcLaptops({
        search: search.trim() || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        status: statusParam,
      });
      const type = res.headers['content-type'] || '';
      if (type.includes('application/json')) {
        const text = await res.data.text?.() || '';
        let message = 'Export failed';
        try { message = JSON.parse(text).message || message; } catch { /* keep */ }
        throw new Error(message);
      }
      const disposition = res.headers['content-disposition'] || '';
      const match = /filename="?([^"]+)"?/.exec(disposition);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(
        res.data,
        match?.[1] || `return_dc_${selectedStatuses.join('_') || 'all'}_laptops_${stamp}.xlsx`
      );
      toast.success('Laptop export downloaded');
    } catch (e) {
      let message = e.message || 'Failed to export laptops';
      const data = e.response?.data;
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text());
          message = parsed.message || message;
        } catch { /* keep */ }
      }
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  const otpCell = (row) => {
    if (row.customer_otp_verified_at) {
      return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Verified</span>;
    }
    if (row.customer_otp_code) {
      return (
        <span className="font-mono text-blue-700 inline-flex items-center gap-1">
          <KeyRound className="w-3.5 h-3.5" />
          {row.customer_otp_code}
        </span>
      );
    }
    return <span className="text-xs text-gray-400">—</span>;
  };

  const pdfCell = (row, stopPropagation) => {
    const url = pdfUrl(row.pdf_path);
    if (!url) return <span className="text-xs text-gray-400">—</span>;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stopPropagation}
        className="text-xs text-blue-600 inline-flex items-center gap-1"
      >
        <FileText className="w-3.5 h-3.5" />
        View
      </a>
    );
  };

  const columns = [
    {
      key: 'rdc',
      header: 'RDC #',
      render: (row) => (
        <span className="font-mono text-blue-700 font-semibold">{row.return_dc_number || row.rdc_number}</span>
      ),
    },
    { key: 'date', header: 'Created', render: (row) => formatDate(row.created_at) },
    {
      key: 'pickup_date',
      header: 'Pickup Date',
      render: (row) => formatDate(row.pickup_date) || <span className="text-xs text-gray-400">—</span>,
    },
    { key: 'customer_name', header: 'Customer' },
    {
      key: 'city',
      header: 'City',
      render: (row) => row.city || row.pickup_city || <span className="text-xs text-gray-400">—</span>,
    },
    { key: 'units', header: 'Units', render: (row) => row.unit_count || row.quantity || 1 },
    {
      key: 'original_dc',
      header: 'Original DC',
      render: (row) => <span className="font-mono text-xs">{row.original_dc_number || '—'}</span>,
    },
    {
      key: 'so',
      header: 'SO #',
      render: (row) => <span className="font-mono text-xs">{row.sales_order_number || '—'}</span>,
    },
    { key: 'otp', header: 'OTP', render: otpCell },
    { key: 'reason', header: 'Reason', render: (row) => row.reason || row.return_reason || '—' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span className={`px-2 py-0.5 rounded-full text-xs ${DC_STATUS_STYLES[row.status || 'pending'] || 'bg-gray-100 text-gray-700'}`}>
          {statusLabel(row.status || 'pending')}
        </span>
      ),
    },
    {
      key: 'warehouse',
      header: 'Warehouse',
      render: (row) => (
        row.warehouse_receive_pending ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setDetailRdc(row.return_dc_number || row.rdc_number); }}
            className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 inline-flex items-center gap-1 hover:bg-amber-200"
          >
            <PackageCheck className="w-3.5 h-3.5" />
            Receive
          </button>
        ) : (
          <span className="text-xs text-emerald-700">Received</span>
        )
      ),
    },
    {
      key: 'pdf',
      header: 'Signed PDF',
      render: (row) => pdfCell(row, (e) => e.stopPropagation()),
    },
  ];

  const renderCard = (row) => {
    const rdc = row.return_dc_number || row.rdc_number;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-blue-700 font-semibold">{rdc}</span>
          <span className={`px-2 py-0.5 rounded-full text-xs ${DC_STATUS_STYLES[row.status || 'pending'] || 'bg-gray-100 text-gray-700'}`}>
            {statusLabel(row.status || 'pending')}
          </span>
        </div>
        <p className="font-medium text-slate-800">{row.customer_name}</p>
        {row.city && <p className="text-xs text-slate-600">{row.city}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>Created {formatDate(row.created_at)}</span>
          <span>Pickup {formatDate(row.pickup_date) || '—'}</span>
          <span>{row.unit_count || row.quantity || 1} unit(s)</span>
          {row.original_dc_number && <span className="font-mono">DC {row.original_dc_number}</span>}
          {row.sales_order_number && <span className="font-mono">SO {row.sales_order_number}</span>}
        </div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
          {row.warehouse_receive_pending ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setDetailRdc(rdc); }}
              className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 inline-flex items-center gap-1"
            >
              <PackageCheck className="w-3.5 h-3.5" />
              Warehouse receive
            </button>
          ) : (
            <span className="text-xs text-emerald-700">Warehouse received</span>
          )}
          {pdfCell(row)}
        </div>
      </div>
    );
  };

  const showingFrom = pagination.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const showingTo = Math.min(page * PAGE_SIZE, pagination.total || 0);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Return DC"
        subtitle="Return pickup challans (RDC series) — filter by pending, in transit, delivered"
        icon={RotateCcw}
        actions={(
          <Button
            variant="secondary"
            icon={Download}
            loading={exporting}
            onClick={handleExport}
          >
            Export laptops
          </Button>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <StatCard label="Pending" value={stats.pending} tone="amber" />
        <StatCard label="In Transit" value={stats.in_transit} tone="blue" />
        <StatCard label="Delivered" value={stats.delivered} tone="green" />
        <StatCard label="Cancelled" value={stats.cancelled} tone="gray" />
        <StatCard label="Total" value={stats.total} tone="gray" />
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="w-full sm:w-56">
          <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Status</label>
          <MultiSelectFilter
            options={STATUS_OPTIONS}
            value={selectedStatuses}
            allLabel="All statuses"
            onChange={(next) => setFilters({
              statuses: next.length && next.length < STATUS_OPTIONS.length ? next.join(',') : '',
              tab: '',
            })}
          />
        </div>
        <div className="relative flex-1 min-w-[220px] sm:mt-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="search"
            placeholder="Search RDC #, customer, SO #, original DC, serial…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm min-h-[44px]"
          />
        </div>
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
        keyField="rdc_number"
        loading={loading}
        renderCard={renderCard}
        onRowClick={(row) => setDetailRdc(row.return_dc_number || row.rdc_number)}
        empty={<p className="text-center text-gray-500 py-8">No return DCs found</p>}
      />

      {pagination.totalPages > 1 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
          <p className="text-sm text-gray-500">
            Showing {showingFrom}–{showingTo} of {pagination.total}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setFilters({ page: page - 1 })}>Prev</Button>
            <span className="text-sm text-gray-600 py-2">Page {page} of {pagination.totalPages}</span>
            <Button variant="secondary" disabled={page >= pagination.totalPages} onClick={() => setFilters({ page: page + 1 })}>Next</Button>
          </div>
        </div>
      )}

      {detailRdc && (
        <ReturnDcDetailModal
          rdcNumber={detailRdc}
          onClose={() => setDetailRdc(null)}
          onUpdated={load}
        />
      )}
    </div>
  );
}
