/**
 * Support lead's queue lanes and the technician's My work (claude/carret-support.md steps 3-4).
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { laneOf } = require('../services/supportDeskService');

describe('queue lanes', () => {
  it('one lane per ticket, the most pressing first', () => {
    const ready = { item_type: 'pickup', status: 'awaiting_service_return', repair_ready_at: new Date(), service_dc_number: null, step: 'awaiting_service_return', assigned_to: 1 };
    const unassigned = { item_type: 'complaint', status: 'open', step: 'unassigned', assigned_to: null };
    const replace = { item_type: 'complaint', status: 'assigned', step: 'replacement_required', assigned_to: 2 };
    const going = { item_type: 'complaint', status: 'assigned', step: 'assigned', assigned_to: 3 };
    assert.equal(laneOf([ready, unassigned]), 'ready_to_return');
    assert.equal(laneOf([replace, unassigned]), 'lead_turn');
    assert.equal(laneOf([unassigned, going]), 'needs_technician');
    assert.equal(laneOf([going]), 'in_progress');
    assert.equal(laneOf([{ ...unassigned, status: 'cancelled' }, going]), 'in_progress', 'cancelled laptops do not count');
  });
});

describe('my work', () => {
  const pool = require('../config/db');
  after(async () => { await pool.end(); });
  it('lists only my own jobs, each with a next step, never another technician\'s', async () => {
    const u = (await pool.query(
      `SELECT COALESCE(assigned_to, pickup_assigned_to) AS u FROM support_ticket_items
        WHERE status NOT IN ('resolved','closed','inventory_updated','cancelled') AND COALESCE(assigned_to, pickup_assigned_to) IS NOT NULL
        GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`
    )).rows[0];
    if (!u) return;
    const jobs = await require('../services/supportMyWorkService').myWork(u.u);
    const ids = jobs.map((j) => j.item_id);
    if (!ids.length) return;
    const owners = (await pool.query(
      'SELECT assigned_to, pickup_assigned_to FROM support_ticket_items WHERE id = ANY($1::int[])', [ids]
    )).rows;
    assert.ok(owners.every((o) => o.assigned_to === u.u || o.pickup_assigned_to === u.u));
    assert.ok(jobs.every((j) => j.next && j.next.key && j.next.label));
  });
});
