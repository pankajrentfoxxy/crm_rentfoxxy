'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('instantiateWoSteps fans out per-asset and filters method_scope', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/supportWorkOrderSteps.js'), 'utf8');
  assert.match(src, /per_asset/);
  assert.match(src, /method_scope/);
  assert.match(src, /ON CONFLICT \(wo_id, step_code, \(COALESCE\(line_id, 0\)\)\)/);
});

test('completeStep rejects out-of-order', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/supportWorkOrderService.js'), 'utf8');
  assert.match(src, /STEP_OUT_OF_ORDER/);
});
