import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock } from 'lucide-react';
import SoOrderLinesConfigBlock from '../../features/dispatch/components/SoOrderLinesConfigBlock';

export const DISPATCH_QC_SNOOZE_MINUTES_OPTIONS = [
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

function formatStartedAt(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function getQcSlaState(dueAt) {
  if (!dueAt) return { label: '—', tone: 'muted' };
  const ms = Date.now() - new Date(dueAt).getTime();
  if (ms <= 0) return { label: 'Just due', tone: 'overdue' };
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return { label: `${m}m ${s}s past due`, tone: 'overdue' };
}

const SLA_TONE_CLASS = {
  overdue: 'text-red-800 bg-red-100 border-red-300 font-semibold',
  muted: 'text-slate-500 bg-slate-50 border-slate-200',
};

function QcSlaBadge({ dueAt }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const sla = getQcSlaState(dueAt);
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs tabular-nums ${SLA_TONE_CLASS[sla.tone]}`}>
      <Clock className="w-3.5 h-3.5 shrink-0" />
      {sla.label}
    </span>
  );
}

export default function DispatchQcReminderModal({
  open,
  alert,
  queueLabel,
  remark,
  snoozeMinutes,
  snoozing,
  onRemarkChange,
  onSnoozeMinutesChange,
  onSnooze,
  hideTicketButton = false,
}) {
  const navigate = useNavigate();
  const alertKey = alert ? `${alert.sales_order_number}:${alert.ticket_id || ''}` : '';
  const prevOpenRef = useRef(false);
  const prevAlertKeyRef = useRef('');

  // Fresh remark when the popup opens or when switching to another QC alert.
  useEffect(() => {
    if (!open || !alertKey) {
      prevOpenRef.current = open;
      return;
    }
    const justOpened = open && !prevOpenRef.current;
    const alertChanged = prevAlertKeyRef.current !== alertKey;
    prevOpenRef.current = open;
    prevAlertKeyRef.current = alertKey;
    if (justOpened || alertChanged) {
      onRemarkChange('');
    }
  }, [open, alertKey, onRemarkChange]);

  const handleSnoozeMinutesChange = (minutes) => {
    onSnoozeMinutesChange(minutes);
    onRemarkChange('');
  };

  if (!open || !alert) return null;

  const orderType = ORDER_TYPE_LABELS[alert.order_type] || alert.order_type || '—';
  const customerName = alert.customer_name || alert.customer || '—';
  const ticketPath = alert.ticket_id ? `/floor-pipeline/tickets/${alert.ticket_id}` : null;

  return (
    <div className="fixed inset-0 z-[201] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-orange-950/40 backdrop-blur-[2px]" aria-hidden="true" />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dispatch-qc-alert-title"
        className="relative flex w-full max-w-3xl max-h-[92vh] flex-col rounded-2xl border-4 border-orange-600 bg-white shadow-2xl shadow-orange-900/20 overflow-hidden"
      >
        <div className="shrink-0 bg-orange-600 px-4 sm:px-5 py-3 sm:py-4 flex items-start gap-3 text-white">
          <div className="rounded-full bg-white/15 p-2 shrink-0">
            <AlertTriangle className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-orange-100">
              Dispatch QC reminder
            </p>
            <h2 id="dispatch-qc-alert-title" className="text-base sm:text-lg font-bold leading-tight mt-0.5">
              Laptop attach QC time exceeded
            </h2>
            <p className="text-xs sm:text-sm text-orange-100 mt-1">
              Complete Dispatch QC on the floor ticket or snooze with a reason.
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5 py-4">
          {queueLabel ? (
            <p className="mb-3 text-xs font-medium text-orange-700 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
              {queueLabel}
            </p>
          ) : null}

          <div className="rounded-xl border-2 border-orange-100 bg-orange-50/40 p-4 space-y-3 mb-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-mono text-lg font-bold text-orange-800">{alert.sales_order_number}</span>
              <QcSlaBadge dueAt={alert.qc_due_at} />
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Customer</dt>
                <dd className="font-medium text-slate-900">{customerName}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Order type</dt>
                <dd className="font-medium text-slate-900">{orderType}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-slate-500 mb-1">Configuration</dt>
                <dd><SoOrderLinesConfigBlock row={alert} /></dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-slate-500">QC started</dt>
                <dd className="font-medium text-slate-900">{formatStartedAt(alert.qc_started_at)}</dd>
              </div>
            </dl>
          </div>

          {ticketPath && !hideTicketButton ? (
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={() => navigate(ticketPath)}
                className="rounded-xl bg-orange-700 text-white px-4 py-2.5 text-sm font-bold hover:bg-orange-800"
              >
                Open QC Ticket #{alert.ticket_id}
              </button>
            </div>
          ) : null}

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div>
              <label htmlFor="dispatch-qc-snooze-minutes" className="block text-sm font-semibold text-slate-800 mb-1.5">
                Snooze reminder for
              </label>
              <select
                id="dispatch-qc-snooze-minutes"
                value={snoozeMinutes}
                onChange={(e) => handleSnoozeMinutesChange(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {DISPATCH_QC_SNOOZE_MINUTES_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="dispatch-qc-snooze-remark" className="block text-sm font-semibold text-slate-800 mb-1.5">
                Why is QC still pending? <span className="text-slate-400 font-normal">(required every time you snooze)</span>
              </label>
              <textarea
                id="dispatch-qc-snooze-remark"
                rows={3}
                value={remark}
                onChange={(e) => onRemarkChange(e.target.value)}
                placeholder="e.g. Waiting for technician, config mismatch being checked…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>

            <button
              type="button"
              disabled={snoozing || !remark.trim()}
              onClick={onSnooze}
              className="w-full rounded-xl border-2 border-orange-300 bg-white text-orange-700 py-2.5 text-sm font-bold hover:bg-orange-50 disabled:opacity-50"
            >
              {snoozing ? 'Snoozing…' : 'Snooze Reminder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function isDispatchQcDueCrossed(eta, snoozedUntil) {
  if (!eta?.qc_due_at) return false;
  if (snoozedUntil && new Date(snoozedUntil).getTime() > Date.now()) return false;
  return new Date(eta.qc_due_at).getTime() <= Date.now();
}

export function isDispatchQcTicketAssignee(user, alert) {
  if (!user || !alert) return false;
  const uid = Number(user.user_id);
  const assigneeId = alert.ticket_assignee_user_id ?? alert.ticketAssigneeUserId;
  return assigneeId != null && uid === Number(assigneeId);
}

/** @deprecated use isDispatchQcTicketAssignee */
export function isDispatchWorkflowAssignee(user, eta) {
  return isDispatchQcTicketAssignee(user, eta);
}
