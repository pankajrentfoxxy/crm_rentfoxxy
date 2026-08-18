'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  skillMatch,
  availability,
  capacity,
  pickAssignee,
  sortBucketRows,
  groupVisits,
  visitGroupKey,
} = require('../services/supportAssignmentEngine');

test('phase 9: CHIP_LEVEL never matches a delivery-only technician', () => {
  const delivery = { user_id: 1, name: 'Ravi', skills: ['FIELD_SWAP'] };
  const chip = { user_id: 2, name: 'Anil', skills: ['CHIP_LEVEL'] };
  const ctx = { skillRequired: 'CHIP_LEVEL' };
  assert.equal(skillMatch(delivery, ctx).ok, false);
  assert.equal(skillMatch(delivery, ctx).rejected_by, 'skillMatch');
  assert.equal(skillMatch(chip, ctx).ok, true);
  const { pick, considered } = pickAssignee([delivery, chip], ctx);
  assert.equal(pick.user_id, 2);
  assert.ok(considered.some((c) => c.user_id === 1 && c.rejected_by === 'skillMatch'));
});

test('phase 9: approved leave and full capacity are skipped with an explanation', () => {
  assert.equal(availability({ on_leave: true }).ok, false);
  assert.equal(availability({ on_leave: true }).rejected_by, 'availability');
  const full = capacity({ jobs_today: 8, max_jobs_per_day: 6 });
  assert.equal(full.ok, false);
  assert.equal(full.rejected_by, 'capacity');
  assert.match(full.detail, /8 of 6/);
  const { pick, considered } = pickAssignee([
    { user_id: 1, name: 'A', skills: ['CHIP_LEVEL'], on_leave: false, jobs_today: 8, max_jobs_per_day: 6 },
  ], { skillRequired: 'CHIP_LEVEL' });
  assert.equal(pick, null);
  assert.equal(considered[0].rejected_by, 'capacity');
});

test('phase 9: continuity prefers the technician who already visited the ticket', () => {
  const a = { user_id: 9, name: 'Rahul', skills: ['HARDWARE_BASIC'], jobs_today: 2, max_jobs_per_day: 6 };
  const b = { user_id: 4, name: 'Neha', skills: ['HARDWARE_BASIC'], jobs_today: 0, max_jobs_per_day: 6 };
  const { pick } = pickAssignee([a, b], { skillRequired: 'HARDWARE_BASIC', previousVisitorId: 9 });
  assert.equal(pick.user_id, 9);
});

test('phase 9: bucket sort is breached, then P1, then slot, then nearest', () => {
  const now = Date.now();
  const rows = [
    { wo_id: 1, priority: 4, sla_due_at: new Date(now + 3600000).toISOString(), slot_start: '2026-08-17T09:00:00Z', distance_km: 1 },
    { wo_id: 2, priority: 1, sla_due_at: new Date(now + 3600000).toISOString(), slot_start: '2026-08-17T11:00:00Z', distance_km: 9 },
    { wo_id: 3, priority: 2, sla_due_at: new Date(now - 3600000).toISOString(), slot_start: '2026-08-17T15:00:00Z', distance_km: 2 },
  ];
  const sorted = sortBucketRows(rows);
  assert.equal(sorted[0].wo_id, 3);
  assert.equal(sorted[1].wo_id, 2);
  assert.equal(sorted[2].wo_id, 1);
});

test('phase 9: same customer/site/day collapse to one group card', () => {
  const rows = [
    { wo_id: 902, wo_type: 'REPAIR_PICKUP', customer_id: 88, site_id: 141, slot_start: '2026-08-14T09:00:00Z', priority: 2, sla_due_at: '2026-08-14T16:00:00Z' },
    { wo_id: 891, wo_type: 'FIELD_VISIT', customer_id: 88, site_id: 141, slot_start: '2026-08-14T10:00:00Z', priority: 1, sla_due_at: '2026-08-14T12:00:00Z' },
    { wo_id: 915, wo_type: 'PART_DELIVERY', customer_id: 88, site_id: 141, slot_start: '2026-08-14T11:00:00Z', priority: 3 },
  ];
  assert.equal(visitGroupKey(rows[0]), visitGroupKey(rows[1]));
  const groups = groupVisits(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].jobs.length, 3);
  assert.equal(Number(groups[0].priority), 1);
  assert.equal(groups[0].sla_due_at, '2026-08-14T12:00:00Z');
});

test('phase 9: GET /me/bucket ignores any user id in the query string', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/supportV2DispatchController.js'), 'utf8');
  assert.match(src, /req\.user\.user_id/);
  assert.equal(/req\.query\.(user_id|assigned_to|technician)/.test(src), false);
});

test('phase 9: new support-v2 files do not reference delivery_person_id', () => {
  const files = [
    'services/supportAssignmentEngine.js',
    'services/supportIdentityService.js',
    'services/supportWorkOrderService.js',
    'services/supportWoDocuments.js',
    'services/supportPartsService.js',
    'services/supportPartStatus.js',
    'services/supportTicketStateService.js',
    'controllers/supportV2DispatchController.js',
    'controllers/supportV2Controller.js',
    'controllers/supportV2WorkOrderController.js',
    'controllers/supportV2PartsController.js',
    'middleware/supportWoAccess.js',
    'routes/supportV2.js',
  ];
  const hits = [];
  for (const rel of files) {
    const full = path.join(__dirname, '..', rel);
    if (!fs.existsSync(full)) continue;
    if (fs.readFileSync(full, 'utf8').includes('delivery_person_id')) hits.push(rel);
  }
  const effects = path.join(__dirname, '../services/workOrderEffects');
  for (const name of fs.readdirSync(effects)) {
    if (!name.endsWith('.js')) continue;
    const rel = `services/workOrderEffects/${name}`;
    if (fs.readFileSync(path.join(effects, name), 'utf8').includes('delivery_person_id')) hits.push(rel);
  }
  assert.deepEqual(hits, []);
});

test('phase 9: identity migration adds assigned_user_id and does not drop delivery_person_id', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/210_support_v2_identity.sql'), 'utf8');
  assert.ok(sql.includes('assigned_user_id'));
  assert.ok(sql.includes('delivery_challan_lines'));
  assert.equal(/DROP COLUMN\s+delivery_person_id/i.test(sql), false);
});

test('phase 9: health reports phase 9 or later', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/supportV2Controller.js'), 'utf8');
  const m = src.match(/phase:\s*(\d+)/);
  assert.ok(m && Number(m[1]) >= 9);
});
