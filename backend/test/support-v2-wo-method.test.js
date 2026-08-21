'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertMethodForType, courierDirectionFor, slotsToScheduled,
} = require('../services/supportWoLogistics');

test('wo-method: REMOTE_FIX + COURIER is rejected', () => {
  assert.throws(
    () => assertMethodForType('REMOTE_FIX', 'COURIER'),
    (e) => e.status === 400
  );
});

test('wo-method: allowed pairs', () => {
  assert.equal(assertMethodForType('FIELD_VISIT', 'TECHNICIAN'), 'TECHNICIAN');
  assert.equal(assertMethodForType('REPAIR_PICKUP', 'COURIER'), 'COURIER');
  assert.equal(assertMethodForType('REMOTE_FIX', 'REMOTE'), 'REMOTE');
});

test('wo-method: courier direction', () => {
  assert.equal(courierDirectionFor('REPAIR_PICKUP'), 'PICKUP_FROM_CUSTOMER');
  assert.equal(courierDirectionFor('SERVICE_RETURN'), 'DELIVER_TO_CUSTOMER');
});

test('wo-method: multi-slot derives start/end', () => {
  const { start, end } = slotsToScheduled([
    { date: '2026-03-25', start: '14:00', end: '14:30' },
    { date: '2026-03-24', start: '10:30', end: '11:00' },
  ]);
  assert.ok(start < end);
  assert.equal(start.toISOString().startsWith('2026-03-24'), true);
});
