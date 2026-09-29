/**
 * Vendor money (MD5, MD6): vendor bills, debit notes, vendor payments.
 *
 * Pure rules first, then the real handlers end to end inside one transaction
 * that is rolled back (test/helpers/rollbackHarness), so no bill, note,
 * payment or document number is left behind on QA. The DB half needs
 * migration 369 (applied on QA 29 Sep 2026).
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const vbs = require('../services/vendorBillService');

describe('vendor bill GST — the vendor state against the company state', () => {
  it('reads the state from the GSTIN before the address', () => {
    assert.deepEqual(vbs.supplyStateFromVendor({ gst_number: '07AAKCS1234F1Z5', state: 'haryana' }), { state: '07', source: 'gstin' });
    assert.deepEqual(vbs.supplyStateFromVendor({ gst_number: 'GST-PENDING', state: 'HR' }), { state: 'HR', source: 'address' });
    assert.deepEqual(vbs.supplyStateFromVendor({}), { state: null, source: null });
  });

  it('a Haryana vendor is CGST + SGST, split in half', () => {
    const g = vbs.vendorBillGst(1000.01, '06');
    assert.equal(g.is_intra_state, true);
    assert.equal(g.igst_amount, 0);
    assert.equal(g.gst_amount, 180);
    assert.equal(+(g.cgst_amount + g.sgst_amount).toFixed(2), g.gst_amount);
  });

  it('a Delhi vendor is IGST, and the total is still 18%', () => {
    const g = vbs.vendorBillGst(532.14, '07');
    assert.equal(g.is_intra_state, false);
    assert.equal(g.cgst_amount, 0);
    assert.equal(g.sgst_amount, 0);
    assert.equal(g.igst_amount, 95.79);
    assert.equal(g.gst_amount, 95.79);
  });

  it('the hardcoded subtotal * 0.18 is gone from vendor bill generation', () => {
    const src = fs.readFileSync(`${__dirname}/../services/billingSchedulerService.js`, 'utf8');
    assert.ok(!/subtotal \* 0\.18/.test(src));
  });
});

describe('which debit notes a bill deducts', () => {
  it('takes whole notes, oldest first, while they fit under the bill', () => {
    const r = vbs.pickDebitNotes([
      { debit_note_id: 1, amount: '300' },
      { debit_note_id: 2, amount: '900' },
      { debit_note_id: 3, amount: '150' },
    ], 1000);
    assert.deepEqual(r.applied.map((n) => n.debit_note_id), [1, 3]);
    assert.equal(r.total, 450);
  });

  it('skips a Rs 0 note and never takes the bill below zero', () => {
    const r = vbs.pickDebitNotes([{ debit_note_id: 1, amount: 0 }, { debit_note_id: 2, amount: 5000 }], 100);
    assert.equal(r.applied.length, 0);
    assert.equal(r.total, 0);
  });
});

describe('debit note amounts', () => {
  it('amount wins; else units x rate; else a Rs 0 draft', () => {
    assert.equal(vbs.resolveAmount({ amount: '1200.555' }).amount, 1200.56);
    assert.equal(vbs.resolveAmount({ quantity: 3, unit_rate: 250 }).amount, 750);
    assert.equal(vbs.resolveAmount({}).amount, 0);
  });
  it('refuses a negative amount', () => {
    assert.throws(() => vbs.resolveAmount({ amount: -5 }), /zero or more/);
  });
});

describe('routes — the new endpoints keep the sections the API already uses', () => {
  const src = fs.readFileSync(`${__dirname}/../routes/vendorBilling.js`, 'utf8');
  it('vendor payments list is vendor_billing_mgmt view', () => {
    assert.match(src, /router\.get\('\/payments', cp\('vendor_billing_mgmt', 'view'\)/);
  });
  it('debit note read / set amount / cancel are debit_notes view / create / edit', () => {
    assert.match(src, /router\.get\('\/debit-notes\/:id', cp\('debit_notes', 'view'\)/);
    assert.match(src, /router\.patch\('\/debit-notes\/:id', cp\('debit_notes', 'create'\)/);
    assert.match(src, /router\.patch\('\/debit-notes\/:id\/cancel', cp\('debit_notes', 'edit'\)/);
  });
});

// ── End to end on QA, rolled back ───────────────────────────────────────────

const H = require('./helpers/rollbackHarness');
const ctrl = require('../controllers/vendorBillingController');

describe('vendor bills, debit notes and payments — end to end (rolled back)', () => {
  let db;
  let maker;
  let checker;
  let vendorId;
  let month;
  let year;
  let oldBill;

  before(async () => {
    db = await H.open();
    const users = (await db.query(`SELECT user_id, name, role FROM users ORDER BY user_id LIMIT 2`)).rows;
    maker = { user_id: users[0].user_id, name: users[0].name, role: 'super_admin' };
    checker = { user_id: users[1].user_id, name: users[1].name, role: 'super_admin' };
    // The latest live bill with lines — it is cancelled and regenerated below.
    oldBill = (await db.query(
      `SELECT * FROM vendor_monthly_bills
        WHERE status = 'generated' AND jsonb_array_length(COALESCE(line_items, '[]'::jsonb)) > 0
          AND subtotal > 0
        ORDER BY bill_year DESC, bill_month DESC, bill_id DESC LIMIT 1`
    )).rows[0];
    assert.ok(oldBill, 'QA has a generated vendor bill with lines to work on');
    vendorId = oldBill.vendor_id;
    month = oldBill.bill_month;
    year = oldBill.bill_year;
  });
  after(async () => { await H.close(); });

  const dnInsert = async (amount, status, createdAt) => (await db.query(
    `INSERT INTO vendor_debit_notes (debit_note_number, vendor_id, reason, amount, status, created_at)
     VALUES ($1, $2, 'test', $3, $4, $5::timestamptz) RETURNING *`,
    [`DN-T-${Math.random().toString(36).slice(2, 9)}`, vendorId, amount, status, createdAt]
  )).rows[0];

  it('cancel works now (the status check allows it), with a reason, and locks the month for regeneration only after', async () => {
    const noReason = await H.call(ctrl.cancelVendorBill, { params: { id: oldBill.bill_id }, body: { reason: '' }, user: maker });
    assert.equal(noReason.code, 400);
    const r = await H.call(ctrl.cancelVendorBill, { params: { id: oldBill.bill_id }, body: { reason: 'wrong rent start, regenerating' }, user: maker });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.bill.status, 'cancelled');
    const again = await H.call(ctrl.cancelVendorBill, { params: { id: oldBill.bill_id }, body: { reason: 'second time around' }, user: maker });
    assert.equal(again.code, 409);
  });

  let bill;
  let early;
  let late;

  it('regenerates the month: GST split stored, generated_by written, only notes from the period deducted', async () => {
    const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const afterEnd = new Date(Date.UTC(year, month, 5)).toISOString().slice(0, 10);
    early = await dnInsert(10, 'approved', `${monthEnd}T06:00:00Z`);
    late = await dnInsert(7, 'approved', `${afterEnd}T06:00:00Z`);
    const draft = await dnInsert(0, 'pending', `${monthEnd}T06:00:00Z`);

    const r = await H.call(ctrl.generateVendorBill, { body: { vendor_id: vendorId, month, year }, user: maker });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    bill = r.body.bill;
    assert.notEqual(bill.bill_id, oldBill.bill_id);
    assert.equal(Number(bill.generated_by), maker.user_id);
    assert.notEqual(bill.is_intra_state, null);
    const heads = Number(bill.cgst_amount) + Number(bill.sgst_amount) + Number(bill.igst_amount);
    assert.equal(heads.toFixed(2), Number(bill.gst_amount).toFixed(2));
    assert.equal((Number(bill.subtotal) * 0.18).toFixed(2), Number(bill.gst_amount).toFixed(2));
    if (bill.is_intra_state) assert.equal(Number(bill.igst_amount), 0);
    else assert.equal(Number(bill.cgst_amount), 0);

    assert.equal(Number(bill.debit_note_adjustment), 10);
    assert.equal(
      Number(bill.total_payable).toFixed(2),
      (Number(bill.subtotal) + Number(bill.gst_amount) - 10).toFixed(2)
    );
    const notes = (await db.query(
      `SELECT debit_note_id, status, adjusted_in_bill_id FROM vendor_debit_notes WHERE debit_note_id = ANY($1::int[])`,
      [[early.debit_note_id, late.debit_note_id, draft.debit_note_id]]
    )).rows;
    const by = Object.fromEntries(notes.map((n) => [n.debit_note_id, n]));
    assert.equal(by[early.debit_note_id].status, 'adjusted');
    assert.equal(by[early.debit_note_id].adjusted_in_bill_id, bill.bill_id);
    assert.equal(by[late.debit_note_id].status, 'approved', 'a note raised after the month waits for the next bill');
    assert.equal(by[late.debit_note_id].adjusted_in_bill_id, null);
    assert.equal(by[draft.debit_note_id].status, 'pending');

    const rec = await H.call(ctrl.getVendorBill, { params: { billId: bill.bill_id }, user: maker });
    assert.deepEqual(rec.body.debit_notes.map((d) => d.debit_note_id), [early.debit_note_id]);
  });

  it('the same month cannot be generated twice while a live bill exists', async () => {
    const r = await H.call(ctrl.generateVendorBill, { body: { vendor_id: vendorId, month, year }, user: maker });
    assert.equal(r.code, 409);
  });

  it('refuses a future month', async () => {
    const r = await H.call(ctrl.generateVendorBill, { body: { vendor_id: vendorId, month: 12, year: 2099 }, user: maker });
    assert.equal(r.code, 400);
  });

  it('cancelling a bill hands its debit notes back to the next bill', async () => {
    const r = await H.call(ctrl.cancelVendorBill, { params: { id: bill.bill_id }, body: { reason: 'test release of notes' }, user: maker });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const n = (await db.query(`SELECT status, adjusted_in_bill_id FROM vendor_debit_notes WHERE debit_note_id = $1`, [early.debit_note_id])).rows[0];
    assert.equal(n.status, 'approved');
    assert.equal(n.adjusted_in_bill_id, null);
    const again = await H.call(ctrl.generateVendorBill, { body: { vendor_id: vendorId, month, year }, user: maker });
    assert.equal(again.code, 200, JSON.stringify(again.body));
    bill = again.body.bill;
    assert.equal(Number(bill.debit_note_adjustment), 10);
  });

  it('maker-checker: the generator cannot approve; someone else can', async () => {
    const own = await H.call(ctrl.approveVendorBill, { params: { id: bill.bill_id }, user: maker });
    assert.equal(own.code, 403);
    const ok = await H.call(ctrl.approveVendorBill, { params: { id: bill.bill_id }, user: checker });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.bill.status, 'approved');
  });

  it('payments: locked, capped at what is owed, partial then full, then no more', async () => {
    const total = Number(bill.total_payable);
    const over = await H.call(ctrl.recordBillPayment, { params: { id: bill.bill_id }, body: { amount: total + 1 }, user: checker });
    assert.equal(over.code, 400);
    assert.match(over.body.message, /more than/);
    const zero = await H.call(ctrl.recordBillPayment, { params: { id: bill.bill_id }, body: { amount: 0 }, user: checker });
    assert.equal(zero.code, 400);
    const future = await H.call(ctrl.recordBillPayment, { params: { id: bill.bill_id }, body: { amount: 1, payment_date: '2099-01-01' }, user: checker });
    assert.equal(future.code, 400);

    const part = await H.call(ctrl.recordBillPayment, {
      params: { id: bill.bill_id }, body: { amount: 100, reference: 'UTR-TEST-1', method: 'neft' }, user: checker,
    });
    assert.equal(part.code, 201, JSON.stringify(part.body));
    assert.equal(part.body.status, 'partially_paid');

    const noCancel = await H.call(ctrl.cancelVendorBill, { params: { id: bill.bill_id }, body: { reason: 'paid bills do not cancel' }, user: maker });
    assert.equal(noCancel.code, 409);

    const rest = await H.call(ctrl.markVendorBillPaid, { params: { id: bill.bill_id }, body: { payment_reference: 'UTR-TEST-2' }, user: checker });
    assert.equal(rest.code, 200, JSON.stringify(rest.body));
    assert.equal(rest.body.bill.status, 'paid');
    assert.equal(Number(rest.body.bill.amount_paid).toFixed(2), total.toFixed(2));

    const more = await H.call(ctrl.recordBillPayment, { params: { id: bill.bill_id }, body: { amount: 1 }, user: checker });
    assert.equal(more.code, 409);

    const list = await H.call(ctrl.listVendorPayments, { query: { search: 'UTR-TEST' }, user: checker });
    assert.equal(list.code, 200);
    assert.equal(list.body.payments.length, 2);
    assert.equal(list.body.payments[0].bill_number, bill.bill_number);
  });

  it('an unapproved (generated) bill cannot be paid', async () => {
    const other = (await db.query(
      `SELECT bill_id FROM vendor_monthly_bills WHERE status = 'generated' AND total_payable > 0 LIMIT 1`
    )).rows[0];
    if (!other) return;
    const r = await H.call(ctrl.recordBillPayment, { params: { id: other.bill_id }, body: { amount: 1 }, user: checker });
    assert.equal(r.code, 409);
    assert.match(r.body.message, /only an approved bill/);
  });

  it('debit note drafts: Rs 0 cannot be approved; set the amount, then approve', async () => {
    const draft = await dnInsert(0, 'pending', new Date().toISOString());
    const zero = await H.call(ctrl.approveDebitNote, { params: { id: draft.debit_note_id }, user: checker });
    assert.equal(zero.code, 409);
    assert.match(zero.body.message, /Rs 0/);

    const bad = await H.call(ctrl.updateDebitNote, { params: { id: draft.debit_note_id }, body: { amount: 0 }, user: maker });
    assert.equal(bad.code, 400);
    const set = await H.call(ctrl.updateDebitNote, { params: { id: draft.debit_note_id }, body: { amount: '1499.50' }, user: maker });
    assert.equal(set.code, 200, JSON.stringify(set.body));
    assert.equal(Number(set.body.debit_note.amount), 1499.5);
    assert.equal(set.body.debit_note.amount_set_by, maker.user_id);

    const ok = await H.call(ctrl.approveDebitNote, { params: { id: draft.debit_note_id }, user: checker });
    assert.equal(ok.code, 200);
    assert.equal(ok.body.debit_note.status, 'approved');
    const locked = await H.call(ctrl.updateDebitNote, { params: { id: draft.debit_note_id }, body: { amount: 5 }, user: maker });
    assert.equal(locked.code, 409);

    const rec = await H.call(ctrl.getDebitNote, { params: { id: draft.debit_note_id }, user: maker });
    assert.equal(rec.code, 200);
    assert.ok(rec.body.events.some((e) => e.event_type === 'debit_note_approved'));
  });

  it('debit note cancel: needs a reason; a deducted note cannot be cancelled', async () => {
    const draft = await dnInsert(0, 'pending', new Date().toISOString());
    const noWhy = await H.call(ctrl.cancelDebitNote, { params: { id: draft.debit_note_id }, body: {}, user: checker });
    assert.equal(noWhy.code, 400);
    const r = await H.call(ctrl.cancelDebitNote, { params: { id: draft.debit_note_id }, body: { reason: 'raised against the wrong laptop' }, user: checker });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.debit_note.status, 'cancelled');
    assert.equal(r.body.debit_note.cancelled_by, checker.user_id);
    const twice = await H.call(ctrl.cancelDebitNote, { params: { id: draft.debit_note_id }, body: { reason: 'again and again' }, user: checker });
    assert.equal(twice.code, 409);

    const deducted = await H.call(ctrl.cancelDebitNote, { params: { id: early.debit_note_id }, body: { reason: 'it is on a bill already' }, user: checker });
    assert.equal(deducted.code, 409);
  });

  it('the vendor pick-list: billable vendors by default, every active vendor with scope=all', async () => {
    const billable = await H.call(ctrl.listBillableVendors, { query: {}, user: maker });
    const all = await H.call(ctrl.listBillableVendors, { query: { scope: 'all' }, user: maker });
    assert.equal(billable.code, 200);
    assert.equal(all.code, 200);
    assert.ok(all.body.vendors.length >= billable.body.vendors.length);
    const dnVendors = (await db.query(`SELECT DISTINCT vendor_id FROM vendor_debit_notes`)).rows.map((r) => r.vendor_id);
    const ids = new Set(all.body.vendors.map((v) => v.vendor_id));
    for (const v of dnVendors) assert.ok(ids.has(v), `vendor ${v} with a debit note is pickable`);
  });

  it('a manual debit note gets its number inside the transaction and checks the PO belongs to the vendor', async () => {
    const before_ = (await db.query(`SELECT last_value FROM sm_document_sequences WHERE doc_type = 'vendor_debit_note'`)).rows[0];
    const otherPo = (await db.query(`SELECT po_id FROM vendor_purchase_orders WHERE vendor_id <> $1 LIMIT 1`, [vendorId])).rows[0];
    if (otherPo) {
      const wrong = await H.call(ctrl.createDebitNote, { body: { vendor_id: vendorId, reason: 'Damage', amount: 100, po_id: otherPo.po_id }, user: maker });
      assert.equal(wrong.code, 400);
      const unchanged = (await db.query(`SELECT last_value FROM sm_document_sequences WHERE doc_type = 'vendor_debit_note'`)).rows[0];
      assert.equal(unchanged.last_value, before_.last_value, 'a refused note burns no number');
    }
    const r = await H.call(ctrl.createDebitNote, { body: { vendor_id: vendorId, reason: 'Damage', quantity: 2, unit_rate: 400 }, user: maker });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    assert.equal(Number(r.body.debit_note.amount), 800);
    assert.match(r.body.debit_note.debit_note_number, /^DN-/);
    const list = await H.call(ctrl.listDebitNotes, { query: { search: r.body.debit_note.debit_note_number }, user: maker });
    assert.equal(list.body.debit_notes.length, 1);
  });
});
