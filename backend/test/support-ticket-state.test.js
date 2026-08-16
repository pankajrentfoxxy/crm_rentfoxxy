'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deriveTicketStatus, deriveAssetLineStatus } = require('../services/supportTicketStateService');

test('deriveTicketStatus: CANCELLED and CLOSED stay terminal', () => {
  assert.equal(deriveTicketStatus({
    currentStatus: 'CANCELLED', lines: [], workOrders: [], pendingReason: 'PENDING_CUSTOMER', assignedTo: 1,
  }).status, 'CANCELLED');
  assert.equal(deriveTicketStatus({
    currentStatus: 'CLOSED', lines: [], workOrders: [], pendingReason: null, assignedTo: null,
  }).status, 'CLOSED');
});

test('deriveTicketStatus: resolve only when lines have codes; else blockers', () => {
  const incomplete = deriveTicketStatus({
    currentStatus: 'IN_PROGRESS',
    lines: [{ line_code: 'A1', line_status: 'RESOLVED', resolution_code_id: null, root_cause_id: 1, liability: 'COMPANY', reported_issue_id: 1 }],
    workOrders: [{ wo_number: 'WO-1', status: 'COMPLETED' }],
    pendingReason: null,
    assignedTo: 9,
  });
  assert.equal(incomplete.status, 'IN_PROGRESS');
  assert.ok(incomplete.blockers.some((b) => b.missing && b.missing.includes('resolution_code')));

  const ok = deriveTicketStatus({
    currentStatus: 'IN_PROGRESS',
    lines: [{ line_code: 'A1', line_status: 'RESOLVED', resolution_code_id: 1, root_cause_id: 1, liability: 'COMPANY', reported_issue_id: 1 }],
    workOrders: [{ wo_number: 'WO-1', status: 'COMPLETED' }],
    pendingReason: null,
    assignedTo: 9,
  });
  assert.equal(ok.status, 'RESOLVED');
});

test('deriveTicketStatus: pending, in-progress WO, assigned, triaged, new', () => {
  const line = { line_code: 'A1', line_status: 'OPEN', reported_issue_id: 5 };
  assert.equal(deriveTicketStatus({
    currentStatus: 'NEW', lines: [line], workOrders: [], pendingReason: 'PENDING_PART', assignedTo: null,
  }).status, 'PENDING');
  assert.equal(deriveTicketStatus({
    currentStatus: 'ASSIGNED', lines: [line], workOrders: [{ status: 'EN_ROUTE' }], pendingReason: null, assignedTo: 1,
  }).status, 'IN_PROGRESS');
  assert.equal(deriveTicketStatus({
    currentStatus: 'NEW', lines: [line], workOrders: [], pendingReason: null, assignedTo: 1,
  }).status, 'ASSIGNED');
  assert.equal(deriveTicketStatus({
    currentStatus: 'NEW', lines: [line], workOrders: [], pendingReason: null, assignedTo: null,
  }).status, 'TRIAGED');
  assert.equal(deriveTicketStatus({
    currentStatus: 'NEW', lines: [], workOrders: [], pendingReason: null, assignedTo: null,
  }).status, 'NEW');
});

test('deriveAssetLineStatus', () => {
  assert.equal(deriveAssetLineStatus({ currentStatus: 'CANCELLED', resolutionComplete: true, workOrders: [] }), 'CANCELLED');
  assert.equal(deriveAssetLineStatus({ currentStatus: 'OPEN', resolutionComplete: true, workOrders: [] }), 'RESOLVED');
  assert.equal(deriveAssetLineStatus({
    currentStatus: 'OPEN', resolutionComplete: false, workOrders: [{ status: 'ON_SITE' }],
  }), 'IN_PROGRESS');
  assert.equal(deriveAssetLineStatus({
    currentStatus: 'OPEN', resolutionComplete: false, workOrders: [{ status: 'PENDING_ASSIGNMENT' }],
  }), 'PENDING');
  assert.equal(deriveAssetLineStatus({ currentStatus: 'OPEN', resolutionComplete: false, workOrders: [] }), 'OPEN');
  assert.equal(deriveAssetLineStatus({
    currentStatus: 'OPEN', resolutionComplete: false, workOrders: [], waitingForPart: true,
  }), 'PENDING_PART');
  assert.equal(deriveAssetLineStatus({
    currentStatus: 'OPEN', resolutionComplete: false, workOrders: [{ status: 'ON_SITE' }], waitingForPart: false,
  }), 'IN_PROGRESS');
});
