'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateCreate,
  validateResolveLine,
  validatePause,
  reopenWindowError,
  ticketResolveBlockers,
} = require('../services/supportTicketFlowService');

test('phase 4: create rejects unclassified lines with a per-line errors map', () => {
  const r = validateCreate({
    customer_id: 1,
    channel: 'PHONE',
    contact_name: 'Ravi',
    contact_phone: '9876543210',
    asset_lines: [
      { reported_issue_id: 10, reported_description: 'Nothing happens when the power button is pressed' },
      { reported_description: 'short' },
      { reported_issue_id: 11, reported_description: 'too short' },
    ],
  });
  assert.equal(r.ok, false);
  assert.equal(r.message, 'Every machine must be classified');
  assert.ok(r.errors['1']);
  assert.ok(r.errors['2']);
  assert.ok(!r.errors['0']);
});

test('phase 4: create accepts a fully classified Indian-mobile payload', () => {
  const r = validateCreate({
    customer_id: 1,
    channel: 'PHONE',
    contact_name: 'Ravi',
    contact_phone: '+91 98765-43210',
    asset_lines: [
      { reported_issue_id: 10, reported_description: 'Nothing happens when the power button is pressed' },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.phone, '9876543210');
});

test('phase 4: resolve gate — notes 19 blocked, 20 allowed', () => {
  const base = {
    found_issue_id: 1,
    resolution_code_id: 1,
    root_cause_id: 1,
    liability: 'COMPANY',
    action_code_ids: [4],
  };
  assert.ok(validateResolveLine({ ...base, resolution_notes: '1234567890123456789' }).includes('resolution_notes'));
  assert.deepEqual(validateResolveLine({ ...base, resolution_notes: '12345678901234567890' }), []);
});

test('phase 4: chargeable still needs amount+photo at the service (notes/fields only here)', () => {
  const missing = validateResolveLine({
    found_issue_id: 1,
    resolution_code_id: 1,
    root_cause_id: 1,
    liability: 'CUSTOMER_CHARGEABLE',
    action_code_ids: [1],
    resolution_notes: 'Physical damage confirmed from photos and customer admission.',
  });
  assert.deepEqual(missing, []);
});

test('phase 4: pause PENDING_CUSTOMER requires contact_method', () => {
  assert.ok(validatePause({ reason: 'PENDING_CUSTOMER' }));
  assert.ok(validatePause({ reason: 'PENDING_CUSTOMER', contact_method: 'PHONE' }));
  assert.equal(validatePause({
    reason: 'PENDING_CUSTOMER',
    contact_method: 'PHONE',
    contact_reference: 'called 9876543210',
  }), null);
  assert.equal(validatePause({ reason: 'PENDING_VENDOR' }), null);
});

test('phase 4: reopen window is 7 days, 8 days refused', () => {
  const now = new Date('2026-08-16T00:00:00Z');
  assert.equal(reopenWindowError(new Date('2026-08-10T00:00:00Z'), now), null);
  assert.equal(reopenWindowError(new Date('2026-08-08T00:00:00Z'), now), 'Reopen window is 7 days');
});

test('phase 4: ticket resolve lists unresolved lines', () => {
  const blockers = ticketResolveBlockers(
    [{ line_code: 'A1', line_status: 'OPEN', resolution_code_id: null, root_cause_id: null, liability: null }],
    []
  );
  assert.equal(blockers[0].line_code, 'A1');
  assert.ok(blockers[0].missing.includes('resolution_code'));
});
