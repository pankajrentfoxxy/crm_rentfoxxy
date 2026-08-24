import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Mail, Phone, RefreshCw, Upload, User } from 'lucide-react';
import UploadPodModal from '../../features/delivery-register-management/components/UploadPodModal';
import { exportRowsToCsv } from '../../features/operation-management/utils/quotationHelpers';
import { getBackendOrigin } from '../../utils/api';
import {
  changeDeliveryPerson,
  fetchDeliveryRegisterList,
} from '../../utils/deliveryRegisterApi';
import { deliveryChallanDetailPath } from '../../features/sales-pipeline/salesPipelineUtils';
import { listReturnState } from '../../hooks/useUrlFilters';

const PAGE_SIZES = [10, 25, 50, 100];

const STATUS_TABS = [
  { key: 'in-transit', label: 'In Transit', path: '/sales-pipeline/delivery-register' },
  { key: 'delivered', label: 'Delivered', path: '/sales-pipeline/delivery-register/delivered' },
  { key: 'rejected', label: 'Rejected', path: '/sales-pipeline/delivery-register/rejected' },
];

const STATUS_META = {
  'in-transit': { apiStatus: 'in_transit', title: 'In Transit' },
  delivered: { apiStatus: 'delivered', title: 'Delivered' },
  rejected: { apiStatus: 'rejected', title: 'Rejected' },
};

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function formatDeliveryType(row) {
  if (row.ship_by === 'by_courier' || row.courier_name) {
    return { type: 'Courier Delivery', person: null };
  }
  return {
    type: 'Hand Delivery',
    person: row.delivery_person_name || row.submitted_name || null,
  };
}

function podFileUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}/uploads/${path.replace(/^\//, '')}`;
}

function CourierModal({ open, onClose, onSubmit }) {
  const [courierName, setCourierName] = useState('');
  const [awbNumber, setAwbNumber] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setCourierName('');
      setAwbNumber('');
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    if (!courierName.trim() || !awbNumber.trim()) {
      setError('Courier name and AWB number are required');
      return;
    }
    onSubmit({ courierName: courierName.trim(), awbNumber: awbNumber.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h3 className="text-lg font-semibold">Courier Details</h3>
        <div>
          <label className="text-xs font-medium text-gray-600">Courier Name</label>
          <input required className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={courierName} onChange={(e) => setCourierName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">AWB Number</label>
          <input required className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={awbNumber} onChange={(e) => setAwbNumber(e.target.value)} />
        </div>
        {error ? <p className="text-red-600 text-sm">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm">Submit</button>
        </div>
      </form>
    </div>
  );
}

export default function DeliveryRegisterListPage() {
  const location = useLocation();
  const routeStatus = location.pathname.split('/').pop() || 'in-transit';
  const meta = STATUS_META[routeStatus] || STATUS_META['in-transit'];
  const isInTransit = routeStatus === 'in-transit';

  const [rows, setRows] = useState([]);
  const [deliveryPersons, setDeliveryPersons] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [error, setError] = useState('');
  const [podRow, setPodRow] = useState(null);
  const [courierTarget, setCourierTarget] = useState(null);
  const [actionMsg, setActionMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchDeliveryRegisterList(meta.apiStatus, {
        search,
        page: pagination.page,
        limit: pagination.limit,
      });
      setRows(data.items || []);
      setDeliveryPersons(data.delivery_persons || []);
      if (data.pagination) setPagination((prev) => ({ ...prev, ...data.pagination }));
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load delivery register');
    } finally {
      setLoading(false);
    }
  }, [meta.apiStatus, search, pagination.page, pagination.limit]);

  useEffect(() => { load(); }, [load]);

  const handleTakeAction = async (row, value) => {
    if (!value) return;
    if (value === 'by_courier') {
      setCourierTarget(row);
      return;
    }
    setActionMsg('');
    try {
      await changeDeliveryPerson({
        dc_number: row.dc_number,
        delivery_person_id: value,
        ship_by: 'by_hand',
      });
      setActionMsg('Delivery person updated');
      load();
    } catch (e) {
      setActionMsg(e.response?.data?.message || 'Update failed');
    }
  };

  const submitCourier = async ({ courierName, awbNumber }) => {
    if (!courierTarget) return;
    try {
      await changeDeliveryPerson({
        dc_number: courierTarget.dc_number,
        delivery_person_id: 'by_courier',
        ship_by: 'by_courier',
        courier_name: courierName,
        awb_number: awbNumber,
      });
      setCourierTarget(null);
      setActionMsg('Courier details saved');
      load();
    } catch (e) {
      setActionMsg(e.response?.data?.message || 'Update failed');
    }
  };

  const handleExportCsv = () => {
    exportRowsToCsv(
      `delivery-register-${routeStatus}.csv`,
      ['S.No', 'Challan', 'Customer', 'Total', 'Delivered', 'Rejected', 'Branch', 'Delivery Type', 'Courier', 'AWB'],
      rows.map((row, i) => {
        const dt = formatDeliveryType(row);
        return [
          i + 1,
          row.dc_number,
          row.customer_name,
          row.total_products,
          row.delivered_count,
          row.rejected_count,
          row.branch || '',
          dt.type,
          row.courier_name || '',
          row.awb_number || '',
        ];
      })
    );
  };

  const from = rows.length ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const to = (pagination.page - 1) * pagination.limit + rows.length;

  const currentPersonValue = (row) => {
    if (row.ship_by === 'by_courier' || (row.courier_name && !row.delivery_person_id)) return 'by_courier';
    if (row.delivery_person_id) return String(row.delivery_person_id);
    return '';
  };

  return (
    <div className="max-w-[1400px] mx-auto p-4">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
          View Delivery Register
          <span className="text-base font-normal text-gray-500">({meta.title})</span>
        </h1>
        <button type="button" onClick={load} className="p-1.5 text-gray-500 hover:text-teal-700" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <span className="inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-full bg-gray-800 text-white text-sm font-medium">
          {pagination.total}
        </span>
      </div>

      {actionMsg ? <p className="text-green-700 text-sm mb-2">{actionMsg}</p> : null}

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.key}
            to={t.path}
            className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
              routeStatus === t.key
                ? 'bg-teal-700 text-white border-teal-700'
                : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300'
            }`}
          >
            {t.label}
          </Link>
        ))}
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
                <th className="px-4 py-3">Challan Number</th>
                <th className="px-4 py-3">Customer Details</th>
                <th className="px-4 py-3">Total Products</th>
                <th className="px-4 py-3">Delivered Products</th>
                <th className="px-4 py-3">Rejected Products</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Delivery Type</th>
                <th className="px-4 py-3">Courier</th>
                <th className="px-4 py-3">AWB No.</th>
                <th className="px-4 py-3">Created By</th>
                {isInTransit ? <th className="px-4 py-3">Take Action</th> : null}
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={isInTransit ? 13 : 12} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={isInTransit ? 13 : 12} className="px-4 py-8 text-center text-gray-500">No records found</td></tr>
              ) : rows.map((row, idx) => {
                const dt = formatDeliveryType(row);
                const files = (() => {
                  try {
                    const raw = row.file_path;
                    if (!raw) return [];
                    return typeof raw === 'string' ? JSON.parse(raw) : raw;
                  } catch { return []; }
                })();

                return (
                  <tr key={row.dc_number} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">{from + idx}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={deliveryChallanDetailPath(row.dc_number)}
                        state={listReturnState(location)}
                        className="text-cyan-700 font-medium hover:underline"
                      >
                        {row.dc_number}
                      </Link>
                      <div className="text-xs text-gray-500">{formatDate(row.created_at)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs space-y-1">
                      <div className="flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-gray-400" />{row.customer_name}</div>
                      {row.email ? <div className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-gray-400" />{row.email}</div> : null}
                      {row.customer_phone ? <div className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-gray-400" />{row.customer_phone}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-red-600 font-semibold">{row.total_products}</td>
                    <td className="px-4 py-3 text-green-600 font-semibold">{row.delivered_count}</td>
                    <td className="px-4 py-3 text-green-600 font-semibold">{row.rejected_count}</td>
                    <td className="px-4 py-3">{row.branch || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-teal-700">{dt.type}</span>
                      {dt.person ? <div className="text-xs text-red-600">{dt.person}</div> : null}
                    </td>
                    <td className="px-4 py-3">{row.courier_name ? row.courier_name.replace(/_/g, ' ') : '—'}</td>
                    <td className="px-4 py-3">{row.awb_number || '—'}</td>
                    <td className="px-4 py-3">Admin</td>
                    {isInTransit ? (
                      <td className="px-4 py-3 min-w-[140px]">
                        <select
                          className="border rounded px-2 py-1 text-xs w-full max-w-[160px]"
                          value={currentPersonValue(row)}
                          onChange={(e) => handleTakeAction(row, e.target.value)}
                        >
                          <option value="">Please Select</option>
                          <option value="by_courier">By Courier</option>
                          {deliveryPersons.map((p) => (
                            <option key={`${p.source}-${p.id}`} value={String(p.id)}>{p.name}</option>
                          ))}
                        </select>
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      {isInTransit ? (
                        <button type="button" onClick={() => setPodRow(row)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 border border-cyan-600 text-cyan-700 rounded text-xs hover:bg-cyan-50">
                          <Upload className="w-3.5 h-3.5" /> POD
                        </button>
                      ) : (
                        <div className="space-y-1 text-xs">
                          {row.submitted_name ? <div className="text-red-600">{row.submitted_name}</div> : null}
                          {files.length ? (
                            <div className="flex flex-wrap gap-1">
                              {files.map((f) => (
                                <a key={f} href={podFileUrl(f)} target="_blank" rel="noreferrer"
                                  className="text-cyan-700 underline">File</a>
                              ))}
                            </div>
                          ) : <span className="text-gray-400">No Files</span>}
                          {row.submitted_remark ? <div className="text-gray-600 max-w-[200px] truncate" title={row.submitted_remark}>{row.submitted_remark}</div> : null}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
          <span>Showing {from} to {to} of {pagination.total} entries</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pagination.page <= 1}
              onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
              className="px-3 py-1 border rounded disabled:opacity-40">Previous</button>
            <span className="px-2">{pagination.page} / {pagination.totalPages}</span>
            <button type="button" disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
              className="px-3 py-1 border rounded disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>

      <UploadPodModal
        open={!!podRow}
        row={podRow}
        deliveryPersons={deliveryPersons}
        onClose={() => setPodRow(null)}
        onSuccess={load}
      />

      <CourierModal
        open={!!courierTarget}
        onClose={() => setCourierTarget(null)}
        onSubmit={submitCourier}
      />
    </div>
  );
}
