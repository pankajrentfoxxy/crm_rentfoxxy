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

describe('2.2 section B — QC outcomes are translated, never written raw', () => {
  const { statusForQcOutcome, QC_OUTCOME_TO_STATUS } = require('../constants/statuses');
  const { ASSET_STATUS_VALUES } = require('../constants/statuses');

  it('maps every QC outcome to a canonical status or to nothing', () => {
    for (const [outcome, status] of Object.entries(QC_OUTCOME_TO_STATUS)) {
      if (status === null) continue;
      assert.ok(
        ASSET_STATUS_VALUES.includes(status),
        `${outcome} maps to "${status}", which is not canonical`
      );
    }
  });

  it('translates the five strays that leaked into the lifecycle column', () => {
    // These are the values finding I4 says QC Management wrote straight into
    // inventory_status. None of them is a lifecycle state.
    assert.equal(statusForQcOutcome('out_for_repare').status, 'in_repair');
    assert.equal(statusForQcOutcome('out_for_return').status, 'returned');
    assert.equal(statusForQcOutcome('repared').status, 'in_stock');
    assert.equal(statusForQcOutcome('replace').status, 'returned');
    assert.equal(statusForQcOutcome('qc_reject').status, 'qc_failed');
  });

  it('sends require_for_parts to scrapped, which is terminal', () => {
    assert.equal(statusForQcOutcome('require_for_parts').status, 'scrapped');
  });

  it('distinguishes "no status change" from "unknown outcome"', () => {
    // Conflating these is how the strays got in: pending legitimately moves
    // nothing, and an unrecognised value must be refused rather than written.
    assert.deepEqual(statusForQcOutcome('pending'), { known: true, status: null });
    assert.deepEqual(statusForQcOutcome('nonsense'), { known: false, status: null });
    assert.deepEqual(statusForQcOutcome(''), { known: false, status: null });
    assert.deepEqual(statusForQcOutcome(null), { known: false, status: null });
  });

  it('accepts both spellings of the repair outcome', () => {
    // out_for_repare (44 rows) and out_for_repair (15) both exist live and
    // mean the same thing, so fixing the spelling upstream must not break this.
    assert.equal(statusForQcOutcome('out_for_repare').status, 'in_repair');
    assert.equal(statusForQcOutcome('out_for_repair').status, 'in_repair');
  });

  it('does NOT map `missing` — it is an open business question', () => {
    assert.equal(statusForQcOutcome('missing').known, false);
  });
});

describe('2.2 section B — the QC-pass duplicate is one routine', () => {
  const { NOT_REPLACEABLE } = require('../services/qcPassReservation');

  it('keeps the guard both copies carried', () => {
    for (const s of ['rented', 'sold', 'on_demo', 'in_transit', 'returned']) {
      assert.ok(NOT_REPLACEABLE.includes(s), `${s} must not be re-reserved by a stale QC pass`);
    }
  });

  it('exports one routine, not two', () => {
    const mod = require('../services/qcPassReservation');
    assert.equal(typeof mod.reserveOnQcPass, 'function');
  });
});
