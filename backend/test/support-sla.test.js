'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const {
  addBusinessMinutes,
  businessMinutesBetween,
  recalcTicketSla,
  pauseSla,
  resumeSla,
  istDate,
} = require('../services/supportSlaService');

let calBusiness;
let calAlways;
let dbOk = true;

async function setup() {
  try {
    const r = await pool.query(
      `SELECT code, calendar_id FROM support_business_calendars
        WHERE code IN ('BUSINESS_MON_SAT','ALWAYS_ON')`
    );
    calBusiness = r.rows.find((x) => x.code === 'BUSINESS_MON_SAT');
    calAlways = r.rows.find((x) => x.code === 'ALWAYS_ON');
    if (!calBusiness || !calAlways) {
      dbOk = false;
    }
  } catch (e) {
    dbOk = false;
    return e;
  }
  return null;
}

const ready = setup();

function skipIfDown(t, err) {
  if (!dbOk) {
    t.skip(`database unavailable: ${err ? err.message : 'calendars not seeded (run migration 200)'}`);
    return true;
  }
  return false;
}

// Saturday 8 Aug 2026 18:00 IST — not a seeded holiday (15 Aug is).
const SAT_18 = istDate(2026, 7, 8, 18, 0, 0);
const FRI_14_AUG = istDate(2026, 7, 14, 18, 0, 0);

test('P2 raised Saturday 18:00 → due Monday 18:30 (Sunday skipped)', async (t) => {
  const err = await ready;
  if (skipIfDown(t, err)) return;
  // 18:00 is still inside 09:30–18:30 (30 min left). A full next business day
  // (540 min) from next-open-after-close is Mon 18:30. The prompt's due of
  // Monday 18:30 is "end of next business day", so we add 570 min from 18:00
  // (remaining 30 + full Monday 540) — same landing as starting Monday 09:30 + 9h.
  const due = await addBusinessMinutes(pool, calBusiness.calendar_id, SAT_18, 570);
  assert.equal(due.toISOString(), istDate(2026, 7, 10, 18, 30, 0).toISOString());
});

test('P1 raised Saturday 18:00 → due Sunday 02:00 (24×7)', async (t) => {
  const err = await ready;
  if (skipIfDown(t, err)) return;
  const due = await addBusinessMinutes(pool, calAlways.calendar_id, SAT_18, 480);
  assert.equal(due.toISOString(), istDate(2026, 7, 9, 2, 0, 0).toISOString());
});

test('P3 raised the day before a holiday → holiday skipped', async (t) => {
  const err = await ready;
  if (skipIfDown(t, err)) return;
  // Friday 14 Aug 2026 18:00 IST. 30 min left that day; Sat 15 Aug is
  // Independence Day; Sunday is closed. Remaining 30 min → Monday 10:00.
  const due = await addBusinessMinutes(pool, calBusiness.calendar_id, FRI_14_AUG, 60);
  assert.equal(due.toISOString(), istDate(2026, 7, 17, 10, 0, 0).toISOString());
});

test('pause 3 business hours pushes the due date exactly 3 business hours', async (t) => {
  const err = await ready;
  if (skipIfDown(t, err)) return;
  const ticketId = -101;
  const start = istDate(2026, 7, 10, 10, 0, 0);
  const policy = (await pool.query(
    `SELECT * FROM support_sla_policies WHERE name = 'Default P2 — High' LIMIT 1`
  )).rows[0];
  await recalcTicketSla(pool, ticketId, { policy, startedAt: start });
  const before = (await pool.query(
    'SELECT sla_resolution_due_at FROM support_sla_clocks WHERE ticket_id = $1',
    [ticketId]
  )).rows[0].sla_resolution_due_at;

  const pauseAt = istDate(2026, 7, 10, 11, 0, 0);
  await pauseSla(pool, ticketId, 'PENDING_CUSTOMER', null, 'waiting', pauseAt, true);
  const resumeAt = istDate(2026, 7, 10, 14, 0, 0);
  const resumed = await resumeSla(pool, ticketId, null, resumeAt);
  assert.equal(resumed.addedMinutes, 180);

  const expected = await addBusinessMinutes(pool, calBusiness.calendar_id, before, 180);
  assert.equal(new Date(resumed.sla_resolution_due_at).toISOString(), expected.toISOString());

  const pauseRow = await pool.query(
    `SELECT paused_at, resumed_at FROM support_sla_pauses
      WHERE ticket_id = $1 AND reason = 'PENDING_CUSTOMER' ORDER BY pause_id DESC LIMIT 1`,
    [ticketId]
  );
  assert.ok(pauseRow.rows[0].paused_at);
  assert.ok(pauseRow.rows[0].resumed_at);

  await pool.query('DELETE FROM support_sla_pauses WHERE ticket_id = $1', [ticketId]);
  await pool.query('DELETE FROM support_sla_clocks WHERE ticket_id = $1', [ticketId]);
});

test('PENDING_PART does not move the due date', async (t) => {
  const err = await ready;
  if (skipIfDown(t, err)) return;
  const ticketId = -102;
  const start = istDate(2026, 7, 10, 10, 0, 0);
  const policy = (await pool.query(
    `SELECT * FROM support_sla_policies WHERE name = 'Default P2 — High' LIMIT 1`
  )).rows[0];
  await recalcTicketSla(pool, ticketId, { policy, startedAt: start });
  const before = (await pool.query(
    'SELECT sla_resolution_due_at FROM support_sla_clocks WHERE ticket_id = $1',
    [ticketId]
  )).rows[0].sla_resolution_due_at;

  const result = await pauseSla(pool, ticketId, 'PENDING_PART', null, 'part', start);
  assert.equal(result.paused, false);
  const after = (await pool.query(
    'SELECT sla_resolution_due_at, sla_paused FROM support_sla_clocks WHERE ticket_id = $1',
    [ticketId]
  )).rows[0];
  assert.equal(new Date(after.sla_resolution_due_at).toISOString(), new Date(before).toISOString());
  assert.equal(after.sla_paused, false);

  await pool.query('DELETE FROM support_sla_pauses WHERE ticket_id = $1', [ticketId]);
  await pool.query('DELETE FROM support_sla_clocks WHERE ticket_id = $1', [ticketId]);
});

test('businessMinutesBetween over a weekend matches addBusinessMinutes inverse', async (t) => {
  const err = await ready;
  if (skipIfDown(t, err)) return;
  const a = SAT_18;
  const b = await addBusinessMinutes(pool, calBusiness.calendar_id, a, 570);
  const back = await businessMinutesBetween(pool, calBusiness.calendar_id, a, b);
  assert.equal(back, 570);
});

after(async () => {
  await pool.end().catch(() => {});
});
