/**
 * A delivery refused for missing proof is answered 400 with what is missing.
 * It used to surface as a 500 from "Mark Delivered" on the old challan page.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { respondIfRefused } = require('../utils/transitionRefusal');
const { ProofRejected } = require('../services/deliveryCompletionService');

const res = () => {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

describe('delivery proof refusal response', () => {
  it('answers 400 and lists the missing proof', () => {
    const r = res();
    const handled = respondIfRefused(new ProofRejected({ mode: 'admin_override', missing: ['A proof-of-delivery photo is required.'], dcNumber: 'DC/26-27/0001' }), r);
    assert.equal(handled, true);
    assert.equal(r.code, 400);
    assert.equal(r.body.code, 'DELIVERY_PROOF_REJECTED');
    assert.deepEqual(r.body.detail.missing, ['A proof-of-delivery photo is required.']);
  });

  it('still leaves an ordinary error to the caller', () => {
    const r = res();
    assert.equal(respondIfRefused(new Error('connection reset'), r), false);
    assert.equal(r.code, 200);
  });
});
