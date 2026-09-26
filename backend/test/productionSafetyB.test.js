/**
 * Production safety B — parts on the floor (P1–P6, P16, PD7). Real handlers on
 * a rolled-back transaction with a test part and its own units.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const h = require('./helpers/rollbackHarness');
const prc = require('../controllers/partRequestController');

describe('parts: request → approve → fit (rolled back)', () => {
  let C;
  let partId;
  let ticketId;
  const user = { user_id: null, name: 'Test Warehouse', role: 'warehouse' };
  let n = 0;
  const unit = async (status = 'in_stock') => {
    n += 1;
    return (await C.query(
      `INSERT INTO part_instances (prt_id, part_id, status, fitment) VALUES ($1, $2, $3, 'universal') RETURNING instance_id, prt_id`,
      [`TESTPRT-${Date.now()}-${n}`, partId, status]
    )).rows[0];
  };
  const request = async (status = 'pending') => {
    n += 1;
    return (await C.query(
      `INSERT INTO part_requests (ticket_id, requested_by, part_name, status, part_id, quantity, request_number, context,
                                  collect_old_part, photo_attachment_ids, needs_lead_approval, requested_before_visit)
       VALUES ($1, $2, 'Test part', $3, $4, 1, $5, 'FLOOR', FALSE, '[]'::jsonb, FALSE, FALSE) RETURNING request_id, request_number`,
      [ticketId, user.user_id, status, partId, `TESTPRQ-${n}`]
    )).rows[0];
  };
  const approve = (requestId, body = {}) => h.call(prc.approvePartRequest, { params: { requestId: String(requestId) }, body, user });

  before(async () => {
    C = await h.open();
    user.user_id = (await C.query('SELECT user_id FROM users ORDER BY user_id LIMIT 1')).rows[0].user_id;
    partId = (await C.query(`INSERT INTO parts (part_name, quantity, cost, category) VALUES ('TEST PART SAFETY B', 5, 100, 'ram') RETURNING part_id`)).rows[0].part_id;
    ticketId = (await C.query("SELECT ticket_id FROM tickets WHERE status = 'in_progress' ORDER BY ticket_id DESC LIMIT 1")).rows[0].ticket_id;
  });
  after(() => h.close());

  it('P3: with no unit on the shelf, approve refuses instead of inventing one', async () => {
    const r1 = await request();
    const res = await approve(r1.request_id, { auto_select: true });
    assert.equal(res.code, 400);
    assert.equal(res.body.code, 'NO_UNIT_ON_SHELF');
    const made = (await C.query('SELECT COUNT(*)::int AS n FROM part_instances WHERE part_id = $1', [partId])).rows[0].n;
    assert.equal(made, 0, 'no phantom unit created');
  });

  it('P1: a unit reserved for one request cannot be given to another', async () => {
    const u = await unit();
    const a = await request();
    const b = await request();
    const ra = await approve(a.request_id, { prt_id: u.prt_id });
    assert.equal(ra.code, 200, JSON.stringify(ra.body));
    const rb = await approve(b.request_id, { prt_id: u.prt_id });
    assert.equal(rb.code, 409);
    assert.match(rb.body.message, /already reserved/);
  });

  it('P2: "part received" does not revive a cancelled request or take an installed unit', async () => {
    const cancelled = await request('cancelled');
    const u = await unit();
    const r = await h.call(prc.markPartReceived, { params: { requestId: String(cancelled.request_id) }, body: { instance_id: u.instance_id }, user });
    assert.equal(r.code, 409);
    const open = await request('escalated');
    const installed = await unit('installed');
    const r2 = await h.call(prc.markPartReceived, { params: { requestId: String(open.request_id) }, body: { instance_id: installed.instance_id }, user });
    assert.equal(r2.code, 409);
  });

  it('P4: a part is fitted only as a reserved unit', async () => {
    const r = await request('approved');
    const res = await h.call(prc.attachPartAndReturnOld, { params: { requestId: String(r.request_id) }, body: {}, user });
    assert.equal(res.code, 400);
    assert.match(res.body.message, /No part unit is reserved/);
  });

  it('PD7 / P16: direct issue is retired and the open part routes are guarded', () => {
    const t = fs.readFileSync(require.resolve('../routes/tickets.js'), 'utf8');
    for (const route of ["'/:id/parts'", "'/:id/part-request'", "'/:id/fulfill-part'"]) {
      assert.match(t, new RegExp(`router\\.post\\(${route.replace(/[/:]/g, (c) => `\\${c}`)}, floorAnyEdit, retiredPartIssue\\)`), route);
    }
    const p = fs.readFileSync(require.resolve('../routes/partRequests.js'), 'utf8');
    assert.match(p, /router\.get\('\/ticket\/:ticketId', checkAnySectionPermission/);
    assert.match(p, /router\.get\('\/:requestId', checkAnySectionPermission/);
  });
});
