import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { exportRowsToCsv } from '../../features/operation-management/utils/quotationHelpers';
import { getBackendOrigin } from '../../utils/api';
import { deleteCustomerManagement, fetchCustomerManagementList } from '../../utils/customerManagementApi';
import {
  CUSTOMER_TYPE_OPTIONS,
  customerTypeBadgeClass,
  customerTypeLabel,
} from '../../utils/customerType';

const PAGE_SIZES = [10, 25, 50, 100];

function fileUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}/${path.replace(/^\//, '')}`;
}

function fileKind(filename) {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

export default function CustomersListPage() {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [customerType, setCustomerType] = useState('all');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchCustomerManagementList({
        search,
        page: pagination.page,
        limit: pagination.limit,
        customer_type: customerType === 'all' ? undefined : customerType,
      });
      setRows(data.customers || []);
      if (data.pagination) setPagination((prev) => ({ ...prev, ...data.pagination }));
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [search, customerType, pagination.page, pagination.limit]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (customerId, name) => {
    if (!window.confirm(`Delete customer "${name}"? This cannot be undone.`)) return;
    try {
      await deleteCustomerManagement(customerId);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Delete failed');
    }
  };

  const handleExportCsv = () => {
    exportRowsToCsv(
      'customers.csv',
      ['S.No', 'Customer Name', 'Email', 'Contact Person', 'PAN', 'GST', 'Security Amount'],
      rows.map((row, i) => [
        (pagination.page - 1) * pagination.limit + i + 1,
        row.customer_name,
        row.email,
        row.contact_person_name,
        row.pan_card_number || '',
        row.gst_number || '',
        row.total_security_amount,
      ])
    );
  };

  const from = rows.length ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const to = (pagination.page - 1) * pagination.limit + rows.length;

  return (
    <div className="max-w-7xl mx-auto p-4">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
          <span aria-hidden>👥</span>
          Customer List
        </h1>
        <span className="inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-full bg-gray-800 text-white text-sm font-medium">
          {pagination.total}
        </span>
        <div className="flex-1" />
        <Link
          to="/customer-management/customers/add"
          className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm hover:bg-teal-800 font-medium"
        >
          + Add New Customer
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
          <button type="button" onClick={handleExportCsv} className="px-3 py-1 text-xs border border-orange-400 text-orange-600 rounded hover:bg-orange-50">
            CSV
          </button>
        </div>

        <div className="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-3">
          <label className="text-sm text-gray-600 flex items-center gap-2">
            Customer Type:
            <select
              className="border border-gray-200 rounded px-2 py-1 text-sm"
              value={customerType}
              onChange={(e) => {
                setCustomerType(e.target.value);
                setPagination((p) => ({ ...p, page: 1 }));
              }}
            >
              <option value="all">All</option>
              {CUSTOMER_TYPE_OPTIONS.filter((o) => o.value !== 'both').map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
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

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">S.No</th>
                <th className="px-4 py-3">Customer Details</th>
                <th className="px-4 py-3">Contact Person Details</th>
                <th className="px-4 py-3">PAN Number</th>
                <th className="px-4 py-3">GST Number</th>
                <th className="px-4 py-3">Security Amount</th>
                <th className="px-4 py-3">Files</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No data available in table</td></tr>
              ) : rows.map((row, index) => (
                <tr key={row.customer_id} className="border-t hover:bg-gray-50/50">
                  <td className="px-4 py-3">{(pagination.page - 1) * pagination.limit + index + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-[200px]">
                      {row.profile ? (
                        <img src={fileUrl(row.profile)} alt="" className="w-12 h-12 rounded object-cover border" />
                      ) : (
                        <div className="w-12 h-12 rounded bg-gray-100 border flex items-center justify-center text-gray-400 text-xs">N/A</div>
                      )}
                      <div>
                        <div className="font-semibold text-cyan-700 flex items-center gap-2 flex-wrap">
                          {row.customer_name}
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${customerTypeBadgeClass(row.customer_type)}`}>
                            {customerTypeLabel(row.customer_type)}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">{row.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.contact_person_name || '—'}</div>
                    <div className="text-xs text-gray-500">{row.contact_person_number || row.customer_number || '—'}</div>
                  </td>
                  <td className="px-4 py-3">{row.pan_card_number || 'N/A'}</td>
                  <td className="px-4 py-3">{row.gst_number || 'N/A'}</td>
                  <td className="px-4 py-3">
                    {Number(row.total_security_amount) > 0
                      ? `₹${Number(row.total_security_amount).toFixed(2)}`
                      : '0.00'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(row.upload_docs || []).length === 0 ? (
                        <span className="text-gray-400 text-xs">No Files</span>
                      ) : (row.upload_docs || []).map((doc, i) => {
                        const kind = fileKind(doc);
                        const url = fileUrl(doc);
                        return (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className={`text-[10px] px-2 py-1 rounded border ${
                              kind === 'image' ? 'border-green-600 text-green-700' :
                              kind === 'pdf' ? 'border-red-500 text-red-600' :
                              'border-slate-700 text-slate-700'
                            }`}
                          >
                            {kind === 'image' ? 'Image' : kind === 'pdf' ? 'PDF' : 'File'}
                          </a>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(row.customer_id, row.customer_name)}
                        className="p-1.5 border border-red-200 text-red-600 rounded hover:bg-red-50"
                        title="Delete"
                      >
                        ✕
                      </button>
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
            <button type="button" disabled={pagination.page <= 1} onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
              className="disabled:opacity-40 hover:text-teal-700">Previous</button>
            <button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
              className="disabled:opacity-40 hover:text-teal-700">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
