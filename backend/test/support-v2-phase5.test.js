'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { assertTransition, TRANSITIONS, checkMandatorySteps } = require('../services/supportWorkOrderService');
const { PICKUP_ELIGIBLE_STATUSES } = require('../services/supportPickupEligibility');

test('phase 5: illegal WO transition ASSIGNED → COMPLETED is 409', () => {
  assert.throws(
    () => assertTransition('ASSIGNED', 'COMPLETED'),
    (e) => e.status === 409
  );
});

test('phase 5: legal transitions include unassign and remote skip hook', () => {
  assert.doesNotThrow(() => assertTransition('ASSIGNED', 'PENDING_ASSIGNMENT'));
  assert.doesNotThrow(() => assertTransition('ACCEPTED', 'IN_PROGRESS', { skipsTravel: true }));
  assert.throws(
    () => assertTransition('ACCEPTED', 'EN_ROUTE', { skipsTravel: true }),
    (e) => e.status === 409
  );
  const routes = fs.readFileSync(path.join(__dirname, '../routes/supportV2.js'), 'utf8');
  assert.match(routes, /work-orders\/:woId\/start/);
  const complete = fs.readFileSync(path.join(__dirname, '../services/supportWorkOrderService.js'), 'utf8');
  assert.match(complete, /skipsTravel && wo\.status === 'ACCEPTED'/);
});

test('phase 5: TRANSITIONS map is the only status machine', () => {
  assert.deepEqual(TRANSITIONS.COMPLETED, []);
  assert.ok(TRANSITIONS.IN_PROGRESS.includes('FAILED'));
});

test('phase 5: OTP isolation — WO service never uses OR document_number', () => {
  const file = fs.readFileSync(path.join(__dirname, '../services/supportWorkOrderService.js'), 'utf8');
  assert.equal(/OR\s+document_number/i.test(file), false);
});

test('phase 5: pickup eligibility list is declared in exactly one module', () => {
  const roots = ['services', 'controllers'].map((d) => path.join(__dirname, '..', d));
  const needle = /\[\s*'rented'\s*,\s*'on_demo'\s*,\s*'sold'\s*,\s*'out_stock'\s*\]/;
  const hits = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (name === 'node_modules') continue;
        walk(full);
      } else if (name.endsWith('.js')) {
        const rel = path.relative(path.join(__dirname, '..'), full).replace(/\\/g, '/');
        if (!/support(WorkOrder|PickupEligibility|WoDocuments|V2|CustomerInventory)|workOrderEffects/.test(rel)) continue;
        const text = fs.readFileSync(full, 'utf8');
        if (needle.test(text)) hits.push(rel);
      }
    }
  }
  roots.forEach(walk);
  assert.deepEqual(hits, ['services/supportPickupEligibility.js'], `Eligibility list leaked:\n${hits.join('\n')}`);
  assert.deepEqual([...PICKUP_ELIGIBLE_STATUSES], ['rented', 'on_demo', 'sold', 'out_stock']);
});

test('phase 5: new support-v2 code does not raw-update inventory_status', () => {
  const files = [
    'services/supportWorkOrderService.js',
    'services/workOrderEffects/repairPickup.js',
    'services/workOrderEffects/serviceReturn.js',
    'services/workOrderEffects/fieldVisit.js',
    'services/workOrderEffects/returnPickup.js',
    'services/workOrderEffects/replacement.js',
    'controllers/supportV2WorkOrderController.js',
    'controllers/supportV2ReturnController.js',
    'controllers/supportV2ReplacementController.js',
  ];
  const offenders = [];
  for (const rel of files) {
    const full = path.join(__dirname, '..', rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (/UPDATE\s+vendor_serial_numbers[\s\S]{0,200}inventory_status\s*=/i.test(text)) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, []);
});

test('phase 5: checkMandatorySteps shape', async () => {
  const fake = {
    query: async () => ({ rows: [{ step_code: 'CUSTOMER_OTP' }, { step_code: 'TECH_ESIGN' }] }),
  };
  const r = await checkMandatorySteps(fake, 1);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['CUSTOMER_OTP', 'TECH_ESIGN']);
});
