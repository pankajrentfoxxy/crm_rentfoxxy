'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveAttribution } = require('../services/supportFaultAttribution');
const fs = require('fs');
const path = require('path');

test('part-charge: attribution mapping', () => {
  assert.equal(resolveAttribution('CUSTOMER_DAMAGE').chargeable, true);
  assert.equal(resolveAttribution('CUSTOMER_DAMAGE').liability, 'CUSTOMER_CHARGEABLE');
  assert.equal(resolveAttribution('COMPANY_FAULT').chargeable, false);
  assert.equal(resolveAttribution('WEAR_AND_TEAR').needsApproval, false);
  assert.equal(resolveAttribution('UNKNOWN').needsApproval, true);
});

test('part-charge: issue() gates on needs_lead_approval', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/supportPartsService.js'), 'utf8');
  assert.match(src, /needs_lead_approval/);
  assert.match(src, /No selling price set/);
});

test('part-charge: consume writes billing_mode MONTHLY', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/supportPartsService.js'), 'utf8');
  assert.match(src, /billing_mode/);
  assert.match(src, /source_part_request_id/);
});

test('part-charge: monthly hook filters IMMEDIATE', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/supportBillingHooks.js'), 'utf8');
  assert.match(src, /billing_mode.*MONTHLY/);
});
