import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, Eye, FileText, Loader2, RotateCcw, Search } from 'lucide-react';
import { PageHeader, ListPagination, DateRangeFilter } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { useAuth } from '../../../context/AuthContext';
import {
  downloadVendorRepairPdf,
  fetchVendorRepairDcList,
} from '../vendorRepairApi';
import { vendorRepairStatusClass, vendorRepairStatusLabel, vendorRepairDispatchModeLabel, vendorDeliveryStatusLabel, vendorDeliveryStatusClass } from '../vendorRepairUi';
import FloorPipelineFilterPanel, { FILTER_CTL } from '../components/FloorPipelineFilterPanel';
import { EMPTY_SPEC_FILTERS } from '../../inventory-management/inventorySpecFilters';
import useDebouncedSpecParams from '../../inventory-management/hooks/useDebouncedSpecParams';

const PAGE_SIZE = 25;
const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead']);

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN');
}

export default function VendorRepairDcListPage() {
  const { user } = useAuth();
  const canReceive = WAREHOUSE_ROLES.has(user?.role);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [specFilters, setSpecFilters] = useState(EMPTY_SPEC_FILTERS);
  const [pdfBusy, setPdfBusy] = useState(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 320);
  const debouncedSpecParams = useDebouncedSpecParams(specFilters);
  const specFilterKey = JSON.stringify(debouncedSpecParams);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchVendorRepairDcList({
        search: debouncedSearch || undefined,
        status: status || undefined,
        page,
        limit: PAGE_SIZE,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        ...debouncedSpecParams,
      });
      setRows(data.data || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load vendor repair DCs');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, page, dateFrom, dateTo, debouncedSpecParams]);

  useEffect(() => { setPage(1); }, [debouncedSearch, status, dateFrom, dateTo, specFilterKey]);
  useEffect(() => { load(); }, [load]);

  const handlePdf = async (dcNumber) => {
    setPdfBusy(dcNumber);
    try {
      await downloadVendorRepairPdf(dcNumber);
    } catch (err) {
      toast.error(err?.message || 'PDF download failed');
    } finally {
      setPdfBusy(null);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Vendor Repair DC"
        subtitle="View dispatch challans (VRDC), download PDFs, and receive laptops back from vendors"
        icon={FileText}
        actions={(
          <Link
            to="/floor-pipeline/diagnosis-failed"
            className="inline-flex items-center gap-1.5 h-9 px-3 border rounded-lg text-sm hover:bg-slate-50"
          >
            ← Diagnosis Failed
          </Link>
        )}
      />

      <FloorPipelineFilterPanel
        specFilters={specFilters}
        onSpecFiltersChange={setSpecFilters}
        onSpecFiltersClear={() => setSpecFilters(EMPTY_SPEC_FILTERS)}
      >
        <div className="relative min-w-[12rem] flex-1 max-w-sm shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            className={`${FILTER_CTL} w-full pl-8 pr-2`}
            placeholder="Search VRDC #, vendor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={`${FILTER_CTL} min-w-[7.5rem] max-w-[9rem]`}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="dispatch_ready">Dispatch Ready</option>
          <option value="dispatched">Dispatched</option>
          <option value="partially_returned">Partially Returned</option>
          <option value="returned">Returned</option>
        </select>
        <DateRangeFilter
          layout="inline"
          controlClassName="h-9 px-2 text-sm min-h-0"
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          fromLabel="Dispatched from"
          toLabel="Dispatched to"
        />
      </FloorPipelineFilterPanel>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3">VRDC #</th>
                  <th className="p-3">Vendor</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Send mode</th>
                  <th className="p-3">Vendor delivery</th>
                  <th className="p-3">Laptops</th>
                  <th className="p-3">Out Date</th>
                  <th className="p-3">Expected Return</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.dc_number} className="border-t hover:bg-slate-50/80">
                    <td className="p-3 font-mono text-xs text-purple-800">{r.dc_number}</td>
                    <td className="p-3">{r.vendor_name || '—'}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${vendorRepairStatusClass(r.status)}`}>
                        {vendorRepairStatusLabel(r.status)}
                      </span>
                    </td>
                    <td className="p-3 text-xs">{vendorRepairDispatchModeLabel(r.ship_by, r.dispatch_mode)}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${vendorDeliveryStatusClass(r)}`}>
                        {vendorDeliveryStatusLabel(r)}
                      </span>
                    </td>
                    <td className="p-3 text-xs">
                      {r.item_count || 0} total
                      {r.received_count > 0 ? ` · ${r.received_count} received` : ''}
                      {r.pending_count > 0 && r.status !== 'draft' ? ` · ${r.pending_count} pending` : ''}
                    </td>
                    <td className="p-3 text-xs whitespace-nowrap">{fmtDate(r.out_date || r.dispatched_at)}</td>
                    <td className="p-3 text-xs whitespace-nowrap">{fmtDate(r.expected_return_date)}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          to={`/vendor-management/vendor-repair-dc/${encodeURIComponent(r.dc_number)}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                        >
                          <Eye className="w-3.5 h-3.5" /> Open
                        </Link>
                        <button
                          type="button"
                          disabled={pdfBusy === r.dc_number}
                          onClick={() => handlePdf(r.dc_number)}
                          className="inline-flex items-center gap-1 text-xs text-slate-700 hover:underline disabled:opacity-50"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {pdfBusy === r.dc_number ? '…' : 'PDF'}
                        </button>
                        {canReceive && ['dispatched', 'partially_returned'].includes(r.status) && (r.pending_count > 0) ? (
                          <Link
                            to={`/vendor-management/vendor-repair-dc/${encodeURIComponent(r.dc_number)}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 hover:underline"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Receive
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">
                      No vendor repair challans yet. Create one from{' '}
                      <Link to="/floor-pipeline/diagnosis-failed" className="text-blue-600 hover:underline">Diagnosis Failed</Link>.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <ListPagination
            page={page}
            totalPages={pagination.totalPages || 1}
            total={pagination.total || 0}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
