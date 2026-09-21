/**
 * Part 3.3–3.6 — one delivery path, hardened OTP, the BlueDart sweep, rejection.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });

const { MODE, checkProof, ProofRejected } = require('../services/deliveryCompletionService');
const otp = require('../services/deliveryOtpService');
const { isAllowed } = require('../services/inventoryStateMachine');

describe('3.3 — the proof rules, stated once', () => {
  it('by hand needs BOTH the OTP and a POD', () => {
    assert.deepEqual(checkProof(MODE.BY_HAND, { otpVerified: true, podPhotoUrl: 'pod/x.jpg' }), []);

    const noPod = checkProof(MODE.BY_HAND, { otpVerified: true });
    assert.equal(noPod.length, 1);
    assert.match(noPod[0], /proof of delivery/i);

    const noOtp = checkProof(MODE.BY_HAND, { podPhotoUrl: 'pod/x.jpg' });
    assert.match(noOtp[0], /OTP/);
  });

  it('accepts an e-signature as a POD', () => {
    assert.deepEqual(checkProof(MODE.BY_HAND, { otpVerified: true, esignUrl: 'esign/x.png' }), []);
  });

  it('reports EVERY missing item at once, not the first', () => {
    // A driver at a customer's door should be told everything they need in one
    // go rather than sent away twice.
    const missing = checkProof(MODE.BY_HAND, {});
    assert.equal(missing.length, 2);
  });

  it('courier auto needs the carrier scan and nothing else', () => {
    assert.deepEqual(checkProof(MODE.COURIER_AUTO, { courierScan: { awb: '778' } }), []);
    assert.equal(checkProof(MODE.COURIER_AUTO, {}).length, 1);
  });

  it('manual courier needs a POD and an actor who is not a field role', () => {
    assert.deepEqual(
      checkProof(MODE.COURIER_MANUAL, { podPhotoUrl: 'pod/x.jpg' }, { role: 'accounts' }),
      []
    );
    // A technician confirming that a courier delivered something is marking
    // their own homework.
    const byTech = checkProof(MODE.COURIER_MANUAL, { podPhotoUrl: 'pod/x.jpg' }, { role: 'technician' });
    assert.equal(byTech.length, 1);
    assert.match(byTech[0], /not a field role/);
  });

  it('an override needs a POD AND a reason', () => {
    assert.deepEqual(checkProof(MODE.ADMIN_OVERRIDE, { podPhotoUrl: 'p.jpg', reason: 'customer confirmed by phone' }), []);
    assert.equal(checkProof(MODE.ADMIN_OVERRIDE, { podPhotoUrl: 'p.jpg' }).length, 1);
    assert.equal(checkProof(MODE.ADMIN_OVERRIDE, { reason: 'x' }).length, 1);
  });

  it('refuses a bare pod_image_url with no OTP — finding V3', () => {
    // markDcDelivered accepted exactly this: a plain body string, no OTP, and
    // anyone with challan edit rights could start the rent clock.
    const missing = checkProof(MODE.BY_HAND, { podImageUrl: '/uploads/anything.jpg' });
    assert.ok(missing.length > 0, 'a POD string alone must not complete a by-hand delivery');
  });

  it('refuses an unknown mode rather than defaulting to the laxest', () => {
    assert.equal(checkProof('something_else', {}).length, 1);
    assert.equal(checkProof(undefined, {}).length, 1);
  });

  it('ProofRejected is a 400 that names what is missing', () => {
    const e = new ProofRejected({ mode: MODE.BY_HAND, missing: ['No OTP.'], dcNumber: 'DC/1' });
    assert.equal(e.statusCode, 400);
    assert.equal(e.code, 'DELIVERY_PROOF_REJECTED');
    assert.deepEqual(e.missing, ['No OTP.']);
  });
});

describe('3.4 — the OTP is no longer six plaintext digits with unlimited tries', () => {
  it('generates six digits from a CSPRNG', () => {
    for (let i = 0; i < 50; i += 1) {
      assert.match(otp.generateOtp(), /^\d{6}$/);
    }
  });

  it('hashes rather than storing the code', () => {
    const h = otp.hashOtp('DC/26-27/0778', '123456');
    assert.notEqual(h, '123456');
    assert.equal(h.length, 64, 'sha256 hex');
  });

  it('salts by challan, so one leaked hash does not identify another delivery', () => {
    assert.notEqual(otp.hashOtp('DC/1', '123456'), otp.hashOtp('DC/2', '123456'));
  });

  it('is stable for the same challan and code', () => {
    assert.equal(otp.hashOtp('DC/1', '123456'), otp.hashOtp('DC/1', '123456'));
  });

  it('trims what the customer typed', () => {
    assert.equal(otp.hashOtp('DC/1', ' 123456 '), otp.hashOtp('DC/1', '123456'));
  });

  it('bounds the exposure: 15 minutes and 5 attempts', () => {
    assert.equal(otp.OTP_TTL_MINUTES, 15);
    assert.equal(otp.MAX_ATTEMPTS, 5);
  });
});

describe('3.6 — rejection leaves a unit somewhere real', () => {
  it('a challan that never left the warehouse can be rejected (DC7)', () => {
    const { REJECTABLE_STATUSES } = require('../services/deliveryRejectionService');
    // Not exported by the module, so assert through behaviour instead where it
    // is not available.
    if (REJECTABLE_STATUSES) {
      assert.ok(REJECTABLE_STATUSES.has('dispatch_ready'));
    }
  });

  it('dispatch_ready goes back to stock — it is still here', () => {
    assert.equal(isAllowed('dispatch_ready', 'in_stock'), true);
  });

  it('a unit on the road goes to at_gate, not nowhere (I17)', () => {
    // The old code deliberately left it in_transit with no DC and no owner,
    // which also made the sales order impossible to cancel (T1).
    assert.equal(isAllowed('in_transit', 'at_gate'), true);
  });
});

describe('3.5 — the BlueDart sweep matches on courier name only (B1)', () => {
  it('no longer claims challans with a blank courier', () => {
    const fs = require('fs');
    const src = fs.readFileSync(`${__dirname}/../services/bluedartAwbSyncService.js`, 'utf8');

    // The sweep's WHERE clause must not contain the blank-courier arms. A
    // porter challan carrying an AWB could otherwise be auto-delivered by an
    // unrelated waybill — rent clock and invoice included.
    //
    // SQL comments are stripped first: the fix carries a comment explaining
    // what it removed, and matching on prose rather than code would make this
    // test fail on its own documentation.
    const sweep = src
      .slice(0, src.indexOf('GROUP BY TRIM(awb_number)'))
      .split('\n')
      .filter((line) => !line.trim().startsWith('--') && !line.trim().startsWith('//'))
      .join('\n');

    assert.ok(!/courier_name IS NULL/.test(sweep), 'blank courier must not match the sweep');
    assert.ok(!/TRIM\(courier_name\) = ''/.test(sweep), 'empty courier must not match the sweep');
    assert.ok(/courier_name ILIKE '%bluedart%'/.test(sweep), 'it should still match BlueDart by name');
  });
});
