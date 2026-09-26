/**
 * Procure screens 3 — D2 on laptop POs: amend (back to approval), cancel (only
 * while nothing is received; a manager's call once approved), short-close
 * (manager, partly received). Also D3: a rental line's rate is its monthly rent.
 * Test POs are inserted with a TEST- number so no real PO number is used up.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const po = require('../controllers/vendorManagement/purchaseOrders.controller');
const spo = require('../controllers/vendorManagement/sparePartsOrders.controller');
const { applyRentalRate, mapLineForProductDetail } = require('../services/purchaseOrderProductDetailsService');

const call = async (fn, { id, body = {}, user }) => {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  const req = { params: { id: String(id) }, body, query: {}, user };
  for (const v of (fn.validators || po.reasonValidators)) await v.run(req);
  await fn(req, res);
  return res;
};

describe('D3 rental rate', () => {
  it('a rental line is billed and totalled at its monthly rent', () => {
    const [l] = applyRentalRate([{ quantity: 2, rate: 25000, monthly_rental_amount: 1999 }], 'rental_purchase');
    assert.equal(l.rate, 1999);
    assert.equal(mapLineForProductDetail({ quantity: 2, rate: 25000, monthly_rental_amount: 1999 }, 'rent_to_own').rate, 1999);
    assert.equal(applyRentalRate([{ rate: 500, monthly_rental_amount: 9 }], 'direct_purchase')[0].rate, 500);
  });
});

describe('amend / cancel / short-close', () => {
  const manager = { user_id: null, name: 'Test Manager', role: 'manager' };
  const clerk = { user_id: null, name: 'Test Clerk', role: 'procurement' };
  const ids = [];
  let vendorId;
  const make = async (status) => {
    const r = await pool.query(
      `INSERT INTO vendor_purchase_orders (purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state,
         sub_total_amount, total_amount, line_items, status)
       VALUES ($1, CURRENT_DATE, 'direct_purchase', $2, 'haryana', 1000, 1180, '[{"brand":"Dell","quantity":1,"rate":1000}]'::jsonb, $3)
       RETURNING po_id`,
      [`TEST-D2-${Date.now()}-${ids.length}`, vendorId, status]
    );
    ids.push(r.rows[0].po_id);
    return r.rows[0].po_id;
  };
  before(async () => {
    const u = (await pool.query('SELECT user_id FROM users ORDER BY user_id LIMIT 2')).rows;
    manager.user_id = u[0].user_id; clerk.user_id = u[1].user_id;
    vendorId = (await pool.query("SELECT vendor_id FROM vendors WHERE deleted_at IS NULL ORDER BY vendor_id LIMIT 1")).rows[0].vendor_id;
  });
  after(async () => {
    for (const id of ids) {
      await pool.query('DELETE FROM purchase_order_activities WHERE po_id = $1', [id]);
      await pool.query("DELETE FROM vendor_audit_logs WHERE entity_type = 'purchase_order' AND entity_id = $1", [String(id)]);
      await pool.query('DELETE FROM vendor_purchase_orders WHERE po_id = $1', [id]);
    }
  });

  it('needs a reason', async () => {
    const id = await make('draft');
    const r = await call(po.cancel, { id, body: {}, user: clerk });
    assert.equal(r.code, 400);
  });

  it('anyone with edit cancels a draft; the To-buy link is released', async () => {
    const id = await make('draft');
    const r = await call(po.cancel, { id, body: { reason: 'duplicate' }, user: clerk });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const row = (await pool.query('SELECT status, cancel_reason, cancelled_by FROM vendor_purchase_orders WHERE po_id = $1', [id])).rows[0];
    assert.deepEqual([row.status, row.cancel_reason, row.cancelled_by], ['cancelled', 'duplicate', clerk.user_id]);
    const again = await call(po.cancel, { id, body: { reason: 'again' }, user: clerk });
    assert.equal(again.code, 409);
  });

  it('only a manager cancels an approved PO', async () => {
    const id = await make('approved');
    assert.equal((await call(po.cancel, { id, body: { reason: 'vendor out of stock' }, user: clerk })).code, 409);
    assert.equal((await call(po.cancel, { id, body: { reason: 'vendor out of stock' }, user: manager })).code, 200);
  });

  it('amending an approved PO sends it back to draft with the next amendment number', async () => {
    const id = await make('approved');
    const r = await call(po.amend, { id, body: { reason: 'price changed' }, user: clerk });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.status, 'draft');
    assert.equal(r.body.data.amendment_no, 1);
    assert.equal(r.body.data.approved_at, null);
    assert.equal((await call(po.amend, { id, body: { reason: 'again' }, user: clerk })).code, 409, 'a draft is edited, not amended');
  });

  it('short-close needs a manager, an approved PO and something received', async () => {
    const id = await make('processing');
    assert.equal((await call(po.shortClose, { id, body: { reason: 'vendor has no more' }, user: clerk })).code, 409);
    const r = await call(po.shortClose, { id, body: { reason: 'vendor has no more' }, user: manager });
    assert.equal(r.code, 409);
    assert.match(r.body.message, /cancel it instead/);
  });
});

describe('spare-parts POs follow the same rules (D13)', () => {
  const manager = { user_id: null, name: 'Test Manager', role: 'manager' };
  const clerk = { user_id: null, name: 'Test Clerk', role: 'procurement' };
  const ids = [];
  let vendorId;
  const make = async (status) => {
    const r = await pool.query(
      `INSERT INTO vendor_spare_parts_purchase_orders (purchase_order_number, purchase_order_date, vendor_id, po_state, sub_total_amount, total_amount, line_items, status)
       VALUES ($1, CURRENT_DATE, $2, 'haryana', 100, 118, '[{"spare_part_name":"Battery","quantity":1,"rate":100}]'::jsonb, $3) RETURNING spo_id`,
      [`TEST-SPO-${Date.now()}-${ids.length}`, vendorId, status]
    );
    ids.push(r.rows[0].spo_id);
    return r.rows[0].spo_id;
  };
  const run = async (fn, id, body, user) => {
    const res = { code: 200, body: null };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    const req = { params: { id: String(id) }, body, query: {}, user };
    for (const v of spo.reasonValidators) await v.run(req);
    await fn(req, res);
    return res;
  };
  before(async () => {
    const u = (await pool.query('SELECT user_id FROM users ORDER BY user_id LIMIT 2')).rows;
    manager.user_id = u[0].user_id; clerk.user_id = u[1].user_id;
    vendorId = (await pool.query('SELECT vendor_id FROM vendors WHERE deleted_at IS NULL ORDER BY vendor_id LIMIT 1')).rows[0].vendor_id;
  });
  after(async () => {
    for (const id of ids) {
      await pool.query("DELETE FROM vendor_audit_logs WHERE entity_type = 'spare_parts_po' AND entity_id = $1", [String(id)]);
      await pool.query('DELETE FROM vendor_spare_parts_purchase_orders WHERE spo_id = $1', [id]);
    }
  });

  it('cancel is a status with a reason, not a silent delete; approved needs a manager', async () => {
    const a = await make('approved');
    assert.equal((await run(spo.cancel, a, { reason: 'not needed' }, clerk)).code, 409);
    const r = await run(spo.cancel, a, { reason: 'not needed' }, manager);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const row = (await pool.query('SELECT status, cancel_reason, deleted_at FROM vendor_spare_parts_purchase_orders WHERE spo_id = $1', [a])).rows[0];
    assert.deepEqual([row.status, row.cancel_reason, row.deleted_at], ['cancelled', 'not needed', null]);
  });

  it('amend returns an approved spare PO to draft; short-close refuses when nothing arrived', async () => {
    const a = await make('approved');
    const r = await run(spo.amend, a, { reason: 'price changed' }, clerk);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.data.status, r.body.data.amendment_no], ['draft', 1]);
    const b = await make('approved');
    assert.match((await run(spo.shortClose, b, { reason: 'no more' }, manager)).body.message, /cancel it instead/);
  });
});

after(() => pool.end());
