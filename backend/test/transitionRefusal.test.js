/**
 * Part 2.2 section A — the nine catch-block bypasses.
 *
 * These are the sites that made the state machine advisory rather than
 * enforcing: validation refused, the catch swallowed the error, and the raw
 * write went through anyway. The exception path was the one that always
 * succeeded.
 *
 * What is tested here is the machinery that replaced them — a typed refusal a
 * caller can distinguish from a real fault, and a helper that turns it into a
 * 409 instead of a 500. The absence of the raw writes themselves is asserted by
 * the grep in the Part 2 acceptance criteria, not by a unit test.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });

const { TransitionRefused } = require('../services/inventoryStateMachine');
const { isTransitionRefused, respondIfRefused } = require('../utils/transitionRefusal');

/** Minimal Express res. */
function fakeRes() {
  const out = { statusCode: null, body: null };
  return {
    out,
    status(c) { out.statusCode = c; return this; },
    json(b) { out.body = b; return this; },
  };
}

describe('2.2 — a refusal is a type, not a string', () => {
  const refusal = new TransitionRefused({
    serialId: 4227, ttsplId: 'TTSPL4227', from: 'rented', to: 'in_stock',
    caller: 'salesManagementController.cancelDeliveryChallan',
  });

  it('is recognisable without matching on the message', () => {
    assert.equal(isTransitionRefused(refusal), true);
    assert.equal(refusal.code, 'TRANSITION_REFUSED');
    assert.equal(refusal.statusCode, 409);
  });

  it('carries the serial, the move and the caller', () => {
    assert.equal(refusal.serialId, 4227);
    assert.equal(refusal.ttsplId, 'TTSPL4227');
    assert.equal(refusal.from, 'rented');
    assert.equal(refusal.to, 'in_stock');
    assert.match(refusal.caller, /cancelDeliveryChallan/);
  });

  it('still reads well as a message', () => {
    assert.match(refusal.message, /rented -> in_stock/);
    assert.match(refusal.message, /TTSPL4227/);
  });

  it('is an Error, so an unhandled one still crashes loudly', () => {
    assert.ok(refusal instanceof Error);
  });

  it('does NOT claim a real fault is a refusal', () => {
    // The distinction the nine bypasses could not make: a dropped connection
    // looked exactly like "this move is illegal", so they forced the write for
    // both. Getting this wrong in the other direction would be worse.
    assert.equal(isTransitionRefused(new Error('connection terminated')), false);
    assert.equal(isTransitionRefused(new TypeError('x is not a function')), false);
    assert.equal(isTransitionRefused(null), false);
    assert.equal(isTransitionRefused(undefined), false);
  });
});

describe('2.2 — respondIfRefused answers 409, and only for a refusal', () => {
  it('answers 409 and says nothing was changed', () => {
    const res = fakeRes();
    const handled = respondIfRefused(new TransitionRefused({
      serialId: 1, ttsplId: 'TTSPL1', from: 'sold', to: 'dispatch_ready', caller: 'test',
    }), res);

    assert.equal(handled, true);
    assert.equal(res.out.statusCode, 409);
    assert.equal(res.out.body.success, false);
    assert.equal(res.out.body.code, 'TRANSITION_REFUSED');
    assert.match(res.out.body.message, /Nothing was changed/);
  });

  it('names the unit and the move in the message a user sees', () => {
    const res = fakeRes();
    respondIfRefused(new TransitionRefused({
      serialId: 9, ttsplId: 'TTSPL9', from: 'in_transit', to: 'reserved', caller: 'test',
    }), res);
    assert.match(res.out.body.message, /TTSPL9/);
    assert.match(res.out.body.message, /in_transit/);
    assert.match(res.out.body.message, /reserved/);
  });

  it('falls back to the serial id when there is no TTSPL', () => {
    const res = fakeRes();
    respondIfRefused(new TransitionRefused({
      serialId: 77, ttsplId: null, from: 'scrapped', to: 'in_stock', caller: 'test',
    }), res);
    assert.match(res.out.body.message, /Serial 77/);
  });

  it('returns the structured detail a client can act on', () => {
    const res = fakeRes();
    respondIfRefused(new TransitionRefused({
      serialId: 5, ttsplId: 'TTSPL5', from: 'rented', to: 'in_stock', caller: 'test',
    }), res);
    assert.deepEqual(res.out.body.detail, {
      serial_id: 5, ttspl_id: 'TTSPL5', from: 'rented', to: 'in_stock',
    });
  });

  it('leaves a real error alone so the 500 path still runs', () => {
    const res = fakeRes();
    const handled = respondIfRefused(new Error('ECONNRESET'), res);
    assert.equal(handled, false);
    assert.equal(res.out.statusCode, null, 'must not answer for a fault it does not understand');
  });
});

describe('2.2 — the moves the bypasses were forcing are the ones now refused', () => {
  const { isAllowed } = require('../services/inventoryStateMachine');

  it('refuses dragging a rented unit back to stock by cancelling its challan', () => {
    // bypass-register A, cancelDeliveryChallan — the bare `catch (_)` that did
    // not even log. The laptop is with a customer; marking it available is how
    // it gets promised to a second one.
    assert.equal(isAllowed('rented', 'in_stock'), false);
  });

  it('refuses re-dispatching a unit that is already sold', () => {
    assert.equal(isAllowed('sold', 'dispatch_ready'), false);
  });

  it('refuses gating out a unit that never came back', () => {
    assert.equal(isAllowed('rented', 'in_transit'), false);
  });

  it('still permits the legitimate moves those sites exist to make', () => {
    assert.equal(isAllowed('reserved', 'dispatch_ready'), true, 'DC create');
    assert.equal(isAllowed('dispatch_ready', 'in_transit'), true, 'gate outward');
    assert.equal(isAllowed('dispatch_ready', 'in_stock'), true, 'DC cancel before gate');
    assert.equal(isAllowed('dispatch_ready', 'qc_failed'), true, 'dispatch QC hard fail');
    assert.equal(isAllowed('qc_failed', 'in_stock'), true, 'dispatch QC rework');
  });
});
