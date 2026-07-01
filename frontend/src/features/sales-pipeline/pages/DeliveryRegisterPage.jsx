import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { KeyRound, Map as MapIcon, CheckCircle2, ExternalLink, Image as ImageIcon, Users, XCircle } from 'lucide-react';
import { ListPagination, SearchField } from '../../../components/ui/primitives';
import { listDeliveryFlow, markRejected } from '../salesPipelineApi';
import { deliveryChallanDetailPath } from '../salesPipelineUtils';
import { DISPATCH_MODE_STYLES, formatDateTime, statusLabel } from '../salesPipelineUtils';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { getBackendOrigin } from '../../../utils/api';
import AdminDeliverModal from '../components/AdminDeliverModal';
import ReturnWarehouseReceiveModal from '../components/ReturnWarehouseReceiveModal';
import PermissionGate from '../../../components/PermissionGate';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'inhouse', label: 'Inhouse' },
  { id: 'courier', label: 'Courier' },
  { id: 'porter', label: 'Porter' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'rejected', label: 'Rejected' },
];

const PAGE_SIZE = 25;

function uploadUrl(p) {
  if (!p) return null;
  if (p.startsWith('http')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/uploads/${p.replace(/^\/?uploads\//, '')}`;
}

export default function DeliveryRegisterPage() {
  const [tab, setTab] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 320);
  const [pagination, setPagination] = useState({
    page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE,
  });
  const [otpModal, setOtpModal] = useState(null);
  const [deliverModal, setDeliverModal] = useState(null);
  const [receiveModal, setReceiveModal] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectRemarks, setRejectRemarks] = useState('');

  const isDelivered = tab === 'delivered';
  const isRejectedTab = tab === 'rejected';

  useEffect(() => { setPage(1); }, [tab, search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listDeliveryFlow({
        status: tab,
        movement: 'outbound', // delivery register = outbound DCs only (no RDC)
        search: search || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setRows(r.data?.items || []);
      setPagination(r.data?.pagination || {
        page: 1, totalPages: 1, total: r.data?.items?.length || 0, limit: PAGE_SIZE,
      });
    } catch {
      toast.error('Failed to load delivery register');
    } finally {
      setLoading(false);
    }
  }, [tab, page, search]);

  useEffect(() => { load(); }, [load]);

  const handleCourierReject = async () => {
    if (!rejectModal || !rejectReason.trim()) {
      toast.error('Rejection reason is required');
      return;
    }
    try {
      await markRejected(rejectModal.dc_number, {
        rejection_reason: rejectReason.trim(),
        rejection_remarks: rejectRemarks.trim() || undefined,
      });
      toast.success('Marked rejected — confirm warehouse return with OTP');
      setRejectModal(null);
      setRejectReason('');
      setRejectRemarks('');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Reject failed');
    }
  };

  const selectTab = (id) => setTab(id);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Delivery Register</h1>
          <p className="text-sm text-gray-500">Track dispatched, in-transit and delivered challans</p>
        </div>
        <PermissionGate section="technician_bucket" action="view">
          <Link
            to="/delivery-register-management/technicians"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100"
          >
            <Users className="w-4 h-4" />
            Delivery Technicians
          </Link>
        </PermissionGate>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => selectTab(t.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${tab === t.id ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search DC #, customer, SO #, GST…"
        />
      </div>

      {!loading && pagination.total > 0 ? (
        <p className="text-sm text-gray-500 mb-3">
          {pagination.total} {isDelivered ? 'delivered ' : isRejectedTab ? 'rejected ' : ''}challan{pagination.total === 1 ? '' : 's'}
        </p>
      ) : null}

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase text-left">
            <tr>
              <th className="px-4 py-3">DC #</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Tech / Courier</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">Dispatched</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">OTP</th>
              <th className="px-4 py-3">{isDelivered ? 'POD' : 'Actions'}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No deliveries in this view.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.dc_number} className={row.status === 'rejected' ? 'bg-red-50/60' : ''}>
                <td className={`px-4 py-3 font-mono ${row.status === 'rejected' ? 'text-red-700 line-through decoration-red-400' : 'text-blue-700'}`}>
                  {row.dc_number}
                  {row.movement_type === 'return' && (
                    <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">RDC</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p>{row.customer_name}</p>
                  <p className="text-xs text-gray-400">{row.customer_phone}</p>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {row.dispatch_mode === 'courier'
                    ? `${row.courier_name || '—'}${row.awb_number ? ` · ${row.awb_number}` : ''}`
                    : row.dispatch_mode === 'porter'
                      ? (row.porter_booking_url
                        ? <a href={row.porter_booking_url} target="_blank" rel="noreferrer" className="text-blue-600 inline-flex items-center gap-1">{row.porter_tracking_id || 'Track'} <ExternalLink className="w-3 h-3" /></a>
                        : (row.porter_tracking_id || '—'))
                      : (row.technician_name || '—')}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${DISPATCH_MODE_STYLES[row.dispatch_mode] || 'bg-gray-100'}`}>
                    {row.dispatch_mode || row.ship_by || '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{formatDateTime(row.dispatched_at)}</td>
                <td className="px-4 py-3">
                  <span className={row.status === 'rejected' ? 'text-red-700 font-medium line-through decoration-red-400' : ''}>
                    {statusLabel(row.status)}
                  </span>
                  {row.rejected_at && <p className="text-[10px] text-red-600">{formatDateTime(row.rejected_at)}</p>}
                  {row.return_to_warehouse_at && <p className="text-[10px] text-emerald-700">WH: {formatDateTime(row.return_to_warehouse_at)}</p>}
                </td>
                <td className="px-4 py-3">
                  {row.otp_verified_at ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">✓ Verified</span>
                  ) : row.otp_code ? (
                    <button type="button" onClick={() => setOtpModal(row)} className="font-mono text-blue-700 inline-flex items-center gap-1">
                      <KeyRound className="w-3.5 h-3.5" />{row.otp_code}
                    </button>
                  ) : row.otp_sent_at ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Sent</span>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {isDelivered ? (
                    <div className="flex gap-2">
                      {uploadUrl(row.pod_photo_url) && (
                        <a href={uploadUrl(row.pod_photo_url)} target="_blank" rel="noreferrer" className="text-xs text-blue-600 inline-flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5" /> Photo</a>
                      )}
                      {uploadUrl(row.esign_url) && (
                        <a href={uploadUrl(row.esign_url)} target="_blank" rel="noreferrer" className="text-xs text-blue-600 inline-flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5" /> E-Sign</a>
                      )}
                      {!row.pod_photo_url && !row.esign_url && <span className="text-xs text-gray-400">{row.pod_type || '—'}</span>}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(row.tech_latitude && row.tech_longitude) && (
                        <a href={`https://www.google.com/maps?q=${row.tech_latitude},${row.tech_longitude}`} target="_blank" rel="noreferrer" className="text-xs text-gray-600 inline-flex items-center gap-1"><MapIcon className="w-3.5 h-3.5" /> Map</a>
                      )}
                      {row.movement_type === 'return' ? (
                        <button type="button" onClick={() => setReceiveModal(row)} className="text-xs text-blue-700 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Warehouse receive</button>
                      ) : row.status === 'rejected' ? (
                        row.return_to_warehouse_at ? (
                          <span className="text-xs text-emerald-700">Returned to QC</span>
                        ) : (
                          <Link
                            to={deliveryChallanDetailPath(row.dc_number)}
                            className="text-xs text-red-700 inline-flex items-center gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Warehouse return
                          </Link>
                        )
                      ) : (
                        <>
                          <button type="button" onClick={() => setDeliverModal(row)} className="text-xs text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Deliver</button>
                          {(row.dispatch_mode === 'courier' || row.ship_by === 'by_courier') && ['in_transit', 'reached', 'shipped'].includes(row.status) && (
                            <PermissionGate section="dispatch_ops" action="edit">
                              <button type="button" onClick={() => { setRejectModal(row); setRejectReason(''); setRejectRemarks(''); }}
                                className="text-xs text-red-700 inline-flex items-center gap-1">
                                <XCircle className="w-3.5 h-3.5" /> Reject
                              </button>
                            </PermissionGate>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
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

      {otpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setOtpModal(null)} aria-label="Close" />
          <div className="relative bg-white rounded-xl p-6 w-full max-w-xs text-center">
            <h3 className="font-semibold mb-2">OTP — {otpModal.dc_number}</h3>
            <p className="text-3xl font-mono font-bold tracking-widest text-blue-700">{otpModal.otp_code}</p>
            <p className="text-xs text-gray-500 mt-2">Sent {formatDateTime(otpModal.otp_sent_at)}</p>
            <button type="button" onClick={() => setOtpModal(null)} className="mt-4 w-full py-2 border rounded-lg text-sm">Close</button>
          </div>
        </div>
      )}

      {deliverModal && (
        <AdminDeliverModal
          dc={deliverModal}
          onClose={() => setDeliverModal(null)}
          onDelivered={load}
        />
      )}

      {receiveModal && (
        <ReturnWarehouseReceiveModal
          dc={receiveModal}
          onClose={() => setReceiveModal(null)}
          onReceived={load}
        />
      )}

      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setRejectModal(null)} aria-label="Close" />
          <div className="relative bg-white rounded-xl p-6 w-full max-w-sm space-y-3">
            <h3 className="font-semibold">Reject Courier Delivery — {rejectModal.dc_number}</h3>
            <p className="text-xs text-gray-500">Mark rejected — laptops return to QC only after warehouse OTP is confirmed.</p>
            <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} placeholder="Rejection reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} placeholder="Warehouse remarks (optional)" value={rejectRemarks} onChange={(e) => setRejectRemarks(e.target.value)} />
            <button type="button" onClick={handleCourierReject} className="w-full py-2 bg-red-600 text-white rounded-lg text-sm">Confirm Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}
