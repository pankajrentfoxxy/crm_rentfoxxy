export function getCountdownState(untilAt) {
  if (!untilAt) return { label: '—', tone: 'muted', active: false };
  const ms = new Date(untilAt).getTime() - Date.now();
  if (ms <= 0) return { label: 'Expired', tone: 'muted', active: false };
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return {
    label: `${m}m ${s}s`,
    tone: ms <= 5 * 60 * 1000 ? 'urgent' : 'normal',
    active: true,
  };
}

export function isSnoozeActive(untilAt) {
  if (!untilAt) return false;
  return new Date(untilAt).getTime() > Date.now();
}

/** Center popup only after acceptance SLA time (default 30 min from assignment). */
export function isPopupAlertReady(order) {
  if (!order) return false;
  if (order.sla_breached) return true;
  const dueAt = order.acceptance_due_at || order.acceptanceDueAt;
  if (!dueAt) return true;
  return new Date(dueAt).getTime() <= Date.now();
}

/** Center popup only after Dispatch QC ETA (default 120 min; testing may use 5 min). */
export function isQcPopupAlertReady(order) {
  if (!order) return false;
  if (order.qc_sla_breached || order.qcSlaBreached) return true;
  const dueAt = order.qc_due_at || order.qcDueAt;
  if (!dueAt) return false;
  return new Date(dueAt).getTime() <= Date.now();
}

function filterPopupAlerts(alerts, {
  isReady,
  snoozeField,
  suppressUntilBySo = new Map(),
}) {
  const now = Date.now();
  return (alerts || []).filter((a) => {
    if (!isReady(a)) return false;
    const so = a.sales_order_number;
    const localUntil = suppressUntilBySo.get(so);
    if (localUntil && now < localUntil) return false;
    if (localUntil && now >= localUntil) suppressUntilBySo.delete(so);
    const snoozedUntil = a[snoozeField];
    if (isSnoozeActive(snoozedUntil)) return false;
    return true;
  });
}

/** Keep popup hidden until SLA elapsed and snooze time has passed. */
export function filterActivePopupAlerts(alerts, suppressUntilBySo = new Map()) {
  return filterPopupAlerts(alerts, {
    isReady: isPopupAlertReady,
    snoozeField: 'alert_snoozed_until',
    suppressUntilBySo,
  });
}

/** Dispatch QC SLA popup — after laptop attach ETA elapsed. */
export function filterActiveQcPopupAlerts(alerts, suppressUntilBySo = new Map()) {
  return filterPopupAlerts(alerts, {
    isReady: isQcPopupAlertReady,
    snoozeField: 'qc_alert_snoozed_until',
    suppressUntilBySo,
  });
}

export function formatSnoozeUntil(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

export const DISPATCH_WORKFLOW_CHANGED = 'dispatch-workflow-changed';

export function emitDispatchWorkflowChanged() {
  window.dispatchEvent(new CustomEvent(DISPATCH_WORKFLOW_CHANGED));
}

export function onDispatchWorkflowChanged(handler) {
  window.addEventListener(DISPATCH_WORKFLOW_CHANGED, handler);
  return () => window.removeEventListener(DISPATCH_WORKFLOW_CHANGED, handler);
}
