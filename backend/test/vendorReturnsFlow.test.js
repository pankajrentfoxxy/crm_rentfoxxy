/**
 * Procure to stock step 6 — laptops going back to the vendor (B1/D11, B5, D9,
 * D12, B14, B23). One connection, one outer transaction, rolled back: the
 * handlers' BEGIN/COMMIT become savepoints, so nothing is left behind.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');

let C;
const realConnect = pool.connect.bind(pool);
const realQuery = pool.query.bind(pool);
function wrapClient(c) {
  let depth = 0;
  return {
    query: (text, ...rest) => {
      const t = typeof text === 'string' ? text.trim().toUpperCase() : '';
      if (t === 'BEGIN') { depth += 1; return c.query(`SAVEPOINT r${depth}`); }
      if (t === 'COMMIT') { depth -= 1; return c.query(`RELEASE SAVEPOINT r${depth + 1}`); }
      if (t === 'ROLLBACK') { depth -= 1; return c.query(`ROLLBACK TO SAVEPOINT r${depth + 1}`); }
      return c.query(text, ...rest);
    },
    release: () => {},
  };
}
const call = async (fn, { params = {}, body = {}, user, validators = [] }) => {
  const res = { code: 200, body: null, headersSent: false };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; res.headersSent = true; return res; };
  const req = { params, body, query: {}, user };
  for (const v of validators) await v.run(req);
  await fn(req, res);
  return res;
};

const po = require('../controllers/vendorManagement/purchaseOrders.controller');
const phase2 = require('../controllers/ticketPhase2Controller');
const sm = require('../services/inventoryStateMachine');
const rtv = require('../services/vendorReturnToVendorService');
const vrdc = require('../services/vendorRepairDcService');

describe('a laptop going back to its vendor', () => {
  const user = { user_id: null, name: 'Test Floor', role: 'manager' };
  let poId;
  let serialId;
  let ticketId;

  before(async () => {
    C = await realConnect();
    await C.query('BEGIN');
    const w = wrapClient(C);
    pool.connect = async (...a) => (a.length ? realConnect(...a) : w);
    pool.query = (...a) => C.query(...a);
    user.user_id = (await C.query('SELECT user_id FROM users ORDER BY user_id LIMIT 1')).rows[0].user_id;
    const v = (await C.query("SELECT vendor_id FROM vendors WHERE deleted_at IS NULL AND status = 'approved' LIMIT 1")).rows[0];
    const line = { brand: 'Dell', model: 'Latitude 5410', processor: 'Intel Core i5', generation: '10th Gen', ram: '8GB RAM', storage: '256GB SSD', quantity: 1, rate: 1500, allowed_conditions: ['on', 'not_on'] };
    poId = (await C.query(
      `INSERT INTO vendor_purchase_orders (purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state, sub_total_amount, total_amount, line_items, status)
       VALUES ('TEST-RT-1', CURRENT_DATE, 'rental_purchase', $1, 'haryana', 1500, 1770, $2::jsonb, 'approved') RETURNING po_id`,
      [v.vendor_id, JSON.stringify([line])]
    )).rows[0].po_id;
    const r = await call(po.receivePoLineUnit, {
      params: { poId: String(poId) },
      body: { line_index: 0, rental_start_date: '2026-09-26', serial_number: 'TESTRT-1', received_condition: 'not_on', config_capture_waiver_reason: 'No power at all on arrival' },
      user, validators: po.receivePoLineUnitValidators,
    });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    serialId = r.body.data.created.serial_id;
    ticketId = r.body.data.ticket?.ticket_id || r.body.data.ticket?.ticketId
      || (await C.query('SELECT ticket_id FROM tickets WHERE vendor_serial_id = $1', [serialId])).rows[0].ticket_id;
  });
  after(async () => {
    await C.query('ROLLBACK');
    C.release();
    pool.connect = realConnect;
    pool.query = realQuery;
    await pool.end();
  });

  it('floor QC fail moves the laptop to qc_failed and drafts one debit note (B1, D11, D12)', async () => {
    const r = await call(phase2.markQcFailed, { params: { id: String(ticketId) }, body: { reason: 'Motherboard dead' }, user });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.ok(r.body.debit_note?.debit_note_number);
    const s = (await C.query('SELECT inventory_status FROM vendor_serial_numbers WHERE serial_id = $1', [serialId])).rows[0];
    assert.equal(s.inventory_status, 'qc_failed');
  });

  it('it can go on a return challan, and while it is there it cannot be reserved (B5)', async () => {
    const dc = await rtv.createReturnDc(C, { serialIds: [serialId], returnReason: 'QC failed', actorUserId: user.user_id, actorName: user.name });
    const dcNumber = dc.dc_number || dc.dc?.dc_number || dc.head?.dc_number;
    assert.ok(dcNumber, JSON.stringify(dc).slice(0, 300));
    // Returns take in_stock / returned laptops too; that is where the hold matters.
    await sm.transitionAsset(C, { serialId, toStatus: sm.STATUS.IN_STOCK, caller: 'test' });
    await assert.rejects(
      sm.transitionAsset(C, { serialId, toStatus: sm.STATUS.RESERVED, caller: 'test' }),
      /is on vendor return/
    );
    // B14: cancelling the challan cancels its item rows too.
    await rtv.cancelReturnDc(C, { dcNumber, actorUserId: user.user_id, actorName: user.name });
    const it2 = (await C.query('SELECT item_status FROM vendor_return_dc_items WHERE dc_number = $1', [dcNumber])).rows[0];
    assert.equal(it2.item_status, 'cancelled');
  });

  it('returned_to_vendor is a real state, reachable and not terminal (D9)', () => {
    assert.equal(sm.isAllowed('qc_failed', 'returned_to_vendor'), true);
    assert.equal(sm.isAllowed('in_repair', 'returned_to_vendor'), true);
    assert.equal(sm.isAllowed('returned_to_vendor', 'in_repair'), true);
    assert.equal(sm.isAllowed('returned_to_vendor', 'reserved'), false);
    assert.equal(sm.isAllowed('scrapped', 'returned_to_vendor'), false);
  });

  it('a second return does not draft a second debit note while one is pending', async () => {
    const svc = require('../services/vendorDebitNoteService');
    const again = await svc.draftForReturn(C, { serialId, source: 'return_challan', sourceRef: 'TEST' });
    assert.equal(again, null);
  });

  it('a repair challan that has not gone out can be cancelled (B23)', async () => {
    await C.query(
      `INSERT INTO vendor_repair_delivery_challans (dc_number, vendor_name, status, item_domain, items_dispatched_count, items_received_count)
       VALUES ('TEST-VRDC-1', 'Test vendor', 'draft', 'laptop', 0, 0)`
    );
    await C.query(
      `INSERT INTO vendor_repair_dc_items (dc_number, ticket_id, serial_id, ttspl_id, serial_number, item_status)
       VALUES ('TEST-VRDC-1', $1, $2, 'TESTTTSPL', 'TESTRT-1', 'draft')`,
      [ticketId, serialId]
    );
    await C.query("UPDATE tickets SET vendor_repair_dc_number = 'TEST-VRDC-1' WHERE ticket_id = $1", [ticketId]);
    await assert.rejects(vrdc.cancelVendorRepairDc(C, { dcNumber: 'TEST-VRDC-1', reason: '' }), /reason/);
    const out = await vrdc.cancelVendorRepairDc(C, { dcNumber: 'TEST-VRDC-1', reason: 'Vendor closed', actorUserId: user.user_id });
    assert.equal(out.status, 'cancelled');
    const t = (await C.query('SELECT vendor_repair_dc_number FROM tickets WHERE ticket_id = $1', [ticketId])).rows[0];
    assert.equal(t.vendor_repair_dc_number, null);
    await assert.rejects(vrdc.cancelVendorRepairDc(C, { dcNumber: 'TEST-VRDC-1', reason: 'again' }), /only one that has not gone out/);
  });
});
