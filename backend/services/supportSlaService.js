'use strict';

const pool = require('../config/db');
const { computePriority } = require('./supportPriorityService');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const PAUSE_REASONS = new Set(['PENDING_CUSTOMER', 'PENDING_VENDOR', 'PENDING_APPROVAL']);

function istParts(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    H: shifted.getUTCHours(),
    M: shifted.getUTCMinutes(),
    S: shifted.getUTCSeconds(),
    dow: shifted.getUTCDay(),
  };
}

function istDate(y, mo, d, H = 0, M = 0, S = 0) {
  return new Date(Date.UTC(y, mo, d, H, M, S) - IST_OFFSET_MS);
}

function addIstDays(parts, days) {
  const dt = istDate(parts.y, parts.mo, parts.d, 12, 0, 0);
  dt.setTime(dt.getTime() + days * 86400000);
  return istParts(dt);
}

function ymd(parts) {
  const mm = String(parts.mo + 1).padStart(2, '0');
  const dd = String(parts.d).padStart(2, '0');
  return `${parts.y}-${mm}-${dd}`;
}

function parseTime(t) {
  const s = String(t);
  const [h, m, sec] = s.split(':').map((x) => parseInt(x, 10));
  return { H: h || 0, M: m || 0, S: sec || 0 };
}

function minutesOfDay(H, M, S = 0) {
  return H * 60 + M + S / 60;
}

async function loadCalendar(db, calendarId) {
  const cal = await db.query(
    `SELECT calendar_id, code, timezone, is_always_on FROM support_business_calendars WHERE calendar_id = $1`,
    [calendarId]
  );
  if (!cal.rows[0]) throw Object.assign(new Error('Calendar not found'), { status: 404 });
  const hours = await db.query(
    `SELECT day_of_week, start_time, end_time FROM support_calendar_hours WHERE calendar_id = $1`,
    [calendarId]
  );
  const holidays = await db.query(
    `SELECT holiday_date::text AS holiday_date FROM support_holidays WHERE calendar_id = $1`,
    [calendarId]
  );
  return {
    ...cal.rows[0],
    hoursByDow: Object.fromEntries(hours.rows.map((r) => [Number(r.day_of_week), r])),
    holidays: new Set(holidays.rows.map((r) => r.holiday_date.slice(0, 10))),
  };
}

function windowFor(cal, parts) {
  if (cal.holidays.has(ymd(parts))) return null;
  const row = cal.hoursByDow[parts.dow];
  if (!row) return null;
  const start = parseTime(row.start_time);
  const end = parseTime(row.end_time);
  return {
    start: istDate(parts.y, parts.mo, parts.d, start.H, start.M, start.S),
    end: istDate(parts.y, parts.mo, parts.d, end.H, end.M, end.S),
    startMin: minutesOfDay(start.H, start.M, start.S),
    endMin: minutesOfDay(end.H, end.M, end.S),
  };
}

function nextOpen(cal, from) {
  let cursor = istParts(from);
  for (let i = 0; i < 400; i += 1) {
    const win = windowFor(cal, cursor);
    if (win) {
      if (from.getTime() < win.start.getTime()) return win.start;
      if (from.getTime() < win.end.getTime()) return from;
    }
    cursor = addIstDays(cursor, 1);
    cursor.H = 0;
    cursor.M = 0;
    cursor.S = 0;
    from = istDate(cursor.y, cursor.mo, cursor.d, 0, 0, 0);
  }
  throw new Error('No open calendar window in the next year');
}

async function addBusinessMinutes(db = pool, calendarId, from, minutes) {
  const start = from instanceof Date ? from : new Date(from);
  const need = Number(minutes);
  if (!Number.isFinite(need) || need < 0) {
    throw Object.assign(new Error('minutes must be a non-negative number'), { status: 400 });
  }
  if (need === 0) return start;
  const cal = await loadCalendar(db, calendarId);
  if (cal.is_always_on || cal.code === 'ALWAYS_ON') {
    return new Date(start.getTime() + need * 60000);
  }
  let remaining = need;
  let cursor = nextOpen(cal, start);
  for (let i = 0; i < 400 && remaining > 0; i += 1) {
    const parts = istParts(cursor);
    const win = windowFor(cal, parts);
    if (!win || cursor.getTime() >= win.end.getTime()) {
      cursor = nextOpen(cal, new Date(cursor.getTime() + 60000));
      continue;
    }
    const available = (win.end.getTime() - cursor.getTime()) / 60000;
    if (remaining <= available) {
      return new Date(cursor.getTime() + remaining * 60000);
    }
    remaining -= available;
    cursor = nextOpen(cal, new Date(win.end.getTime() + 60000));
  }
  throw new Error('Could not place business minutes');
}

async function businessMinutesBetween(db = pool, calendarId, a, b) {
  const start = a instanceof Date ? a : new Date(a);
  const end = b instanceof Date ? b : new Date(b);
  if (end <= start) return 0;
  const cal = await loadCalendar(db, calendarId);
  if (cal.is_always_on || cal.code === 'ALWAYS_ON') {
    return Math.round((end.getTime() - start.getTime()) / 60000);
  }
  let total = 0;
  let cursor = nextOpen(cal, start);
  if (cursor >= end) return 0;
  for (let i = 0; i < 400 && cursor < end; i += 1) {
    const parts = istParts(cursor);
    const win = windowFor(cal, parts);
    if (!win || cursor >= win.end) {
      cursor = nextOpen(cal, new Date(cursor.getTime() + 60000));
      continue;
    }
    const sliceEnd = end < win.end ? end : win.end;
    if (sliceEnd > cursor) total += (sliceEnd.getTime() - cursor.getTime()) / 60000;
    cursor = nextOpen(cal, new Date(win.end.getTime() + 60000));
  }
  return Math.round(total);
}

async function resolvePolicy(db, { customerId, supportTier, ticketClass, priority }) {
  let tier = supportTier || null;
  if (customerId && !tier) {
    const c = await db.query('SELECT support_tier FROM customers WHERE customer_id = $1', [customerId]);
    tier = c.rows[0]?.support_tier || null;
  }
  const r = await db.query(
    `SELECT p.*, cal.code AS calendar_code, cal.name AS calendar_name, cal.is_always_on
       FROM support_sla_policies p
       JOIN support_business_calendars cal ON cal.calendar_id = p.calendar_id
      WHERE p.active = TRUE
        AND (p.priority IS NULL OR p.priority = $1)
        AND (p.ticket_class IS NULL OR p.ticket_class = 'BOTH' OR p.ticket_class = $2)
        AND (p.customer_id IS NULL OR p.customer_id = $3)
        AND (p.support_tier IS NULL OR p.support_tier = $4)
      ORDER BY p.specificity DESC,
               p.customer_id NULLS LAST,
               p.support_tier NULLS LAST,
               p.priority NULLS LAST
      LIMIT 1`,
    [priority, ticketClass || null, customerId || null, tier]
  );
  return r.rows[0] || null;
}

function reasonPausesResolution(reason, customerSide) {
  if (reason === 'PENDING_CUSTOMER' || reason === 'PENDING_VENDOR') return true;
  if (reason === 'PENDING_APPROVAL') return Boolean(customerSide);
  return false;
}

async function recalcTicketSla(db, ticketId, opts = {}) {
  const startedAt = opts.startedAt ? new Date(opts.startedAt) : new Date();
  const policy = opts.policy || await resolvePolicy(db, opts);
  if (!policy) throw Object.assign(new Error('No SLA policy matches'), { status: 400 });
  const responseDue = await addBusinessMinutes(db, policy.calendar_id, startedAt, policy.response_minutes);
  const resolutionDue = await addBusinessMinutes(db, policy.calendar_id, startedAt, policy.resolution_minutes);
  await db.query(
    `INSERT INTO support_sla_clocks (
       ticket_id, policy_id, calendar_id, sla_response_due_at, sla_resolution_due_at,
       sla_started_at, sla_paused_minutes, sla_paused, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,0,false,NOW())
     ON CONFLICT (ticket_id) DO UPDATE SET
       policy_id = EXCLUDED.policy_id,
       calendar_id = EXCLUDED.calendar_id,
       sla_response_due_at = EXCLUDED.sla_response_due_at,
       sla_resolution_due_at = EXCLUDED.sla_resolution_due_at,
       sla_started_at = EXCLUDED.sla_started_at,
       sla_paused_minutes = 0,
       sla_paused = false,
       updated_at = NOW()`,
    [ticketId, policy.policy_id, policy.calendar_id, responseDue, resolutionDue, startedAt]
  );
  await db.query(
    `UPDATE support_tickets_v2
        SET sla_policy_id = $2,
            sla_response_due_at = $3,
            sla_resolution_due_at = $4,
            sla_started_at = $5,
            sla_paused_minutes = 0,
            sla_paused = false,
            sla_breached = false,
            sla_resolution_breached = false,
            updated_at = NOW()
      WHERE ticket_id = $1`,
    [ticketId, policy.policy_id, responseDue, resolutionDue, startedAt]
  );
  return {
    policy,
    sla_response_due_at: responseDue,
    sla_resolution_due_at: resolutionDue,
    sla_started_at: startedAt,
  };
}

async function pauseSla(db, ticketId, reason, userId, note, at = new Date(), customerSide = false) {
  const clock = await db.query('SELECT * FROM support_sla_clocks WHERE ticket_id = $1', [ticketId]);
  if (!clock.rows[0]) throw Object.assign(new Error('SLA clock not found'), { status: 404 });
  const pauses = reasonPausesResolution(reason, customerSide);
  const ins = await db.query(
    `INSERT INTO support_sla_pauses (ticket_id, reason, customer_side, note, paused_at, paused_by, resumed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [ticketId, reason, Boolean(customerSide), note || null, at, userId || null, pauses ? null : at]
  );
  if (pauses) {
    await db.query(
      `UPDATE support_sla_clocks SET sla_paused = true, updated_at = NOW() WHERE ticket_id = $1`,
      [ticketId]
    );
  }
  return { pause: ins.rows[0], paused: pauses, clock: clock.rows[0] };
}

async function resumeSla(db, ticketId, userId, at = new Date()) {
  const clockRes = await db.query('SELECT * FROM support_sla_clocks WHERE ticket_id = $1', [ticketId]);
  const clock = clockRes.rows[0];
  if (!clock) throw Object.assign(new Error('SLA clock not found'), { status: 404 });
  const open = await db.query(
    `SELECT * FROM support_sla_pauses
      WHERE ticket_id = $1 AND resumed_at IS NULL
      ORDER BY paused_at DESC LIMIT 1`,
    [ticketId]
  );
  const row = open.rows[0];
  if (!row) return { clock, addedMinutes: 0 };
  const elapsed = await businessMinutesBetween(db, clock.calendar_id, row.paused_at, at);
  const newDue = await addBusinessMinutes(db, clock.calendar_id, clock.sla_resolution_due_at, elapsed);
  await db.query(
    `UPDATE support_sla_pauses SET resumed_at = $2, resumed_by = $3 WHERE pause_id = $1`,
    [row.pause_id, at, userId || null]
  );
  await db.query(
    `UPDATE support_sla_clocks
        SET sla_paused = false,
            sla_paused_minutes = sla_paused_minutes + $2,
            sla_resolution_due_at = $3,
            updated_at = NOW()
      WHERE ticket_id = $1`,
    [ticketId, elapsed, newDue]
  );
  return { addedMinutes: elapsed, sla_resolution_due_at: newDue };
}

async function previewSla(db, body) {
  const impact = Number(body.impact);
  const urgency = Number(body.urgency);
  let supportTier = body.support_tier || null;
  if (body.customer_id && !supportTier) {
    const c = await db.query('SELECT support_tier FROM customers WHERE customer_id = $1', [body.customer_id]);
    supportTier = c.rows[0]?.support_tier || null;
  }
  const computed = computePriority({
    impact,
    urgency,
    supportTier,
    isSafety: Boolean(body.is_safety),
    isRepeat: Boolean(body.is_repeat),
    isReopen: Boolean(body.is_reopen),
    contactIsVip: Boolean(body.contact_is_vip),
    isSlaComplaint: Boolean(body.is_sla_complaint),
    fleetSize: body.fleet_size,
    affectedUnits: body.affected_units,
  });
  const policy = await resolvePolicy(db, {
    customerId: body.customer_id,
    supportTier,
    ticketClass: body.ticket_class || 'INCIDENT',
    priority: computed.priority,
  });
  if (!policy) throw Object.assign(new Error('No SLA policy matches'), { status: 400 });
  const from = body.from ? new Date(body.from) : new Date();
  const responseDue = await addBusinessMinutes(db, policy.calendar_id, from, policy.response_minutes);
  const resolutionDue = await addBusinessMinutes(db, policy.calendar_id, from, policy.resolution_minutes);
  return {
    priority: computed.priority,
    reasons: computed.reasons,
    policy,
    response_due_at: responseDue,
    resolution_due_at: resolutionDue,
    calendar: {
      calendar_id: policy.calendar_id,
      code: policy.calendar_code,
      name: policy.calendar_name,
    },
  };
}

module.exports = {
  resolvePolicy,
  addBusinessMinutes,
  businessMinutesBetween,
  recalcTicketSla,
  pauseSla,
  resumeSla,
  previewSla,
  reasonPausesResolution,
  PAUSE_REASONS,
  istDate,
  istParts,
};
