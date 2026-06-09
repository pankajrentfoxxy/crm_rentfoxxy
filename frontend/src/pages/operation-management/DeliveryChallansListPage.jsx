import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DeliveryChallanDetailModal from '../../features/operation-management/components/DeliveryChallanDetailModal';
import { exportRowsToCsv } from '../../features/operation-management/utils/quotationHelpers';
import { getBackendOrigin } from '../../utils/api';
import { fetchDeliveryChallans } from '../../utils/salesManagementApi';

const PAGE_SIZES = [10, 25, 50, 100];

function pdfUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}/${path.replace(/^\//, '')}`;
}

function formatShipBy(value) {
  if (!value) return '—';
  return value === 'by_hand' ? 'By Hand' : value === 'by_courier' ? 'By Courier' : value;
}

function formatCreatedAt(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function DeliveryChallansListPage() {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [error, setError] = useState('');
  const [detailDc, setDetailDc] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchDeliveryChallans({ search, page: pagination.page, limit: pagination.limit });
      setRows(data.delivery_challans || []);
      if (data.pagination) setPagination((prev) => ({ ...prev, ...data.pagination }));
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load delivery challans');
    } finally {
      setLoading(false);
    }
  }, [search, pagination.page, pagination.limit]);

  useEffect(() => { load(); }, [load]);

  const handleExportCsv = () => {
    exportRowsToCsv(
      'delivery-challans.csv',
      ['S.No', 'DC Number', 'SO Number', 'Customer', 'GST', 'Ship By', 'Delivery Person', 'Status'],
      rows.map((row) => [
        row.id,
        row.dc_number,
        row.sales_order_number,
        row.customer_name,
        row.gst_number || '',
        formatShipBy(row.ship_by),
        row.delivery_person_name || '',
        row.status,
      ])
    );
  };

  const from = rows.length ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const to = (pagination.page - 1) * pagination.limit + rows.length;

  return (
    <div className="max-w-7xl mx-auto p-4">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
          <span aria-hidden>🚚</span>
          Delivery Challan List
        </h1>
        <span className="inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-full bg-gray-800 text-white text-sm font-medium">
          {pagination.total}
        </span>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Show</span>
            <select className="border rounded px-2 py-1" value={pagination.limit}
              onChange={(e) => setPagination((p) => ({ ...p, limit: Number(e.target.value), page: 1 }))}>
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span>Entries</span>
          </div>
          <button type="button" onClick={handleExportCsv} className="px-3 py-1 text-xs border border-orange-400 text-orange-600 rounded">CSV</button>
        </div>

        <div className="px-4 py-2 border-b flex justify-end">
          <label className="text-sm text-gray-600 flex items-center gap-2">
            Search:
            <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (setPagination((p) => ({ ...p, page: 1 })), setSearch(searchInput))}
              className="border rounded px-2 py-1 text-sm w-48" />
            <button type="button" onClick={() => { setPagination((p) => ({ ...p, page: 1 })); setSearch(searchInput); }}
              className="px-3 py-1 border rounded text-xs">Go</button>
          </label>
        </div>

        {error ? <p className="text-red-600 text-sm px-4 py-2">{error}</p> : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">S.No</th>
                <th className="px-4 py-3">Order Details</th>
                <th className="px-4 py-3">Customer Name</th>
                <th className="px-4 py-3">GST Number</th>
                <th className="px-4 py-3">Ship By</th>
                <th className="px-4 py-3">Delivery Person Name</th>
                <th className="px-4 py-3">POD Files</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No data available in table</td></tr>
              ) : rows.map((row) => (
                <tr key={row.dc_number} className="border-t hover:bg-gray-50/50">
                  <td className="px-4 py-3">{row.id}</td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setDetailDc(row.dc_number)} className="text-left">
                      <span className="inline-block px-2.5 py-1 rounded-full text-sm font-semibold text-cyan-800 bg-cyan-100">
                        {row.dc_number}
                      </span>
                      <span className="block text-xs text-gray-500 mt-1">SO: {row.sales_order_number}</span>
                      <span className="block text-xs text-gray-400">Created: {formatCreatedAt(row.created_at)}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3 font-medium text-cyan-700">{row.customer_name || '—'}</td>
                  <td className="px-4 py-3">{row.gst_number || 'N/A'}</td>
                  <td className="px-4 py-3">{formatShipBy(row.ship_by)}</td>
                  <td className="px-4 py-3">{row.delivery_person_name || '—'}</td>
                  <td className="px-4 py-3">
                    {row.file_path ? (
                      <a href={pdfUrl(row.file_path)} target="_blank" rel="noreferrer" className="text-xs text-cyan-700 hover:underline">View</a>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 capitalize">{row.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link to={`/operation-management/delivery-challans/${row.dc_number}/register`}
                        className="text-xs px-2 py-1 rounded border border-teal-200 text-teal-700 hover:bg-teal-50">
                        Register
                      </Link>
                      {row.pdf_path ? (
                        <a href={pdfUrl(row.pdf_path)} target="_blank" rel="noreferrer"
                          className="inline-flex items-center justify-center w-8 h-8 rounded bg-teal-700 text-white text-xs" title="PDF">↓</a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t flex justify-between text-sm text-gray-600">
          <span>Showing {from} to {to} of {pagination.total} entries</span>
          <div className="flex gap-3">
            <button type="button" disabled={pagination.page <= 1} onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
              className="disabled:opacity-40">Previous</button>
            <button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
              className="disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>

      <DeliveryChallanDetailModal dcNumber={detailDc} onClose={() => setDetailDc(null)} />
    </div>
  );
}
