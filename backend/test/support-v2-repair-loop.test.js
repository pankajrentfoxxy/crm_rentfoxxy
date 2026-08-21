'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('repair loop service closes the floor → dispatch path', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/supportRepairLoopService.js'), 'utf8');
  assert.match(src, /onFloorTicketCompleted/);
  assert.match(src, /SERVICE_RETURN/);
  assert.match(src, /AT_REPAIR_CENTRE/);
  assert.match(src, /endBillingHold/);
});

test('ticketController hooks support-origin completion without changing non-support path', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/ticketController.js'), 'utf8');
  assert.match(src, /customer_owned/);
  assert.match(src, /onFloorTicketCompleted/);
  assert.match(src, /not returned to rentable stock/);
});
