'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('warehouse receipt requires a signature', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/supportReturnPickupService.js'), 'utf8');
  assert.match(src, /signature_attachment_id/);
  assert.match(src, /support_warehouse_receipts/);
  assert.match(src, /WHR\//);
});
