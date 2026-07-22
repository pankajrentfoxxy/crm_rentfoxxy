import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Clock, Loader2, Truck, Wifi, WifiOff } from 'lucide-react';
import usePermission from '../../../hooks/usePermission';
import { acceptDispatchWorkflow } from '../../../utils/dispatchWorkflowApi';
import {
  formatSnoozeUntil,
  getCountdownState,
  isPopupAlertReady,
  isSnoozeActive,
} from '../dispatchAlertUtils';
import { useDispatchRealtime } from '../DispatchRealtimeProvider';
import SoOrderLinesConfigBlock from '../components/SoOrderLinesConfigBlock';
import { salesOrderDetailPath } from '../../sales-pipeline/salesOrderScope';

function soDetailPath(row) {
  const scope = row.order_type === 'sale' || row.order_type === 'sales' ? 'sale' : 'rental';
  return salesOrderDetailPath(row.sales_order_number, scope);
}

const ORDER_TYPE_LABELS = { sale: 'Sales', rental: 'Rental' };
const PRIORITY_LABELS = { critical: 'Critical', high: 'High', normal: 'Normal' };

function formatAssignedAt(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function getSlaState(dueAt) {
  if (!dueAt) return { label: '—', tone: 'muted' };
  const ms = new Date(dueAt).getTime() - Date.now();
  if (ms <= 0) return { label: 'Popup due', tone: 'overdue' };
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const label = `${m}m ${s}s`;
  if (ms > 15 * 60 * 1000) return { label, tone: 'green' };
  if (ms > 5 * 60 * 1000) return { label, tone: 'orange' };
  return { label, tone: 'red' };
}

const SLA_TONE_CLASS = {
  green: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  orange: 'text-amber-700 bg-amber-50 border-amber-200',
  red: 'text-red-700 bg-red-50 border-red-200',
  overdue: 'text-red-800 bg-red-100 border-red-300 font-semibold',
  muted: 'text-slate-500 bg-slate-50 border-slate-200',
};

function SlaCountdown({ dueAt }) {
  const [, tick] = useState(0);
  React.useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const sla = getSlaState(dueAt);
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs tabular-nums ${SLA_TONE_CLASS[sla.tone]}`}>
      <Clock className="w-3 h-3 shrink-0" />
      {sla.label}
    </span>
  );
}

function SnoozeTimeline({ untilAt, remark, acceptanceDueAt }) {
  const [, tick] = useState(0);
  React.useEffect(() => {
    const waitingForPopup = acceptanceDueAt && !isPopupAlertReady({ acceptance_due_at: acceptanceDueAt });
    if (!isSnoozeActive(untilAt) && !waitingForPopup) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [untilAt, acceptanceDueAt]);

  if (!isSnoozeActive(untilAt)) {
    if (acceptanceDueAt && !isPopupAlertReady({ acceptance_due_at: acceptanceDueAt })) {
      const countdown = getCountdownState(acceptanceDueAt);
      return (
        <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs tabular-nums text-sky-800 bg-sky-50 border-sky-200">
          <Clock className="w-3 h-3 shrink-0" />
          Popup in {countdown.label}
        </span>
      );
    }
    return <span className="text-xs text-emerald-700 font-medium">Alert active</span>;
  }

  const countdown = getCountdownState(untilAt);
  return (
    <div className="space-y-1">
      <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs tabular-nums ${
        countdown.tone === 'urgent'
          ? 'text-amber-800 bg-amber-50 border-amber-200'
          : 'text-sky-800 bg-sky-50 border-sky-200'
      }`}>
        <Clock className="w-3 h-3 shrink-0" />
        Alert in {countdown.label}
      </span>
      <p className="text-[11px] text-slate-500">Until {formatSnoozeUntil(untilAt)}</p>
      {remark ? (
        <p className="text-[11px] text-slate-600 italic max-w-xs truncate" title={remark}>{remark}</p>
      ) : null}
    </div>
  );
}

export default function DispatchPendingOrdersPage() {
  const navigate = useNavigate();
  const { canEdit, user } = usePermission();
  const canAccept = canEdit('dispatch_pending_orders') || canEdit('dispatch_workflow');
  const isDispatchUser = user?.role === 'dispatch';
  const { orders, loading, connected, loadInitial, removeOrder } = useDispatchRealtime();
  const [acceptingSo, setAcceptingSo] = useState(null);

  const accept = async (soNumber, orderId, row) => {
    setAcceptingSo(soNumber);
    try {
      const { data } = await acceptDispatchWorkflow(soNumber);
      if (data.success) {
        toast.success('Order accepted — opening sales order');
        removeOrder(orderId, soNumber);
        navigate(soDetailPath(row));
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Accept failed');
    } finally {
      setAcceptingSo(null);
    }
  };

  const emptyMessage = useMemo(() => {
    if (!isDispatchUser) return 'Dispatch Pending Orders are visible to dispatch login only.';
    return 'No orders assigned to you are waiting for acceptance.';
  }, [isDispatchUser]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <Truck className="w-6 h-6 text-sky-700" />
            Pending Orders
          </h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
            Real-time updates via Socket.IO — orders appear immediately; urgent popup after 30 minutes if not accepted.
            {connected ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 text-xs"><Wifi className="w-3.5 h-3.5" /> Live</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-700 text-xs"><WifiOff className="w-3.5 h-3.5" /> Reconnecting…</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={loadInitial}
          disabled={loading}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loading && !orders.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 flex justify-center">
          <Loader2 className="w-7 h-7 animate-spin text-sky-600" />
        </div>
      ) : !orders.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500 text-center">
          {emptyMessage}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">SO Number</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Entity</th>
                  <th className="px-4 py-3 font-semibold">Order Type</th>
                  <th className="px-4 py-3 font-semibold min-w-[220px]">Configuration</th>
                  <th className="px-4 py-3 font-semibold">Assigned Time</th>
                  <th className="px-4 py-3 font-semibold">Popup In</th>
                  <th className="px-4 py-3 font-semibold">Alert / Snooze</th>
                  <th className="px-4 py-3 font-semibold">Priority</th>
                  <th className="px-4 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((row) => {
                  const orderType = ORDER_TYPE_LABELS[row.order_type] || row.order_type || '—';
                  const priority = PRIORITY_LABELS[row.priority] || row.priority || 'Normal';
                  const priorityClass = row.priority === 'critical'
                    ? 'text-red-700 bg-red-50'
                    : row.priority === 'high'
                      ? 'text-amber-700 bg-amber-50'
                      : 'text-slate-600 bg-slate-50';
                  const rowClass = row.sla_breached ? 'bg-red-50/60' : 'hover:bg-slate-50/80';
                  return (
                    <tr key={row.id || row.sales_order_number} className={rowClass}>
                      <td className="px-4 py-3 font-mono">
                        <span className="text-slate-800" title="Open from Sales Orders after you accept">
                          {row.sales_order_number}
                        </span>
                      </td>
                      <td className="px-4 py-3">{row.customer_name || '—'}</td>
                      <td className="px-4 py-3">{row.entity_code || '—'}</td>
                      <td className="px-4 py-3">{orderType}</td>
                      <td className="px-4 py-3 align-top">
                        <SoOrderLinesConfigBlock row={row} compact />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        {formatAssignedAt(row.assigned_at)}
                      </td>
                      <td className="px-4 py-3">
                        <SlaCountdown dueAt={row.acceptance_due_at} />
                      </td>
                      <td className="px-4 py-3">
                        <SnoozeTimeline
                          untilAt={row.alert_snoozed_until}
                          remark={row.last_decline_remark}
                          acceptanceDueAt={row.acceptance_due_at}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${priorityClass}`}>
                          {priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canAccept ? (
                          <button
                            type="button"
                            disabled={acceptingSo === row.sales_order_number}
                            onClick={() => accept(row.sales_order_number, row.id, row)}
                            className="rounded-lg bg-teal-700 text-white px-3 py-1.5 text-xs font-semibold hover:bg-teal-800 disabled:opacity-50"
                          >
                            {acceptingSo === row.sales_order_number ? 'Accepting…' : 'Accept Order'}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">View only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
