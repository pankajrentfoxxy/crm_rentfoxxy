/**
 * Procure to stock step 5 — gate arrival and receiving (D4, D5, D6, D7).
 *
 * Drives the real handlers end to end: the guard logs a delivery, the
 * warehouse receives against it (one laptop that won't power on, one rejected
 * at the door), the guard's count caps the receipt, a manager approves the
 * waiver, the delivery closes. Everything runs on ONE connection inside an
 * outer transaction — the handlers' BEGIN/COMMIT become savepoints — and is
 * rolled back, so no TTSPL code, PO or GRN is left behind.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');

let C; // the one connection
const realConnect = pool.connect.bind(pool);
const realQuery = pool.query.bind(pool);
function wrapClient(c) {
  let depth = 0;
  return {
    query: (text, ...rest) => {
      const t = typeof text === 'string' ? text.trim().toUpperCase() : '';
      if (t === 'BEGIN') { depth += 1; return c.query(`SAVEPOINT h${depth}`); }
      if (t === 'COMMIT') { depth -= 1; return c.query(`RELEASE SAVEPOINT h${depth + 1}`); }
      if (t === 'ROLLBACK') { depth -= 1; return c.query(`ROLLBACK TO SAVEPOINT h${depth + 1}`); }
      return c.query(text, ...rest);
    },
    release: () => {},
  };
}

const po = require('../controllers/vendorManagement/purchaseOrders.controller');
const dl = require('../controllers/vendorManagement/vendorDeliveries.controller');

const call = async (fn, { params = {}, body = {}, user, validators = [] }) => {
  const res = { code: 200, body: null, headersSent: false };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; res.headersSent = true; return res; };
  const req = { params, body, query: {}, user };
  for (const v of validators) await v.run(req);
  await fn(req, res);
  return res;
};

describe('vendor delivery → receive → close', () => {
  const guard = { user_id: null, name: 'Test Guard', role: 'guard' };
  const clerk = { user_id: null, name: 'Test Warehouse', role: 'warehouse' };
  const manager = { user_id: null, name: 'Test Manager', role: 'manager' };
  let poId;
  let delivery;

  before(async () => {
    C = await realConnect();
    await C.query('BEGIN');
    const w = wrapClient(C);
    pool.connect = async (...a) => (a.length ? realConnect(...a) : w);
    pool.query = (...a) => C.query(...a);
    const u = (await C.query('SELECT user_id FROM users ORDER BY user_id LIMIT 3')).rows;
    guard.user_id = u[0].user_id; clerk.user_id = u[1].user_id; manager.user_id = u[2].user_id;
    const v = (await C.query("SELECT vendor_id FROM vendors WHERE deleted_at IS NULL AND status = 'approved' LIMIT 1")).rows[0];
    const line = { brand: 'Dell', model: 'Latitude 5410', processor: 'Intel Core i5', generation: '10th Gen', ram: '8GB RAM', storage: '256GB SSD', quantity: 2, rate: 1500, monthly_rental_amount: 1500, allowed_conditions: ['on', 'not_on'] };
    poId = (await C.query(
      `INSERT INTO vendor_purchase_orders (purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state, sub_total_amount, total_amount, line_items, status)
       VALUES ('TEST-VD-1', CURRENT_DATE, 'rental_purchase', $1, 'haryana', 3000, 3540, $2::jsonb, 'approved') RETURNING po_id`,
      [v.vendor_id, JSON.stringify([line])]
    )).rows[0].po_id;
  });
  after(async () => {
    await C.query('ROLLBACK');
    C.release();
    pool.connect = realConnect;
    pool.query = realQuery;
    await pool.end();
  });

  const receive = (body, user = clerk) => call(po.receivePoLineUnit, {
    params: { poId: String(poId) },
    body: { line_index: 0, rental_start_date: '2026-09-26', ...body },
    user,
    validators: po.receivePoLineUnitValidators,
  });

  it('the guard logs the delivery with the challan and count', async () => {
    const r = await call(dl.create, { body: { po_id: poId, laptop_count: 2, vendor_challan_no: 'DC-778' }, user: guard, validators: dl.createValidators });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    delivery = r.body.data;
    assert.match(delivery.delivery_number, /^VD-\d{6}$/);
    assert.equal(delivery.status, 'arrived');
    const exp = await call(dl.expected, { user: guard });
    assert.ok(exp.body.data.some((x) => x.po_id === poId && x.remaining === 2));
  });

  it('a laptop that will not power on is received with a waiver on the delivery’s own GRN', async () => {
    const r = await receive({ serial_number: 'TESTVD-NOTON', received_condition: 'not_on', config_capture_waiver_reason: 'No power at all on arrival', delivery_id: delivery.delivery_id });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.created.waiver_pending, true);
    const d = (await C.query('SELECT status, grn_id FROM vendor_deliveries WHERE delivery_id = $1', [delivery.delivery_id])).rows[0];
    assert.equal(d.status, 'receiving');
    const g = (await C.query('SELECT delivery_id, vendor_challan_no FROM vendor_goods_received_notes WHERE grn_id = $1', [d.grn_id])).rows[0];
    assert.deepEqual([g.delivery_id, g.vendor_challan_no], [delivery.delivery_id, 'DC-778']);
  });

  it('a wrong laptop is rejected at the door: qc_failed, no floor ticket, not counted on the line', async () => {
    const r = await receive({ serial_number: 'TESTVD-WRONG', reject_at_receipt: true, rejection_reason: 'i3 sent, i5 ordered', delivery_id: delivery.delivery_id });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    const s = (await C.query('SELECT serial_id, inventory_status, rejected_at_receipt FROM vendor_serial_numbers WHERE serial_number = $1', ['TESTVD-WRONG'])).rows[0];
    assert.deepEqual([s.inventory_status, s.rejected_at_receipt], ['qc_failed', true]);
    const t = (await C.query('SELECT COUNT(*)::int AS n FROM tickets WHERE vendor_serial_id = $1', [s.serial_id])).rows[0];
    assert.equal(t.n, 0);
    const line = r.body.data.lines[0];
    assert.equal(Number(line.receivedQty), 1, 'only the accepted laptop counts');
  });

  it('refuses a laptop beyond the count the guard logged', async () => {
    const r = await receive({ serial_number: 'TESTVD-EXTRA', received_condition: 'not_on', config_capture_waiver_reason: 'No power at all on arrival', delivery_id: delivery.delivery_id });
    assert.equal(r.code, 409);
    assert.match(r.body.message, /guard logged 2/);
  });

  it('only a manager approves the waiver', async () => {
    const s = (await C.query("SELECT serial_id FROM vendor_serial_numbers WHERE serial_number = 'TESTVD-NOTON'")).rows[0];
    assert.equal((await call(dl.approveWaiver, { params: { serialId: String(s.serial_id) }, user: clerk })).code, 403);
    assert.equal((await call(dl.approveWaiver, { params: { serialId: String(s.serial_id) }, user: manager })).code, 200);
    const one = await call(dl.getOne, { params: { id: String(delivery.delivery_id) }, user: clerk });
    assert.equal(one.body.data.units.length, 2);
    assert.equal(one.body.data.waiver_pending_count, 0);
    assert.equal(one.body.data.rejected_count, 1);
  });

  it('closes the delivery; a missing laptop needs a note', async () => {
    const r = await call(dl.complete, { params: { id: String(delivery.delivery_id) }, body: {}, user: clerk, validators: dl.completeValidators });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.status, 'received');
    const d2 = await call(dl.create, { body: { po_id: poId, laptop_count: 3, vendor_challan_no: 'DC-779' }, user: guard, validators: dl.createValidators });
    const short = await call(dl.complete, { params: { id: String(d2.body.data.delivery_id) }, body: {}, user: clerk, validators: dl.completeValidators });
    assert.equal(short.body.code, 'COUNT_MISMATCH');
  });

  it('vendor billing leaves the rejected laptop out', async () => {
    const { VENDOR_LINE_RATE_SQL, VENDOR_LINE_JOIN_SQL } = require('../services/billingSchedulerService');
    assert.ok(VENDOR_LINE_RATE_SQL && VENDOR_LINE_JOIN_SQL);
    const src = require('fs').readFileSync(require.resolve('../services/billingSchedulerService'), 'utf8');
    assert.equal((src.match(/NOT COALESCE\(vsn\.rejected_at_receipt, FALSE\)/g) || []).length, 2);
  });
});
