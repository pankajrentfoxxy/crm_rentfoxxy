import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import usePermission from '../../hooks/usePermission';
import {
  acceptDispatchWorkflow,
  snoozeDispatchAlert,
} from '../../utils/dispatchWorkflowApi';
import { useDispatchRealtime } from '../../features/dispatch/DispatchRealtimeProvider';
import SoOrderLinesConfigBlock from '../../features/dispatch/components/SoOrderLinesConfigBlock';
import ReadyToRentMatchList from '../../features/dispatch/components/ReadyToRentMatchList';
import { getOrderLines, getTotalQuantity } from '../../features/dispatch/dispatchSoConfigUtils';
import { salesOrderDetailPath } from '../../features/sales-pipeline/salesOrderScope';

const SNOOZE_MINUTES_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
];

const ORDER_TYPE_LABELS = {
  sale: 'Sales',
  rental: 'Rental',
};

function formatAssignedAt(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function getSlaState(dueAt) {
  if (!dueAt) return { label: '—', tone: 'muted' };
  const ms = new Date(dueAt).getTime() - Date.now();
  if (ms <= 0) return { label: 'Overdue', tone: 'overdue' };
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const label = `${m}m ${s}s Remaining`;
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

function SlaBadge({ dueAt }) {
  const [, tick] = useState(0);
  React.useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const sla = getSlaState(dueAt);
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs tabular-nums ${SLA_TONE_CLASS[sla.tone]}`}>
      <Clock className="w-3.5 h-3.5 shrink-0" />
      {sla.label}
    </span>
  );
}

export default function DispatchAssignmentAlert() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { canEdit } = usePermission();
  const canAccept = canEdit('dispatch_pending_orders') || canEdit('dispatch_workflow');
  const {
    enabled,
    alertOrders,
    applyLocalSnooze,
    removeOrder,
  } = useDispatchRealtime();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [remark, setRemark] = useState('');
  const [snoozeMinutes, setSnoozeMinutes] = useState(5);
  const [accepting, setAccepting] = useState(false);
  const [snoozing, setSnoozing] = useState(false);

  const safeIndex = alertOrders.length
    ? Math.min(currentIndex, alertOrders.length - 1)
    : 0;
  const alert = alertOrders[safeIndex] || null;
  const isAssignee = alert && Number(alert.assigned_user_id) === Number(user?.user_id);
  const showModal = enabled && !!alert && isAssignee;

  const handleSnooze = async (snoozeRemark, minutes = snoozeMinutes) => {
    if (!alert || snoozing) return;
    setSnoozing(true);
    try {
      const { data } = await snoozeDispatchAlert(alert.sales_order_number, {
        remark: snoozeRemark,
        snoozeMinutes: minutes,
      });
      const mins = data?.snooze_minutes || minutes;
      if (data?.snoozed_until) {
        applyLocalSnooze(alert.sales_order_number, data.snoozed_until, data.remark);
      }
      toast.success(`Alert snoozed for ${mins} minute${mins === 1 ? '' : 's'}`);
      setRemark('');
      setSnoozeMinutes(5);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not snooze alert');
    } finally {
      setSnoozing(false);
    }
  };

  const handleDefer = async () => {
    const trimmed = remark.trim();
    if (!trimmed) {
      toast.error('Please enter why you cannot accept this order right now');
      return;
    }
    await handleSnooze(trimmed);
  };

  const handleAccept = async () => {
    if (!alert || !canAccept || accepting) return;
    setAccepting(true);
    try {
      const { data } = await acceptDispatchWorkflow(alert.sales_order_number);
      if (data.success) {
        toast.success('Order accepted — opening sales order');
        removeOrder(alert.id, alert.sales_order_number);
        setRemark('');
        const scope = alert.order_type === 'sale' || alert.order_type === 'sales' ? 'sale' : 'rental';
        navigate(salesOrderDetailPath(alert.sales_order_number, scope));
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Accept failed');
    } finally {
      setAccepting(false);
    }
  };

  if (!showModal) return null;

  const orderType = ORDER_TYPE_LABELS[alert.order_type] || alert.order_type || '—';
  const orderLines = getOrderLines(alert);
  const totalQty = getTotalQuantity(orderLines) || alert.quantity;
  const isOverdue = alert.sla_breached
    || (alert.acceptance_due_at && new Date(alert.acceptance_due_at) <= new Date());

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-red-950/40 backdrop-blur-[2px]" aria-hidden="true" />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dispatch-alert-title"
        className="relative flex w-full max-w-6xl max-h-[92vh] flex-col rounded-2xl border-4 border-red-600 bg-white shadow-2xl shadow-red-900/20 overflow-hidden"
      >
        <div className="shrink-0 bg-red-600 px-4 sm:px-5 py-3 sm:py-4 flex items-start gap-3 text-white">
          <div className="rounded-full bg-white/15 p-2 shrink-0">
            <AlertTriangle className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-red-100">Urgent dispatch action</p>
            <h2 id="dispatch-alert-title" className="text-base sm:text-lg font-bold leading-tight mt-0.5">
              {isOverdue ? 'Dispatch acceptance overdue' : 'New sales order assigned'}
            </h2>
            <p className="text-xs sm:text-sm text-red-100 mt-1">
              {isOverdue
                ? 'Acceptance SLA exceeded — accept now or explain why you cannot.'
                : 'Accept this order or tell us why you cannot accept it right now.'}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5 py-4">
          {alertOrders.length > 1 ? (
            <p className="mb-3 text-xs font-medium text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              Alert {safeIndex + 1} of {alertOrders.length} pending acceptance
            </p>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
            <div className="rounded-xl border-2 border-red-100 bg-red-50/40 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-mono text-lg font-bold text-red-800">{alert.sales_order_number}</span>
                <SlaBadge dueAt={alert.acceptance_due_at} />
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Customer</dt>
                  <dd className="font-medium text-slate-900">{alert.customer_name || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Entity</dt>
                  <dd className="font-medium text-slate-900">{alert.entity_code || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Order type</dt>
                  <dd className="font-medium text-slate-900">{orderType}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Quantity</dt>
                  <dd className="font-medium text-slate-900">{totalQty ?? '—'}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-slate-500 mb-1">Configuration</dt>
                  <dd><SoOrderLinesConfigBlock row={alert} /></dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-slate-500">Assigned at</dt>
                  <dd className="font-medium text-slate-900">{formatAssignedAt(alert.assigned_at)}</dd>
                </div>
              </dl>
            </div>

            <ReadyToRentMatchList
              lines={orderLines}
              orderType={alert.order_type}
            />

            <div className="space-y-3">
              <div>
                <label htmlFor="dispatch-snooze-minutes" className="block text-sm font-semibold text-slate-800 mb-1.5">
                  Snooze alert for
                </label>
                <select
                  id="dispatch-snooze-minutes"
                  value={snoozeMinutes}
                  onChange={(e) => setSnoozeMinutes(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  {SNOOZE_MINUTES_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="dispatch-defer-remark" className="block text-sm font-semibold text-slate-800 mb-1.5">
                  Why can&apos;t you accept now? <span className="text-slate-400 font-normal">(required to snooze)</span>
                </label>
                <textarea
                  id="dispatch-defer-remark"
                  rows={3}
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="e.g. On another delivery, laptop not available…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                {canAccept ? (
                  <button
                    type="button"
                    disabled={accepting || snoozing}
                    onClick={handleAccept}
                    className="flex-1 rounded-xl bg-teal-700 text-white py-2.5 text-sm font-bold hover:bg-teal-800 disabled:opacity-50"
                  >
                    {accepting ? 'Accepting…' : 'Accept Order'}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={accepting || snoozing || !remark.trim()}
                  onClick={handleDefer}
                  className="flex-1 rounded-xl border-2 border-red-300 bg-white text-red-700 py-2.5 text-sm font-bold hover:bg-red-50 disabled:opacity-50"
                >
                  {snoozing ? 'Snoozing…' : "Can't Accept Now"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2 text-xs text-slate-500">
            <Link to="/dispatch/pending-orders" className="text-sky-700 hover:underline">
              View all pending orders
            </Link>
            {alertOrders.length > 1 ? (
              <div className="flex gap-1">
                <button type="button" disabled={safeIndex <= 0} onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">Prev</button>
                <button type="button" disabled={safeIndex >= alertOrders.length - 1} onClick={() => setCurrentIndex((i) => Math.min(alertOrders.length - 1, i + 1))} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">Next</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
