import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SalesOrderDetailModal from '../../features/operation-management/components/SalesOrderDetailModal';
import { exportRowsToCsv } from '../../features/operation-management/utils/quotationHelpers';
import { getBackendOrigin } from '../../utils/api';
import { fetchSalesOrders } from '../../utils/salesManagementApi';

const PAGE_SIZES = [10, 25, 50, 100];

function pdfUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}/${path.replace(/^\//, '')}`;
}

function formatCreatedAt(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export default function SalesOrdersListPage() {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [error, setError] = useState('');
  const [detailSalesOrder, setDetailSalesOrder] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchSalesOrders({
        search,
        page: pagination.page,
        limit: pagination.limit,
      });
      setRows(data.sales_orders || []);
      if (data.pagination) setPagination((prev) => ({ ...prev, ...data.pagination }));
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load sales orders');
    } finally {
      setLoading(false);
    }
  }, [search, pagination.page, pagination.limit]);

  useEffect(() => { load(); }, [load]);

  const handleExportCsv = () => {
    const headers = ['S.No', 'Sales Order Number', 'Customer Name', 'GST Number', 'Created At'];
    const dataRows = rows.map((row) => [
      row.id,
      row.sales_order_number,
      row.customer_name,
      row.gst_number || '',
      formatCreatedAt(row.created_at),
    ]);
    exportRowsToCsv('sales-orders.csv', headers, dataRows);
  };

  const handleCopy = () => {
    const text = rows.map((row) =>
      [row.id, row.sales_order_number, row.customer_name, row.gst_number].join('\t')
    ).join('\n');
    navigator.clipboard?.writeText(text);
    setStatusMessage('Copied to clipboard');
  };

  const from = rows.length ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const to = (pagination.page - 1) * pagination.limit + rows.length;

  return (
    <div className="max-w-7xl mx-auto p-4">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
          <span aria-hidden>📋</span>
          Sales Order List
        </h1>
        <span className="inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-full bg-gray-800 text-white text-sm font-medium">
          {pagination.total}
        </span>
        <div className="flex-1" />
        <Link
          to="/operation-management/sales-orders/add"
          className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm hover:bg-teal-800 font-medium whitespace-nowrap"
        >
          + Add SO Without Quotation
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Show</span>
            <select
              className="border border-gray-200 rounded px-2 py-1"
              value={pagination.limit}
              onChange={(e) => setPagination((prev) => ({ ...prev, limit: Number(e.target.value), page: 1 }))}
            >
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            <span>Entries</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {['Copy', 'CSV'].map((label) => (
              <button
                key={label}
                type="button"
                onClick={label === 'Copy' ? handleCopy : handleExportCsv}
                className="px-3 py-1 text-xs border border-orange-400 text-orange-600 rounded hover:bg-orange-50"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 py-2 border-b flex justify-end">
          <label className="text-sm text-gray-600 flex items-center gap-2">
            Search:
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (setPagination((p) => ({ ...p, page: 1 })), setSearch(searchInput))}
              className="border border-gray-200 rounded px-2 py-1 text-sm w-48"
            />
            <button type="button" onClick={() => { setPagination((p) => ({ ...p, page: 1 })); setSearch(searchInput); }}
              className="px-3 py-1 border rounded text-xs">Go</button>
          </label>
        </div>

        {error ? <p className="text-red-600 text-sm px-4 py-2">{error}</p> : null}
        {statusMessage ? <p className="text-emerald-600 text-sm px-4 py-2">{statusMessage}</p> : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">S.No</th>
                <th className="px-4 py-3">Sales Order Number</th>
                <th className="px-4 py-3">Customer Name</th>
                <th className="px-4 py-3">GST Number</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No data available in table</td></tr>
              ) : rows.map((row) => {
                const canCreateDc = Number(row.remaining_qty) > 0;
                const pdf = pdfUrl(row.pdf_path);
                return (
                  <tr key={row.sales_order_number} className="border-t hover:bg-gray-50/50">
                    <td className="px-4 py-3">{row.id}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setDetailSalesOrder(row.sales_order_number)}
                        className="flex flex-col items-start text-left"
                      >
                        <span className="inline-block px-2.5 py-1 rounded-full text-sm font-semibold text-cyan-800 bg-cyan-100 hover:bg-cyan-200">
                          {row.sales_order_number}
                        </span>
                        <span className="text-xs text-gray-500 mt-1 ml-1">
                          Created: {formatCreatedAt(row.created_at)}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium text-cyan-700">{row.customer_name || '--'}</td>
                    <td className="px-4 py-3">{row.gst_number || 'N/A'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {canCreateDc ? (
                          <Link
                            to={`/operation-management/delivery-challans/add?sales_order_number=${encodeURIComponent(row.sales_order_number)}&quotation_number=${encodeURIComponent(row.quotation_number || '')}`}
                            className="text-xs px-3 py-1.5 rounded border border-teal-600 text-teal-700 hover:bg-teal-50"
                          >
                            Create DC
                          </Link>
                        ) : (
                          <span className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-400 cursor-not-allowed">
                            Create DC
                          </span>
                        )}
                        {pdf ? (
                          <a
                            href={pdf}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center w-9 h-9 rounded bg-teal-700 text-white hover:bg-teal-800"
                            title="Download PDF"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <path d="M12.5535 16.5061C12.4114 16.6615 12.2106 16.75 12 16.75C11.7894 16.75 11.5886 16.6615 11.4465 16.5061L7.44648 12.1311C7.16698 11.8254 7.18822 11.351 7.49392 11.0715C7.79963 10.792 8.27402 10.8132 8.55352 11.1189L11.25 14.0682V3C11.25 2.58579 11.5858 2.25 12 2.25C12.4142 2.25 12.75 2.58579 12.75 3V14.0682L15.4465 11.1189C15.726 10.8132 16.2004 10.792 16.5061 11.0715C16.8118 11.351 16.833 11.8254 16.5535 12.1311L12.5535 16.5061Z" fill="currentColor" />
                            </svg>
                          </a>
                        ) : (
                          <span className="inline-flex items-center justify-center w-9 h-9 rounded bg-gray-200 text-gray-400 cursor-not-allowed" title="PDF not available">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <path d="M12.5535 16.5061C12.4114 16.6615 12.2106 16.75 12 16.75C11.7894 16.75 11.5886 16.6615 11.4465 16.5061L7.44648 12.1311C7.16698 11.8254 7.18822 11.351 7.49392 11.0715C7.79963 10.792 8.27402 10.8132 8.55352 11.1189L11.25 14.0682V3C11.25 2.58579 11.5858 2.25 12 2.25C12.4142 2.25 12.75 2.58579 12.75 3V14.0682L15.4465 11.1189C15.726 10.8132 16.2004 10.792 16.5061 11.0715C16.8118 11.351 16.833 11.8254 16.5535 12.1311L12.5535 16.5061Z" fill="currentColor" />
                            </svg>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
          <span>Showing {from} to {to} of {pagination.total} entries</span>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
              className="disabled:opacity-40 hover:text-teal-700"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
              className="disabled:opacity-40 hover:text-teal-700"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <SalesOrderDetailModal
        salesOrderNumber={detailSalesOrder}
        onClose={() => setDetailSalesOrder(null)}
      />
    </div>
  );
}
