/**
 * Vendor return request (D10, claude/carret-vendor-return-request.md).
 *
 * The rules on their own, then the whole channel on the database inside one
 * rolled-back transaction: request → send (rent stops from the chosen date) →
 * cancel (rent resumes, vendor mailed) → challan with transport → the ₹50,000
 * e-way mail to Accounts. Mail is captured, never sent.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
delete process.env.VENDOR_RETURN_REQUEST_CC;
delete process.env.VENDOR_RETURN_NOTIFY_CC;
require('../services/outboundMessagingGuard');

// Capture mail before any service takes its own reference to the sender.
const mail = require('../services/dispatchEmailService');
const sent = [];
mail.sendDispatchMail = async (m) => { sent.push(m); return true; };
mail.isDispatchMailConfigured = () => true;

const fs = require('fs');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const hx = require('./helpers/rollbackHarness');
const rules = require('../services/vendorReturnRequestMail');
const eway = require('../services/vrtdcEwayComplianceService');
const shared = require('../services/vendorRepairDcShared');

const today = rules.todayIst();

describe('return request rules', () => {
  it('rent stop date is today or later, at most 30 days ahead (D10)', () => {
    assert.throws(() => rules.validateRequestDates({ rentStopDate: rules.addDays(today, -1) }), /can't be in the past/);
    assert.throws(() => rules.validateRequestDates({ rentStopDate: rules.addDays(today, 31) }), /at most 30 days/);
    assert.equal(rules.validateRequestDates({ rentStopDate: today }).rentStopDate, today);
    assert.throws(() => rules.validateRequestDates({ pickupDate: rules.addDays(today, -2) }), /Pickup date/);
    assert.throws(() => rules.validateRequestDates({ pickupDate: today, pickupTime: '25:00' }), /HH:MM/);
    assert.throws(() => rules.validateRequestDates({ pickupTime: '10:00' }), /pickup date/);
    assert.equal(rules.validateRequestDates({ pickupDate: today, pickupTime: '9:30' }).pickupTime, '09:30');
  });

  it('"stops from the 1st" bills up to the day before', () => {
    assert.equal(rules.lastBilledDay('2026-10-01'), '2026-09-30');
    assert.equal(rules.lastBilledDay('2027-03-01'), '2027-02-28');
  });

  it('the request mail says when rent stops, the pickup slot, the laptops, and signs off', () => {
    const m = rules.buildRequestMail({
      ticket: {
        ticket_number: 'VRT/26-27/9999', vendor_name: 'Acme <Rentals>', reason_code: 'customer_returned',
        pickup_date: '2026-10-03', pickup_time: '14:30',
      },
      items: [{ ttspl_id: 'TTSPL0001', serial_number: 'SN1', brand: 'Dell', model: 'Latitude 5410', configuration: 'i5 · 8GB', po_number: 'PO-1' }],
      stopDate: '2026-10-01',
      contactName: 'Ravi',
      pickupAddress: 'Our warehouse',
    });
    assert.match(m.html, /Dear Ravi/);
    assert.match(m.html, /from <strong>01 Oct 2026<\/strong> onwards/);
    assert.match(m.html, /only up to <strong>30 Sept? 2026<\/strong>/);
    assert.match(m.html, /03 Oct 2026 at 2:30 PM/);
    assert.match(m.html, /returned by our customer/);
    assert.match(m.html, /TTSPL0001/);
    assert.match(m.html, /Acme &lt;Rentals&gt;/, 'vendor name is escaped');
    assert.match(m.html, /TrueTech Services Pvt\. Ltd\./);
    assert.match(m.subject, /VRT\/26-27\/9999/);
  });

  it('the cancellation mail says rent continues', () => {
    const m = rules.buildCancelMail({
      ticket: { ticket_number: 'VRT/1', vendor_name: 'Acme', vendor_notified_at: '2026-09-26' },
      items: [{ ttspl_id: 'TTSPL0001' }], remainingCount: 2, reason: 'Customer extended',
    });
    assert.match(m.html, /rent continues as before/);
    assert.match(m.html, /other 2 laptop/);
  });

  it('the default CC list is the four addresses asked for', () => {
    assert.equal(rules.requestCc(), 'accounts@truetechservices.in, pankkajyadav@rentfoxxy.com, warehouse@rentfoxxy.com, adminn@rentfoxxy.com');
  });

  it('a return challan needs an e-way bill from ₹50,000; the repair challan keeps "above"', () => {
    assert.equal(eway.requiresVrtdcEway(50000), true);
    assert.equal(eway.requiresVrtdcEway(49999.99), false);
    assert.equal(shared.requiresVrdcEway(50000), false);
  });

  it('the Accounts mail groups by brand and model', () => {
    const g = eway.summariseByModel([
      { brand: 'Dell', model: 'Latitude 5410', declared_value: 30000 },
      { brand: 'dell', model: 'latitude 5410', declared_value: 25000 },
      { brand: 'HP', model: '840 G5', declared_value: 20000 },
      { brand: 'HP', model: '840 G5', declared_value: 99, item_status: 'cancelled' },
    ]);
    assert.deepEqual(g.map((x) => [x.brand, x.count, x.value]), [['Dell', 2, 55000], ['HP', 1, 20000]]);
  });
});

describe('return request on the database', () => {
  const user = { user_id: null, name: 'Test Warehouse', role: 'manager' };
  let C;
  let tickets;
  let rtv;
  let rtvCtl;
  let vendorId;
  let serials = [];
  const files = [];

  before(async () => {
    C = await hx.open();
    tickets = require('../services/vendorReturnTicketService');
    rtv = require('../services/vendorReturnToVendorService');
    rtvCtl = require('../controllers/vendorManagement/vendorReturnToVendor.controller');
    user.user_id = (await C.query('SELECT user_id FROM users ORDER BY user_id LIMIT 1')).rows[0].user_id;
    vendorId = (await C.query("SELECT vendor_id FROM vendors WHERE deleted_at IS NULL AND status = 'approved' ORDER BY vendor_id LIMIT 1")).rows[0].vendor_id;
    await C.query("UPDATE vendors SET email = 'test-vendor@rentfoxxy.com', contact_person_name = 'Test Contact' WHERE vendor_id = $1", [vendorId]);
    const line = { brand: 'Dell', model: 'Latitude 5410', processor: 'Intel Core i5', ram: '8GB', storage: '256GB SSD', quantity: 3, rate: 1500, asset_value: 30000, allowed_conditions: ['on', 'not_on'] };
    const poId = (await C.query(
      `INSERT INTO vendor_purchase_orders (purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state, sub_total_amount, total_amount, line_items, status)
       VALUES ('TEST-VRQ-1', CURRENT_DATE, 'rental_purchase', $1, 'haryana', 4500, 5310, $2::jsonb, 'approved') RETURNING po_id`,
      [vendorId, JSON.stringify([line])]
    )).rows[0].po_id;
    const po = require('../controllers/vendorManagement/purchaseOrders.controller');
    for (let i = 1; i <= 3; i += 1) {
      const r = await hx.call(po.receivePoLineUnit, {
        params: { poId: String(poId) },
        body: { line_index: 0, rental_start_date: rules.addDays(today, -60), serial_number: `TESTVRQ-${i}`, received_condition: 'not_on', config_capture_waiver_reason: 'No power at all on arrival' },
        user, validators: po.receivePoLineUnitValidators,
      });
      assert.equal(r.code, 201, JSON.stringify(r.body));
      serials.push(r.body.data.created.serial_id);
    }
    // Refurbished and back on the shelf (the floor is not what this tests).
    await C.query(
      `UPDATE vendor_serial_numbers SET inventory_status = 'in_stock', extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb
        WHERE serial_id = ANY($1::int[])`,
      [serials, JSON.stringify({ brand: 'Dell', model: 'Latitude 5410', processor: 'Intel Core i5', ram: '8GB', storage: '256GB SSD' })]
    );
  });
  after(async () => {
    for (const f of files) { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }
    await hx.close();
  });

  it('a rented laptop in good condition cannot go straight on a challan (one channel)', async () => {
    await assert.rejects(
      rtv.createReturnDc(C, { serialIds: [serials[0]], returnReason: 'x', actorUserId: user.user_id, actorName: user.name }),
      /return request/
    );
    const list = await rtv.listEligibleLaptops({ vendorId, search: 'TESTVRQ-1', inventoryStatus: 'all' });
    assert.equal(list.data[0].needs_return_request, true);
  });

  let t1;
  it('a request takes the reason, rent stop date and pickup slot — not a past date', async () => {
    await assert.rejects(
      tickets.createTicket(C, { vendorId, serialIds: [serials[0]], reasonCode: 'surplus', rentStopDate: rules.addDays(today, -1), actorUserId: user.user_id }),
      /past/
    );
    const t = await tickets.createTicket(C, {
      vendorId, serialIds: [serials[0], serials[1]], reasonCode: 'customer_returned',
      rentStopDate: rules.addDays(today, 3), pickupDate: rules.addDays(today, 2), pickupTime: '11:00', actorUserId: user.user_id, actorName: user.name,
    });
    t1 = t.ticket_number;
    assert.equal(t.status, 'requested');
    assert.equal(t.rent_stop_date, rules.addDays(today, 3));
    assert.equal(t.reason_label, 'Returned by our customer');
    const upd = await tickets.updateTicket(C, { ticketNumber: t1, pickupTime: '15:00', actorUserId: user.user_id });
    assert.equal(upd.pickup_time, '15:00');
    const p = await tickets.previewRequest(t1);
    assert.equal(p.to, 'test-vendor@rentfoxxy.com');
    assert.match(p.html, /3:00 PM/);
  });

  it('sending mails the vendor with the PDF and stops rent from the chosen date', async () => {
    sent.length = 0;
    const r = await tickets.notifyVendor(C, { ticketNumber: t1, actorUserId: user.user_id, actorName: user.name });
    assert.equal(r.ticket.status, 'notified');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'test-vendor@rentfoxxy.com');
    assert.match(sent[0].cc, /warehouse@rentfoxxy\.com/);
    assert.equal(sent[0].userTriggered, true);
    const pdf = path.join(__dirname, '..', sent[0].pdfRelativePath);
    files.push(pdf);
    assert.ok(fs.existsSync(pdf), 'request PDF attached');
    const s = (await C.query("SELECT to_char(vendor_rent_end_date, 'YYYY-MM-DD') AS d FROM vendor_serial_numbers WHERE serial_id = $1", [serials[0]])).rows[0];
    assert.equal(s.d, rules.addDays(today, 2), 'last billed day = stop date − 1');
    await assert.rejects(tickets.updateTicket(C, { ticketNumber: t1, pickupTime: '16:00' }), /already been told/);
  });

  it('taking a told laptop off resumes its rent and mails the vendor; a reason is required', async () => {
    await assert.rejects(tickets.cancelTicketItems(C, { ticketNumber: t1, serialIds: [serials[1]], reason: '' }), /reason/);
    sent.length = 0;
    const t = await tickets.cancelTicketItems(C, { ticketNumber: t1, serialIds: [serials[1]], reason: 'Customer extended the rental', actorUserId: user.user_id });
    const s = (await C.query('SELECT vendor_rent_end_date FROM vendor_serial_numbers WHERE serial_id = $1', [serials[1]])).rows[0];
    assert.equal(s.vendor_rent_end_date, null, 'rent resumes');
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /^Cancelled/);
    assert.match(sent[0].html, /other 1 laptop/);
    assert.ok(t.cancel_mail_sent_at);
  });

  let dcNumber;
  it('the challan from the request takes the transport the chosen mode needs', async () => {
    const made = await tickets.createDcFromTicket(C, { ticketNumber: t1, serialIds: [serials[0]], actorUserId: user.user_id, actorName: user.name });
    dcNumber = made.dc_number;
    const item = (await C.query('SELECT declared_value FROM vendor_return_dc_items WHERE dc_number = $1', [dcNumber])).rows[0];
    assert.equal(Number(item.declared_value), 30000, 'pre-filled from the PO line asset value');

    const base = { dcNumber, declared_values: { [serials[0]]: 60000 }, actorUserId: user.user_id, actorName: user.name };
    await assert.rejects(rtv.dispatchReturnDc(C, { ...base, ship_by: 'by_courier', courier_name: 'DTDC' }), /tracking ID/);
    await assert.rejects(rtv.dispatchReturnDc(C, { ...base, ship_by: 'by_porter', porter_person_name: 'Raju', vehicle_number: 'HR26AB1234' }), /phone/i);
    await assert.rejects(rtv.dispatchReturnDc(C, { ...base, ship_by: 'by_vendor_pickup', vendor_pickup_person: 'Amit', vendor_pickup_mobile: '9876543210' }), /vehicle/i);
    await assert.rejects(rtv.dispatchReturnDc(C, { ...base, ship_by: 'by_hand', vehicle_number: 'HR26AB1234' }), /delivery person/);
  });

  it('send to gate at ₹50,000+ mails Accounts by itself, with brand/model, count, value and transport', async () => {
    sent.length = 0;
    const r = await hx.call(rtvCtl.dispatchDc, {
      params: { dcNumber },
      body: { ship_by: 'by_porter', porter_person_name: 'Raju', porter_person_phone: '9876543210', vehicle_number: 'hr 26 ab 1234', declared_values: { [serials[0]]: 60000 } },
      user,
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const dc = r.body.dc;
    assert.equal(dc.porter_person_name, 'Raju');
    assert.equal(dc.vehicle_number, 'HR26AB1234');
    assert.equal(r.body.eway_request.required, true);
    assert.equal(r.body.eway_request.sent, true, JSON.stringify(r.body.eway_request));
    const m = sent.find((x) => /E-way Bill required/.test(x.subject));
    assert.ok(m, 'Accounts mail sent');
    assert.match(m.html, /By brand and model/);
    assert.match(m.html, /Latitude 5410/);
    assert.match(m.html, /Porter person/);
    assert.match(m.html, /9876543210/);
    if (m.pdfRelativePath) files.push(path.join(__dirname, '..', m.pdfRelativePath));
    await assert.rejects(rtv.confirmGateOutwardVrtdc(C, { dcNumber, actorUserId: user.user_id }), /E-way Bill required/);
  });

  it('an in-house challan records our delivery person and their phone', async () => {
    const tech = (await C.query('SELECT technician_id, phone FROM delivery_technicians WHERE is_active IS NOT FALSE ORDER BY technician_id LIMIT 1')).rows[0];
    if (!tech) return;
    const t2 = await tickets.createTicket(C, { vendorId, serialIds: [serials[2]], reasonCode: 'surplus', rentStopDate: today, pickupDate: today, pickupTime: '10:00', actorUserId: user.user_id });
    await tickets.notifyVendor(C, { ticketNumber: t2.ticket_number, actorUserId: user.user_id });
    const s = (await C.query("SELECT to_char(vendor_rent_end_date, 'YYYY-MM-DD') AS d FROM vendor_serial_numbers WHERE serial_id = $1", [serials[2]])).rows[0];
    assert.equal(s.d, rules.addDays(today, -1), 'stops today → billed up to yesterday');
    const made = await tickets.createDcFromTicket(C, { ticketNumber: t2.ticket_number, serialIds: [serials[2]], actorUserId: user.user_id });
    const dc = await rtv.dispatchReturnDc(C, {
      dcNumber: made.dc_number, ship_by: 'by_hand', delivery_person_id: tech.technician_id,
      delivery_person_phone: '9876501234', vehicle_number: 'DL1AB2345', declared_values: { [serials[2]]: 20000 }, actorUserId: user.user_id,
    });
    assert.equal(dc.delivery_person_id, tech.technician_id);
    assert.equal(dc.delivery_person_phone, '9876501234');
    assert.ok(dc.delivery_person_name);
    for (const f of fs.readdirSync(path.join(__dirname, '../uploads/vendor-return-requests'))) {
      if (f.startsWith(String(t2.ticket_number).replace(/[^\w-]+/g, '_'))) files.push(path.join(__dirname, '../uploads/vendor-return-requests', f));
    }
  });
});
