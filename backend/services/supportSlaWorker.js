'use strict';

const pool = require('../config/db');
const { logEvent, forceTicketStatus } = require('./supportTicketStateService');
const { notifyEvent } = require('./supportNotificationService');
const { getNumber, getSetting } = require('./supportSettingsService');

const TERMINAL = new Set(['RESOLVED', 'CLOSED', 'CANCELLED']);
const WO_ACCEPTED_OR_LATER = new Set([
  'ACCEPTED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED',
]);

const ESCALATION_LEVELS = [
  { pct: 50, level: 1 },
  { pct: 75, level: 2 },
  { pct: 100, level: 3 },
  { pct: 125, level: 4 },
  { pct: 150, level: 5 },
];

const LEVEL_AUDIENCES = {
  1: ['ASSIGNEE'],
  2: ['ASSIGNEE', 'LEAD'],
  3: ['LEAD', 'MANAGER'],
  4: ['MANAGER', 'OPS_HEAD'],
  5: ['OPS_HEAD', 'BUSINESS_HEAD'],
};

let cronJob = null;

function elapsedPct(startedAt, dueAt, now = new Date()) {
  if (!startedAt || !dueAt) return 0;
  const start = new Date(startedAt).getTime();
  const due = new Date(dueAt).getTime();
  const n = new Date(now).getTime();
  const total = due - start;
  if (!Number.isFinite(total) || total <= 0) return n >= due ? 100 : 0;
  return ((n - start) / total) * 100;
}

function crossedLevels(pct, fired = {}) {
  const seen = fired && typeof fired === 'object' ? fired : {};
  return ESCALATION_LEVELS
    .filter((row) => pct >= row.pct && !seen[String(row.level)])
    .map((row) => row.level);
}

function shouldSkipTicket(ticket) {
  if (!ticket) return true;
  if (TERMINAL.has(String(ticket.status || '').toUpperCase())) return true;
  if (ticket.sla_paused) return true;
  return false;
}

function woNeedsAcceptanceAlert(wo, now = new Date(), minutes = 30) {
  if (!wo || !wo.slot_start) return false;
  if (wo.acceptance_alert_fired) return false;
  if (WO_ACCEPTED_OR_LATER.has(String(wo.status || '').toUpperCase())) return false;
  const windowMs = (Number(minutes) || 30) * 60 * 1000;
  return new Date(now).getTime() >= new Date(wo.slot_start).getTime() - windowMs;
}

function overByLabel(dueAt, now = new Date()) {
  const ms = new Date(now).getTime() - new Date(dueAt).getTime();
  if (ms <= 0) return 'on time';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

async function setting(db, key, fallback) {
  return getSetting(db, key, fallback);
}

async function fireEscalation(db, ticket, level, pct, now) {
  const fired = { ...(ticket.escalation_fired || {}) };
  fired[String(level)] = true;
  const pin = level >= 5;
  await db.query(
    `UPDATE support_tickets_v2
        SET escalation_level = GREATEST(COALESCE(escalation_level, 0), $2),
            escalation_fired = $3::jsonb,
            sla_resolution_breached = sla_resolution_breached OR $4,
            dashboard_pinned = dashboard_pinned OR $5,
            updated_at = NOW()
      WHERE ticket_id = $1`,
    [ticket.ticket_id, level, JSON.stringify(fired), level >= 3, pin]
  );
  await logEvent(db, {
    ticketId: ticket.ticket_id,
    eventType: 'SLA_ESCALATED',
    actorKind: 'SYSTEM',
    summary: `SLA escalation level ${level} (${Math.round(pct)}%)`,
    detail: { level, pct: Math.round(pct), due_at: ticket.sla_resolution_due_at },
  });
  const vars = {
    ticket_number: ticket.ticket_number,
    customer_name: ticket.customer_name || '',
    assignee_name: ticket.assignee_name || '',
    due_at: ticket.sla_resolution_due_at,
    over_by: overByLabel(ticket.sla_resolution_due_at, now),
  };
  await notifyEvent(db, {
    eventCode: `SLA_ESCALATION_${level}`,
    ticketId: ticket.ticket_id,
    audiences: LEVEL_AUDIENCES[level] || [],
    assignedTo: ticket.assigned_to,
    vars,
  });
}

async function sweepResolution(db, now) {
  const tickets = (await db.query(
    `SELECT t.ticket_id, t.ticket_number, t.status, t.assigned_to,
            t.sla_paused, t.sla_started_at, t.sla_resolution_due_at,
            t.escalation_level, t.escalation_fired,
            COALESCE(c.company_name, c.name) AS customer_name,
            u.name AS assignee_name
       FROM support_tickets_v2 t
       LEFT JOIN customers c ON c.customer_id = t.customer_id
       LEFT JOIN users u ON u.user_id = t.assigned_to
      WHERE t.status NOT IN ('RESOLVED','CLOSED','CANCELLED')`
  )).rows;

  let fired = 0;
  for (const ticket of tickets) {
    if (shouldSkipTicket(ticket)) continue;
    const pct = elapsedPct(ticket.sla_started_at, ticket.sla_resolution_due_at, now);
    const levels = crossedLevels(pct, ticket.escalation_fired);
    for (const level of levels) {
      await fireEscalation(db, ticket, level, pct, now);
      ticket.escalation_fired = { ...(ticket.escalation_fired || {}), [String(level)]: true };
      fired += 1;
    }
  }
  return fired;
}

async function sweepResponse(db, now) {
  const rows = (await db.query(
    `SELECT t.ticket_id, t.ticket_number, t.assigned_to, t.sla_paused,
            t.sla_response_due_at, t.sla_breached
       FROM support_tickets_v2 t
      WHERE t.status NOT IN ('RESOLVED','CLOSED','CANCELLED')
        AND t.sla_paused = FALSE
        AND t.sla_breached = FALSE
        AND t.sla_response_due_at IS NOT NULL
        AND t.sla_response_due_at <= $1`,
    [now]
  )).rows;
  for (const row of rows) {
    await db.query(
      `UPDATE support_tickets_v2 SET sla_breached = TRUE, updated_at = NOW() WHERE ticket_id = $1`,
      [row.ticket_id]
    );
    await logEvent(db, {
      ticketId: row.ticket_id,
      eventType: 'SLA_RESPONSE_BREACHED',
      actorKind: 'SYSTEM',
      summary: 'Response SLA breached',
    });
    await notifyEvent(db, {
      eventCode: 'SLA_RESPONSE_BREACH',
      ticketId: row.ticket_id,
      audiences: ['LEAD'],
      assignedTo: row.assigned_to,
      vars: { ticket_number: row.ticket_number },
    });
  }
  return rows.length;
}

async function sweepWorkOrders(db, now) {
  const minutes = await getNumber(db, 'accept_window_minutes', 30);
  const rows = (await db.query(
    `SELECT w.wo_id, w.wo_number, w.status, w.slot_start, w.acceptance_alert_fired,
            w.ticket_id, t.ticket_number, t.assigned_to
       FROM support_work_orders w
       JOIN support_tickets_v2 t ON t.ticket_id = w.ticket_id
      WHERE w.acceptance_alert_fired = FALSE
        AND w.slot_start IS NOT NULL
        AND w.status NOT IN ('ACCEPTED','EN_ROUTE','ON_SITE','IN_PROGRESS','COMPLETED','FAILED','CANCELLED')`
  )).rows;
  let n = 0;
  for (const wo of rows) {
    if (!woNeedsAcceptanceAlert(wo, now, minutes)) continue;
    await db.query(
      `UPDATE support_work_orders SET acceptance_alert_fired = TRUE, updated_at = NOW() WHERE wo_id = $1`,
      [wo.wo_id]
    );
    await logEvent(db, {
      ticketId: wo.ticket_id,
      woId: wo.wo_id,
      eventType: 'WO_ACCEPTANCE_ALERT',
      actorKind: 'SYSTEM',
      summary: `WO ${wo.wo_number} not accepted before slot`,
    });
    await notifyEvent(db, {
      eventCode: 'WO_UNACCEPTED',
      ticketId: wo.ticket_id,
      woId: wo.wo_id,
      audiences: ['LEAD'],
      assignedTo: wo.assigned_to,
      vars: {
        wo_number: wo.wo_number,
        ticket_number: wo.ticket_number,
        slot_start: wo.slot_start,
      },
    });
    n += 1;
  }
  return n;
}

async function sweepAutoClose(db, now) {
  const hours = Number(await setting(db, 'auto_close_hours', '48')) || 48;
  const cutoff = new Date(new Date(now).getTime() - hours * 3600000);
  const rows = (await db.query(
    `SELECT ticket_id, sla_resolution_breached, breach_reason
       FROM support_tickets_v2
      WHERE status = 'RESOLVED'
        AND resolved_at IS NOT NULL
        AND resolved_at <= $1`,
    [cutoff]
  )).rows;
  let n = 0;
  for (const row of rows) {
    if (row.sla_resolution_breached && !row.breach_reason) continue;
    await forceTicketStatus(db, row.ticket_id, 'CLOSED', {
      summary: `Auto-closed after ${hours}h`,
    });
    n += 1;
  }
  return n;
}

async function runSlaSweep(now = new Date()) {
  const resolution = await sweepResolution(pool, now);
  const response = await sweepResponse(pool, now);
  const workOrders = await sweepWorkOrders(pool, now);
  const autoClosed = await sweepAutoClose(pool, now);
  return { resolution, response, workOrders, autoClosed };
}

function startSupportSlaWorker() {
  if (cronJob) return;
  const cron = require('node-cron');
  cronJob = cron.schedule('*/5 * * * *', () => {
    runSlaSweep().catch((e) => console.error('slaSweep:', e));
  });
  console.log('Support SLA worker started (every 5 minutes)');
}

function stopSupportSlaWorker() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}

module.exports = {
  ESCALATION_LEVELS,
  LEVEL_AUDIENCES,
  elapsedPct,
  crossedLevels,
  shouldSkipTicket,
  woNeedsAcceptanceAlert,
  overByLabel,
  runSlaSweep,
  startSupportSlaWorker,
  stopSupportSlaWorker,
};
