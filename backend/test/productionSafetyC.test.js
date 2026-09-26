/**
 * Production safety C — floor permissions and transactions (F10–F15, PD4,
 * PD12, PD13). Real handlers on a rolled-back transaction.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const h = require('./helpers/rollbackHarness');
const tc = require('../controllers/ticketController');
const phase2 = require('../controllers/ticketPhase2Controller');

describe('floor permissions and transactions (rolled back)', () => {
  let C;
  let ticket;
  let tech;
  let other;
  const stageId = async (name) => (await C.query('SELECT stage_id FROM stages WHERE stage_name = $1 ORDER BY (team_id IS NULL), stage_id LIMIT 1', [name])).rows[0].stage_id;
  const at = async (name, assignee = null) => {
    await C.query("UPDATE tickets SET current_stage_id = $1, assigned_user_id = $2, status = 'in_progress' WHERE ticket_id = $3", [await stageId(name), assignee, ticket.ticket_id]);
  };

  before(async () => {
    C = await h.open();
    ticket = (await C.query("SELECT ticket_id, ttspl_id, serial_number FROM tickets WHERE status = 'in_progress' AND ttspl_id IS NOT NULL ORDER BY ticket_id DESC LIMIT 1")).rows[0];
    const u = (await C.query('SELECT user_id FROM users ORDER BY user_id LIMIT 2')).rows;
    tech = { user_id: u[0].user_id, name: 'Test Tech', role: 'technician' };
    other = { user_id: u[1].user_id, name: 'Other Tech', role: 'technician' };
    await C.query('DELETE FROM ticket_part_blocks WHERE ticket_id = $1', [ticket.ticket_id]).catch(() => {});
  });
  after(() => h.close());

  it('F11: a ticket\'s status is not set from the edit form', async () => {
    const r = await h.call(tc.updateTicket, { params: { id: String(ticket.ticket_id) }, body: { status: 'completed' }, user: tech });
    assert.equal(r.code, 400);
  });

  it('PD13: only the assignee starts the timer; an unassigned ticket is claimed first', async () => {
    await at('Diagnosis', null);
    const r0 = await h.call(tc.startWork, { params: { id: String(ticket.ticket_id) }, body: { verify_ttspl: ticket.ttspl_id, verify_serial: ticket.serial_number }, user: tech });
    assert.equal(r0.code, 409);
    await at('Diagnosis', tech.user_id);
    const r1 = await h.call(tc.startWork, { params: { id: String(ticket.ticket_id) }, body: { verify_ttspl: ticket.ttspl_id, verify_serial: ticket.serial_number }, user: other });
    assert.equal(r1.code, 403);
  });

  it('claim is first-come: a claimed ticket cannot be claimed again', async () => {
    await at('Diagnosis', tech.user_id);
    const r = await h.call(tc.claimTicket, { params: { id: String(ticket.ticket_id) }, user: { ...other, role: 'floor_manager' } });
    assert.ok([400, 409].includes(r.code), JSON.stringify(r.body));
  });

  it('PD12: chip-level repair goes back to Diagnosis, not straight to Assembly', async () => {
    await at('Chip Level Repair', tech.user_id);
    const r = await h.call(phase2.moveToStage, { params: { id: String(ticket.ticket_id) }, body: { to_stage_name: 'Assembly & Software' }, user: { ...tech, role: 'floor_manager' } });
    assert.equal(r.code, 409, JSON.stringify(r.body));
    assert.match(r.body.message, /back to Diagnosis/);
  });

  it('PD4: only a floor manager sends a ticket back to Floor Manager, with a reason; moving back needs a reason', async () => {
    await at('Assembly & Software', tech.user_id);
    const r = await h.call(phase2.moveToStage, { params: { id: String(ticket.ticket_id) }, body: { to_stage_name: 'Floor Manager', reason: 'needs triage again' }, user: tech });
    assert.equal(r.code, 403);
    const r2 = await h.call(phase2.moveToStage, { params: { id: String(ticket.ticket_id) }, body: { to_stage_name: 'Floor Manager' }, user: { ...tech, role: 'floor_manager' } });
    assert.equal(r2.code, 400);
    assert.match(r2.body.message, /Say why/);
  });

  it('F10: bulk move and floor-manager fail need a floor manager; chip routes need a permission', () => {
    const t = fs.readFileSync(require.resolve('../routes/tickets.js'), 'utf8');
    assert.match(t, /router\.post\('\/bulk-move', ftEdit, requireFloorLead, bulkMoveTickets\)/);
    assert.match(t, /'\/:id\/floor-manager-fail',\n\s+ftEdit,\n\s+requireFloorLead,/);
    const c = fs.readFileSync(require.resolve('../routes/chipLevel.js'), 'utf8');
    assert.match(c, /checkSectionPermission\('chip_level_repair', 'edit'\), submitChipRepair/);
  });

  it('F14: next-stage runs in one transaction and a refused move writes nothing', async () => {
    await at('Pending Inventory', tech.user_id);
    const acts = async () => (await C.query('SELECT COUNT(*)::int AS n FROM activities WHERE ticket_id = $1', [ticket.ticket_id])).rows[0].n;
    const before = await acts();
    const r = await h.call(tc.moveToNextStage, { params: { id: String(ticket.ticket_id) }, body: {}, user: { ...tech, role: 'floor_manager' } });
    assert.ok(r.code >= 400, JSON.stringify(r.body));
    assert.equal(await acts(), before);
  });
});
