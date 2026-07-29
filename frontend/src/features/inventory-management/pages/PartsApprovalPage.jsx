import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowUpRight, ShoppingCart, RefreshCw, Package, Search, QrCode } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getWarehouseQueue,
  approvePartRequest,
  rejectPartRequest,
  escalatePartRequest,
} from '../../floor-pipeline/partRequestsApi';
import ApprovePartRequestModal from '../components/ApprovePartRequestModal';

const TABS = [
  { id: 'pending', label: 'Pending Approval', statuses: ['pending'] },
  { id: 'escalated', label: 'Escalated', statuses: ['escalated', 'ordered'] },
  { id: 'done', label: 'Ordered / Received', statuses: ['received', 'approved'] },
];

const STATUS_COLORS = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  escalated: 'bg-purple-100 text-purple-800',
  ordered: 'bg-blue-100 text-blue-800',
  received: 'bg-teal-100 text-teal-800',
  rejected: 'bg-red-100 text-red-800',
};

const REJECT_REASONS = [
  'Wrong part specified',
  'Part not needed — issue resolved differently',
  'Duplicate request',
  'Other',
];

export default function PartsApprovalPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectModal, setRejectModal] = useState(null);
  const [serialModal, setSerialModal] = useState(null);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await getWarehouseQueue();
      setRequests(data.requests || []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const visibleRequests = useMemo(() => {
    const statuses = TABS.find((t) => t.id === tab)?.statuses || [];
    const q = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (!statuses.includes(r.status)) return false;
      if (!q) return true;
      return (
        String(r.request_number || '').toLowerCase().includes(q) ||
        String(r.part_name || '').toLowerCase().includes(q) ||
        String(r.ttspl_id || '').toLowerCase().includes(q) ||
        String(r.requester_name || '').toLowerCase().includes(q) ||
        String(r.stage_name || '').toLowerCase().includes(q)
      );
    });
  }, [requests, tab, search]);

  const tabCount = (id) =>
    requests.filter((r) => TABS.find((t) => t.id === id)?.statuses.includes(r.status)).length;

  const confirmApprove = async (payload) => {
    if (!serialModal) return;
    setBusy(true);
    try {
      const body = payload.instance_id
        ? { ...payload }
        : { ...payload, auto_select: true };
      const { data } = await approvePartRequest(serialModal.request_id, body);
      toast.success(data.message || `Approved — ${data.prt_id || 'unit assigned'}`);
      setSerialModal(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Approve failed');
    } finally {
      setBusy(false);
    }
  };

  const reject = async (reason) => {
    if (!rejectModal) return;
    setBusy(true);
    try {
      await rejectPartRequest(rejectModal.request_id, { reason });
      toast.success('Request rejected');
      setRejectModal(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Reject failed');
    } finally {
      setBusy(false);
    }
  };

  const escalate = async (req) => {
    setBusy(true);
    try {
      await escalatePartRequest(req.request_id, {});
      toast.success('Escalated to procurement');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Escalate failed');
    } finally {
      setBusy(false);
    }
  };

  const createSpoForRequest = (req) => {
    navigate('/vendor-management/spare-parts-po', {
      state: {
        openForm: true,
        prefill: {
          part_name: req.part_name,
          category: req.category || req.part_type,
          quantity: req.quantity || 1,
          request_id: req.request_id,
          request_number: req.request_number,
          ttspl_id: req.ttspl_id,
        },
      },
    });
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-600" />
            Parts Approval Queue
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Approve, reject, or escalate floor part requests to procurement
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-2 text-sm"
          placeholder="Search request #, part, TTSPL, requester…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex gap-1 border-b mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {tabCount(t.id) > 0 && (
              <span
                className={`ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                  t.id === 'pending'
                    ? 'bg-amber-100 text-amber-800'
                    : t.id === 'escalated'
                    ? 'bg-purple-100 text-purple-800'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {tabCount(t.id)}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : visibleRequests.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400">
            {tab === 'pending'
              ? 'No pending part requests'
              : tab === 'escalated'
              ? 'No requests awaiting procurement'
              : 'No ordered/received requests'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRequests.map((req) => {
            const outOfStock = Number(req.stock_qty || 0) <= 0;
            const isEscalated = ['escalated', 'ordered'].includes(req.status);

            return (
              <div key={req.request_id} className="bg-white border rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-blue-700 font-medium">
                        {req.request_number}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                          req.request_type === 'upgrade'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-orange-100 text-orange-800'
                        }`}
                      >
                        {req.request_type}
                      </span>
                      {req.ttspl_id && (
                        <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                          {req.ttspl_id}
                        </span>
                      )}
                      <span
                        className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_COLORS[req.status] || 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>

                    <p className="font-semibold text-gray-900 mt-1 text-base">{req.part_name}</p>

                    {req.request_type === 'upgrade' && req.config_field && (
                      <p className="text-sm text-blue-700 mt-0.5">
                        ⬆ {req.config_field}: {req.old_value} → {req.new_value}
                      </p>
                    )}

                    <p className="text-sm text-gray-500 mt-1">
                      Requested by {req.requester_name}
                      {req.stage_name && ` · Stage: ${req.stage_name}`}
                      {req.brand && ` · ${req.brand} ${req.model || ''}`}
                    </p>

                    {req.description && (
                      <p className="text-xs text-gray-400 mt-1 italic">"{req.description}"</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-3">
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                      outOfStock
                        ? 'bg-red-50 text-red-700 border border-red-100'
                        : Number(req.stock_qty) <= 5
                        ? 'bg-amber-50 text-amber-700 border border-amber-100'
                        : 'bg-green-50 text-green-700 border border-green-100'
                    }`}
                  >
                    {outOfStock ? '⚠ Out of stock' : `In Stock: ${req.stock_qty}`}
                  </span>
                  {!outOfStock && (
                    <span className="text-xs text-gray-500">
                      ₹{req.catalog_cost || req.instance_cost || 0}/unit
                    </span>
                  )}
                  {req.location_code && (
                    <span className="text-xs text-gray-400">📍 {req.location_code}</span>
                  )}
                  {req.prt_id && (
                    <span className="font-mono text-xs text-teal-700 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded">
                      {req.prt_id}
                    </span>
                  )}
                </div>

                {req.old_part_expected && (
                  <p className="mt-2 text-xs text-gray-500">
                    {req.old_part_expected === 'yes'
                      ? `Old part expected back: ${req.old_part_catalog_name || req.old_part_name || 'part'}`
                      : 'No old part on this laptop'}
                    {req.old_part_prt_id ? ` · returned as ${req.old_part_prt_id}` : ''}
                  </p>
                )}

                <div className="mt-3 pt-3 border-t flex flex-wrap gap-2">
                  {req.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        disabled={busy || outOfStock}
                        onClick={() => setSerialModal(req)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold disabled:opacity-50 hover:bg-green-700"
                      >
                        <QrCode className="w-4 h-4" />
                        {outOfStock ? 'Cannot approve (out of stock)' : 'Scan & Approve'}
                      </button>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRejectModal(req)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-red-200 text-red-700 text-sm font-semibold hover:bg-red-50 disabled:opacity-50"
                      >
                        <X className="w-4 h-4" /> Reject
                      </button>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => escalate(req)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-purple-200 text-purple-700 text-sm font-semibold hover:bg-purple-50 disabled:opacity-50"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                        {outOfStock ? 'Send to Procurement' : 'Escalate to Procurement'}
                      </button>
                    </>
                  )}

                  {isEscalated && (
                    <>
                      {req.spo_id ? (
                        <div className="flex items-center gap-3 w-full">
                          <span className="text-sm text-purple-700 font-medium">
                            Linked to SPO #{req.spo_id}
                          </span>
                          <span className="text-xs text-gray-400">
                            Will auto-approve when received
                          </span>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => createSpoForRequest(req)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                          >
                            <ShoppingCart className="w-4 h-4" />
                            Create Spare Parts PO
                          </button>
                          <span className="text-xs text-gray-400 self-center">
                            or wait for procurement to raise one
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rejectModal && (
        <RejectModal
          request={rejectModal}
          onReject={reject}
          onClose={() => setRejectModal(null)}
          busy={busy}
        />
      )}

      <ApprovePartRequestModal
        open={!!serialModal}
        request={serialModal}
        busy={busy}
        onClose={() => setSerialModal(null)}
        onConfirm={confirmApprove}
      />
    </div>
  );
}

function RejectModal({ request, onReject, onClose, busy }) {
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [custom, setCustom] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-xl">
        <h3 className="font-semibold text-gray-900 mb-1">Reject Part Request</h3>
        <p className="text-sm text-gray-500 mb-4">
          {request.request_number} · {request.part_name}
        </p>
        <div className="space-y-2 mb-4">
          {REJECT_REASONS.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
              />
              {r}
            </label>
          ))}
          {reason === 'Other' && (
            <textarea
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              rows={2}
              placeholder="Describe the reason…"
              className="w-full border rounded-lg px-3 py-2 text-sm mt-2"
            />
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onReject(reason === 'Other' ? custom || reason : reason)}
            className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Rejecting…' : 'Confirm Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}
