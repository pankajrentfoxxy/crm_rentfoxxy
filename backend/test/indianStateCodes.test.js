const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { canonicalState, stateFromGstin, vendorGstState } = require('../utils/indianStateCodes');
const rules = require('../services/purchaseOrderRules');

describe('indian state codes (PO GST split)', () => {
  it('names, slugs, two-letter and GST codes are one state', () => {
    for (const s of ['HR', 'hr', '06', 'Haryana', 'haryana', 'HARYANA']) assert.equal(canonicalState(s), 'haryana', s);
    assert.equal(canonicalState('Madhya Pradesh'), 'madhya_pradesh');
    assert.equal(canonicalState('DL'), 'delhi');
    assert.equal(canonicalState(''), '');
  });
  it('a vendor GSTIN beats its stored state', () => {
    assert.equal(stateFromGstin('07AAACB1234C1Z5'), 'delhi');
    assert.equal(vendorGstState({ state: 'HR', gst_number: '07AAACB1234C1Z5' }), 'delhi');
    assert.equal(vendorGstState({ state: 'HR', gst_number: '' }), 'haryana');
  });
  it('the PO rules compare the same way (HR vendor delivering to haryana is intra-state)', () => {
    assert.equal(rules.normalizeState('HR'), rules.normalizeState('haryana'));
  });
});
