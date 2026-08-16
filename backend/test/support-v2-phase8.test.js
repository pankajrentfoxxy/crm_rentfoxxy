'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const effects = require('../services/workOrderEffects');
const { PAUSE_REASONS } = require('../services/supportSlaService');
const { deriveAssetLineStatus } = require('../services/supportTicketStateService');
const {
  sortPartQueue,
  queueOrderSql,
  filterCompatibleParts,
  assertPhotos,
  OPEN_FIELD_PART_STATUSES,
} = require('../services/supportPartStatus');

test('phase 8: queue sort puts P1 above P4 and breached above all', () => {
  const now = new Date('2026-08-17T10:00:00Z');
  const rows = [
    { request_id: 1, priority: 4, sla_resolution_due_at: '2026-08-18T10:00:00Z', created_at: '2026-08-16T08:00:00Z' },
    { request_id: 2, priority: 1, sla_resolution_due_at: '2026-08-18T10:00:00Z', created_at: '2026-08-16T09:00:00Z' },
    { request_id: 3, priority: 3, sla_resolution_due_at: '2026-08-16T10:00:00Z', created_at: '2026-08-16T10:00:00Z' },
  ];
  const sorted = sortPartQueue(rows, 'priority', now);
  assert.equal(sorted[0].request_id, 3);
  assert.equal(sorted[1].request_id, 2);
  assert.equal(sorted[2].request_id, 1);
});

test('phase 8: oldest sort is FIFO by created_at', () => {
  const rows = [
    { request_id: 2, priority: 1, created_at: '2026-08-16T09:00:00Z' },
    { request_id: 1, priority: 4, created_at: '2026-08-16T08:00:00Z' },
  ];
  const sorted = sortPartQueue(rows, 'oldest');
  assert.equal(sorted[0].request_id, 1);
  assert.equal(sorted[1].request_id, 2);
  assert.match(queueOrderSql('oldest'), /created_at ASC/);
  assert.match(queueOrderSql('priority'), /sla_resolution_due_at < NOW/);
});

test('phase 8: compatible filter; no rows → full catalogue + warning', () => {
  const catalogue = [{ part_id: 1 }, { part_id: 2 }, { part_id: 3 }];
  const filtered = filterCompatibleParts(catalogue, [{ part_id: 2 }]);
  assert.equal(filtered.warning, false);
  assert.deepEqual(filtered.rows.map((p) => p.part_id), [2]);
  const open = filterCompatibleParts(catalogue, []);
  assert.equal(open.warning, true);
  assert.equal(open.rows.length, 3);
});

test('phase 8: photo is required on create', () => {
  assert.throws(() => assertPhotos([]), (e) => e.status === 400);
  assert.throws(() => assertPhotos(null), (e) => e.status === 400);
  assert.deepEqual(assertPhotos([11, 12]), [11, 12]);
});

test('phase 8: PENDING_PART is not a pause reason; PENDING_CUSTOMER is', () => {
  assert.equal(PAUSE_REASONS.has('PENDING_PART'), false);
  assert.equal(PAUSE_REASONS.has('PENDING_CUSTOMER'), true);
});

test('phase 8: waitingForPart is line-scoped; other lines stay OPEN', () => {
  assert.equal(deriveAssetLineStatus({
    currentStatus: 'OPEN', resolutionComplete: false, workOrders: [], waitingForPart: true,
  }), 'PENDING_PART');
  assert.equal(deriveAssetLineStatus({
    currentStatus: 'OPEN', resolutionComplete: false, workOrders: [], waitingForPart: false,
  }), 'OPEN');
});

test('phase 8: parts service loads (no circular require)', () => {
  const svc = require('../services/supportPartsService');
  assert.equal(typeof svc.createPartRequest, 'function');
  assert.equal(typeof svc.consumePart, 'function');
});

test('phase 8: one create path; effects registered; legacy table not rewritten', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/supportPartsService.js'), 'utf8');
  assert.equal((src.match(/async function createPartRequest/g) || []).length, 1);
  assert.ok(effects.PART_DELIVERY);
  assert.ok(effects.PART_RETURN);
  assert.notEqual(effects.PART_DELIVERY, effects.PART_RETURN);
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/209_support_v2_parts_unify.sql'), 'utf8');
  assert.ok(sql.includes('ALTER TABLE part_requests'));
  assert.ok(sql.includes("context"));
  assert.ok(sql.includes('PENDING_PART'));
  assert.ok(sql.includes('legacy_request_number'));
  assert.equal(/DROP TABLE\s+support_part_requests/i.test(sql), false);
  assert.equal(/ALTER TABLE\s+support_part_requests/i.test(sql), false);
});

test('phase 8: supportController and old part screens were not edited', () => {
  const ctrl = fs.readFileSync(path.join(__dirname, '../controllers/supportController.js'), 'utf8');
  assert.equal(ctrl.includes('status_v2'), false);
  assert.equal(ctrl.includes('supportPartsService'), false);
});

test('phase 8: new files do not raw-update inventory_status or redeclare eligibility', () => {
  const files = [
    'services/supportPartsService.js',
    'services/supportPartStatus.js',
    'services/workOrderEffects/partDelivery.js',
    'services/workOrderEffects/partReturn.js',
    'controllers/supportV2PartsController.js',
  ];
  const needle = /\[\s*'rented'\s*,\s*'on_demo'\s*,\s*'sold'\s*,\s*'out_stock'\s*\]/;
  const offenders = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    if (needle.test(text)) offenders.push(`${rel}:eligibility`);
    if (/UPDATE\s+vendor_serial_numbers[\s\S]{0,200}inventory_status\s*=/i.test(text)) {
      offenders.push(`${rel}:inventory_status`);
    }
  }
  assert.deepEqual(offenders, []);
  assert.ok(OPEN_FIELD_PART_STATUSES.includes('ESCALATED_TO_PROCUREMENT'));
});

test('phase 8: health reports phase 8 or later', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/supportV2Controller.js'), 'utf8');
  const m = src.match(/phase:\s*(\d+)/);
  assert.ok(m && Number(m[1]) >= 8);
});
