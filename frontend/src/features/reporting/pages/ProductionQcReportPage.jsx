import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Download, Eye, Loader2, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, Button, ResponsiveTable, DateRangeFilter } from '../../../components/ui/primitives';
import { useAuth } from '../../../context/AuthContext';
import { useUrlFilters, useDebouncedUrlSearch } from '../../../hooks/useUrlFilters';
import InventorySpecMultiFilterBar from '../../inventory-management/components/InventorySpecMultiFilterBar';
import {
  EMPTY_SPEC_FILTERS,
  SPEC_FILTER_KEYS,
  specMultiFiltersToParams,
} from '../../inventory-management/inventorySpecFilters';
import useDebouncedSpecParams from '../../inventory-management/hooks/useDebouncedSpecParams';
import {
  getProductionQcReport,
  getProductionQcReportDetail,
  getProductionQcReportFilters,
  downloadProductionQcReportPdf,
  downloadProductionQcReportDetailPdf,
} from '../reportingApi';

async function savePdfBlob(blob, fallbackName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 25;
const FILTER_CTL = 'border border-slate-200 rounded-lg bg-white text-sm min-h-[36px] px-2.5 py-1.5';

const FILTER_DEFAULTS = {
  page: 1,
  search: '',
  dateFrom: '',
  dateTo: '',
  technicianId: '',
  stage: '',
  qcStatus: '',
  ...EMPTY_SPEC_FILTERS,
};

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusBadge(status) {
  const s = String(status || '').toUpperCase();
  const cls = s === 'PASS'
    ? 'bg-emerald-100 text-emerald-800'
    : s === 'FAIL'
      ? 'bg-red-100 text-red-800'
      : 'bg-slate-100 text-slate-600';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status || '—'}</span>;
}

function checkBadge(result) {
  const r = String(result || 'Not Checked');
  const cls = r === 'Working'
    ? 'bg-emerald-100 text-emerald-800'
    : r === 'Not Working'
      ? 'bg-red-100 text-red-800'
      : 'bg-slate-100 text-slate-500';
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{r}</span>;
}

function DetailModal({ historyId, onClose, onOpenAttempt, showCustomerVendor }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProductionQcReportDetail(historyId)
      .then((res) => {
        if (!cancelled) setDetail(res.data?.data || null);
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load QC details');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [historyId]);

  const handleDetailPdf = async () => {
    setPdfBusy(true);
    try {
      const res = await downloadProductionQcReportDetailPdf(historyId);
      const name = `production-qc_${detail?.ttspl_id || historyId}_attempt${detail?.attempt_no || 1}.pdf`;
      await savePdfBlob(res.data, name);
      toast.success('PDF downloaded');
    } catch {
      toast.error('PDF download failed');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white w-full sm:max-w-3xl sm:rounded-xl shadow-xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
          <div>
            <h3 className="font-semibold text-slate-900">QC Checklist Details</h3>
            {detail && (
              <p className="text-xs text-slate-500 mt-0.5">
                {detail.ttspl_id || '—'} · {detail.qc_stage} · Attempt #{detail.attempt_no}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleDetailPdf}
              disabled={pdfBusy || loading || !detail}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {pdfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              PDF
            </button>
            <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="flex justify-center py-12 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}
          {!loading && detail && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div><p className="text-xs text-slate-500">TTSPL</p><p className="font-mono font-medium">{detail.ttspl_id || '—'}</p></div>
                <div><p className="text-xs text-slate-500">Serial</p><p className="font-mono">{detail.serial_number || '—'}</p></div>
                <div><p className="text-xs text-slate-500">Technician</p><p>{detail.technician_name || '—'}</p></div>
                {showCustomerVendor ? (
                  <div><p className="text-xs text-slate-500">Customer / Vendor</p><p>{detail.customer_vendor || '—'}</p></div>
                ) : null}
                <div><p className="text-xs text-slate-500">QC Stage</p><p>{detail.qc_stage || '—'}</p></div>
                <div><p className="text-xs text-slate-500">Status</p><p>{statusBadge(detail.qc_status)}</p></div>
                <div><p className="text-xs text-slate-500">Checked At</p><p>{formatDateTime(detail.submitted_at)}</p></div>
                <div><p className="text-xs text-slate-500">Checked By</p><p>{detail.checked_by_name || detail.technician_name || '—'}</p></div>
                <div><p className="text-xs text-slate-500">Grade</p><p>{detail.final_grade || '—'}</p></div>
              </div>

              {detail.qc_remarks && (
                <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                  <p className="text-xs text-slate-500 mb-1">QC Remarks</p>
                  <p className="text-slate-800 whitespace-pre-wrap">{detail.qc_remarks}</p>
                </div>
              )}

              {Array.isArray(detail.attempts) && detail.attempts.length > 1 && (
                <div>
                  <p className="text-xs font-medium text-slate-600 mb-2">QC History (same stage)</p>
                  <div className="flex flex-wrap gap-2">
                    {detail.attempts.map((a) => (
                      <button
                        key={a.history_id}
                        type="button"
                        onClick={() => onOpenAttempt(a.history_id)}
                        className={`text-xs px-2.5 py-1 rounded-full border ${
                          a.history_id === detail.history_id
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        #{a.attempt_no} · {a.qc_result || '—'} · {formatDateTime(a.submitted_at)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-sm font-semibold text-slate-800 mb-2">Component checklist</p>
                <div className="overflow-x-auto border rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Component</th>
                        <th className="text-left px-3 py-2">Result</th>
                        <th className="text-left px-3 py-2">Details</th>
                        <th className="text-left px-3 py-2">Checked By</th>
                        <th className="text-left px-3 py-2">Checked At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(detail.components || []).map((c) => (
                        <tr key={c.component_key}>
                          <td className="px-3 py-2 font-medium text-slate-800">{c.component}</td>
                          <td className="px-3 py-2">{checkBadge(c.check_result)}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">
                            {(c.source_details || []).length
                              ? c.source_details.map((s) => `${s.key}: ${s.value}`).join(' · ')
                              : (c.technician_remark || '—')}
                          </td>
                          <td className="px-3 py-2 text-xs">{c.checked_by || '—'}</td>
                          <td className="px-3 py-2 text-xs">{formatDateTime(c.checked_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {detail.ticket_id && (
                <div className="text-xs text-slate-500">
                  Ticket{' '}
                  <Link to={`/floor-pipeline/tickets/${detail.ticket_id}`} className="text-blue-600 underline">
                    #{detail.ticket_id}
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProductionQcReportPage() {
  const { user } = useAuth();
  const showCustomerVendor = user?.role === 'admin' || user?.role === 'super_admin';
  const { filters, setFilters } = useUrlFilters(FILTER_DEFAULTS);
  const {
    page,
    dateFrom,
    dateTo,
    technicianId,
    stage,
    qcStatus,
  } = filters;
  const { searchInput, setSearchInput, debouncedSearch: search } = useDebouncedUrlSearch(filters, setFilters);

  const specFilters = useMemo(() => {
    const out = { ...EMPTY_SPEC_FILTERS };
    SPEC_FILTER_KEYS.forEach((k) => { out[k] = filters[k] || ''; });
    return out;
  }, [filters]);
  const debouncedSpecParams = useDebouncedSpecParams(specFilters);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [detailId, setDetailId] = useState(null);
  const [filterOptions, setFilterOptions] = useState({ technicians: [], stages: [], qc_statuses: [] });

  useEffect(() => {
    getProductionQcReportFilters()
      .then((res) => {
        setFilterOptions(res.data?.data || { technicians: [], stages: [], qc_statuses: [] });
      })
      .catch(() => {});
  }, []);

  const listParams = useMemo(() => ({
    page,
    limit: PAGE_SIZE,
    search: search || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    technician_id: technicianId || undefined,
    stage: stage || undefined,
    qc_status: qcStatus || undefined,
    ...specMultiFiltersToParams(debouncedSpecParams),
  }), [page, search, dateFrom, dateTo, technicianId, stage, qcStatus, debouncedSpecParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProductionQcReport(listParams);
      setRows(res.data?.rows || []);
      setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load Production QC report');
    } finally {
      setLoading(false);
    }
  }, [listParams]);

  useEffect(() => { load(); }, [load]);

  const handleListPdf = async () => {
    setPdfBusy(true);
    try {
      const res = await downloadProductionQcReportPdf({
        ...listParams,
        for_export: true,
        page: 1,
        limit: 2000,
      });
      const date = new Date().toISOString().slice(0, 10);
      await savePdfBlob(res.data, `production-qc-report_${date}.pdf`);
      toast.success('PDF downloaded');
    } catch {
      toast.error('PDF download failed');
    } finally {
      setPdfBusy(false);
    }
  };

  const columns = useMemo(() => {
    const base = [
      { key: 'ttspl', header: 'TTSPL', render: (r) => <span className="font-mono text-blue-700 font-semibold">{r.ttspl_id || '—'}</span> },
      { key: 'serial', header: 'Serial', render: (r) => <span className="font-mono text-xs">{r.serial_number || '—'}</span> },
      { key: 'tech', header: 'Technician', render: (r) => r.technician_name || '—' },
    ];
    if (showCustomerVendor) {
      base.push({ key: 'party', header: 'Customer / Vendor', render: (r) => r.customer_vendor || '—' });
    }
    base.push(
      {
        key: 'config',
        header: 'Brand / Model',
        render: (r) => [r.brand, r.model].filter(Boolean).join(' · ') || '—',
      },
      { key: 'stage', header: 'QC Stage', render: (r) => r.qc_stage || '—' },
      { key: 'current', header: 'Current Stage', render: (r) => r.current_stage || '—' },
      { key: 'when', header: 'QC Date & Time', render: (r) => formatDateTime(r.submitted_at) },
      { key: 'status', header: 'QC Status', render: (r) => statusBadge(r.qc_status) },
      {
        key: 'remarks',
        header: 'QC Remarks',
        render: (r) => (
          <span className="text-xs text-slate-600 line-clamp-2 max-w-[180px]">{r.qc_remarks || '—'}</span>
        ),
      },
      {
        key: 'attempt',
        header: 'Attempt',
        render: (r) => <span className="text-xs text-slate-500">#{r.attempt_no}</span>,
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (r) => (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setDetailId(r.history_id); }}
            className="inline-flex items-center gap-1 text-xs text-blue-700 font-semibold hover:underline"
          >
            <Eye className="w-3.5 h-3.5" /> View Details
          </button>
        ),
      },
    );
    return base;
  }, [showCustomerVendor]);

  const showingFrom = pagination.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const showingTo = Math.min(page * PAGE_SIZE, pagination.total || 0);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Production QC Report"
        subtitle="Search and filter completed QC by date, technician, stage, status, and specs"
        icon={ClipboardCheck}
        actions={(
          <Button
            variant="secondary"
            onClick={handleListPdf}
            disabled={pdfBusy || loading}
            className="inline-flex items-center gap-2"
          >
            {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download PDF
          </Button>
        )}
      />

      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
          <div className="relative min-w-[12rem] flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder={showCustomerVendor ? 'Search TTSPL, serial, brand, model, customer…' : 'Search TTSPL, serial, brand, model…'}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className={`${FILTER_CTL} w-full pl-8`}
            />
          </div>

          <DateRangeFilter
            layout="inline"
            controlClassName="h-9 px-2 text-sm min-h-0"
            dateFrom={dateFrom}
            dateTo={dateTo}
            onRangeChange={(range) => setFilters(range)}
            onDateFromChange={(v) => setFilters({ dateFrom: v })}
            onDateToChange={(v) => setFilters({ dateTo: v })}
            fromLabel="QC from"
            toLabel="QC to"
          />

          <select
            className={`${FILTER_CTL} min-w-[9rem] max-w-[11rem]`}
            value={technicianId}
            onChange={(e) => setFilters({ technicianId: e.target.value })}
            aria-label="Technician"
          >
            <option value="">All technicians</option>
            {(filterOptions.technicians || []).map((t) => (
              <option key={t.user_id} value={String(t.user_id)}>{t.name}</option>
            ))}
          </select>

          <select
            className={`${FILTER_CTL} min-w-[8rem] max-w-[10rem]`}
            value={stage}
            onChange={(e) => setFilters({ stage: e.target.value })}
            aria-label="QC stage"
          >
            <option value="">All QC stages</option>
            {(filterOptions.stages || []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            className={`${FILTER_CTL} min-w-[7.5rem] max-w-[9rem]`}
            value={qcStatus}
            onChange={(e) => setFilters({ qcStatus: e.target.value })}
            aria-label="QC status"
          >
            <option value="">All QC status</option>
            {(filterOptions.qc_statuses || ['PASS', 'FAIL']).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <InventorySpecMultiFilterBar
          filters={specFilters}
          onChange={(patch) => setFilters(patch)}
          onClear={() => setFilters(Object.fromEntries(SPEC_FILTER_KEYS.map((k) => [k, ''])))}
        />
      </div>

      <ResponsiveTable
        columns={columns}
        rows={rows}
        keyField="history_id"
        loading={loading}
        onRowClick={(r) => setDetailId(r.history_id)}
        empty={<p className="text-center text-gray-500 py-8">No QC reports found</p>}
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

      {detailId && (
        <DetailModal
          historyId={detailId}
          onClose={() => setDetailId(null)}
          onOpenAttempt={(id) => setDetailId(id)}
          showCustomerVendor={showCustomerVendor}
        />
      )}
    </div>
  );
}
