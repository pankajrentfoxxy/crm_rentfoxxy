/**
 * Procure-to-stock safety, batch A: purchase orders can only change the way the
 * process says (D1, D2, D13). Drives the real handlers on throwaway POs and
 * deletes them afterwards.
 */
// Load the outbound-mail block FIRST: approving emails the vendor, submitting
// emails managers, and a test must never send either.
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const po = require('../controllers/vendorManagement/purchaseOrders.controller');
const spo = require('../controllers/vendorManagement/sparePartsOrders.controller');
const rules = require('../services/purchaseOrderRules');

const call = async (fn, { params = {}, body = {}, user }) => {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  await fn({ params, body, query: {}, user }, res);
  return res;
};
// Two real users (status stamps reference users); the role is the test's.
const alice = { user_id: null, name: 'Test Alice', role: 'manager' };
const bob = { user_id: null, name: 'Test Bob', role: 'manager' };

describe('purchase order rules (pure)', () => {
  it('edits only before submission or after a rejection', () => {
    for (const s of ['draft', '', 'pending', 'rejected', 'vendor_rejected']) assert.equal(rules.canEditPo(s), true, s);
    for (const s of ['pending_approval', 'approved', 'processing', 'completed', 'vendor_accepted']) assert.equal(rules.canEditPo(s), false, s);
    assert.equal(rules.statusAfterEdit('rejected'), 'draft');
  });
  it('the creator or submitter cannot approve', () => {
    assert.ok(rules.approvalConflict({ approverId: 1, creatorId: 1 }));
    assert.ok(rules.approvalConflict({ approverId: 1, creatorId: 2, submitterId: 1 }));
    assert.equal(rules.approvalConflict({ approverId: 3, creatorId: 1, submitterId: 2 }), null);
    assert.equal(rules.approvalConflict({ approverId: 3 }), null, 'unknown people never block');
  });
  it('a spare PO is received only once approved (drafts could be before)', () => {
    for (const st of ['approved', 'processing', 'completed']) assert.equal(rules.spareReceivable(st), true, st);
    for (const st of ['draft', 'pending', '', 'rejected']) assert.equal(rules.spareReceivable(st), false, st);
  });
  it('compares states the same way whatever the spelling', () => {
    assert.equal(rules.normalizeState('Madhya Pradesh'), rules.normalizeState('madhya_pradesh'));
  });
});

describe('laptop purchase orders against the database', () => {
  let vendorId;
  const created = [];
  before(async () => {
    const u = (await pool.query('SELECT user_id FROM users ORDER BY user_id LIMIT 2')).rows;
    alice.user_id = u[0].user_id; bob.user_id = u[1].user_id;
    vendorId = (await pool.query("SELECT vendor_id FROM vendors WHERE deleted_at IS NULL AND status = 'approved' ORDER BY vendor_id LIMIT 1")).rows[0].vendor_id;
  });
  after(async () => {
    for (const id of created) {
      const n = (await pool.query('SELECT purchase_order_number FROM vendor_purchase_orders WHERE po_id = $1', [id])).rows[0]?.purchase_order_number;
      await pool.query('DELETE FROM vendor_serial_numbers WHERE po_id = $1', [id]);
      await pool.query('DELETE FROM vendor_goods_received_notes WHERE po_id = $1', [id]);
      await pool.query('DELETE FROM purchase_order_activities WHERE po_id = $1', [id]);
      await pool.query('DELETE FROM vendor_product_details WHERE po_id = $1', [id]);
      await pool.query("DELETE FROM vendor_audit_logs WHERE entity_type = 'purchase_order' AND entity_id = $1", [String(id)]);
      await pool.query('DELETE FROM vendor_purchase_orders WHERE po_id = $1', [id]);
      const dir = path.join(__dirname, '..', 'uploads', 'vendor-po-documents');
      if (n && fs.existsSync(dir)) fs.readdirSync(dir).filter((f) => f.startsWith(n)).forEach((f) => fs.unlinkSync(path.join(dir, f)));
    }
    await pool.end();
  });

  const line = { brand: 'Dell', model: 'Test', processor: 'Intel Core i5', generation: '8th Gen', ram: '8GB', storage: '256GB SSD', quantity: 1, rate: 1000, monthly_rental_amount: 1000, allowed_conditions: ['on'] };
  const newPo = (extra = {}) => call(po.create, {
    user: alice,
    body: { purchase_order_date: '2026-09-26', purchase_order_type: 'rental_purchase', vendor_id: vendorId, po_state: 'haryana', remarks: 'TEST safety — safe to ignore', line_items: [line], ...extra },
  });

  it('a new PO is always a draft with a server-allocated number, whatever the request says', async () => {
    const r = await newPo({ status: 'approved', purchase_order_number: 'PO-TEST-EVIL', sub_total_amount: 1 });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    created.push(r.body.data.po_id);
    assert.equal(r.body.data.status, 'draft');
    assert.match(r.body.data.purchase_order_number, /^PO-\d+$/);
    assert.equal(Number(r.body.data.sub_total_amount), 1000, 'subtotal comes from the lines');
  });

  it('editing cannot set the status; a draft can be edited', async () => {
    const id = created[0];
    assert.equal((await call(po.update, { user: alice, params: { id }, body: { status: 'approved' } })).code, 400);
    const ok = await call(po.update, { user: alice, params: { id }, body: { remarks: 'TEST edited', line_items: [{ ...line, quantity: 2 }] } });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));
    assert.equal(Number(ok.body.data.sub_total_amount), 2000);
    const pd = await pool.query('SELECT SUM(quantity)::int AS q FROM vendor_product_details WHERE po_id = $1', [id]);
    assert.equal(pd.rows[0].q, 2, 'product records follow the edited lines');
  });

  it('the submitter cannot approve; someone else can, once', async () => {
    const id = created[0];
    assert.equal((await call(po.updateStatus, { user: alice, params: { id }, body: { status: 'pending_approval' } })).code, 200);
    const self = await call(po.updateStatus, { user: alice, params: { id }, body: { status: 'approved' } });
    assert.equal(self.code, 403);
    assert.equal(self.body.code, 'SELF_APPROVAL');
    assert.equal((await call(po.updateStatus, { user: bob, params: { id }, body: { status: 'approved' } })).code, 200);
    assert.equal((await call(po.updateStatus, { user: bob, params: { id }, body: { status: 'approved' } })).code, 400, 'already approved');
  });

  it('an approved PO cannot be edited', async () => {
    const r = await call(po.update, { user: bob, params: { id: created[0] }, body: { remarks: 'sneaky' } });
    assert.equal(r.code, 409);
    assert.equal(r.body.code, 'PO_LOCKED');
  });

  it('a PO with a received laptop cannot be cancelled; an empty one can', async () => {
    const id = created[0];
    const grn = await pool.query("INSERT INTO vendor_goods_received_notes (po_id, meta) VALUES ($1, '{}') RETURNING grn_id", [id]);
    await pool.query("INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, extra) VALUES ($1, $2, 'TEST-SAFETY-SN', '{}')", [id, grn.rows[0].grn_id]);
    const r = await call(po.remove, { user: bob, params: { id } });
    assert.equal(r.code, 409);
    assert.equal(r.body.code, 'PO_HAS_RECEIPTS');

    const empty = await newPo();
    created.push(empty.body.data.po_id);
    assert.equal((await call(po.remove, { user: alice, params: { id: empty.body.data.po_id } })).code, 200);
  });
});
