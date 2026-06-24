import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileText, Image as ImageIcon, RefreshCw, User } from 'lucide-react';
import { getBackendOrigin } from '../../utils/api';
import {
  fetchTechniciansBucketDetails,
  fetchTechniciansBucketMeta,
} from '../../utils/techniciansBucketApi';

const PAGE_SIZES = [10, 25, 50, 100];

const TYPE_COLORS = {
  danger: 'bg-red-100 text-red-800',
  warning: 'bg-amber-100 text-amber-800',
  success: 'bg-green-100 text-green-800',
  primary: 'bg-blue-100 text-blue-800',
};

function uploadUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const origin = getBackendOrigin().replace(/\/$/, '');
  const clean = path.replace(/^\//, '');
  if (clean.startsWith('uploads/')) return `${origin}/${clean}`;
  return `${origin}/uploads/${clean}`;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function SpecBlock({ row }) {
  const title = [row.model_name, row.screen_size].filter(Boolean).join(' | ');
  const sub = [
    row.processor,
    row.generation,
    [row.ram, row.storage].filter(Boolean).join(' | '),
    row.gpu,
  ].filter(Boolean).join(' | ');
  return (
    <div>
      <p className="font-medium text-gray-800 text-sm">{title || '—'}</p>
      {sub ? <p className="text-xs text-gray-500 mt-0.5">{sub}</p> : null}
    </div>
  );
}

export default function TechniciansBucketListPage() {
  const [technicians, setTechnicians] = useState([]);
  const [technicianId, setTechnicianId] = useState('all');
  const [tab, setTab] = useState('assets');
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    fetchTechniciansBucketMeta()
      .then((data) => setTechnicians(data.technicians || []))
      .catch(() => setTechnicians([]));
  }, []);

  const load = useCallback(async () => {
    if (!technicianId) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchTechniciansBucketDetails({
        technician_id: technicianId,
        type: tab,
        search,
        page: pagination.page,
        limit: pagination.limit,
      });
      setRows(data.items || []);
      if (data.pagination) setPagination((prev) => ({ ...prev, ...data.pagination }));
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load bucket list');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [technicianId, tab, search, pagination.page, pagination.limit]);

  useEffect(() => { load(); }, [load]);

  const openPdf = (pdfPath) => {
    const url = uploadUrl(pdfPath);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else window.alert('PDF not available');
  };

  const applySearch = () => {
    setPagination((p) => ({ ...p, page: 1 }));
    setSearch(searchInput.trim());
  };

  const from = rows.length ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const to = (pagination.page - 1) * pagination.limit + rows.length;
  const rowOffset = (pagination.page - 1) * pagination.limit;

  return (
    <div className="max-w-[1400px] mx-auto p-4">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
          <User className="w-6 h-6 text-teal-700" />
          Technician Bucket List
        </h1>
        <button type="button" onClick={load} className="p-1.5 text-gray-500 hover:text-teal-700" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <span className="inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-full bg-gray-800 text-white text-sm font-medium">
          {pagination.total}
        </span>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 mb-4">
        <label className="text-xs font-medium text-gray-600">Select Technician</label>
        <select
          className="mt-1 w-full max-w-md border rounded-lg px-3 py-2 text-sm"
          value={technicianId}
          onChange={(e) => {
            setTechnicianId(e.target.value);
            setPagination((p) => ({ ...p, page: 1 }));
          }}
        >
          <option value="all">-- All Technicians --</option>
          {technicians.map((t) => (
            <option key={t.id} value={String(t.id)}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-2 mb-4 border-b border-gray-200">
        {[
          { key: 'assets', label: 'Assets' },
          { key: 'parts', label: 'Parts' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setPagination((p) => ({ ...p, page: 1 }));
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Show</span>
            <select
              className="border rounded px-2 py-1"
              value={pagination.limit}
              onChange={(e) => setPagination((p) => ({ ...p, limit: Number(e.target.value), page: 1 }))}
            >
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span>Entries</span>
          </div>
          <label className="text-sm text-gray-600 flex items-center gap-2">
            Search:
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              placeholder="Challan, serial, customer, technician..."
              className="border rounded px-2 py-1 text-sm w-56"
            />
            <button type="button" onClick={applySearch} className="px-3 py-1 border rounded text-xs">
              Go
            </button>
            {search ? (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setPagination((p) => ({ ...p, page: 1 }));
                  setSearch('');
                }}
                className="px-3 py-1 border rounded text-xs text-gray-500"
              >
                Clear
              </button>
            ) : null}
          </label>
        </div>

        {error ? <p className="text-red-600 text-sm px-4 py-2">{error}</p> : null}

        <div className="overflow-x-auto">
          {tab === 'assets' ? (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">S.No</th>
                  <th className="px-4 py-3">Serial & Unique No.</th>
                  <th className="px-4 py-3">Challan No.</th>
                  <th className="px-4 py-3">Item Descriptions</th>
                  <th className="px-4 py-3">Delivery Type</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Technician Name</th>
                  <th className="px-4 py-3">Customer Name</th>
                  <th className="px-4 py-3">POD</th>
                  <th className="px-4 py-3">Remark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-500">Loading...</td></tr>
                ) : !rows.length ? (
                  <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-500">No records found</td></tr>
                ) : rows.map((row, i) => (
                  <tr key={row.dc_number} className="hover:bg-gray-50/80 align-top">
                    <td className="px-4 py-3">{rowOffset + i + 1}</td>
                    <td className="px-4 py-3">
                      <ul className="space-y-1">
                        {(row.serial_items || []).map((s, idx) => (
                          <li key={`${s.raw}-${idx}`} className="flex flex-wrap gap-1">
                            <Link
                              to={`/inventory-management/serial-number-status?serial_number=${encodeURIComponent(s.serial)}`}
                              className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 hover:underline"
                            >
                              {s.serial}
                            </Link>
                            {s.unique ? (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800">{s.unique}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openPdf(row.pdf_path)}
                        className="text-amber-600 border-b border-amber-500 hover:text-amber-700 font-medium"
                      >
                        {row.dc_number}
                      </button>
                      <div className="text-xs text-amber-600/80 mt-0.5">{formatDate(row.created_at)}</div>
                    </td>
                    <td className="px-4 py-3"><SpecBlock row={row} /></td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">{row.delivery_type}</span>
                      <div className="text-xs text-cyan-700 mt-1">{row.delivery_person_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <ul className="space-y-1">
                        {(row.type_status || []).map((t) => (
                          <li key={t.name}>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[t.color] || 'bg-gray-100 text-gray-700'}`}>
                              {t.name} ({t.count})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3">{row.delivery_person_name}</td>
                    <td className="px-4 py-3">
                      {row.customer_id ? (
                        <Link
                          to="/lead-crm/customers"
                          className="text-red-600 font-medium hover:underline"
                        >
                          {row.customer_name}
                        </Link>
                      ) : (
                        <span className="text-red-600 font-medium">{row.customer_name || 'N/A'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {(row.pod_files || []).length ? (
                        <div className="flex flex-wrap gap-1">
                          {row.pod_files.map((f) => {
                            const url = uploadUrl(f.startsWith('pod_files/') ? f : `pod_files/${f}`);
                            const ext = f.split('.').pop()?.toLowerCase();
                            const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
                            return (
                              <a
                                key={f}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] border rounded ${
                                  isImg ? 'border-green-600 text-green-700' : ext === 'pdf' ? 'border-red-500 text-red-600' : 'border-slate-600 text-slate-700'
                                }`}
                              >
                                {isImg ? <ImageIcon className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                                View
                              </a>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">No Files</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[180px]">{row.submitted_remark || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">S.No</th>
                  <th className="px-4 py-3">Part Name</th>
                  <th className="px-4 py-3">Serial No.</th>
                  <th className="px-4 py-3">Technician Name</th>
                  <th className="px-4 py-3">Customer Name</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">Loading...</td></tr>
                ) : !rows.length ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">No records found</td></tr>
                ) : rows.map((row, i) => (
                  <tr key={`${row.complaint_id}-${row.serial_number_raw}-${i}`} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">{rowOffset + i + 1}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-800 capitalize">
                        {row.part_name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.serial_number_display && row.serial_number_display !== 'N/A' ? (
                        <Link
                          to={`/inventory-management/serial-number-status?serial_number=${encodeURIComponent(row.serial_number_display)}`}
                          className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800 hover:underline inline-flex items-center gap-1"
                        >
                          {row.serial_number_display}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      ) : (
                        <span className="text-gray-400">N/A</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{row.delivery_person_name}</td>
                    <td className="px-4 py-3">
                      {row.customer_id ? (
                        <Link to="/lead-crm/customers" className="text-red-600 font-medium hover:underline">
                          {row.customer_name}
                        </Link>
                      ) : (
                        <span className="text-red-600 font-medium">{row.customer_name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        row.status === 'New' ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
          <span>Showing {from} to {to} of {pagination.total} entries</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
              className="px-3 py-1 border rounded disabled:opacity-40"
            >
              Previous
            </button>
            <span className="px-2">{pagination.page} / {pagination.totalPages}</span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
              className="px-3 py-1 border rounded disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
