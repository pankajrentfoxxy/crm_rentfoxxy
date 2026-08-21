'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('OTP is not generated at work-order create', () => {
  for (const file of ['repairPickup.js', 'returnPickup.js', 'replacement.js', 'serviceReturn.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../services/workOrderEffects', file), 'utf8');
    assert.equal(src.includes('customer_otp = $2'), false, file);
  }
});

test('OTP service exists with send/reveal/bypass', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/supportOtpService.js'), 'utf8');
  assert.match(src, /sendOtp/);
  assert.match(src, /revealOtp/);
  assert.match(src, /requestBypass/);
  assert.match(src, /otp_send_count >= 3/);
});
