/**
 * Production screens backend — floor board visibility (PD1, PD9), hold and
 * release (PD11), finish dismantling (PD14). Rolled back.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/rollbackHarness');
const fb = require('../controllers/floorBoard.controller');

describe('floor board, hold, dismantle (rolled back)', () => {
  let C;
  let ticket;
  let mgr;
  const stage = async (name) => (await C.query('SELECT stage_id, team_id FROM stages WHERE stage_name = $1 ORDER BY (team_id IS NULL), stage_id LIMIT 1', [name])).rows[0];
  const stageOf = async () => (await C.query('SELECT s.stage_name FROM tickets t JOIN stages s ON s.stage_id = t.current_stage_id WHERE t.ticket_id = $1', [ticket.ticket_id])).rows[0].stage_name;

  before(async () => {
    C = await h.open();
    ticket = (await C.query("SELECT ticket_id, vendor_serial_id, ttspl_id FROM tickets WHERE status = 'in_progress' AND vendor_serial_id IS NOT NULL ORDER BY ticket_id DESC LIMIT 1")).rows[0];
    mgr = { user_id: (await C.query("SELECT user_id FROM users ORDER BY user_id LIMIT 1")).rows[0].user_id, name: 'Test FM', role: 'super_admin' };
  });
  after(() => h.close());

  it('PD9: a technician sees unassigned tickets waiting in their team\'s stage, and can claim them', async () => {
    const dx = await stage('Diagnosis');
    const techId = (await C.query('SELECT user_id FROM users ORDER BY user_id DESC LIMIT 1')).rows[0].user_id;
    await C.query('UPDATE users SET team_id = $1 WHERE user_id = $2', [dx.team_id, techId]);
    await C.query("UPDATE tickets SET current_stage_id = $1, assigned_team_id = $2, assigned_user_id = NULL WHERE ticket_id = $3", [dx.stage_id, dx.team_id, ticket.ticket_id]);
    const r = await h.call(fb.board, { query: { stage: 'Diagnosis', view: 'unassigned' }, user: { user_id: techId, role: 'technician' } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const row = r.body.rows.find((x) => x.ticket_id === ticket.ticket_id);
    assert.ok(row, 'the unassigned ticket is visible');
    assert.equal(row.can_claim, true);
    assert.ok(r.body.stages.some((s) => s.name === 'Hold'));
  });

  it('PD11: hold from a stage with a reason, release back to that stage with a reason', async () => {
    const qc1 = await stage('QC1');
    await C.query('UPDATE tickets SET current_stage_id = $1 WHERE ticket_id = $2', [qc1.stage_id, ticket.ticket_id]);
    assert.equal((await h.call(fb.hold, { params: { id: String(ticket.ticket_id) }, body: {}, user: mgr })).code, 400);
    const held = await h.call(fb.hold, { params: { id: String(ticket.ticket_id) }, body: { reason: 'Waiting for customer data wipe OK' }, user: mgr });
    assert.equal(held.code, 200, JSON.stringify(held.body));
    assert.equal(await stageOf(), 'Hold');
    const rel = await h.call(fb.release, { params: { id: String(ticket.ticket_id) }, body: { reason: 'Customer confirmed' }, user: mgr });
    assert.equal(rel.code, 200, JSON.stringify(rel.body));
    assert.equal(await stageOf(), 'QC1');
  });

  it('PD14: dismantling adds the harvested parts and scraps the laptop — never stock', async () => {
    const dm = await stage('Dismantle');
    await C.query("UPDATE tickets SET current_stage_id = $1 WHERE ticket_id = $2", [dm.stage_id, ticket.ticket_id]);
    await C.query("UPDATE vendor_serial_numbers SET inventory_status = 'in_repair' WHERE serial_id = $1", [ticket.vendor_serial_id]);
    const partId = (await C.query(`INSERT INTO parts (part_name, quantity, cost, category) VALUES ('TEST HARVEST PART', 0, 100, 'ram') RETURNING part_id`)).rows[0].part_id;
    const r = await h.call(fb.dismantle, { params: { id: String(ticket.ticket_id) }, body: { reason: 'Motherboard beyond repair', parts: [{ part_id: partId, condition: 'good', quantity: 2 }] }, user: mgr });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.parts.length, 2);
    const v = (await C.query('SELECT inventory_status FROM vendor_serial_numbers WHERE serial_id = $1', [ticket.vendor_serial_id])).rows[0];
    assert.equal(v.inventory_status, 'scrapped');
    const shelf = (await C.query("SELECT COUNT(*)::int AS n FROM part_instances WHERE part_id = $1 AND status = 'in_stock'", [partId])).rows[0].n;
    assert.equal(shelf, 2);
  });
});
