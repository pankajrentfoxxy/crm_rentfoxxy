/** Map Socket.IO dispatch payloads to pending-orders table rows. */
export function mapSocketOrderToRow(payload) {
  if (!payload) return null;
  return {
    id: payload.orderId,
    sales_order_number: payload.soNumber,
    customer_name: payload.customer,
    assigned_user_id: payload.assignedTo,
    assigned_at: payload.assignedAt,
    acceptance_due_at: payload.acceptanceDueAt,
    alert_snoozed_until: payload.alertSnoozedUntil,
    last_decline_remark: payload.lastDeclineRemark,
    entity_code: payload.entityCode,
    order_type: payload.orderType,
    priority: payload.priority || 'normal',
    sla_breached: !!payload.slaBreached,
    sla_minutes: payload.slaMinutes,
    lines: payload.lines || [],
    brand: payload.brand,
    model_name: payload.modelName,
    processor: payload.processor,
    generation: payload.generation,
    ram: payload.ram,
    storage: payload.storage,
    quantity: payload.quantity,
  };
}

export function mapApiOrderToRow(row) {
  return {
    ...row,
    sla_breached: row.acceptance_due_at
      ? new Date(row.acceptance_due_at) <= new Date()
      : false,
  };
}

export function orderSortKey(row) {
  const due = row.acceptance_due_at ? new Date(row.acceptance_due_at).getTime() : Infinity;
  const assigned = row.assigned_at ? new Date(row.assigned_at).getTime() : 0;
  return [due, assigned];
}

export function sortPendingOrders(rows) {
  return [...rows].sort((a, b) => {
    const [dueA, assignedA] = orderSortKey(a);
    const [dueB, assignedB] = orderSortKey(b);
    if (dueA !== dueB) return dueA - dueB;
    return assignedA - assignedB;
  });
}

export function mapApiQcAlertToRow(row) {
  return {
    ...row,
    qc_sla_breached: row.qc_due_at
      ? new Date(row.qc_due_at) <= new Date()
      : false,
  };
}

export function mapSocketQcAlertToRow(payload) {
  if (!payload) return null;
  return {
    id: payload.orderId,
    sales_order_number: payload.soNumber,
    customer_name: payload.customer,
    assigned_user_id: payload.assignedTo,
    qc_started_at: payload.qcStartedAt,
    qc_due_at: payload.qcDueAt,
    qc_overdue: payload.qcOverdue,
    qc_alert_snoozed_until: payload.qcAlertSnoozedUntil,
    qc_alert_snooze_remark: payload.qcAlertSnoozeRemark,
    ticket_id: payload.ticketId,
    ticket_assignee_user_id: payload.ticketAssigneeUserId || payload.assignedTo,
    entity_code: payload.entityCode,
    order_type: payload.orderType,
    priority: payload.priority || 'normal',
    qc_sla_breached: !!payload.qcSlaBreached,
    qc_eta_minutes: payload.qcEtaMinutes,
    lines: payload.lines || [],
    brand: payload.brand,
    model_name: payload.modelName,
    processor: payload.processor,
    generation: payload.generation,
    ram: payload.ram,
    storage: payload.storage,
    quantity: payload.quantity,
  };
}

export function qcAlertSortKey(row) {
  const due = row.qc_due_at ? new Date(row.qc_due_at).getTime() : Infinity;
  const started = row.qc_started_at ? new Date(row.qc_started_at).getTime() : 0;
  return [due, started];
}

export function sortQcAlerts(rows) {
  return [...rows].sort((a, b) => {
    const [dueA, startedA] = qcAlertSortKey(a);
    const [dueB, startedB] = qcAlertSortKey(b);
    if (dueA !== dueB) return dueA - dueB;
    return startedA - startedB;
  });
}

export function mergeQcAlertRow(existing, incoming) {
  const merged = { ...existing, ...incoming };
  if (!Array.isArray(incoming.lines) || !incoming.lines.length) {
    merged.lines = existing.lines;
  }
  ['brand', 'model_name', 'processor', 'generation', 'ram', 'storage', 'quantity', 'ticket_id', 'ticket_assignee_user_id', 'customer_name', 'order_type'].forEach((key) => {
    if (incoming[key] == null && existing[key] != null) {
      merged[key] = existing[key];
    }
  });
  return merged;
}

export function mergeOrderRow(existing, incoming) {
  const merged = { ...existing, ...incoming };
  if (!Array.isArray(incoming.lines) || !incoming.lines.length) {
    merged.lines = existing.lines;
  }
  ['brand', 'model_name', 'processor', 'generation', 'ram', 'storage', 'quantity'].forEach((key) => {
    if (incoming[key] == null && existing[key] != null) {
      merged[key] = existing[key];
    }
  });
  return merged;
}
