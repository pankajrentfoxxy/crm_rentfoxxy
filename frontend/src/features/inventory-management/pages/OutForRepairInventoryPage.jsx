import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, FileSpreadsheet, Loader2, RotateCcw, Search, Wrench } from 'lucide-react';
import { PageHeader, ListPagination, SearchField } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { useAuth } from '../../../context/AuthContext';
import {
  exportOutForRepairExcel,
  exportOutForRepairPdf,
  fetchOutForRepairInventory,
} from '../../floor-pipeline/vendorRepairApi';
import { ticketStatusLabel } from '../../floor-pipeline/floorPipelineUi';
import { invalidateInventoryManagement } from '../inventoryCountsEvents';

const PAGE_SIZE = 25;
const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead']);

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN');
}

export default function OutForRepairInventoryPage() {
  const { user } = useAuth();
  const canReceive = WAREHOUSE_ROLES.has(user?.role);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [dcFilter, setDcFilter] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 320);
  const debouncedVendor = useDebouncedValue(vendorFilter.trim(), 320);
  const debouncedDc = useDebouncedValue(dcFilter.trim(), 320);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchOutForRepairInventory({
        search: debouncedSearch || undefined,
        vendor: debouncedVendor || undefined,
        dc_number: debouncedDc || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setRows(data.data || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load inventory');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, debouncedVendor, debouncedDc, page]);

  useEffect(() => { setPage(1); }, [debouncedSearch, debouncedVendor, debouncedDc]);
  useEffect(() => { load(); }, [load]);

  const exportParams = {
    search: debouncedSearch || undefined,
    vendor: debouncedVendor || undefined,
    dc_number: debouncedDc || undefined,
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

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Out for Repair"
        subtitle="Laptops dispatched to external repair vendors"
        icon={Wrench}
        actions={(
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleExportExcel} className="inline-flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm hover:bg-slate-50">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </button>
            <button type="button" onClick={handleExportPdf} className="inline-flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm hover:bg-slate-50">
              <Download className="w-4 h-4" /> PDF
            </button>
          </div>
        )}
      />

      <div className="flex flex-wrap gap-2">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="TTSPL, serial, vendor, DC…"
          className="min-w-[220px] flex-1 max-w-md"
        />
        <input
          className="rounded-lg border px-3 py-2 text-sm min-w-[160px]"
          placeholder="Filter vendor"
          value={vendorFilter}
          onChange={(e) => setVendorFilter(e.target.value)}
        />
        <input
          className="rounded-lg border px-3 py-2 text-sm min-w-[160px]"
          placeholder="Filter DC number"
          value={dcFilter}
          onChange={(e) => setDcFilter(e.target.value)}
        />
        <button type="button" onClick={() => { load(); invalidateInventoryManagement(); }} className="inline-flex items-center gap-1 px-3 py-2 border rounded-lg text-sm">
          <Search className="w-4 h-4" /> Refresh
        </button>
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
                  <th className="p-3">Configuration</th>
                  <th className="p-3">Ticket</th>
                  <th className="p-3">Vendor</th>
                  <th className="p-3">Vendor Address</th>
                  <th className="p-3">DC Number</th>
                  <th className="p-3">Out Date</th>
                  <th className="p-3">Expected Return</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Remarks</th>
                  {canReceive ? <th className="p-3">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-slate-50/80 align-top">
                    <td className="p-3 font-mono text-xs">{r.ttspl_id || '—'}</td>
                    <td className="p-3 font-mono text-xs">{r.serial_number || '—'}</td>
                    <td className="p-3 text-xs">{[r.brand, r.model].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="p-3 text-xs max-w-[180px]">{r.configuration || '—'}</td>
                    <td className="p-3">
                      <Link to={`/floor-pipeline/tickets/${r.ticket_id}`} className="text-blue-600 font-mono text-xs">
                        #{r.ticket_id}
                      </Link>
                    </td>
                    <td className="p-3 text-xs">{r.vendor_name || '—'}</td>
                    <td className="p-3 text-xs max-w-[160px]">{r.vendor_address || '—'}</td>
                    <td className="p-3">
                      <Link to={`/floor-pipeline/vendor-repair-dc/${encodeURIComponent(r.dc_number)}`} className="text-purple-700 font-mono text-xs hover:underline">
                        {r.dc_number}
                      </Link>
                    </td>
                    <td className="p-3 text-xs whitespace-nowrap">{fmtDate(r.out_date)}</td>
                    <td className="p-3 text-xs whitespace-nowrap">{fmtDate(r.expected_return_date)}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-900">
                        {ticketStatusLabel('out_for_repair')}
                      </span>
                    </td>
                    <td className="p-3 text-xs max-w-[140px]">{r.remarks || '—'}</td>
                    {canReceive ? (
                      <td className="p-3">
                        <Link
                          to={`/floor-pipeline/vendor-repair-dc/${encodeURIComponent(r.dc_number)}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 hover:underline"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Receive Back
                        </Link>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={canReceive ? 13 : 12} className="p-8 text-center text-slate-500">
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
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
