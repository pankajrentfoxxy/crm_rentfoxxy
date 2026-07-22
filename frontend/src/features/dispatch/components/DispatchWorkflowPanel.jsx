import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  acceptDispatchWorkflow,
  fetchDispatchDashboard,
  fetchDispatchWorkflow,
} from '../../../utils/dispatchWorkflowApi';
import usePermission from '../../../hooks/usePermission';

function formatCountdown(dueAt) {
  if (!dueAt) return '—';
  const ms = new Date(dueAt).getTime() - Date.now();
  if (ms <= 0) return 'Overdue';
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m left`;
}

const STATUS_LABELS = {
  waiting_acceptance: 'Waiting acceptance',
  accepted: 'Accepted',
  attaching: 'Attach laptop',
  dispatch_qc: 'Dispatch QC',
  ready_for_dispatch: 'Ready for DC',
  dc_generated: 'DC generated',
  dispatched: 'Dispatched',
  customer_asset: 'Delivered',
  awaiting_purchase: 'Awaiting purchase',
};

export function DispatchWorkflowCard({ soNumber, onRefresh }) {
  const [wf, setWf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const { canEdit } = usePermission();

  const load = useCallback(async () => {
    if (!soNumber) return;
    setLoading(true);
    try {
      const { data } = await fetchDispatchWorkflow(soNumber);
      setWf(data?.workflow || null);
    } catch {
      setWf(null);
    } finally {
      setLoading(false);
    }
  }, [soNumber]);

  useEffect(() => { load(); }, [load]);

  const accept = async () => {
    setAccepting(true);
    try {
      const { data } = await acceptDispatchWorkflow(soNumber);
      if (data.success) {
        toast.success('Order accepted');
        setWf(data.workflow);
        onRefresh?.();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Accept failed');
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!wf) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Dispatch workflow</h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
          {STATUS_LABELS[wf.status] || wf.status}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>
          <dt className="text-slate-400">Assigned</dt>
          <dd>{wf.assigned_user_name || '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Accept by</dt>
          <dd>{formatCountdown(wf.acceptance_due_at)}</dd>
        </div>
        {wf.qc_due_at ? (
          <div>
            <dt className="text-slate-400">QC ETA</dt>
            <dd className={wf.qc_overdue ? 'text-red-600 font-semibold' : ''}>
              {formatCountdown(wf.qc_due_at)}
              {wf.qc_overdue ? ' (overdue)' : ''}
            </dd>
          </div>
        ) : null}
        {wf.purchase_request_status ? (
          <div>
            <dt className="text-slate-400">Purchase request</dt>
            <dd>{wf.purchase_request_status}</dd>
          </div>
        ) : null}
      </dl>
      {wf.status === 'waiting_acceptance' && (canEdit('dispatch_pending_orders') || canEdit('dispatch_workflow')) ? (
        <button
          type="button"
          disabled={accepting}
          onClick={accept}
          className="w-full rounded-lg bg-teal-700 text-white py-2 text-sm font-semibold disabled:opacity-50"
        >
          {accepting ? 'Accepting…' : 'Accept order'}
        </button>
      ) : null}
    </div>
  );
}

export default function DispatchDashboardWidget() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchDispatchDashboard()
      .then(({ data }) => {
        if (!cancelled) setRows(data?.workflows || []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">
        No active dispatch workflows.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-800">Dispatch queue</h3>
        <p className="text-xs text-slate-500">Acceptance SLA and QC ETA</p>
      </div>
      <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
        {rows.map((w) => (
          <li key={w.id} className="px-4 py-3 text-sm">
            <div className="flex justify-between gap-2">
              <span className="font-mono text-blue-700">{w.sales_order_number}</span>
              <span className="text-xs text-slate-500">{STATUS_LABELS[w.status] || w.status}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {w.assigned_user_name || 'Unassigned'} · Accept: {formatCountdown(w.acceptance_due_at)}
              {w.qc_due_at ? ` · QC: ${formatCountdown(w.qc_due_at)}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
