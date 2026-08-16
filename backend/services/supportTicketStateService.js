'use strict';

const LINE_TERMINAL = new Set(['RESOLVED', 'CANCELLED']);
const WO_TERMINAL = new Set(['COMPLETED', 'CANCELLED']);
const WO_ACTIVE = new Set(['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS']);
const TICKET_TERMINAL = new Set(['CANCELLED', 'CLOSED']);

function deriveTicketStatus({ currentStatus, lines, workOrders, pendingReason, assignedTo }) {
  if (TICKET_TERMINAL.has(currentStatus)) {
    return { status: currentStatus, blockers: [] };
  }

  const allLinesTerminal = lines.length > 0 && lines.every((l) => LINE_TERMINAL.has(l.line_status));
  const allWoTerminal = workOrders.every((w) => WO_TERMINAL.has(w.status));

  if (allLinesTerminal && allWoTerminal) {
    const blockers = [];
    for (const l of lines) {
      if (l.line_status === 'CANCELLED') continue;
      const missing = [];
      if (!l.resolution_code_id) missing.push('resolution_code');
      if (!l.root_cause_id) missing.push('root_cause');
      if (!l.liability) missing.push('liability');
      if (missing.length) blockers.push({ line_code: l.line_code, missing });
    }
    for (const w of workOrders) {
      if (!WO_TERMINAL.has(w.status)) {
        blockers.push({ wo_number: w.wo_number, status: w.status });
      }
    }
    if (blockers.length) return { status: 'IN_PROGRESS', blockers };
    return { status: 'RESOLVED', blockers: [] };
  }

  if (pendingReason) return { status: 'PENDING', blockers: [] };
  if (workOrders.some((w) => WO_ACTIVE.has(w.status))) return { status: 'IN_PROGRESS', blockers: [] };
  if (assignedTo) return { status: 'ASSIGNED', blockers: [] };
  const classified = lines.length > 0 && lines.every((l) => l.reported_issue_id);
  if (classified) return { status: 'TRIAGED', blockers: [] };
  return { status: 'NEW', blockers: [] };
}

function deriveAssetLineStatus({ currentStatus, resolutionComplete, workOrders, waitingForPart = false }) {
  if (currentStatus === 'CANCELLED') return 'CANCELLED';
  if (resolutionComplete) return 'RESOLVED';
  if (waitingForPart) return 'PENDING_PART';
  if (workOrders.some((w) => WO_ACTIVE.has(w.status))) return 'IN_PROGRESS';
  if (workOrders.some((w) => w.status === 'PENDING_ASSIGNMENT' || w.status === 'DRAFT')) return 'PENDING';
  return 'OPEN';
}

/** THE ONLY function permitted to write support_tickets_v2.status. */
async function computeTicketStatus(client, ticketId) {
  const ticketRes = await client.query(
    `SELECT ticket_id, status, pending_reason, assigned_to FROM support_tickets_v2 WHERE ticket_id = $1`,
    [ticketId]
  );
  const ticket = ticketRes.rows[0];
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });

  const lines = (await client.query(
    `SELECT line_id, line_code, line_status, resolution_code_id, root_cause_id, liability, reported_issue_id
       FROM support_ticket_assets WHERE ticket_id = $1`,
    [ticketId]
  )).rows;

  const workOrders = (await client.query(
    `SELECT wo_id, wo_number, status FROM support_work_orders WHERE ticket_id = $1`,
    [ticketId]
  )).rows;

  const derived = deriveTicketStatus({
    currentStatus: ticket.status,
    lines,
    workOrders,
    pendingReason: ticket.pending_reason,
    assignedTo: ticket.assigned_to,
  });

  const changed = derived.status !== ticket.status;
  if (changed) {
    await client.query(
      `UPDATE support_tickets_v2
          SET status = $2::varchar,
              resolved_at = CASE WHEN $2::varchar = 'RESOLVED' THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END,
              updated_at = NOW()
        WHERE ticket_id = $1`,
      [ticketId, derived.status]
    );
    await logEvent(client, {
      ticketId,
      eventType: 'STATUS_CHANGED',
      actorKind: 'SYSTEM',
      summary: `Status ${ticket.status} → ${derived.status}`,
      detail: { from: ticket.status, to: derived.status, blockers: derived.blockers },
    });
  }

  return { status: derived.status, changed, blockers: derived.blockers };
}

/** THE ONLY function permitted to write support_ticket_assets.line_status. */
async function computeAssetLineStatus(client, lineId) {
  const lineRes = await client.query(
    `SELECT line_id, ticket_id, line_status, resolution_code_id, root_cause_id, liability
       FROM support_ticket_assets WHERE line_id = $1`,
    [lineId]
  );
  const line = lineRes.rows[0];
  if (!line) throw Object.assign(new Error('Asset line not found'), { status: 404 });

  const workOrders = (await client.query(
    `SELECT w.wo_id, w.status
       FROM support_work_orders w
       JOIN support_work_order_assets a ON a.wo_id = w.wo_id
      WHERE a.line_id = $1`,
    [lineId]
  )).rows;

  const resolutionComplete = Boolean(
    line.resolution_code_id && line.root_cause_id && line.liability
  );
  let waitingForPart = false;
  try {
    const { OPEN_FIELD_PART_STATUSES } = require('./supportPartStatus');
    const openPart = await client.query(
      `SELECT request_id FROM part_requests
        WHERE support_line_id = $1
          AND context = 'FIELD'
          AND status_v2 = ANY($2::text[])
        LIMIT 1`,
      [lineId, OPEN_FIELD_PART_STATUSES]
    );
    waitingForPart = openPart.rows.length > 0;
  } catch (e) {
    if (e.code !== '42703' && e.code !== '42P01') throw e;
  }
  const next = deriveAssetLineStatus({
    currentStatus: line.line_status,
    resolutionComplete,
    workOrders,
    waitingForPart,
  });

  const changed = next !== line.line_status;
  if (changed) {
    await client.query(
      `UPDATE support_ticket_assets SET line_status = $2, updated_at = NOW() WHERE line_id = $1`,
      [lineId, next]
    );
    await logEvent(client, {
      ticketId: line.ticket_id,
      lineId,
      eventType: 'LINE_STATUS_CHANGED',
      actorKind: 'SYSTEM',
      summary: `Line ${line.line_id} ${line.line_status} → ${next}`,
      detail: { from: line.line_status, to: next },
    });
  }
  return { status: next, changed };
}

async function logEvent(client, {
  ticketId, lineId, woId, eventType, actorId, actorKind = 'USER',
  summary, detail, isCustomerVisible = false, contactMethod,
}) {
  const r = await client.query(
    `INSERT INTO support_ticket_events (
       ticket_id, line_id, wo_id, event_type, actor_id, actor_kind,
       summary, detail, is_customer_visible, contact_method
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      ticketId,
      lineId || null,
      woId || null,
      eventType,
      actorId || null,
      actorKind,
      summary || null,
      detail ? JSON.stringify(detail) : null,
      Boolean(isCustomerVisible),
      contactMethod || null,
    ]
  );
  return r.rows[0];
}

/** Close / cancel / reopen — still the only module that writes status. */
async function forceTicketStatus(client, ticketId, nextStatus, { actorId, summary, detail } = {}) {
  const allowed = new Set(['CLOSED', 'CANCELLED', 'IN_PROGRESS', 'RESOLVED']);
  if (!allowed.has(nextStatus)) {
    throw Object.assign(new Error('Cannot force that status'), { status: 400 });
  }
  const cur = await client.query(
    'SELECT ticket_id, status FROM support_tickets_v2 WHERE ticket_id = $1',
    [ticketId]
  );
  if (!cur.rows[0]) throw Object.assign(new Error('Ticket not found'), { status: 404 });
  const from = cur.rows[0].status;
  if (from === nextStatus) return { status: nextStatus, changed: false, blockers: [] };
  await client.query(
    `UPDATE support_tickets_v2
        SET status = $2::varchar,
            closed_at = CASE
              WHEN $2::varchar = 'CLOSED' THEN COALESCE(closed_at, NOW())
              WHEN $2::varchar = 'IN_PROGRESS' THEN NULL
              ELSE closed_at END,
            resolved_at = CASE
              WHEN $2::varchar = 'RESOLVED' THEN COALESCE(resolved_at, NOW())
              WHEN $2::varchar = 'IN_PROGRESS' THEN NULL
              ELSE resolved_at END,
            pending_reason = CASE WHEN $2::varchar IN ('CLOSED','CANCELLED','RESOLVED','IN_PROGRESS') THEN NULL ELSE pending_reason END,
            updated_at = NOW()
      WHERE ticket_id = $1`,
    [ticketId, nextStatus]
  );
  await logEvent(client, {
    ticketId,
    eventType: 'STATUS_CHANGED',
    actorId,
    actorKind: actorId ? 'USER' : 'SYSTEM',
    summary: summary || `Status ${from} → ${nextStatus}`,
    detail: { from, to: nextStatus, ...(detail || {}) },
  });
  return { status: nextStatus, changed: true, blockers: [] };
}

module.exports = {
  computeTicketStatus,
  computeAssetLineStatus,
  logEvent,
  forceTicketStatus,
  deriveTicketStatus,
  deriveAssetLineStatus,
};
