const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { otpMatches } = require('../controllers/supportController');

describe('support OTP comparison', () => {
  it('rejects the literal string "null" when no OTP was issued', () => {
    // The original bug: String(null) === 'null', and 'null' is truthy, so
    // POST /api/support/items/:id/verify-otp {"otp":"null"} closed the item,
    // marked the asset returned and raised a return credit note.
    assert.equal(otpMatches(null, 'null'), false);
    assert.equal(otpMatches(undefined, 'null'), false);
    assert.equal(otpMatches(null, 'undefined'), false);
  });

  it('rejects any value when nothing is stored', () => {
    for (const supplied of ['123456', '', '0', 'null', ' ']) {
      assert.equal(otpMatches(null, supplied), false, `stored=null supplied=${JSON.stringify(supplied)}`);
      assert.equal(otpMatches('', supplied), false, `stored='' supplied=${JSON.stringify(supplied)}`);
      assert.equal(otpMatches('   ', supplied), false, `stored=blank supplied=${JSON.stringify(supplied)}`);
    }
  });

  it('rejects a missing supplied OTP against a real stored one', () => {
    assert.equal(otpMatches('123456', null), false);
    assert.equal(otpMatches('123456', undefined), false);
    assert.equal(otpMatches('123456', ''), false);
  });

  it('accepts an exact match, trimming whitespace on both sides', () => {
    assert.equal(otpMatches('123456', '123456'), true);
    assert.equal(otpMatches('123456', ' 123456 '), true);
    assert.equal(otpMatches(' 123456 ', '123456'), true);
  });

  it('accepts a numeric stored OTP against its string form', () => {
    assert.equal(otpMatches(123456, '123456'), true);
  });

  it('rejects a near miss', () => {
    assert.equal(otpMatches('123456', '123457'), false);
    assert.equal(otpMatches('123456', '12345'), false);
    assert.equal(otpMatches('123456', '1234567'), false);
  });
});
