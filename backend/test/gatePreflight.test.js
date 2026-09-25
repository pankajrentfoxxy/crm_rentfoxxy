/**
 * Part 3.1 and 3.2 — at_gate, and the gate that can refuse.
 *
 * Finding DC1: the gate blocked only cancelled, delivered and rejected
 * challans. It did not check QC, e-way or AWB, and it accepted challans still
 * at `pending` — and this is the event that puts stock in transit and starts
 * the rent clock.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });

const { STATUS, ALLOWED, isAllowed } = require('../services/inventoryStateMachine');
const {
  checkDispatchQc, checkEwayBill, checkAwb, checkChallanState, EWAY_VALUE_THRESHOLD,
} = require('../services/gatePreflightService');

describe('3.1 — at_gate makes guard custody recordable', () => {
  it('is a canonical status', () => {
    assert.equal(STATUS.AT_GATE, 'at_gate');
    assert.ok(Object.prototype.hasOwnProperty.call(ALLOWED, 'at_gate'));
  });

  it('accepts an arriving unit from in_transit', () => {
    assert.equal(isAllowed('in_transit', 'at_gate'), true);
  });

  it('lets inventory collect it into stock — the second step', () => {
    // This is the move that cannot be recorded today. Before at_gate existed,
    // inward confirm went straight to `returned`, asserting something nobody
    // had checked yet.
    assert.equal(isAllowed('at_gate', 'in_stock'), true);
  });

  it('also releases to returned or qc_failed', () => {
    assert.equal(isAllowed('at_gate', 'returned'), true);
    assert.equal(isAllowed('at_gate', 'qc_failed'), true);
  });

  it('does NOT add an outward staging step', () => {
    // Decision, 21 Sep 2026: units go straight out — the guard scan IS the
    // departure. Asserted so re-adding it later is a deliberate change rather
    // than a drift.
    assert.equal(isAllowed('dispatch_ready', 'at_gate'), false);
    assert.equal(isAllowed('dispatch_ready', 'in_transit'), true);
  });

  it('is not a way around a terminal state', () => {
    assert.equal(isAllowed('scrapped', 'at_gate'), false);
    assert.equal(isAllowed('sold', 'at_gate'), false);
  });
});

describe('3.2 — Dispatch QC: zero rows is "not checked", not "passed"', () => {
  const dbWith = (rows) => ({ async query() { return { rows }; } });

  it('refuses a challan with no QC record at all (D3)', async () => {
    // The old gate treated an empty result as a pass. That is the difference
    // between a gate and a formality.
    const f = await checkDispatchQc(dbWith([{ total: 0, passed: 0 }]), 'DC/1');
    assert.ok(f);
    assert.equal(f.code, 'DISPATCH_QC_MISSING');
  });

  it('refuses a partially passed challan and says how many', async () => {
    const f = await checkDispatchQc(dbWith([{ total: 5, passed: 3 }]), 'DC/1');
    assert.ok(f);
    assert.equal(f.code, 'DISPATCH_QC_INCOMPLETE');
    assert.match(f.message, /3 of 5/);
  });

  it('passes when every unit has passed', async () => {
    assert.equal(await checkDispatchQc(dbWith([{ total: 5, passed: 5 }]), 'DC/1'), null);
  });
});

describe('3.2 — e-way bill', () => {
  it('refuses when the challan is flagged as needing one and has none', async () => {
    const f = await checkEwayBill(null, { eway_required: true, eway_bill_number: null });
    assert.ok(f);
    assert.equal(f.code, 'EWAY_MISSING');
  });

  it('refuses at the threshold, not only above it', async () => {
    const f = await checkEwayBill(null, { eway_asset_value: EWAY_VALUE_THRESHOLD });
    assert.ok(f, 'a consignment exactly at the threshold still needs an e-way bill');
  });

  it('passes below the threshold with no flag', async () => {
    assert.equal(await checkEwayBill(null, { eway_asset_value: 10000 }), null);
  });

  it('passes when the bill is present', async () => {
    assert.equal(
      await checkEwayBill(null, { eway_required: true, eway_bill_number: 'EWB123' }),
      null
    );
  });

  it('does not read a missing flag as "not required"', async () => {
    // An older challan may predate eway_required. Value alone must still gate.
    const f = await checkEwayBill(null, { eway_required: null, eway_asset_value: 90000 });
    assert.ok(f);
  });
});

describe('3.2 — AWB', () => {
  it('refuses a courier challan with no AWB', () => {
    const f = checkAwb({ dispatch_mode: 'courier', awb_number: null });
    assert.ok(f);
    assert.equal(f.code, 'AWB_MISSING');
  });

  it('does not ask a by-hand challan for one', () => {
    assert.equal(checkAwb({ dispatch_mode: 'inhouse' }), null);
    assert.equal(checkAwb({ dispatch_mode: 'by_hand' }), null);
  });

  it('passes a courier challan that has one', () => {
    assert.equal(checkAwb({ dispatch_mode: 'bluedart', awb_number: '7781104432' }), null);
  });

  it('accepts a porter challan on its Porter tracking ID, which is all porter ever has', () => {
    assert.equal(checkAwb({ dispatch_mode: 'porter', awb_number: null, porter_tracking_id: 'CRN8812' }), null);
    const f = checkAwb({ dispatch_mode: 'porter', awb_number: null, porter_tracking_id: '  ' });
    assert.equal(f.code, 'AWB_MISSING');
    assert.match(f.message, /Porter tracking ID/);
  });
});

describe('3.2 — challan state (DC1)', () => {
  it('refuses a challan still at pending', () => {
    // The specific hole: applyOutwardGateInventory accepted these.
    const f = checkChallanState({ status: 'pending' });
    assert.ok(f);
    assert.equal(f.code, 'CHALLAN_NOT_READY');
  });

  it('refuses a cancelled or rejected challan', () => {
    assert.ok(checkChallanState({ status: 'cancelled' }));
    assert.ok(checkChallanState({ status: 'rejected' }));
  });

  it('allows dispatch_ready', () => {
    assert.equal(checkChallanState({ status: 'dispatch_ready' }), null);
  });

  it('allows in_transit so a re-scan is not an error', () => {
    assert.equal(checkChallanState({ status: 'in_transit' }), null);
  });
});
