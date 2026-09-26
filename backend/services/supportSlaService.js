/**
 * Support SLA (claude/carret-support.md S5, targets agreed 26 Sep 2026).
 *
 * Business hours 09:00–19:00 IST, Monday–Saturday (10 h a day). Two clocks per
 * ticket, both from when it was raised:
 *   visit    until a technician first reaches the customer (visited_at)
 *   resolve  until the ticket is closed
 * The clocks pause while the ticket waits on the customer (a hold the lead
 * sets) or on a part (a part request raised and not yet with the technician /
 * customer). Computed on read — nothing is stored — so a change of target
 * applies to every ticket at once.
 */
const pool = require('../config/db');

const DAY_START = 9 * 60;
const DAY_END = 19 * 60;
const IST = 330; // minutes ahead of UTC, no daylight saving
const MIN = 60 * 1000;

// Business minutes. 1 business day = 600.
const TARGETS = {
  urgent: { visit: 240, resolve: 600 },
  high: { visit: 480, resolve: 1200 },
  normal: { visit: 600, resolve: 1800 },
  low: { visit: 1200, resolve: 3000 },
};
const AT_RISK = 0.75;

const toMs = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** Business windows [startMs, endMs) overlapping [a, b), IST, Mon–Sat. */
function businessWindows(a, b) {
  const out = [];
  if (!(b > a)) return out;
  // Walk IST calendar days.
  const istA = new Date(a + IST * MIN);
  let day = Date.UTC(istA.getUTCFullYear(), istA.getUTCMonth(), istA.getUTCDate());
  const endIst = b + IST * MIN;
  while (day < endIst) {
    const dow = new Date(day).getUTCDay(); // 0 Sunday
    if (dow !== 0) {
      const ws = day + DAY_START * MIN - IST * MIN;
      const we = day + DAY_END * MIN - IST * MIN;
      const s = Math.max(ws, a);
      const e = Math.min(we, b);
      if (e > s) out.push([s, e]);
    }
    day += 24 * 60 * MIN;
  }
  return out;
}

/** Merge [s, e) intervals (e may be null = still open → `now`). */
function mergePauses(pauses, now) {
  const list = (pauses || [])
    .map((p) => [toMs(p.from), p.to ? toMs(p.to) : now])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [s, e] of list) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/** Business minutes in [a, b) outside the pauses. */
function businessMinutes(a, b, pauses = [], now = Date.now()) {
  const A = toMs(a);
  const B = toMs(b);
  if (!(B > A)) return 0;
  const P = mergePauses(pauses, now);
  let total = 0;
  for (const [s, e] of businessWindows(A, B)) {
    let span = e - s;
    for (const [ps, pe] of P) {
      const os = Math.max(s, ps);
      const oe = Math.min(e, pe);
      if (oe > os) span -= oe - os;
    }
    total += span;
  }
  return Math.round(total / MIN);
}

/** The instant `minutes` business minutes after `from`, skipping pauses (bounded search). */
function addBusinessMinutes(from, minutes, pauses = [], now = Date.now()) {
  let left = minutes * MIN;
  const P = mergePauses(pauses, now);
  let cursor = toMs(from);
  for (let guard = 0; guard < 400 && left > 0; guard += 1) {
    const dayEnd = cursor + 7 * 24 * 60 * MIN;
    for (const [s0, e] of businessWindows(cursor, dayEnd)) {
      let s = s0;
      // carve pauses out of this window
      const pieces = [];
      for (const [ps, pe] of P) {
        if (pe <= s || ps >= e) continue;
        if (ps > s) pieces.push([s, ps]);
        s = Math.max(s, pe);
      }
      if (s < e) pieces.push([s, e]);
      for (const [ps, pe] of pieces) {
        const span = pe - ps;
        if (span >= left) return new Date(ps + left);
        left -= span;
      }
    }
    cursor = dayEnd;
  }
  return null;
}

function clock({ from, doneAt, target, pauses, pausedNow, now }) {
  const end = doneAt ? toMs(doneAt) : now;
  const used = businessMinutes(from, end, pauses, now);
  const due = addBusinessMinutes(from, target, pauses, now);
  let state;
  if (doneAt) state = used <= target ? 'met' : 'breached';
  else if (used > target) state = 'breached';
  else if (pausedNow) state = 'paused';
  else state = used >= target * AT_RISK ? 'at_risk' : 'on_track';
  return {
    target_minutes: target,
    used_minutes: used,
    left_minutes: Math.max(0, target - used),
    due_at: due ? due.toISOString() : null,
    done_at: doneAt ? new Date(doneAt).toISOString() : null,
    state,
  };
}

/** SLA for many tickets at once: Map(ticketId → sla). */
async function slaForTickets(ticketIds, db = pool, now = Date.now()) {
  const ids = [...new Set((ticketIds || []).map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const tickets = (await db.query(
    `SELECT t.id, t.priority, t.status, t.created_at, t.closed_at,
            (SELECT MIN(i.visited_at) FROM support_ticket_items i WHERE i.ticket_id = t.id) AS first_visit,
            EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id
                     AND (i.item_type = 'complaint' OR COALESCE(i.pickup_method, '') IN ('technician', 'inhouse'))) AS needs_visit
       FROM support_tickets t WHERE t.id = ANY($1::int[])`,
    [ids]
  )).rows;
  const holds = (await db.query(
    `SELECT ticket_id, reason, from_at, to_at FROM support_ticket_holds WHERE ticket_id = ANY($1::int[])`, [ids]
  )).rows;
  const partWaits = (await db.query(
    `SELECT support_ticket_id AS ticket_id, created_at AS from_at,
            COALESCE(issued_at, dispatched_at, delivered_at, used_at,
                     CASE WHEN status IN ('rejected', 'cancelled') THEN updated_at END) AS to_at
       FROM support_part_requests WHERE support_ticket_id = ANY($1::int[])`,
    [ids]
  )).rows;
  const pausesBy = new Map();
  const openReason = new Map();
  for (const h of [...holds.map((x) => ({ ...x, kind: x.reason })), ...partWaits.map((x) => ({ ...x, kind: 'part' }))]) {
    const list = pausesBy.get(h.ticket_id) || [];
    list.push({ from: h.from_at, to: h.to_at });
    pausesBy.set(h.ticket_id, list);
    if (!h.to_at) openReason.set(h.ticket_id, h.kind);
  }
  for (const t of tickets) {
    const target = TARGETS[String(t.priority || 'normal').toLowerCase()] || TARGETS.normal;
    const pauses = pausesBy.get(t.id) || [];
    const closed = ['closed', 'cancelled'].includes(t.status);
    const pausedNow = !closed && openReason.has(t.id);
    out.set(t.id, {
      priority: String(t.priority || 'normal').toLowerCase(),
      paused: pausedNow,
      paused_for: pausedNow ? openReason.get(t.id) : null,
      visit: t.needs_visit
        ? clock({ from: t.created_at, doneAt: t.first_visit || (closed ? t.closed_at : null), target: target.visit, pauses, pausedNow, now })
        : { state: 'n/a' },
      resolve: t.status === 'cancelled'
        ? { state: 'n/a' }
        : clock({ from: t.created_at, doneAt: closed ? t.closed_at : null, target: target.resolve, pauses, pausedNow, now }),
    });
  }
  return out;
}

/** Open tickets with their SLA, worst first — the lead's SLA board. */
async function slaBoard({ allowedCustomerTypes = null } = {}) {
  const params = [];
  let scope = '';
  const { isRestricted } = require('./customerAccessScope');
  if (isRestricted(allowedCustomerTypes)) {
    params.push(allowedCustomerTypes);
    scope = `AND EXISTS (SELECT 1 FROM customers c WHERE c.customer_id = t.customer_id AND c.customer_type = ANY($1::text[]))`;
  }
  const rows = (await pool.query(
    `SELECT t.id, t.customer_name, t.priority, t.status, t.created_at,
            (SELECT string_agg(DISTINCT u.name, ', ') FROM support_ticket_items i
               JOIN users u ON u.user_id = COALESCE(i.assigned_to, i.pickup_assigned_to)
              WHERE i.ticket_id = t.id) AS technicians
       FROM support_tickets t
      WHERE t.status IN ('open', 'in_progress') ${scope}
      ORDER BY t.created_at`,
    params
  )).rows;
  const sla = await slaForTickets(rows.map((r) => r.id));
  const rank = { breached: 0, at_risk: 1, on_track: 2, paused: 3, met: 4, 'n/a': 5 };
  const list = rows.map((r) => ({ ...r, sla: sla.get(r.id) }))
    .sort((a, b) => (rank[a.sla.resolve.state] - rank[b.sla.resolve.state]) || (a.sla.resolve.left_minutes ?? 0) - (b.sla.resolve.left_minutes ?? 0));
  const counts = { breached: 0, at_risk: 0, on_track: 0, paused: 0 };
  for (const r of list) {
    const s = r.sla.resolve.state === 'breached' || r.sla.visit.state === 'breached' ? 'breached' : r.sla.resolve.state;
    if (counts[s] != null) counts[s] += 1;
  }
  return { counts, tickets: list, targets: TARGETS };
}

/** Lead: put a ticket on hold (waiting on the customer), or release it. */
async function setHold(client, { ticketId, reason, note, user }) {
  const why = String(note || '').trim();
  if (!['customer', 'other'].includes(reason)) throw Object.assign(new Error('Hold reason must be customer or other (part waits pause by themselves)'), { status: 400 });
  if (why.length < 3) throw Object.assign(new Error('Say what we are waiting for'), { status: 400 });
  const t = (await client.query('SELECT status FROM support_tickets WHERE id = $1 FOR UPDATE', [ticketId])).rows[0];
  if (!t) throw Object.assign(new Error('Ticket not found'), { status: 404 });
  if (['closed', 'cancelled'].includes(t.status)) throw Object.assign(new Error(`Ticket is ${t.status}`), { status: 409 });
  try {
    await client.query('SAVEPOINT hold');
    await client.query(
      `INSERT INTO support_ticket_holds (ticket_id, reason, note, created_by) VALUES ($1, $2, $3, $4)`,
      [ticketId, reason, why, user?.user_id || null]
    );
    await client.query('RELEASE SAVEPOINT hold');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT hold');
    if (err.code === '23505') throw Object.assign(new Error('Already on hold'), { status: 409 });
    throw err;
  }
  return { on_hold: true };
}

async function releaseHold(client, { ticketId, user }) {
  const r = await client.query(
    `UPDATE support_ticket_holds SET to_at = NOW(), released_by = $2 WHERE ticket_id = $1 AND to_at IS NULL RETURNING id`,
    [ticketId, user?.user_id || null]
  );
  if (!r.rowCount) throw Object.assign(new Error('Not on hold'), { status: 409 });
  return { on_hold: false };
}

module.exports = {
  TARGETS,
  businessMinutes,
  addBusinessMinutes,
  slaForTickets,
  slaBoard,
  setHold,
  releaseHold,
};
