/**
 * Real-time dispatch pending orders — Socket.IO emit helpers.
 */
const pool = require('../config/db');
const { loadConfig, STATUS, fetchSoLinesByNumbers } = require('./dispatchWorkflowService');

let io = null;

function setIo(socketIo) {
  io = socketIo;
}

function userRoom(userId) {
  return `dispatch-user-${userId}`;
}

function emitToAssignee(assignedUserId, event, payload) {
  if (!io) return;
  if (assignedUserId) {
    io.to(userRoom(assignedUserId)).emit(event, payload);
  }
  io.to('dispatch-admin').emit(event, payload);
}

/** QC SLA alerts — ticket assignee only (not dispatch-admin observers). */
function emitToQcTicketAssignee(assignedUserId, event, payload) {
  if (!io || !assignedUserId) return;
  io.to(userRoom(assignedUserId)).emit(event, payload);
}

async function fetchOrderSocketPayload(workflowIdOrSo) {
  const isId = typeof workflowIdOrSo === 'number' || /^\d+$/.test(String(workflowIdOrSo));
  const cfg = await loadConfig();
  const params = isId ? [workflowIdOrSo] : [workflowIdOrSo];
  const where = isId ? 'dw.id = $1' : 'dw.sales_order_number = $1';

  const r = await pool.query(
    `SELECT dw.id, dw.sales_order_number, dw.assigned_user_id, dw.assigned_at,
            dw.acceptance_due_at, dw.alert_snoozed_until, dw.last_decline_remark,
            dw.status,
            sol.customer_name,
            COALESCE(sol.entity_code, sol.branch) AS entity_code,
            sol.quotation_type AS order_type,
            CASE
              WHEN dw.acceptance_due_at IS NOT NULL AND dw.acceptance_due_at < NOW() THEN 'critical'
              WHEN dw.acceptance_due_at IS NOT NULL AND dw.acceptance_due_at < NOW() + interval '5 minutes' THEN 'high'
              ELSE 'normal'
            END AS priority
       FROM dispatch_workflow dw
       LEFT JOIN LATERAL (
         SELECT customer_name, entity_code, quotation_type, branch
           FROM sales_order_lines
          WHERE sales_order_number = dw.sales_order_number
          ORDER BY id ASC
          LIMIT 1
       ) sol ON TRUE
      WHERE ${where}
      LIMIT 1`,
    params
  );
  const row = r.rows[0];
  if (!row) return null;

  const linesBySo = await fetchSoLinesByNumbers([row.sales_order_number]);
  const lines = linesBySo[row.sales_order_number] || [];
  const first = lines[0] || {};

  return {
    orderId: row.id,
    soNumber: row.sales_order_number,
    customer: row.customer_name || null,
    assignedTo: row.assigned_user_id,
    assignedAt: row.assigned_at,
    acceptanceDueAt: row.acceptance_due_at,
    slaMinutes: cfg.acceptance_sla_minutes || 30,
    entityCode: row.entity_code || null,
    orderType: row.order_type || null,
    alertSnoozedUntil: row.alert_snoozed_until || null,
    lastDeclineRemark: row.last_decline_remark || null,
    priority: row.priority || 'normal',
    slaBreached: row.acceptance_due_at ? new Date(row.acceptance_due_at) <= new Date() : false,
    status: row.status,
    lines,
    brand: first.brand || null,
    modelName: first.model_name || null,
    processor: first.processor || null,
    generation: first.generation || null,
    ram: first.ram || null,
    storage: first.storage || null,
    quantity: first.quantity || null,
  };
}

async function emitNewOrder(workflowIdOrSo) {
  const payload = await fetchOrderSocketPayload(workflowIdOrSo);
  if (!payload || payload.status !== STATUS.WAITING) return;
  emitToAssignee(payload.assignedTo, 'dispatch:new-order', payload);
}

async function emitAccepted(workflowIdOrSo) {
  const payload = await fetchOrderSocketPayload(workflowIdOrSo);
  const base = payload || {};
  emitToAssignee(base.assignedTo, 'dispatch:accepted', {
    orderId: base.orderId,
    soNumber: base.soNumber,
    assignedTo: base.assignedTo,
  });
}

async function emitSlaBreach(workflowRow) {
  const payload = workflowRow?.sales_order_number
    ? await fetchOrderSocketPayload(workflowRow.sales_order_number)
    : await fetchOrderSocketPayload(workflowRow?.id);
  if (!payload) return;
  payload.slaBreached = true;
  payload.priority = 'critical';
  emitToAssignee(payload.assignedTo, 'dispatch:sla-breach', payload);
}

async function emitCancelled(salesOrderNumber, assignedUserId = null) {
  let payload = await fetchOrderSocketPayload(salesOrderNumber);
  if (!payload) {
    payload = {
      orderId: null,
      soNumber: salesOrderNumber,
      customer: null,
      assignedTo: assignedUserId,
    };
  }
  payload.status = 'cancelled';
  emitToAssignee(payload.assignedTo || assignedUserId, 'dispatch:cancelled', {
    orderId: payload.orderId,
    soNumber: payload.soNumber,
    customer: payload.customer,
    assignedTo: payload.assignedTo || assignedUserId,
  });
}

async function fetchQcAlertPayload(workflowIdOrSo) {
  const isId = typeof workflowIdOrSo === 'number' || /^\d+$/.test(String(workflowIdOrSo));
  const cfg = await loadConfig();
  const params = isId ? [workflowIdOrSo] : [workflowIdOrSo];
  const where = isId ? 'dw.id = $1' : 'dw.sales_order_number = $1';

  const r = await pool.query(
    `SELECT dw.id, dw.sales_order_number, dw.qc_started_at,
            dw.qc_due_at, dw.qc_overdue, dw.qc_alert_snoozed_until, dw.qc_alert_snooze_remark,
            dw.status,
            sol.customer_name,
            COALESCE(sol.entity_code, sol.branch) AS entity_code,
            sol.quotation_type AS order_type,
            tk.ticket_id,
            tk.ticket_assignee_user_id,
            CASE
              WHEN dw.qc_due_at IS NOT NULL AND dw.qc_due_at < NOW() THEN 'critical'
              WHEN dw.qc_due_at IS NOT NULL AND dw.qc_due_at < NOW() + interval '5 minutes' THEN 'high'
              ELSE 'normal'
            END AS priority
       FROM dispatch_workflow dw
       LEFT JOIN LATERAL (
         SELECT customer_name, entity_code, quotation_type, branch
           FROM sales_order_lines
          WHERE sales_order_number = dw.sales_order_number
          ORDER BY id ASC
          LIMIT 1
       ) sol ON TRUE
       LEFT JOIN LATERAL (
         SELECT t.ticket_id, t.assigned_user_id AS ticket_assignee_user_id
           FROM tickets t
           JOIN stages s ON s.stage_id = t.current_stage_id
          WHERE t.sales_order_number = dw.sales_order_number
            AND t.ticket_type = 'sales_order_qc'
            AND t.status IN ('in_progress', 'on_hold')
            AND s.stage_name = 'Dispatch QC'
          ORDER BY t.ticket_id DESC
          LIMIT 1
       ) tk ON TRUE
      WHERE ${where}
      LIMIT 1`,
    params
  );
  const row = r.rows[0];
  if (!row) return null;

  const linesBySo = await fetchSoLinesByNumbers([row.sales_order_number]);
  const lines = linesBySo[row.sales_order_number] || [];
  const first = lines[0] || {};

  return {
    orderId: row.id,
    soNumber: row.sales_order_number,
    customer: row.customer_name || null,
    assignedTo: row.ticket_assignee_user_id || null,
    ticketAssigneeUserId: row.ticket_assignee_user_id || null,
    qcStartedAt: row.qc_started_at,
    qcDueAt: row.qc_due_at,
    qcOverdue: !!row.qc_overdue,
    qcEtaMinutes: cfg.qc_eta_minutes || 120,
    qcAlertSnoozedUntil: row.qc_alert_snoozed_until || null,
    qcAlertSnoozeRemark: row.qc_alert_snooze_remark || null,
    ticketId: row.ticket_id || null,
    entityCode: row.entity_code || null,
    orderType: row.order_type || null,
    priority: row.priority || 'normal',
    qcSlaBreached: row.qc_due_at ? new Date(row.qc_due_at) <= new Date() : false,
    status: row.status,
    lines,
    brand: first.brand || null,
    modelName: first.model_name || null,
    processor: first.processor || null,
    generation: first.generation || null,
    ram: first.ram || null,
    storage: first.storage || null,
    quantity: first.quantity || null,
  };
}

async function emitQcStarted(salesOrderNumber) {
  const payload = await fetchQcAlertPayload(salesOrderNumber);
  if (!payload || payload.status !== STATUS.DISPATCH_QC || !payload.assignedTo) return;
  emitToQcTicketAssignee(payload.assignedTo, 'dispatch:qc-started', payload);
}

async function emitQcSlaBreach(workflowRow) {
  const payload = workflowRow?.sales_order_number
    ? await fetchQcAlertPayload(workflowRow.sales_order_number)
    : await fetchQcAlertPayload(workflowRow?.id);
  if (!payload || !payload.assignedTo) return;
  payload.qcSlaBreached = true;
  payload.priority = 'critical';
  emitToQcTicketAssignee(payload.assignedTo, 'dispatch:qc-sla-breach', payload);
}

async function emitQcSnoozed(salesOrderNumber) {
  const payload = await fetchQcAlertPayload(salesOrderNumber);
  if (!payload || !payload.assignedTo) return;
  emitToQcTicketAssignee(payload.assignedTo, 'dispatch:qc-snoozed', {
    orderId: payload.orderId,
    soNumber: payload.soNumber,
    assignedTo: payload.assignedTo,
    qcAlertSnoozedUntil: payload.qcAlertSnoozedUntil,
    qcAlertSnoozeRemark: payload.qcAlertSnoozeRemark,
    qcDueAt: payload.qcDueAt,
    ticketId: payload.ticketId,
    customer: payload.customer,
    priority: payload.priority,
  });
}

async function emitQcComplete(salesOrderNumber, assignedUserId = null) {
  let payload = await fetchQcAlertPayload(salesOrderNumber);
  if (!payload) {
    payload = {
      orderId: null,
      soNumber: salesOrderNumber,
      assignedTo: assignedUserId,
    };
  }
  emitToQcTicketAssignee(payload.assignedTo || assignedUserId, 'dispatch:qc-complete', {
    orderId: payload.orderId,
    soNumber: payload.soNumber,
    assignedTo: payload.assignedTo || assignedUserId,
  });
}

async function emitSnoozed(salesOrderNumber) {
  const payload = await fetchOrderSocketPayload(salesOrderNumber);
  if (!payload) return;
  emitToAssignee(payload.assignedTo, 'dispatch:snoozed', {
    orderId: payload.orderId,
    soNumber: payload.soNumber,
    assignedTo: payload.assignedTo,
    alertSnoozedUntil: payload.alertSnoozedUntil,
    lastDeclineRemark: payload.lastDeclineRemark,
    customer: payload.customer,
    assignedAt: payload.assignedAt,
    acceptanceDueAt: payload.acceptanceDueAt,
    slaMinutes: payload.slaMinutes,
    entityCode: payload.entityCode,
    orderType: payload.orderType,
    priority: payload.priority,
  });
}

module.exports = {
  setIo,
  fetchOrderSocketPayload,
  fetchQcAlertPayload,
  emitNewOrder,
  emitAccepted,
  emitSlaBreach,
  emitQcSlaBreach,
  emitQcStarted,
  emitQcSnoozed,
  emitQcComplete,
  emitCancelled,
  emitSnoozed,
};
