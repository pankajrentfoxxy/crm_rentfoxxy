/**
 * Vendor repair challan (claude/carret-vendor-repair.md): rent pause on the
 * vendor mail, resume on gate-in, replacement check + approval, vendor keeps
 * it, cancel, e-way at Rs 50,000+, and the daily vendor-bill maths.
 *
 * The rules alone first, then the whole flow on the database inside one
 * rolled-back transaction. Mail is captured, never sent.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
delete process.env.VENDOR_RETURN_REQUEST_CC;
require('../services/outboundMessagingGuard');

const mail = require('../services/dispatchEmailService');
const sent = [];
const attached = [];
mail.sendDispatchMail = async (m) => { sent.push(m); if (m.pdfRelativePath) attached.push(m.pdfRelativePath); return true; };
mail.isDispatchMailConfigured = () => true;

const fs = require('fs');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const hx = require('./helpers/rollbackHarness');
const { calcVendorLineAmount, pausedDaysInRange } = require('../services/billingMath');
const repairMail = require('../services/vendorRepairMail');
const reqMail = require('../services/vendorReturnRequestMail');
const vrdcEway = require('../services/vrdcEwayComplianceService');
const shared = require('../services/vendorRepairDcShared');

const today = reqMail.todayIst();
const SIGN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('vendor repair rules', () => {
  it('paused days come out of the vendor line, the resume day is billed', () => {
    const monthStart = new Date(2026, 8, 1);
    const monthEnd = new Date(2026, 8, 30);
    const base = { receivedAt: new Date(2026, 0, 1), returnedAt: null, monthStart, monthEnd, monthlyRate: 3000 };
    assert.equal(calcVendorLineAmount(base).days, 30);
    // Paused 10th..19th, resumed 20th → 10 days not billed.
    const r = calcVendorLineAmount({ ...base, pauses: [{ from: new Date(2026, 8, 10), to: new Date(2026, 8, 19) }] });
    assert.equal(r.days, 20);
    assert.equal(r.pausedDays, 10);
    assert.equal(r.amount, 2000);
    // Still paused from the 25th → 6 days not billed.
    assert.equal(calcVendorLineAmount({ ...base, pauses: [{ from: new Date(2026, 8, 25), to: null }] }).days, 24);
    // Paused all month → no line.
    assert.equal(calcVendorLineAmount({ ...base, pauses: [{ from: new Date(2026, 7, 20), to: null }] }), null);
    // Overlapping pauses are not double counted.
    assert.equal(pausedDaysInRange([{ from: new Date(2026, 8, 1), to: new Date(2026, 8, 5) }, { from: new Date(2026, 8, 3), to: new Date(2026, 8, 7) }], monthStart, monthEnd), 7);
  });

  it('declared value: asset value, else a purchase-looking rate on a rental line, else the purchase rate', () => {
    assert.equal(repairMail.declaredValueFromLine('rental_purchase', { asset_value: 32000, rate: 1500 }), 32000);
    assert.equal(repairMail.declaredValueFromLine('rental_purchase', { rate: 25000, monthly_rental_amount: 1999 }), 25000);
    assert.equal(repairMail.declaredValueFromLine('rental_purchase', { rate: 1500 }), null);
    assert.equal(repairMail.declaredValueFromLine('direct_purchase', { rate: '41,000' }), 41000);
  });

  it('a laptop repair challan needs an e-way bill from Rs 50,000; part/scrap keep "above"', () => {
    assert.equal(vrdcEway.requiresVrdcEway(50000), true);
    assert.equal(vrdcEway.requiresVrdcEway(49999), false);
    assert.equal(shared.requiresVrdcEway(50000), false);
  });

  it('the repair mail names the rent stop, the issues, and the replacement rule', () => {
    const m = repairMail.buildRepairRequestMail({
      dc: { dc_number: 'VRDC/26-27/9999', vendor_name: 'Acme' },
      items: [{ ttspl_id: 'TTSPL1', serial_number: 'S1', configuration: 'Dell · 5410', issue_type: 'display', item_remarks: 'Lines on screen' }],
      stopDate: '2026-10-01', contactName: 'Ravi', pausedCount: 1,
    });
    assert.match(m.html, /stopping the rent on this laptop from <strong>01 Oct 2026<\/strong>/);
    assert.match(m.html, /Display \/ screen/);
    assert.match(m.html, /Lines on screen/);
    assert.match(m.html, /needs our approval/);
  });
});

describe('vendor repair on the database', () => {
  const user = { user_id: null, name: 'Test Warehouse', role: 'manager', email: 'wh@test' };
  const approver = { user_id: null, name: 'Test Accounts', role: 'accounts', email: 'acc@test' };
  let C; let svc; let rent; let gate; let capture; let ctl;
  let vendorId; let serials = []; let tickets = [];
  const stop = reqMail.addDays(today, 1);
  const files = [];

  before(async () => {
    C = await hx.open();
    svc = require('../services/vendorRepairDcService');
    rent = require('../services/vendorRepairRentService');
    gate = require('../services/vendorRepairGateService');
    capture = require('../services/vendorReturnCaptureService');
    ctl = require('../controllers/vendorRepairController');
    user.user_id = (await C.query('SELECT user_id FROM users ORDER BY user_id LIMIT 1')).rows[0].user_id;
    approver.user_id = user.user_id;
    vendorId = (await C.query("SELECT vendor_id FROM vendors WHERE deleted_at IS NULL AND status = 'approved' ORDER BY vendor_id LIMIT 1")).rows[0].vendor_id;
    await C.query("UPDATE vendors SET email = 'test-vendor@rentfoxxy.com', contact_person_name = 'Test Contact' WHERE vendor_id = $1", [vendorId]);
    const line = { brand: 'Dell', model: 'Latitude 5410', processor: 'Intel Core i5', generation: '10th Gen', ram: '8GB', storage: '256GB SSD', quantity: 4, rate: 1500, asset_value: 30000, allowed_conditions: ['on', 'not_on'] };
    const poId = (await C.query(
      `INSERT INTO vendor_purchase_orders (purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state, sub_total_amount, total_amount, line_items, status)
       VALUES ('TEST-VRDC-R1', CURRENT_DATE, 'rental_purchase', $1, 'haryana', 6000, 7080, $2::jsonb, 'approved') RETURNING po_id`,
      [vendorId, JSON.stringify([line])]
    )).rows[0].po_id;
    const po = require('../controllers/vendorManagement/purchaseOrders.controller');
    for (let i = 1; i <= 4; i += 1) {
      const r = await hx.call(po.receivePoLineUnit, {
        params: { poId: String(poId) },
        body: { line_index: 0, rental_start_date: reqMail.addDays(today, -90), serial_number: `TESTVRDC-${i}`, received_condition: 'not_on', config_capture_waiver_reason: 'No power at all on arrival' },
        user, validators: po.receivePoLineUnitValidators,
      });
      assert.equal(r.code, 201, JSON.stringify(r.body));
      serials.push(r.body.data.created.serial_id);
    }
    await C.query(
      `UPDATE vendor_serial_numbers SET extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb WHERE serial_id = ANY($1::int[])`,
      [serials, JSON.stringify({ brand: 'Dell', model: 'Latitude 5410', processor: 'Intel Core i5', generation: '10th Gen', ram: '8GB', storage: '256GB SSD' })]
    );
    tickets = (await C.query('SELECT ticket_id, vendor_serial_id, ttspl_id, serial_number FROM tickets WHERE vendor_serial_id = ANY($1::int[]) ORDER BY vendor_serial_id', [serials])).rows;
    for (const t of tickets) {
      await svc.markDiagnosisFailed(C, { ticketId: t.ticket_id, reason: 'Board fault', actorUserId: user.user_id, actorName: user.name });
    }
  });
  after(async () => {
    for (const f of files) { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }
    for (const rel of attached) { try { fs.unlinkSync(path.join(__dirname, '..', rel)); } catch (_) { /* gone */ } }
    await hx.close();
  });

  const createArgs = (ts, extra = {}) => ({
    ticketIds: ts.map((t) => t.ticket_id),
    vendorId, vendorName: 'Test vendor', vendorAddress: 'Somewhere', shippingAddress: 'Somewhere',
    itemVerifications: Object.fromEntries(ts.map((t) => [t.ticket_id, { ttspl: t.ttspl_id, serial: t.serial_number }])),
    itemIssueTypes: Object.fromEntries(ts.map((t) => [t.ticket_id, 'motherboard'])),
    itemRemarks: Object.fromEntries(ts.map((t) => [t.ticket_id, 'Does not power on'])),
    rentStopDate: stop,
    ship_by: 'by_courier', courier_name: 'DTDC', awb_number: 'AWB123',
    actorUserId: user.user_id, actorName: user.name, actorRole: 'manager',
    ...extra,
  });

  let dc;
  it('a challan needs an issue type and remarks per laptop, and a rent stop date for laptops rented from the vendor', async () => {
    const three = tickets.slice(0, 3);
    await C.query('SAVEPOINT a');
    await assert.rejects(svc.createOutForRepairDc(C, createArgs(three, { itemIssueTypes: {} })), /issue type/);
    await C.query('ROLLBACK TO SAVEPOINT a');
    await assert.rejects(svc.createOutForRepairDc(C, createArgs(three, { rentStopDate: undefined })), /rented from this vendor/);
    await C.query('ROLLBACK TO SAVEPOINT a');
    await assert.rejects(svc.createOutForRepairDc(C, createArgs(three, { ship_by: 'by_porter', porter_person_name: 'Raju' })), /phone/i);
    await C.query('ROLLBACK TO SAVEPOINT a');
    const r = await svc.createOutForRepairDc(C, createArgs(three));
    dc = r.dc_number;
    assert.equal(r.rent_stop_date, stop);
    assert.equal(r.rented_from_vendor, 3);
    assert.equal(r.total_declared, 90000, 'pre-filled from the PO line asset value');
    assert.equal(r.eway_required, true);
  });

  it('it cannot go to the gate before the vendor is mailed; the mail pauses rent from the stop date', async () => {
    await C.query('SAVEPOINT b');
    await assert.rejects(svc.signDispatchDc(C, { dcNumber: dc, warehouseEsign: SIGN, actorUserId: user.user_id }), /Mail the vendor first/);
    await C.query('ROLLBACK TO SAVEPOINT b');
    sent.length = 0;
    const out = await rent.sendRepairMail(C, { dcNumber: dc, actorUserId: user.user_id, actorName: user.name });
    assert.equal(out.paused, 3);
    assert.equal(sent[0].to, 'test-vendor@rentfoxxy.com');
    assert.match(sent[0].cc, /accounts@truetechservices\.in/);
    assert.ok(fs.existsSync(path.join(__dirname, '..', sent[0].pdfRelativePath)));
    const p = (await C.query("SELECT COUNT(*)::int AS n, MIN(to_char(paused_from, 'YYYY-MM-DD')) AS f FROM vendor_rent_pauses WHERE source_ref = $1 AND closed_reason IS NULL", [dc])).rows[0];
    assert.equal(p.n, 3);
    assert.equal(p.f, stop);
  });

  it('signing for dispatch at Rs 50,000+ mails Accounts; the gate will not let it out without the e-way bill', async () => {
    const r = await hx.call(ctl.signDispatch, { params: { dcNumber: dc }, body: { warehouse_esign: SIGN }, user });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.eway_request?.required, true);
    assert.equal(r.body.eway_request?.sent, true, JSON.stringify(r.body.eway_request));
    const acc = sent.find((m) => /E-Way Bill Required/.test(m.subject));
    assert.ok(acc);
    assert.match(acc.html, /By brand and model/);
    assert.match(acc.html, /AWB123/);
    await C.query('SAVEPOINT c');
    await assert.rejects(gate.applyOutwardGateVrdc(C, { dcNumber: dc, serialIds: [], actorUserId: user.user_id }), /E-way Bill required/);
    await C.query('ROLLBACK TO SAVEPOINT c');
    await C.query("UPDATE vendor_repair_delivery_challans SET eway_bill_number = '123456789012' WHERE dc_number = $1", [dc]);
    await gate.applyOutwardGateVrdc(C, { dcNumber: dc, serialIds: [], actorUserId: user.user_id });
    const h = (await C.query('SELECT status FROM vendor_repair_delivery_challans WHERE dc_number = $1', [dc])).rows[0];
    assert.equal(h.status, 'dispatched');
  });

  it('a repaired laptop resumes rent on its gate-in date', async () => {
    await gate.applyInwardGateVrdc(C, { dcNumber: dc, serialIds: [serials[0]], actorUserId: user.user_id });
    await C.query(
      `UPDATE vendor_repair_dc_items SET return_config_verified_at = NOW(), return_captured_serial = serial_number
        WHERE dc_number = $1 AND serial_id = $2`,
      [dc, serials[0]]
    );
    await svc.receiveFromVendor(C, {
      dcNumber: dc, receiveItems: [{ ticket_id: tickets[0].ticket_id, receive_mode: 'repaired', laptop_condition: 'on', wh_esign: SIGN, wh_signer_name: 'WH' }],
      actorUserId: user.user_id, actorName: user.name, actorRole: 'manager',
    });
    const p = (await C.query("SELECT to_char(resumed_on, 'YYYY-MM-DD') AS r, closed_reason FROM vendor_rent_pauses WHERE serial_id = $1", [serials[0]])).rows[0];
    assert.equal(p.closed_reason, 'resumed');
    assert.equal(p.r, stop, 'came back before the stop date → no paused days (resumed_on = paused_from)');
  });

  let item2;
  it('a replacement of a different config waits for approval; only Accounts / the approver decide', async () => {
    item2 = (await C.query('SELECT * FROM vendor_repair_dc_items WHERE dc_number = $1 AND serial_id = $2', [dc, serials[1]])).rows[0];
    const chk = await rent.startReplacementCheck(C, { dcNumber: dc, itemId: item2.id, actorUserId: user.user_id });
    assert.ok(chk.access_number);
    const tok = (await C.query("SELECT token_id, mode FROM vendor_return_capture_tokens WHERE item_id = $1 AND status = 'pending'", [item2.id])).rows[0];
    assert.equal(tok.mode, 'replacement');
    const v = await capture.verifyVendorReturnConfiguration(tok.token_id, { manufacturer: 'HP', model: 'EliteBook 840 G5', processor: 'Intel Core i5-8350U', generation: '8th Gen', ram: '8GB', ssd: '256GB' }, '127.0.0.1');
    assert.equal(v.configurationMatched, false);
    const sOur = await capture.submitVendorReturnSerial(tok.token_id, 'TESTVRDC-2');
    assert.equal(sOur.ok, false, 'our own laptop is not a replacement');
    const sNew = await capture.submitVendorReturnSerial(tok.token_id, 'REPLHP-001');
    assert.equal(sNew.ok, true);
    sent.length = 0;
    const res = await svc.receiveFromVendor(C, {
      dcNumber: dc, receiveItems: [{ ticket_id: tickets[1].ticket_id, receive_mode: 'replacement', laptop_condition: 'on', wh_esign: SIGN, wh_signer_name: 'WH' }],
      actorUserId: user.user_id, actorName: user.name, actorRole: 'manager',
    });
    assert.equal(res.pending_approval.length, 1);
    assert.match(sent[0].subject, /Approve replacement/);
    const it2 = (await C.query('SELECT item_status, replacement_proposed FROM vendor_repair_dc_items WHERE id = $1', [item2.id])).rows[0];
    assert.equal(it2.item_status, 'replacement_pending');
    assert.equal(it2.replacement_proposed.serial_number, 'REPLHP-001');
    await assert.rejects(rent.decideReplacement(C, { dcNumber: dc, itemId: item2.id, approve: true, user }), /Only Accounts/);
    const list = await rent.listPendingApprovals();
    assert.ok(list.some((r) => r.item_id === item2.id));
  });

  it('approved: it becomes the replacement, billed from its gate-in date; the original ends the day before the pause', async () => {
    await rent.decideReplacement(C, { dcNumber: dc, itemId: item2.id, approve: true, note: 'OK, same price', user: approver });
    await svc.receiveFromVendor(C, {
      dcNumber: dc, receiveItems: [{ ticket_id: tickets[1].ticket_id, receive_mode: 'replacement', laptop_condition: 'on', wh_esign: SIGN, wh_signer_name: 'WH' }],
      actorUserId: user.user_id, actorName: user.name, actorRole: 'manager',
    });
    const repl = (await C.query(
      `SELECT to_char(rental_start_date, 'YYYY-MM-DD') AS s, extra->>'replaced_ttspl_id' AS replaced, po_id, extra->>'line_index' AS li
         FROM vendor_serial_numbers WHERE serial_number = 'REPLHP-001'`
    )).rows[0];
    assert.equal(repl.s, today);
    assert.equal(repl.replaced, tickets[1].ttspl_id);
    const orig = (await C.query("SELECT inventory_status, to_char(vendor_rent_end_date, 'YYYY-MM-DD') AS e, po_id FROM vendor_serial_numbers WHERE serial_id = $1", [serials[1]])).rows[0];
    assert.equal(orig.inventory_status, 'returned_to_vendor');
    assert.equal(orig.e, reqMail.addDays(stop, -1));
    assert.equal(repl.po_id, orig.po_id, 'same PO line → same rate');
  });

  it('a rejected replacement is handed back; the laptop waits with the vendor, rent still paused', async () => {
    const item3 = (await C.query('SELECT * FROM vendor_repair_dc_items WHERE dc_number = $1 AND serial_id = $2', [dc, serials[2]])).rows[0];
    await rent.startReplacementCheck(C, { dcNumber: dc, itemId: item3.id, actorUserId: user.user_id });
    await svc.receiveFromVendor(C, {
      dcNumber: dc, receiveItems: [{ ticket_id: tickets[2].ticket_id, receive_mode: 'replacement', laptop_condition: 'not_on', replacement_serial_number: 'DEADREPL-9', replacement_brand: 'Acer', replacement_model: 'Aspire', wh_esign: SIGN, wh_signer_name: 'WH' }],
      actorUserId: user.user_id, actorName: user.name, actorRole: 'manager',
    });
    await assert.rejects(rent.decideReplacement(C, { dcNumber: dc, itemId: item3.id, approve: false, note: '', user: approver }), /reason/);
    sent.length = 0;
    await rent.decideReplacement(C, { dcNumber: dc, itemId: item3.id, approve: false, note: 'Lower model than we sent', user: approver });
    assert.match(sent[0].subject, /Replacement not accepted/);
    const it3 = (await C.query('SELECT item_status, gate_inward_at, replacement_rejections FROM vendor_repair_dc_items WHERE id = $1', [item3.id])).rows[0];
    assert.equal(it3.item_status, 'dispatched');
    assert.equal(it3.gate_inward_at, null);
    assert.equal(it3.replacement_rejections.length, 1);
    const p = (await C.query('SELECT closed_reason FROM vendor_rent_pauses WHERE serial_id = $1', [serials[2]])).rows[0];
    assert.equal(p.closed_reason, null, 'rent stays paused');
  });

  it('vendor keeps it: confirmation mail, returned to vendor, rent ends the day before the pause, challan closes', async () => {
    const item3 = (await C.query('SELECT id FROM vendor_repair_dc_items WHERE dc_number = $1 AND serial_id = $2', [dc, serials[2]])).rows[0];
    const pv = await rent.previewVendorKept(dc, item3.id, 'Board not available');
    assert.equal(pv.rent_end_date, reqMail.addDays(stop, -1));
    sent.length = 0;
    const out = await rent.markVendorKept(C, { dcNumber: dc, itemId: item3.id, reason: 'Board not available', actorUserId: user.user_id, actorName: user.name });
    assert.equal(out.dc_status, 'returned');
    assert.match(sent[0].subject, /Confirmation/);
    const s = (await C.query("SELECT inventory_status, to_char(vendor_rent_end_date, 'YYYY-MM-DD') AS e FROM vendor_serial_numbers WHERE serial_id = $1", [serials[2]])).rows[0];
    assert.equal(s.inventory_status, 'returned_to_vendor');
    assert.equal(s.e, reqMail.addDays(stop, -1));
    const dn = (await C.query("SELECT source FROM vendor_debit_notes WHERE serial_id = $1 AND status = 'pending'", [serials[2]])).rows[0];
    assert.equal(dn.source, 'vendor_kept');
  });

  it('cancelling a mailed challan voids the pause (rent as before) and mails the vendor', async () => {
    const r = await svc.createOutForRepairDc(C, createArgs([tickets[3]]));
    await rent.sendRepairMail(C, { dcNumber: r.dc_number, actorUserId: user.user_id });
    sent.length = 0;
    const out = await svc.cancelVendorRepairDc(C, { dcNumber: r.dc_number, reason: 'Fixed in house', actorUserId: user.user_id });
    assert.equal(out.rent_pauses_voided, 1);
    assert.equal(out.vendor_mailed, true);
    assert.match(sent[0].subject, /^Cancelled: repair/);
    const p = (await C.query('SELECT closed_reason FROM vendor_rent_pauses WHERE source_ref = $1', [r.dc_number])).rows[0];
    assert.equal(p.closed_reason, 'cancelled');
  });

  it('the vendor rentals view counts the replacement and what went back, and says which laptop was replaced', async () => {
    const { vendorRentalSummary, vendorRentalLaptops } = require('../services/vendorRentalAssetsService');
    const [sum] = await vendorRentalSummary({ vendorId });
    assert.ok(sum.replacements >= 1);
    assert.ok(sum.returned >= 2);
    const repl = await vendorRentalLaptops({ vendorId, replacementsOnly: true, search: 'REPLHP' });
    assert.equal(repl[0].replaced_ttspl_id, tickets[1].ttspl_id);
  });
});
