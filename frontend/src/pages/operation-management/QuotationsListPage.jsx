import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QuotationDetailModal from '../../features/operation-management/components/QuotationDetailModal';
import { exportRowsToCsv } from '../../features/operation-management/utils/quotationHelpers';
import { getBackendOrigin } from '../../utils/api';
import { fetchQuotations, updateQuotationStatus } from '../../utils/salesManagementApi';

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

const PAGE_SIZES = [10, 25, 50, 100];

function pdfUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}/${path.replace(/^\//, '')}`;
}

export default function QuotationsListPage() {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [error, setError] = useState('');
  const [detailQuotation, setDetailQuotation] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchQuotations({
        search,
        page: pagination.page,
        limit: pagination.limit,
      });
      setRows(data.quotations || []);
      if (data.pagination) setPagination((prev) => ({ ...prev, ...data.pagination }));
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load quotations');
    } finally {
      setLoading(false);
    }
  }, [search, pagination.page, pagination.limit]);

  useEffect(() => { load(); }, [load]);

  const onStatusChange = async (quotationNumber, status) => {
    try {
      await updateQuotationStatus(quotationNumber, status);
      setStatusMessage('Status updated');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Status update failed');
    }
  };

  const handleExportCsv = () => {
    const headers = ['S.No', 'Quotation Number', 'Customer Name', 'GST Number', 'Status', 'Status Updated By'];
    const dataRows = rows.map((row, index) => [
      (pagination.page - 1) * pagination.limit + index + 1,
      row.quotation_number,
      row.customer_name,
      row.gst_number || '',
      row.status,
      row.status_updated_by_name || '',
    ]);
    exportRowsToCsv('quotations.csv', headers, dataRows);
  };

  const handleCopy = () => {
    const text = rows.map((row, i) =>
      [(pagination.page - 1) * pagination.limit + i + 1, row.quotation_number, row.customer_name, row.gst_number, row.status].join('\t')
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
          <span aria-hidden>📝</span>
          Quotation List
        </h1>
        <span className="inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-full bg-gray-800 text-white text-sm font-medium">
          {pagination.total}
        </span>
        <div className="flex-1" />
        <Link
          to="/operation-management/quotations/add"
          className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm hover:bg-teal-800 font-medium"
        >
          + Add New Quotation
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
                <th className="px-4 py-3">Quotation Number</th>
                <th className="px-4 py-3">Customer Name</th>
                <th className="px-4 py-3">GST Number</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Take Action</th>
                <th className="px-4 py-3">Status Updated By</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No data available in table</td></tr>
              ) : rows.map((row, index) => (
                <tr key={row.quotation_number} className="border-t hover:bg-gray-50/50">
                  <td className="px-4 py-3">{(pagination.page - 1) * pagination.limit + index + 1}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setDetailQuotation(row.quotation_number)}
                      className="inline-block px-2.5 py-1 rounded-full text-sm font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200"
                    >
                      {row.quotation_number}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-medium text-cyan-700">{row.customer_name || '--'}</td>
                  <td className="px-4 py-3">{row.gst_number || '--'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_STYLES[row.status] || 'bg-gray-100'}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={row.status}
                      onChange={(e) => onStatusChange(row.quotation_number, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1.5 min-w-[110px]"
                    >
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{row.status_updated_by_name || '--'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2 items-center">
                      {row.status === 'approved' && Number(row.remaining_qty) > 0 ? (
                        <Link
                          to={`/operation-management/sales-orders/add?quotation_number=${row.quotation_number}`}
                          className="text-xs px-2 py-1 rounded bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100"
                        >
                          Create SO
                        </Link>
                      ) : null}
                      {row.pdf_path ? (
                        <a
                          href={pdfUrl(row.pdf_path)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 border hover:bg-gray-200"
                        >
                          PDF
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
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

      <QuotationDetailModal
        quotationNumber={detailQuotation}
        onClose={() => setDetailQuotation(null)}
      />
    </div>
  );
}
