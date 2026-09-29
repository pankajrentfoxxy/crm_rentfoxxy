/**
 * Spare-parts PO receiving (builder 7): the count rules first, then the real
 * receive / GRN handlers end to end inside one transaction that is rolled back
 * (no Part ID, asset code or GRN is used up).
 *
 * Fixed and covered here: over-receiving past the ordered quantity (count now
 * read under a row lock inside the transaction), a double submit receiving
 * twice (receive_key), receipts not moving the PO status, GRNs opened on
 * cancelled / fully received POs and double-clicked into empty duplicates,
 * and legacy part-id receipts hiding new receipts on the same line.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ctrl = require('../controllers/vendorManagement/sparePartsOrders.controller');

const empty = { byIdx: {}, byPd: {}, unalloc: 0 };

describe('spare receive — the rules', () => {
  it('status follows the receipt: first part → processing, every line full → completed', () => {
    const lines = (a, b) => [{ quantity: 3, receivedQty: a }, { quantity: 2, receivedQty: b }];
    assert.equal(ctrl.spareStatusAfterReceipt('approved', lines(0, 0)), null);
    assert.equal(ctrl.spareStatusAfterReceipt('approved', lines(1, 0)), 'processing');
    assert.equal(ctrl.spareStatusAfterReceipt('processing', lines(2, 0)), null);
    // 5 of 5 in total is not enough when one line is short and another over.
    assert.equal(ctrl.spareStatusAfterReceipt('processing', [{ quantity: 3, receivedQty: 4 }, { quantity: 2, receivedQty: 1 }]), null);
    assert.equal(ctrl.spareStatusAfterReceipt('processing', lines(3, 2)), 'completed');
    assert.equal(ctrl.spareStatusAfterReceipt('approved', lines(3, 2)), 'completed');
  });

  it('never moves a closed, cancelled, completed or draft PO', () => {
    for (const st of ['closed', 'cancelled', 'completed', 'draft', 'pending']) {
      assert.equal(ctrl.spareStatusAfterReceipt(st, [{ quantity: 1, receivedQty: 1 }]), null, st);
    }
  });

  it('counts receipts by line, and a legacy part-id receipt no longer hides them', () => {
    const lines = [{ part_id: 7, quantity: 5 }];
    const out = ctrl.enrichSpareLinesWithReceived(lines, { byIdx: { 0: 2 }, byPd: { 7: 1 }, unalloc: 0 });
    // Before: byPd won and the two new receipts were not counted (1, not 3).
    assert.equal(out[0].receivedQty, 3);
  });

  it('shares legacy part-id receipts over lines with the same part instead of repeating them', () => {
    const lines = [{ part_id: 7, quantity: 2 }, { part_id: 7, quantity: 4 }];
    const out = ctrl.enrichSpareLinesWithReceived(lines, { byIdx: {}, byPd: { 7: 3 }, unalloc: 0 });
    assert.deepEqual(out.map((l) => l.receivedQty), [2, 1]);
    const over = ctrl.enrichSpareLinesWithReceived(lines, { byIdx: {}, byPd: { 7: 9 }, unalloc: 0 });
    assert.deepEqual(over.map((l) => l.receivedQty), [2, 7]);
  });

  it('keeps a preset received count (ERP import) when higher', () => {
    const out = ctrl.enrichSpareLinesWithReceived([{ quantity: 4, receivedQty: 3 }], empty);
    assert.equal(out[0].receivedQty, 3);
  });
});

describe('spare receive — handlers (rolled back)', () => {
  const h = require('./helpers/rollbackHarness');
  let db;
  let user;
  let spoId;
  const tag = `ZZSPR${Date.now()}`;
  const LINES = [
    { part_id: 100, floor_part_id: 11, parts_catalog_id: 11, spare_part_name: 'Laptop Battery', category: 'battery', brand_name: 'Any', quantity: 3, rate: 4000, warranty_months: 12 },
    { part_id: 275, floor_part_id: 97, parts_catalog_id: 97, spare_part_name: '32 GB', category: 'ram', brand_name: 'Crucial', part_type: 'DDR4', quantity: 2, rate: 1999, warranty_months: 6 },
  ];

  const bulk = (body) => h.call(ctrl.receiveSpareLineBulk, {
    user, params: { spoId: String(spoId) }, body, validators: ctrl.receiveSpareLineBulkValidators,
  });
  const grn = (body = {}) => h.call(ctrl.createSpareGrn, {
    user, params: { spoId: String(spoId) }, body, validators: [...ctrl.spareGrnPoParam, ...ctrl.spareGrnCreateValidators],
  });
  const status = async () => (await db.query('SELECT status FROM vendor_spare_parts_purchase_orders WHERE spo_id = $1', [spoId])).rows[0].status;

  before(async () => {
    db = await h.open();
    user = (await db.query("SELECT user_id, role, name, email FROM users WHERE role = 'super_admin' ORDER BY user_id LIMIT 1")).rows[0];
    const vendor = (await db.query('SELECT vendor_id FROM vendors WHERE deleted_at IS NULL ORDER BY vendor_id LIMIT 1')).rows[0];
    assert.ok(user && vendor, 'a super_admin and a vendor exist');
    spoId = (await db.query(
      `INSERT INTO vendor_spare_parts_purchase_orders
         (purchase_order_number, purchase_order_date, vendor_id, po_state, line_items, status)
       VALUES ($1, CURRENT_DATE, $2, 'haryana', $3::jsonb, 'approved') RETURNING spo_id`,
      [tag, vendor.vendor_id, JSON.stringify(LINES)]
    )).rows[0].spo_id;
  });
  after(async () => { await h.close(); });

  it('opens a GRN with the vendor challan / invoice, and a double click reuses the empty one', async () => {
    const a = await grn({ vendor_challan_no: 'CH-1', vendor_invoice_no: 'INV-9' });
    assert.equal(a.code, 201, JSON.stringify(a.body));
    assert.equal(a.body.data.vendor_challan_no, 'CH-1');
    assert.equal(a.body.data.grn_number, `GRN-${String(a.body.data.grn_id).padStart(4, '0')}`);
    const b = await grn({});
    assert.equal(b.code, 200);
    assert.equal(b.body.data.grn_id, a.body.data.grn_id);
    assert.equal(b.body.data.reused, true);
  });

  it('receives part of a line: Part IDs, shelf and note on the units, PO moves to processing', async () => {
    const r = await bulk({ line_index: 0, quantity: 2, serial_numbers: [`${tag}A`, ''], location_code: 'R1-S2', note: 'box dented', receive_key: `${tag}-k1` });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.created.length, 2);
    assert.ok(r.body.data.created.every((u) => /^PRT/.test(u.prt_id)), JSON.stringify(r.body.data.created));
    assert.equal(r.body.data.created[1].physical_serial, null);
    assert.equal(r.body.data.lines[0].receivedQty, 2);
    assert.equal(r.body.data.status, 'processing');
    assert.equal(await status(), 'processing');
    const units = (await db.query('SELECT location_code, notes, unit_cost FROM part_instances WHERE instance_id = ANY($1::int[])', [r.body.data.created.map((u) => u.instance_id)])).rows;
    assert.ok(units.every((u) => u.location_code === 'R1-S2' && u.notes === 'box dented' && Number(u.unit_cost) === 4000), JSON.stringify(units));
  });

  it('a repeated submit (same receive_key) returns the first result and receives nothing more', async () => {
    const before = (await db.query('SELECT COUNT(*)::int n FROM vendor_serial_numbers WHERE spo_id = $1', [spoId])).rows[0].n;
    const r = await bulk({ line_index: 0, quantity: 2, serial_numbers: [`${tag}A`, ''], receive_key: `${tag}-k1` });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.replayed, true);
    assert.equal(r.body.data.created.length, 2);
    const after = (await db.query('SELECT COUNT(*)::int n FROM vendor_serial_numbers WHERE spo_id = $1', [spoId])).rows[0].n;
    assert.equal(after, before);
  });

  it('refuses more than is left on the line, and a serial already in stock', async () => {
    const over = await bulk({ line_index: 0, quantity: 2, serial_numbers: ['', ''] });
    assert.equal(over.code, 409);
    assert.equal(over.body.code, 'OVER_RECEIPT');
    const dup = await bulk({ line_index: 0, quantity: 1, serial_numbers: [`${tag}a`] });
    assert.equal(dup.code, 409);
    assert.equal(dup.body.code, 'DUPLICATE_SERIAL');
    const badLine = await bulk({ line_index: 5, quantity: 1, serial_numbers: [''] });
    assert.equal(badLine.code, 400);
  });

  it('the single-unit receive has the same guard', async () => {
    const one = await h.call(ctrl.receiveSpareLineSerial, {
      user, params: { spoId: String(spoId) }, body: { line_index: 0, serial_number: '' }, validators: ctrl.receiveSpareSerialValidators,
    });
    assert.equal(one.code, 201, JSON.stringify(one.body));
    assert.ok(/^PRT/.test(one.body.data.prt_id));
    const again = await h.call(ctrl.receiveSpareLineSerial, {
      user, params: { spoId: String(spoId) }, body: { line_index: 0, serial_number: '' }, validators: ctrl.receiveSpareSerialValidators,
    });
    assert.equal(again.code, 409);
  });

  it('receiving the last line completes the PO; then no new GRN and no receipt', async () => {
    const r = await bulk({ line_index: 1, quantity: 2, serial_numbers: ['', ''] });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.status, 'completed');
    assert.equal(await status(), 'completed');
    const g = await grn({});
    assert.equal(g.code, 409);
    const more = await bulk({ line_index: 1, quantity: 1, serial_numbers: [''] });
    assert.equal(more.code, 409);
  });

  it('GRN detail lists each unit with its Part ID', async () => {
    const g = (await db.query('SELECT grn_id FROM vendor_goods_received_notes WHERE spo_id = $1 ORDER BY grn_id LIMIT 1', [spoId])).rows[0];
    const r = await h.call(ctrl.getSpareGrnReceivedProducts, {
      user, params: { spoId: String(spoId), grnId: String(g.grn_id) }, validators: ctrl.spareGrnReceivedProductsValidators,
    });
    assert.equal(r.code, 200);
    assert.equal(r.body.data.vendor_invoice_no, 'INV-9');
    assert.equal(r.body.data.items.length, 5); // 3 + 2 ordered, all received
    assert.ok(r.body.data.items.every((i) => i.prt_id));
  });

  it('a cancelled PO takes no GRN and no receipt', async () => {
    await db.query("UPDATE vendor_spare_parts_purchase_orders SET status = 'cancelled' WHERE spo_id = $1", [spoId]);
    assert.equal((await grn({})).code, 409);
    assert.equal((await bulk({ line_index: 0, quantity: 1, serial_numbers: [''] })).code, 403);
  });
});
