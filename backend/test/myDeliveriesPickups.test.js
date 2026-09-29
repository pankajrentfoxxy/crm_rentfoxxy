/**
 * My Deliveries — return pickups and vendor hand-overs (wave 2, builder 11).
 * Pure scan rules first, then the real handlers inside one rolled-back
 * transaction (test/helpers/rollbackHarness), so nothing is left behind.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { matchScans } = require('../services/fieldScanMatch');

const LAPTOPS = [
  { key: 'a', codes: ['SNA1', 'TTSPL9001'] },
  { key: 'b', codes: ['SNB2', 'TTSPL9002'] },
];

describe('field scan rules', () => {
  it('a code that is not on the challan is refused, even next to a good one', () => {
    const r = matchScans(LAPTOPS, ['TTSPL9001', 'TTSPL7777']);
    assert.equal(r.ok, false);
    assert.deepEqual(r.unknown, ['TTSPL7777']);
  });
  it('the same laptop twice (TTSPL then serial) is refused', () => {
    const r = matchScans(LAPTOPS, ['ttspl9001', 'sna1']);
    assert.equal(r.ok, false);
    assert.deepEqual(r.duplicates, ['sna1']);
  });
  it('a delivery needs one matching scan; a pickup needs every laptop', () => {
    assert.equal(matchScans(LAPTOPS, ['TTSPL9002']).ok, true);
    const pickup = matchScans(LAPTOPS, ['TTSPL9002'], { requireAll: true });
    assert.equal(pickup.ok, false);
    assert.match(pickup.message, /1 of 2/);
    assert.equal(matchScans(LAPTOPS, [' ttspl9002 ', 'SNA1'], { requireAll: true }).ok, true);
  });
  it('nothing scanned is refused', () => {
    assert.equal(matchScans(LAPTOPS, ['', null]).ok, false);
  });
});

describe('My Deliveries handlers (rolled back)', () => {
  const h = require('./helpers/rollbackHarness');
  let ctrl;
  let chargerSvc;
  let vrdcEway;
  // Real users (vendor_delivered_by is a users FK); two field technicians.
  const OWNER = { role: 'support_tech', name: 'Test tech' };
  const OTHER = { role: 'support_tech', name: 'Other tech' };
  const stamp = Date.now();
  const RDC = `RDCTEST${stamp}`;
  const DC = `DCTEST${stamp}`;
  const VRDC = `VRDC/TEST/${stamp}`;
  const VRTDC = `VRTDC/TEST/${stamp}`;
  const SIGN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const written = [];

  before(async () => {
    await h.open();
    ctrl = require('../controllers/deliveryFlowController');
    chargerSvc = require('../services/dispatchChargerService');
    vrdcEway = require('../services/vrdcEwayComplianceService');
    // No PDF files from a test.
    vrdcEway.shouldPersistPublicVrdcPdf = async () => false;
    vrdcEway.purgeLockedVrdcPublicPdf = async () => {};
    const db = h.db();
    const techs = (await db.query(
      `SELECT user_id FROM users WHERE role = 'support_tech' AND active = TRUE ORDER BY user_id LIMIT 2`
    )).rows;
    assert.equal(techs.length, 2, 'QA needs two support_tech users');
    OWNER.user_id = techs[0].user_id;
    OTHER.user_id = techs[1].user_id;
    await db.query(
      `INSERT INTO delivery_challan_lines (dc_number, customer_name, status, movement_type, dc_purpose, delivery_person_id, serial_number)
       VALUES ($1, 'Pickup test', 'in_transit', 'return', 'standard', $2, $3::jsonb)`,
      [RDC, OWNER.user_id, JSON.stringify(['|SNA1|TTSPL9001', '|SNB2|TTSPL9002'])]
    );
    await db.query(
      `INSERT INTO delivery_challan_lines (dc_number, customer_name, status, movement_type, dc_purpose, delivery_person_id, serial_number)
       VALUES ($1, 'Delivery test', 'in_transit', 'outbound', 'standard', $2, $3::jsonb)`,
      [DC, OWNER.user_id, JSON.stringify(['|SNC3|TTSPL9003'])]
    );
    await db.query(
      `INSERT INTO vendor_repair_delivery_challans (dc_number, vendor_name, status, ship_by, delivery_person_id, item_domain, dispatched_at)
       VALUES ($1, 'Test vendor', 'dispatched', 'by_hand', $2, 'laptop', NOW())`,
      [VRDC, OWNER.user_id]
    );
    await db.query(
      `INSERT INTO vendor_return_delivery_challans (dc_number, vendor_name, status, ship_by, delivery_person_id, dispatched_at)
       VALUES ($1, 'Test vendor', 'dispatched', 'by_hand', $2, NOW())`,
      [VRTDC, OWNER.user_id]
    );
  });
  after(async () => {
    const fs = require('fs');
    const path = require('path');
    for (const f of written) fs.rmSync(path.join(__dirname, '..', 'uploads', f), { force: true });
    await h.close();
  });

  it('another technician cannot act on my challans (reached, scan, deliver, refuse)', async () => {
    for (const dc of [RDC, VRDC, VRTDC]) {
      const r = await h.call(ctrl.markTechReached, { params: { dcNumber: dc }, body: {}, user: OTHER });
      assert.equal(r.code, 403, dc);
    }
    assert.equal((await h.call(ctrl.verifySerialAndGenerateOtp, { params: { dcNumber: DC }, body: { serial_number: 'TTSPL9003' }, user: OTHER })).code, 403);
    assert.equal((await h.call(ctrl.submitDeliveryWithPod, { params: { dcNumber: VRDC }, body: { esign_data: SIGN }, user: OTHER })).code, 403);
    assert.equal((await h.call(ctrl.markCustomerRejected, { params: { dcNumber: DC }, body: { rejection_reason: 'no' }, user: OTHER })).code, 403);
  });

  it('my list carries the repair challan to hand to the vendor', async () => {
    const r = await h.call(ctrl.getMyDeliveries, { user: OWNER });
    assert.equal(r.code, 200);
    const mine = r.body.items.map((x) => x.dc_number);
    for (const dc of [RDC, DC, VRDC, VRTDC]) assert.ok(mine.includes(dc), dc);
    assert.equal(r.body.items.find((x) => x.dc_number === VRDC).dc_purpose, 'vendor_repair');
    assert.ok(Array.isArray(r.body.hand_in));
  });

  it('the laptop cannot be scanned before "reached"', async () => {
    const r = await h.call(ctrl.verifySerialAndGenerateOtp, { params: { dcNumber: RDC }, body: { serial_numbers: ['TTSPL9001', 'TTSPL9002'] }, user: OWNER });
    assert.equal(r.code, 409);
  });

  it('a pickup must scan every laptop, and nothing that is not on it', async () => {
    assert.equal((await h.call(ctrl.markTechReached, { params: { dcNumber: RDC }, body: {}, user: OWNER })).code, 200);
    const one = await h.call(ctrl.verifySerialAndGenerateOtp, { params: { dcNumber: RDC }, body: { serial_numbers: ['TTSPL9001'] }, user: OWNER });
    assert.equal(one.code, 400);
    assert.equal(one.body.code, 'SCAN_INCOMPLETE');
    const stray = await h.call(ctrl.verifySerialAndGenerateOtp, { params: { dcNumber: RDC }, body: { serial_numbers: ['TTSPL9001', 'TTSPL5555'] }, user: OWNER });
    assert.equal(stray.body.code, 'SCAN_NOT_ON_CHALLAN');
    const all = await h.call(ctrl.verifySerialAndGenerateOtp, { params: { dcNumber: RDC }, body: { serial_numbers: ['TTSPL9001', 'snb2'] }, user: OWNER });
    assert.equal(all.code, 200, JSON.stringify(all.body));
    const row = (await h.db().query('SELECT serial_verified_no FROM delivery_challan_lines WHERE dc_number = $1', [RDC])).rows[0];
    assert.equal(row.serial_verified_no, 'TTSPL9001, TTSPL9002');
  });

  it('a delivery still takes one scan, but refuses a laptop that is not on it', async () => {
    await h.call(ctrl.markTechReached, { params: { dcNumber: DC }, body: {}, user: OWNER });
    assert.equal((await h.call(ctrl.verifySerialAndGenerateOtp, { params: { dcNumber: DC }, body: { serial_number: 'TTSPL9001' }, user: OWNER })).code, 400);
    assert.equal((await h.call(ctrl.verifySerialAndGenerateOtp, { params: { dcNumber: DC }, body: { serial_number: 'SNC3' }, user: OWNER })).code, 200);
  });

  it('a pickup cannot be marked "customer refused" (the laptops stay on rent with the customer)', async () => {
    const r = await h.call(ctrl.markCustomerRejected, { params: { dcNumber: RDC }, body: { rejection_reason: 'not home' }, user: OWNER });
    assert.equal(r.code, 400);
    const st = (await h.db().query('SELECT DISTINCT status FROM delivery_challan_lines WHERE dc_number = $1', [RDC])).rows;
    assert.deepEqual(st.map((x) => x.status), ['reached']);
  });

  it('the charger we sent must be scanned (or declared missing) before the OTP is spent', async () => {
    const real = chargerSvc.getReturnDcChargerState;
    chargerSvc.getReturnDcChargerState = async () => ({ units: [{ required: true, scanned: false, ttspl_id: 'TTSPL9001', pickup_item_id: 1 }] });
    try {
      const before = (await h.db().query('SELECT MAX(otp_attempts) AS n FROM delivery_challan_lines WHERE dc_number = $1', [RDC])).rows[0].n;
      const r = await h.call(ctrl.submitDeliveryWithPod, { params: { dcNumber: RDC }, body: { otp: '000000', esign_data: SIGN }, user: OWNER });
      assert.equal(r.code, 409);
      assert.equal(r.body.code, 'CHARGER_NOT_SCANNED');
      const afterN = (await h.db().query('SELECT MAX(otp_attempts) AS n FROM delivery_challan_lines WHERE dc_number = $1', [RDC])).rows[0].n;
      assert.equal(afterN, before, 'the OTP attempt was not used up');
      // With a reason it passes the charger check and reaches the OTP check.
      const withReason = await h.call(ctrl.submitDeliveryWithPod, { params: { dcNumber: RDC }, body: { otp: '000000', esign_data: SIGN, charger_missing_reason: 'Customer lost it' }, user: OWNER });
      assert.notEqual(withReason.body.code, 'CHARGER_NOT_SCANNED');
      assert.match(String(withReason.body.code || ''), /^OTP_/);
    } finally {
      chargerSvc.getReturnDcChargerState = real;
    }
  });

  it('a repair challan is handed to the vendor once: reached → signature → delivered; a second submit is refused', async () => {
    assert.equal((await h.call(ctrl.submitDeliveryWithPod, { params: { dcNumber: VRDC }, body: { esign_data: SIGN }, user: OWNER })).code, 400, 'reached first');
    assert.equal((await h.call(ctrl.markTechReached, { params: { dcNumber: VRDC }, body: { latitude: '28.1', longitude: '77.2' }, user: OWNER })).code, 200);
    assert.equal((await h.call(ctrl.submitDeliveryWithPod, { params: { dcNumber: VRDC }, body: {}, user: OWNER })).code, 400, 'signature required');
    const ok = await h.call(ctrl.submitDeliveryWithPod, { params: { dcNumber: VRDC }, body: { esign_data: SIGN, receiver_name: 'Vendor clerk', notes: 'Two bags' }, user: OWNER });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));
    const row = (await h.db().query(
      'SELECT vendor_delivered_at, vendor_delivered_by, vendor_delivery_esign_url, vendor_delivery_signer_name, vendor_reached_latitude FROM vendor_repair_delivery_challans WHERE dc_number = $1', [VRDC]
    )).rows[0];
    written.push(row.vendor_delivery_esign_url);
    assert.ok(row.vendor_delivered_at);
    assert.equal(row.vendor_delivered_by, OWNER.user_id);
    assert.equal(row.vendor_delivery_signer_name, 'Vendor clerk');
    assert.equal(row.vendor_reached_latitude, '28.1');
    const again = await h.call(ctrl.submitDeliveryWithPod, { params: { dcNumber: VRDC }, body: { esign_data: SIGN }, user: OWNER });
    assert.equal(again.code, 409);
    const list = await h.call(ctrl.getMyDeliveries, { user: OWNER });
    assert.ok(!list.body.items.some((x) => x.dc_number === VRDC), 'leaves the list');
  });

  it('a vendor challan cannot be "refused" at the door', async () => {
    const r = await h.call(ctrl.markCustomerRejected, { params: { dcNumber: VRTDC }, body: { rejection_reason: 'x' }, user: OWNER });
    assert.equal(r.code, 400);
  });
});
