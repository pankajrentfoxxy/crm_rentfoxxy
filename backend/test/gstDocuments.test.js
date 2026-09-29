/**
 * GST documents (decisions MD7, MD8 — 29 Sep 2026).
 *
 * Pure rules first, then the real handlers end to end inside one transaction
 * that is rolled back (test/helpers/rollbackHarness), so no number, audit row or
 * activity entry is left behind. Migration 375 is replayed inside the
 * transaction, so this also runs where it is not yet applied.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const fs = require('fs');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const gstNo = require('../services/gstDocumentNumberService');

describe('GST document numbers — the rules', () => {
  const req = (o = {}) => gstNo.replaceRequest(o);

  it('the same number again, or no number, changes nothing', () => {
    assert.equal(gstNo.checkOverwrite({ label: 'x', docNumber: 'D', current: 'INV/1', next: ' inv/1 ', request: req() }), 'none');
    assert.equal(gstNo.checkOverwrite({ label: 'x', docNumber: 'D', current: 'INV/1', next: null, request: req() }), 'none');
    assert.equal(gstNo.checkOverwrite({ label: 'x', docNumber: 'D', current: null, next: '', request: req() }), 'none');
  });

  it('a first number is an attach', () => {
    assert.equal(gstNo.checkOverwrite({ label: 'x', docNumber: 'D', current: null, next: 'INV/1', request: req() }), 'attach');
  });

  it('a different number is refused unless replace + a reason', () => {
    assert.throws(
      () => gstNo.checkOverwrite({ label: 'invoice', docNumber: 'D', current: 'INV/1', next: 'INV/2', request: req() }),
      (e) => e.status === 409 && e.code === 'REPLACE_REQUIRED' && /INV\/1/.test(e.message),
    );
    assert.throws(
      () => gstNo.checkOverwrite({ label: 'invoice', docNumber: 'D', current: 'INV/1', next: 'INV/2', request: req({ replace: '1', replace_reason: 'typo' }) }),
      (e) => e.status === 400 && e.code === 'REASON_REQUIRED',
    );
    assert.equal(
      gstNo.checkOverwrite({ label: 'invoice', docNumber: 'D', current: 'INV/1', next: 'INV/2', request: req({ replace: 'true', replace_reason: 'Zoho reissued the invoice' }) }),
      'replace',
    );
  });

  it('flags parse the way a form sends them', () => {
    assert.deepEqual(req({ replace: 'on', replace_reason: '  why  ', share_invoice: 'yes' }), { replace: true, reason: 'why', shareInvoice: true });
    assert.deepEqual(req({}), { replace: false, reason: '', shareInvoice: false });
  });
});

describe('GST documents — handlers (rolled back)', () => {
  const h = require('./helpers/rollbackHarness');
  let C;
  let user;
  const q = async (sql, p) => (await C.query(sql, p)).rows;

  before(async () => {
    C = await h.open();
    await C.query(fs.readFileSync(`${__dirname}/../migrations/375_gst_document_number_changes.sql`, 'utf8'));
    const u = await q("SELECT user_id FROM users WHERE role = 'super_admin' ORDER BY user_id LIMIT 1");
    user = { user_id: u[0]?.user_id ?? null, role: 'super_admin', name: 'Test Accounts' };
  });
  after(() => h.close());

  // --- fixtures built inside the transaction -------------------------------
  async function makeDc({ dcNumber, customerId, customerName, einvoice = null, eway = null, quotationType = 'sale', rate = 25000 }) {
    const so = `SO/TEST/${dcNumber.split('/').pop()}`;
    await C.query(
      `INSERT INTO sales_order_lines (sales_order_number, customer_id, customer_name, quotation_type, brand, model_name, quantity, rate, status, created_at)
       VALUES ($1, $2, $3, $4, 'Dell', 'Latitude 5490', 1, $5, 'confirmed', NOW())`,
      [so, customerId, customerName, quotationType, rate]
    );
    await C.query(
      `INSERT INTO delivery_challan_lines
         (dc_number, sales_order_number, customer_id, customer_name, brand, model_name, quantity, status, movement_type,
          entity_code, einvoice_number, einvoice_pdf_path, eway_bill_number, eway_bill_pdf_path, created_at)
       VALUES ($1, $2, $3, $4, 'Dell', 'Latitude 5490', 1, 'pending', 'outbound', 'gorefurbo', $5, $6, $7, $8, NOW())`,
      [dcNumber, so, customerId, customerName, einvoice, einvoice ? 'uploads/test/einv.pdf' : null, eway, eway ? 'uploads/test/ewb.pdf' : null]
    );
    return { dcNumber, so };
  }

  const dcHead = async (dc) => (await q(
    'SELECT einvoice_number, eway_bill_number FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1', [dc]
  ))[0];
  const audit = (docNumber) => q(
    'SELECT field, action, old_value, new_value, reason FROM gst_document_number_changes WHERE doc_number = $1 ORDER BY id', [docNumber]
  );

  const custA = -9101;
  const custB = -9102;

  it('DC e-invoice: same number passes; a different one needs replace + reason; the replace is audited', async () => {
    const ctrl = require('../controllers/saleDcComplianceController');
    const { dcNumber } = await makeDc({ dcNumber: 'DC/TEST/0001', customerId: custA, customerName: 'Cust A', einvoice: 'ZT/TEST/0001' });

    let r = await h.call(ctrl.uploadSaleDcCompliance, { params: { dcNumber }, body: { einvoice_number: 'ZT/TEST/0001' }, user });
    assert.equal(r.code, 200, JSON.stringify(r.body));

    r = await h.call(ctrl.uploadSaleDcCompliance, { params: { dcNumber }, body: { einvoice_number: 'ZT/TEST/0002' }, user });
    assert.equal(r.code, 409);
    assert.equal(r.body.code, 'REPLACE_REQUIRED');
    assert.equal((await dcHead(dcNumber)).einvoice_number, 'ZT/TEST/0001', 'refused change leaves the number alone');

    r = await h.call(ctrl.uploadSaleDcCompliance, { params: { dcNumber }, body: { einvoice_number: 'ZT/TEST/0002', replace: '1', replace_reason: 'no' }, user });
    assert.equal(r.code, 400);
    assert.equal(r.body.code, 'REASON_REQUIRED');

    r = await h.call(ctrl.uploadSaleDcCompliance, {
      params: { dcNumber }, body: { einvoice_number: 'ZT/TEST/0002', replace: '1', replace_reason: 'Zoho cancelled and reissued' }, user,
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal((await dcHead(dcNumber)).einvoice_number, 'ZT/TEST/0002');
    const a = await audit(dcNumber);
    assert.deepEqual(a.map((x) => [x.field, x.action, x.old_value, x.new_value]), [['einvoice_number', 'replace', 'ZT/TEST/0001', 'ZT/TEST/0002']]);
    assert.equal(a[0].reason, 'Zoho cancelled and reissued');
  });

  it('DC e-invoice: another customer\'s number is refused; the same customer\'s needs a shared-invoice confirmation', async () => {
    const ctrl = require('../controllers/saleDcComplianceController');
    await makeDc({ dcNumber: 'DC/TEST/0011', customerId: custB, customerName: 'Cust B', einvoice: 'ZT/TEST/B1' });
    await makeDc({ dcNumber: 'DC/TEST/0012', customerId: custA, customerName: 'Cust A', einvoice: 'ZT/TEST/A1' });
    const { dcNumber } = await makeDc({ dcNumber: 'DC/TEST/0013', customerId: custA, customerName: 'Cust A' });
    // the "PDF required" rule runs before the number rules — give it one
    await C.query("UPDATE delivery_challan_lines SET einvoice_pdf_path = 'uploads/test/x.pdf' WHERE dc_number = $1", [dcNumber]);

    let r = await h.call(ctrl.uploadSaleDcCompliance, { params: { dcNumber }, body: { einvoice_number: 'zt/test/b1' }, user });
    assert.equal(r.code, 409);
    assert.equal(r.body.code, 'DUPLICATE_NUMBER');
    assert.match(r.body.message, /DC\/TEST\/0011/);

    r = await h.call(ctrl.uploadSaleDcCompliance, { params: { dcNumber }, body: { einvoice_number: 'ZT/TEST/A1' }, user });
    assert.equal(r.code, 409);
    assert.equal(r.body.code, 'SHARED_INVOICE_CONFIRM');

    r = await h.call(ctrl.uploadSaleDcCompliance, { params: { dcNumber }, body: { einvoice_number: 'ZT/TEST/A1', share_invoice: '1' }, user });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal((await dcHead(dcNumber)).einvoice_number, 'ZT/TEST/A1');
    assert.deepEqual((await audit(dcNumber)).map((x) => x.action), ['attach']);
  });

  it('demo / value e-way: a number on another document is refused; a replace needs a reason', async () => {
    const ctrl = require('../controllers/saleDcComplianceController');
    const { dcNumber } = await makeDc({ dcNumber: 'DC/TEST/0021', customerId: custA, customerName: 'Cust A', eway: '991100220033', quotationType: 'rental', rate: 60000 });
    await makeDc({ dcNumber: 'DC/TEST/0022', customerId: custB, customerName: 'Cust B', eway: '991100220044', quotationType: 'rental' });
    // e-way required regardless of the laptop matrix, so the value rule passes
    await C.query("UPDATE delivery_challan_lines SET eway_required = TRUE, eway_asset_value = 60000, ship_by = 'by_courier' WHERE dc_number = $1", [dcNumber]);

    // No laptops are attached, so the value falls back to the billed 60,000 — over the threshold.
    let r = await h.call(ctrl.uploadDemoEway, { params: { dcNumber }, body: { eway_bill_number: '991100220055' }, user });
    assert.equal(r.code, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, 'REPLACE_REQUIRED');

    r = await h.call(ctrl.uploadDemoEway, { params: { dcNumber }, body: { eway_bill_number: '991100220044', replace: '1', replace_reason: 'Wrong vehicle, regenerated' }, user });
    assert.equal(r.code, 409);
    assert.equal(r.body.code, 'DUPLICATE_NUMBER');

    r = await h.call(ctrl.uploadDemoEway, { params: { dcNumber }, body: { eway_bill_number: '991100220055', replace: '1', replace_reason: 'Wrong vehicle, regenerated' }, user });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal((await dcHead(dcNumber)).eway_bill_number, '991100220055');
    assert.deepEqual((await audit(dcNumber)).map((x) => [x.field, x.action]), [['eway_bill_number', 'replace']]);
  });

  it('e-way numbers are unique across customer, vendor repair, vendor return and scrap challans', async () => {
    const vr = await q("SELECT dc_number FROM vendor_repair_delivery_challans WHERE COALESCE(status, '') <> 'cancelled' ORDER BY id LIMIT 1");
    if (!vr.length) return;
    await C.query("UPDATE vendor_repair_delivery_challans SET eway_bill_number = '881100220099' WHERE dc_number = $1", [vr[0].dc_number]);
    await assert.rejects(
      gstNo.assertEwayNumberFree(C, '881100220099', { docType: 'delivery_challan', docNumber: 'DC/TEST/0099' }),
      (e) => e.code === 'DUPLICATE_NUMBER' && e.message.includes(vr[0].dc_number),
    );
    await gstNo.assertEwayNumberFree(C, '881100220099', { docType: 'vendor_repair_dc', docNumber: vr[0].dc_number });
  });

  it('sale-in-place invoice: replace needs a reason and is audited', async () => {
    const ctrl = require('../controllers/salesManagementController');
    const so = 'SO/TEST/INPLACE1';
    await C.query(
      `INSERT INTO sales_order_lines (sales_order_number, customer_id, customer_name, quotation_type, brand, model_name, quantity, rate, status,
         fulfillment_mode, sale_invoice_number, created_at)
       VALUES ($1, $2, 'Cust A', 'sale', 'Dell', 'Latitude 5490', 1, 25000, 'confirmed', 'in_place', 'ZT/TEST/S1', NOW())`,
      [so, custA]
    );
    let r = await h.call(ctrl.uploadSaleInvoice, { params: { soNumber: so }, body: { sale_invoice_number: 'ZT/TEST/S2' }, user });
    assert.equal(r.code, 409);
    assert.equal(r.body.code, 'REPLACE_REQUIRED');

    r = await h.call(ctrl.uploadSaleInvoice, { params: { soNumber: so }, body: { sale_invoice_number: 'ZT/TEST/S2', replace: '1', replace_reason: 'Wrong invoice picked' }, user });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.action, 'replace');
    const cur = await q('SELECT DISTINCT sale_invoice_number FROM sales_order_lines WHERE sales_order_number = $1', [so]);
    assert.deepEqual(cur.map((x) => x.sale_invoice_number), ['ZT/TEST/S2']);
    assert.deepEqual((await audit(so)).map((x) => [x.field, x.action, x.old_value]), [['sale_invoice_number', 'replace', 'ZT/TEST/S1']]);
  });

  it('GSP e-way generation refuses a DC that already has an e-way bill (no GSP call made)', async () => {
    const ctrl = require('../controllers/einvoiceController');
    const { dcNumber } = await makeDc({ dcNumber: 'DC/TEST/0031', customerId: custA, customerName: 'Cust A', eway: '771100220011' });
    const r = await h.call(ctrl.generateDcEWayBill, { params: { dcNumber }, body: {}, user });
    assert.equal(r.code, 409);
    assert.equal(r.body.code, 'REPLACE_REQUIRED');
    assert.equal((await dcHead(dcNumber)).eway_bill_number, '771100220011');
  });

  it('MD8: legacy generate-invoice / generate-eway are gone (410) and write nothing', async () => {
    const ctrl = require('../controllers/salesController');
    for (const fn of [ctrl.generateInvoice, ctrl.generateEwayBill]) {
      const r = await h.call(fn, { params: { id: 1 }, user });
      assert.equal(r.code, 410);
      assert.equal(r.body.code, 'GONE');
    }
  });

  it('queue amounts come from the challan billing and the GST split of its place of supply', async () => {
    const { enrichDcRows } = require('../services/gstDocumentQueueService');
    const { computeGstBreakdown } = require('../services/salesManagementService');
    const { dcNumber } = await makeDc({ dcNumber: 'DC/TEST/0041', customerId: custA, customerName: 'Cust A' });
    await C.query(
      `UPDATE delivery_challan_lines SET customer_shipping_address = '{"state":"Karnataka"}'::jsonb, supply_state = NULL WHERE dc_number = $1`,
      [dcNumber]
    );
    const [row] = await enrichDcRows([{ dc_number: dcNumber }]);
    assert.equal(row.amount_is_estimate, false);
    assert.equal(row.invoice.gst_type, 'inter', 'Karnataka from Haryana is IGST');
    assert.equal(row.invoice.cgst, 0);
    const expect = computeGstBreakdown({ subtotal: row.invoice.subtotal, supplyState: row.invoice.place_of_supply });
    assert.equal(row.invoice.igst, expect.igst);
    assert.equal(row.invoice.grand_total, expect.grand_total);
  });

  it('e-way register: known types only, newest first, and "left without" rows are all needed + gone', async () => {
    const { listEwayRegister, DOC_TYPES } = require('../services/gstDocumentQueueService');
    const all = await listEwayRegister({ limit: 100 }, { db: C });
    for (const r of all.rows) assert.ok(DOC_TYPES.includes(r.doc_type), r.doc_type);
    for (let i = 1; i < all.rows.length; i += 1) {
      assert.ok(new Date(all.rows[i - 1].created_at) >= new Date(all.rows[i].created_at), 'newest first');
    }
    const left = await listEwayRegister({ state: 'left_without', limit: 50 }, { db: C });
    for (const r of left.rows) {
      assert.equal(r.eway_state, 'needed');
      assert.equal(r.left_premises, true);
      assert.ok(r.value >= left.threshold);
    }
    assert.equal(left.total, all.counts.left_without);
  });
});
