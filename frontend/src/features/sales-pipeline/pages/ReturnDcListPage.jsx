import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, KeyRound, RotateCcw, Search } from 'lucide-react';
import ReturnDcDetailModal from '../components/ReturnDcDetailModal';
import { listReturnDCs } from '../salesPipelineApi';
import { DC_STATUS_STYLES, formatDate, statusLabel } from '../salesPipelineUtils';
import { getBackendOrigin } from '../../../utils/api';
import { PageHeader, StatCard, Button, ResponsiveTable, DateRangeFilter } from '../../../components/ui/primitives';

const PAGE_SIZE = 25;

function pdfUrl(p) {
  if (!p) return null;
  if (p.startsWith('http')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/${p.replace(/^\/?/, '')}`;
}

export default function ReturnDcListPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [detailRdc, setDetailRdc] = useState(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listReturnDCs({
        page,
        limit: PAGE_SIZE,
        search: search.trim() || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setRows(res.data?.return_dcs || res.data?.rows || []);
      setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch {
      toast.error('Failed to load return DCs');
    } finally {
      setLoading(false);
    }
  }, [page, search, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    total: pagination.total || rows.length,
    delivered: rows.filter((r) => r.status === 'delivered').length,
    inTransit: rows.filter((r) => r.status === 'in_transit' || r.status === 'processing' || r.status === 'shipped').length,
  }), [rows, pagination.total]);

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
    { key: 'date', header: 'Date', render: (row) => formatDate(row.created_at) },
    { key: 'customer_name', header: 'Customer' },
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{formatDate(row.created_at)}</span>
          <span>{row.unit_count || row.quantity || 1} unit(s)</span>
          {row.original_dc_number && <span className="font-mono">DC {row.original_dc_number}</span>}
          {row.sales_order_number && <span className="font-mono">SO {row.sales_order_number}</span>}
        </div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
          {otpCell(row)}
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
        subtitle="Return pickup challans (RDC series)"
        icon={RotateCcw}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard label="Total" value={stats.total} tone="gray" />
        <StatCard label="Delivered (this page)" value={stats.delivered} tone="green" />
        <StatCard label="In transit (this page)" value={stats.inTransit} tone="amber" />
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
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
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
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
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <span className="text-sm text-gray-600 py-2">Page {page} of {pagination.totalPages}</span>
            <Button variant="secondary" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
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
