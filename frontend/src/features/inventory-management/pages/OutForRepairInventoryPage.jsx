import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, FileSpreadsheet, Loader2, RefreshCw, Wrench } from 'lucide-react';
import { PageHeader, ListPagination, SearchField, DateRangeFilter } from '../../../components/ui/primitives';
import { useUrlFilters, useDebouncedUrlSearch, useDebouncedUrlField, listReturnState } from '../../../hooks/useUrlFilters';
import { useAuth } from '../../../context/AuthContext';
import {
  exportOutForRepairExcel,
  exportOutForRepairPdf,
  fetchOutForRepairInventory,
  receiveErpRepairBack,
} from '../../floor-pipeline/vendorRepairApi';
import { invalidateInventoryManagement } from '../inventoryCountsEvents';
import InventorySpecFilterBar from '../components/InventorySpecFilterBar';
import { EMPTY_SPEC_FILTERS, SPEC_FILTER_KEYS } from '../inventorySpecFilters';
import useDebouncedSpecParams from '../hooks/useDebouncedSpecParams';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import TtsplHistoryLink from '../../floor-pipeline/components/TtsplHistoryLink';

const PAGE_SIZE = 25;
const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead']);
const INPUT_CLS = 'rounded-md border border-slate-200 px-2 py-1.5 text-xs min-h-[32px] min-w-[120px]';

const OUT_FOR_REPAIR_FILTER_DEFAULTS = {
  page: 1,
  search: '',
  vendor: '',
  dc: '',
  dateFrom: '',
  dateTo: '',
  ...EMPTY_SPEC_FILTERS,
};

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN');
}

export default function OutForRepairInventoryPage() {
  const { user } = useAuth();
  const location = useLocation();
  const canReceive = WAREHOUSE_ROLES.has(user?.role);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [historyTtspl, setHistoryTtspl] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const { filters, setFilters } = useUrlFilters(OUT_FOR_REPAIR_FILTER_DEFAULTS);
  const { page, dateFrom, dateTo } = filters;
  const { searchInput, setSearchInput, debouncedSearch } = useDebouncedUrlSearch(filters, setFilters);
  const { input: vendorFilter, setInput: setVendorFilter, debounced: debouncedVendor } = useDebouncedUrlField(filters, setFilters, 'vendor');
  const { input: dcFilter, setInput: setDcFilter, debounced: debouncedDc } = useDebouncedUrlField(filters, setFilters, 'dc');
  const specFilters = useMemo(() => {
    const out = { ...EMPTY_SPEC_FILTERS };
    SPEC_FILTER_KEYS.forEach((k) => { out[k] = filters[k] || ''; });
    return out;
  }, [filters]);
  const debouncedSpecParams = useDebouncedSpecParams(specFilters);
  const listReturn = listReturnState(location);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchOutForRepairInventory({
        search: debouncedSearch || undefined,
        vendor: debouncedVendor || undefined,
        dc_number: debouncedDc || undefined,
        page,
        limit: PAGE_SIZE,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        ...debouncedSpecParams,
      });
      setRows(data.data || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load inventory');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, debouncedVendor, debouncedDc, page, dateFrom, dateTo, debouncedSpecParams]);

  useEffect(() => { load(); }, [load]);

  const exportParams = {
    search: debouncedSearch || undefined,
    vendor: debouncedVendor || undefined,
    dc_number: debouncedDc || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    ...debouncedSpecParams,
  };

  const handleExportExcel = async () => {
    try {
      await exportOutForRepairExcel(exportParams);
      toast.success('Excel export started');
    } catch {
      toast.error('Excel export failed');
    }
  };

  const handleExportPdf = async () => {
    try {
      await exportOutForRepairPdf(exportParams);
      toast.success('PDF export started');
    } catch {
      toast.error('PDF export failed');
    }
  };

  const handleReceiveErp = async (row) => {
    if (!window.confirm(`Receive ${row.ttspl_id || row.serial_number} back from repair?\nIt will move to QC Process with a floor ticket.`)) return;
    try {
      const { data } = await receiveErpRepairBack(row.serial_id, { create_floor_ticket: true });
      toast.success(data.message || 'Received to QC Process');
      load();
      invalidateInventoryManagement();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Receive failed');
    }
  };

  return (
    <div className="space-y-3 pb-8">
      <PageHeader
        title="Out for Repair"
        subtitle="Laptops at external repair vendors — includes ERP legacy and vendor-repair DC units"
        icon={Wrench}
        actions={(
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleExportExcel} className="inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs hover:bg-slate-50">
              <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
            </button>
            <button type="button" onClick={handleExportPdf} className="inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs hover:bg-slate-50">
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        )}
      />

      <div className="rounded-lg border border-slate-200 bg-white px-2 py-2 space-y-1.5">
        <div className="flex flex-wrap items-end gap-2">
          <SearchField
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="TTSPL, serial, vendor, DC…"
            className="min-w-[160px] flex-1 max-w-sm"
          />
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <span className="block mb-0.5">Vendor</span>
            <input
              className={INPUT_CLS}
              placeholder="Vendor name"
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
            />
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <span className="block mb-0.5">DC #</span>
            <input
              className={INPUT_CLS}
              placeholder="DC number"
              value={dcFilter}
              onChange={(e) => setDcFilter(e.target.value)}
            />
          </label>
          <DateRangeFilter
            dateFrom={dateFrom}
            dateTo={dateTo}
            onRangeChange={(range) => setFilters(range)}
            onDateFromChange={(v) => setFilters({ dateFrom: v })}
            onDateToChange={(v) => setFilters({ dateTo: v })}
            fromLabel="Out from"
            toLabel="Out to"
          />
          <button
            type="button"
            onClick={() => { load(); invalidateInventoryManagement(); }}
            className="inline-flex items-center gap-1 px-2 py-1.5 border rounded-md text-xs min-h-[32px] hover:bg-slate-50"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        <InventorySpecFilterBar
          filters={specFilters}
          onChange={(next) => setFilters(next)}
          onClear={() => setFilters(Object.fromEntries(SPEC_FILTER_KEYS.map((k) => [k, ''])))}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3">TTSPL</th>
                  <th className="p-3">Serial</th>
                  <th className="p-3">Brand / Model</th>
                  <th className="p-3">Vendor</th>
                  <th className="p-3">DC Number</th>
                  <th className="p-3">Ship</th>
                  <th className="p-3">Out Date</th>
                  <th className="p-3">Days</th>
                  <th className="p-3">Price</th>
                  <th className="p-3">HSN</th>
                  <th className="p-3">E-way Bill</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Remarks</th>
                  {canReceive ? <th className="p-3">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-slate-50/80 align-top">
                    <td className="p-3">
                      <TtsplHistoryLink ttsplId={r.ttspl_id} onOpen={setHistoryTtspl} />
                    </td>
                    <td className="p-3">
                      {r.serial_number && r.ttspl_id ? (
                        <TtsplHistoryLink
                          ttsplId={r.ttspl_id}
                          label={r.serial_number}
                          onOpen={setHistoryTtspl}
                        />
                      ) : (
                        <span className="font-mono text-xs text-slate-500">{r.serial_number || '—'}</span>
                      )}
                    </td>
                    <td className="p-3 text-xs">
                      <div>{[r.brand, r.model].filter(Boolean).join(' / ') || '—'}</div>
                      <div className="text-slate-400 max-w-[160px] truncate">{r.configuration || ''}</div>
                    </td>
                    <td className="p-3 text-xs max-w-[140px]">
                      <div className="font-medium">{r.vendor_name || '—'}</div>
                      <div className="text-slate-400 truncate">{r.vendor_address || ''}</div>
                    </td>
                    <td className="p-3">
                      {r.dc_number ? (
                        <Link
                          to={`/vendor-management/vendor-repair-dc/${encodeURIComponent(r.dc_number)}`}
                          state={listReturn}
                          className="font-mono text-xs text-blue-700 hover:underline"
                        >
                          {r.dc_number}
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">{r.dc_label || '—'}</span>
                      )}
                    </td>
                    <td className="p-3 text-xs">{r.ship_by || r.dispatch_mode || '—'}</td>
                    <td className="p-3 text-xs whitespace-nowrap">{fmtDate(r.out_date)}</td>
                    <td className="p-3 text-xs">{r.days_out != null ? r.days_out : '—'}</td>
                    <td className="p-3 text-xs whitespace-nowrap">
                      {r.price != null ? `₹${Number(r.price).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="p-3 font-mono text-xs">{r.hsn_code || '—'}</td>
                    <td className="p-3 text-xs">
                      {r.eway_bill_number ? (
                        <div>
                          <div className="font-mono">{r.eway_bill_number}</div>
                          <div className="text-slate-400">{fmtDate(r.eway_bill_date)}</div>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="p-3 text-xs">{r.current_status || '—'}</td>
                    <td className="p-3 text-xs max-w-[140px]">{r.remarks || '—'}</td>
                    {canReceive ? (
                      <td className="p-3">
                        {r.source === 'erp' ? (
                          <button
                            type="button"
                            onClick={() => handleReceiveErp(r)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 hover:underline"
                          >
                            Receive to QC
                          </button>
                        ) : (
                          <Link
                            to={`/vendor-management/vendor-repair-dc/${encodeURIComponent(r.dc_number)}`}
                            state={listReturn}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 hover:underline"
                          >
                            Take in
                          </Link>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={canReceive ? 13 : 12} className="p-8 text-center text-slate-500 text-sm">
                      No laptops currently out for repair
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
            onPageChange={(p) => setFilters({ page: p })}
          />
        </>
      )}

      <TtsplHistoryDrawer
        ttsplId={historyTtspl}
        open={Boolean(historyTtspl)}
        onClose={() => setHistoryTtspl(null)}
      />
    </div>
  );
}
