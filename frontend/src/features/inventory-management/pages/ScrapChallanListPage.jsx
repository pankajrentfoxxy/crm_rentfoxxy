import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, Eye, FileText, Loader2, Search } from 'lucide-react';
import { PageHeader, ListPagination, DateRangeFilter } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { downloadScrapChallanPdf, fetchScrapChallanList } from '../scrapChallanApi';

const PAGE_SIZE = 25;

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN');
}

export default function ScrapChallanListPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pdfBusy, setPdfBusy] = useState(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 320);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchScrapChallanList({
        search: debouncedSearch || undefined,
        status: status || undefined,
        page,
        limit: PAGE_SIZE,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setRows(data.data || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load scrap challans');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, page, dateFrom, dateTo]);

  useEffect(() => { setPage(1); }, [debouncedSearch, status, dateFrom, dateTo]);
  useEffect(() => { load(); }, [load]);

  const handlePdf = async (challanNumber) => {
    setPdfBusy(challanNumber);
    try {
      await downloadScrapChallanPdf(challanNumber);
      toast.success('Scrap challan PDF downloaded');
    } catch {
      toast.error('PDF download failed');
    } finally {
      setPdfBusy(null);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Scrap Challans"
        subtitle="One-way disposal of discarded spare parts to scrap buyers"
        icon={FileText}
        actions={(
          <Link
            to="/inventory-management/discarded-parts"
            className="inline-flex items-center gap-1.5 h-9 px-3 border rounded-lg text-sm hover:bg-slate-50"
          >
            ← Discarded Parts
          </Link>
        )}
      />

      <div className="flex flex-wrap gap-2 items-end">
        <div className="relative min-w-[12rem] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm"
            placeholder="Search challan / PRT / recipient…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="border rounded-lg px-3 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="dispatched">Dispatched</option>
        </select>
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onRangeChange={(range) => { setDateFrom(range.dateFrom || ''); setDateTo(range.dateTo || ''); }}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
        />
      </div>

      <div className="overflow-x-auto border rounded-xl bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Challan</th>
              <th className="px-3 py-2">Recipient</th>
              <th className="px-3 py-2">Items</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400"><Loader2 className="inline w-5 h-5 animate-spin" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">No scrap challans</td></tr>
            ) : rows.map((r) => (
              <tr key={r.challan_number} className="border-t hover:bg-slate-50">
                <td className="px-3 py-2 font-mono font-semibold text-blue-700">{r.challan_number}</td>
                <td className="px-3 py-2">{r.recipient_name || '—'}</td>
                <td className="px-3 py-2">{r.item_count || 0}</td>
                <td className="px-3 py-2 capitalize">{String(r.status || '').replace(/_/g, ' ')}</td>
                <td className="px-3 py-2">{fmtDate(r.created_at)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/inventory-management/scrap-challans/${encodeURIComponent(r.challan_number)}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                    >
                      <Eye className="w-3.5 h-3.5" /> Open
                    </Link>
                    <button
                      type="button"
                      disabled={pdfBusy === r.challan_number}
                      onClick={() => handlePdf(r.challan_number)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline disabled:opacity-50"
                    >
                      {pdfBusy === r.challan_number
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Download className="w-3.5 h-3.5" />}
                      Print
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination.totalPages > 1 && (
        <ListPagination
          page={page}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          total={pagination.total}
        />
      )}
    </div>
  );
}
