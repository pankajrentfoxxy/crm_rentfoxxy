/**
 * Support safety fixes (claude/carret-support.md, build step 0). One rolled-back
 * transaction; nothing is left behind.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const hx = require('./helpers/rollbackHarness');

describe('support safety', () => {
  let C;
  let support;
  let delivery;
  before(async () => {
    C = await hx.open();
    support = require('../controllers/supportController');
    delivery = require('../controllers/deliveryFlowController');
  });
  after(async () => { await hx.close(); });

  it('S12: an unknown laptop status is refused, and every change is audited from → to', async () => {
    const item = (await C.query("SELECT id, ticket_id, status FROM support_ticket_items WHERE status = 'open' LIMIT 1")).rows[0];
    assert.ok(item, 'needs one open support item on QA');
    await C.query('SAVEPOINT s1');
    await assert.rejects(C.query("UPDATE support_ticket_items SET status = 'bogus' WHERE id = $1", [item.id]), /support_ticket_items_status_check/);
    await C.query('ROLLBACK TO SAVEPOINT s1');
    await C.query("UPDATE support_ticket_items SET status = 'assigned' WHERE id = $1", [item.id]);
    const a = (await C.query(
      "SELECT detail FROM support_ticket_item_audit WHERE item_id = $1 AND action = 'status_changed' ORDER BY id DESC LIMIT 1",
      [item.id]
    )).rows[0];
    assert.deepEqual(a.detail, { from: 'open', to: 'assigned' });
    await C.query('SAVEPOINT s2');
    await assert.rejects(C.query("UPDATE support_tickets SET status = 'whatever' WHERE id = $1", [item.ticket_id]), /support_tickets_status_check/);
    await C.query('ROLLBACK TO SAVEPOINT s2');
  });

  it('U2: a replacement order only takes a real status', async () => {
    const r = await hx.call(support.updateReplacementOrder, {
      params: { orderId: '1' }, body: { status: 'order_placed' }, user: { user_id: 1, role: 'super_admin' },
    });
    assert.equal(r.code, 400);
    assert.match(r.body.message, /dispatched, delivered, cancelled/);
  });

  it('V5: only the person a DC is out with can mark it reached', async () => {
    const dc = (await C.query(
      "SELECT dc_number, delivery_person_id FROM delivery_challan_lines WHERE status IN ('in_transit','reached') AND delivery_person_id IS NOT NULL LIMIT 1"
    )).rows[0];
    if (!dc) return;
    const stranger = (await C.query(
      `SELECT u.user_id FROM users u
        WHERE NOT EXISTS (SELECT 1 FROM delivery_technicians dt WHERE dt.user_id = u.user_id AND dt.technician_id = $1)
          AND u.user_id <> $1 ORDER BY u.user_id LIMIT 1`,
      [dc.delivery_person_id]
    )).rows[0];
    const r = await hx.call(delivery.markTechReached, {
      params: { dcNumber: dc.dc_number }, body: {}, user: { user_id: stranger.user_id, role: 'support_tech' },
    });
    assert.equal(r.code, 403);
  });

  it('U22: the laptop bucket shows only your own unless you supervise', async () => {
    const r = await hx.call(support.getTechnicianLaptopBucket, { user: { user_id: -999, role: 'sales' } });
    assert.equal(r.body.total, 0, 'a non-supervisor with no jobs sees nothing, not everyone');
  });
});
