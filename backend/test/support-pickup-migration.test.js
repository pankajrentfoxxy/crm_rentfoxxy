'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePickupType,
  mapItemStatus,
  mapTicketStatus,
  mapIssueCategory,
} = require('../services/supportPickupMigration');

test('pickup decision table: first match wins, never source_item_id heuristic', () => {
  assert.deepEqual(
    resolvePickupType({ service_dc_number: 'SDC-1', pickup_type: 'return' }, { hasCreditNote: true }),
    { wo_type: 'REPAIR_PICKUP', confidence: 'HIGH', rule: 'SERVICE_DC' }
  );
  assert.deepEqual(
    resolvePickupType({}, { hasCreditNote: true }),
    { wo_type: 'RETURN_PICKUP', confidence: 'HIGH', rule: 'CREDIT_NOTE_7D' }
  );
  assert.deepEqual(
    resolvePickupType({}, { hasReplacementPickup: true }),
    { wo_type: 'RETURN_PICKUP', confidence: 'HIGH', rule: 'REPLACEMENT_COLLECT' }
  );
  assert.deepEqual(
    resolvePickupType({ pickup_type: 'repair' }, {}),
    { wo_type: 'REPAIR_PICKUP', confidence: 'MEDIUM', rule: 'EXPLICIT_PICKUP_TYPE' }
  );
  assert.deepEqual(
    resolvePickupType({ pickup_type: 'return' }, {}),
    { wo_type: 'RETURN_PICKUP', confidence: 'MEDIUM', rule: 'EXPLICIT_PICKUP_TYPE' }
  );
  assert.deepEqual(
    resolvePickupType({}, { everAwaitingServiceReturn: true }),
    { wo_type: 'REPAIR_PICKUP', confidence: 'MEDIUM', rule: 'AWAITING_SERVICE_RETURN' }
  );
  assert.deepEqual(
    resolvePickupType({}, { serialReturnedOrStockNotAssigned: true }),
    { wo_type: 'RETURN_PICKUP', confidence: 'LOW', rule: 'SERIAL_NOT_ASSIGNED' }
  );
  assert.deepEqual(
    resolvePickupType({ source_item_id: 99 }, {}),
    { wo_type: 'RETURN_PICKUP', confidence: 'LOW', rule: 'FALLBACK' }
  );
});

test('legacy item and ticket status maps', () => {
  assert.equal(mapItemStatus('pending_dispatch').status, 'PENDING_ASSIGNMENT');
  assert.equal(mapItemStatus('picked_up').status, 'COMPLETED');
  assert.equal(mapItemStatus('picked_up').otpDone, true);
  assert.equal(mapItemStatus('awaiting_service_return').followOnServiceReturn, true);
  assert.equal(mapItemStatus('repair_failed').failure_reason, 'LEGACY_REPAIR_FAILED');
  assert.equal(mapTicketStatus('open', false), 'NEW');
  assert.equal(mapTicketStatus('open', true), 'ASSIGNED');
  assert.equal(mapTicketStatus('closed', true), 'CLOSED');
  assert.equal(mapIssueCategory('Hardware / performance'), 'HW-MBD');
  assert.equal(mapIssueCategory(null), 'SVC-OTH');
});
