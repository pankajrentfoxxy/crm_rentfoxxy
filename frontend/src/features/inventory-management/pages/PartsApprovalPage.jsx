import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Check, X, ArrowUpRight, PackageSearch } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  fetchWarehousePartQueue,
  approvePartRequest,
  rejectPartRequest,
  escalatePartRequest,
} from '../../floor-pipeline/floorPipelineApi';

const TABS = [
  { id: 'pending', label: 'Pending Approval', statuses: ['pending', 'received'] },
  { id: 'escalated', label: 'Escalated / Procurement', statuses: ['escalated', 'ordered'] },
  { id: 'approved', label: 'Approved (reserved)', statuses: ['approved'] },
];

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  escalated: 'bg-purple-100 text-purple-800',
  ordered: 'bg-blue-100 text-blue-800',
  received: 'bg-teal-100 text-teal-800',
};

export default function PartsApprovalPage() {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [tab, setTab] = useState('pending');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchWarehousePartQueue();
      if (data.success) setRequests(data.requests || []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = {};
    TABS.forEach((t) => { c[t.id] = requests.filter((r) => t.statuses.includes(r.status)).length; });
    return c;
  }, [requests]);

  const visible = useMemo(() => {
    const active = TABS.find((t) => t.id === tab);
    return requests.filter((r) => active.statuses.includes(r.status));
  }, [requests, tab]);

  const approve = async (req) => {
    setBusyId(req.request_id);
    try {
      const { data } = await approvePartRequest(req.request_id, { auto_select: true });
      toast.success(`Approved — ${data.prt_id} reserved`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Approve failed');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (req) => {
    const reason = window.prompt('Reason for rejection:');
    if (!reason || !reason.trim()) return;
    setBusyId(req.request_id);
    try {
      await rejectPartRequest(req.request_id, { reason: reason.trim() });
      toast.success('Request rejected');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Reject failed');
    } finally {
      setBusyId(null);
    }
  };

  const escalate = async (req) => {
    setBusyId(req.request_id);
    try {
      await escalatePartRequest(req.request_id, {});
      toast.success('Escalated to procurement');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Escalate failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <PackageSearch className="w-5 h-5 text-blue-600" />
        <h1 className="text-xl font-bold text-slate-900">Parts Approval Queue</h1>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm rounded-t-lg ${tab === t.id ? 'bg-white border border-b-0 font-semibold text-blue-700' : 'text-slate-600'}`}
          >
            {t.label} <span className="ml-1 text-xs text-slate-400">({counts[t.id] || 0})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-500 py-10 text-center">No requests in this queue.</p>
      ) : (
        <div className="grid gap-3">
          {visible.map((req) => {
            const outOfStock = Number(req.stock_qty || 0) <= 0;
            const busy = busyId === req.request_id;
            return (
              <div key={req.request_id} className="rounded-xl border bg-white shadow-sm p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-blue-700">{req.request_number}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[req.status] || 'bg-slate-100'}`}>{req.status}</span>
                      <span className="text-xs text-slate-500 capitalize">{req.request_type}</span>
                    </div>
                    <p className="font-semibold text-slate-900 mt-1">{req.part_name}</p>
                    {req.request_type === 'upgrade' ? (
                      <p className="text-xs text-blue-600 capitalize">{req.config_field}: {req.old_value || '—'} → {req.new_value}</p>
                    ) : null}
                    <p className="text-xs text-slate-500 mt-1">
                      <span className="font-mono text-slate-700">{req.ttspl_id || '—'}</span>
                      {req.brand ? ` · ${req.brand} ${req.model || ''}` : ''}
                      {' · '}Requested by {req.requested_by_name || '—'}
                      {req.stage_name ? ` · ${req.stage_name}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${outOfStock ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                      {outOfStock ? 'Out of stock' : `In stock: ${req.stock_qty}`}
                    </span>
                    <p className="text-xs text-slate-500 mt-1">₹{parseFloat(req.catalog_cost || 0).toFixed(0)}/unit</p>
                    {req.prt_id ? <p className="text-xs font-mono text-blue-700 mt-1">{req.prt_id}</p> : null}
                  </div>
                </div>

                {req.description ? <p className="text-xs text-slate-600 mt-2 bg-slate-50 rounded p-2">{req.description}</p> : null}

                {req.status === 'approved' ? (
                  <p className="text-xs text-green-700 mt-3">Reserved for technician{req.instance_location ? ` · ${req.instance_location}` : ''}. Awaiting attachment.</p>
                ) : ['escalated', 'ordered'].includes(req.status) ? (
                  <p className="text-xs text-purple-700 mt-3">Sent to procurement{req.spo_id ? ` · SPO #${req.spo_id}` : ''}. Will return here once received.</p>
                ) : (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button type="button" disabled={busy || outOfStock} onClick={() => approve(req)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold disabled:opacity-50">
                      <Check className="w-3.5 h-3.5" /> Approve (auto-pick PRT)
                    </button>
                    <button type="button" disabled={busy} onClick={() => reject(req)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-100 text-red-700 text-xs font-semibold disabled:opacity-50">
                      <X className="w-3.5 h-3.5" /> Reject
                    </button>
                    {outOfStock ? (
                      <button type="button" disabled={busy} onClick={() => escalate(req)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-100 text-purple-700 text-xs font-semibold disabled:opacity-50">
                        <ArrowUpRight className="w-3.5 h-3.5" /> Escalate to Procurement
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
