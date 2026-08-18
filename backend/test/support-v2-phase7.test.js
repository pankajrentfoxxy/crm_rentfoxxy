'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const effects = require('../services/workOrderEffects');
const { onComplete } = require('../services/workOrderEffects/returnPickup');
const {
  needsCollectLeg,
  configMatchScore,
  unitValue,
  REASONS,
} = require('../services/supportReplacementService');

test('phase 7: five reasons share one create path', () => {
  assert.deepEqual(REASONS, [
    'FAULTY_IRREPARABLE', 'REPAIR_TOO_LONG', 'UPGRADE_DOWNGRADE',
    'WRONG_UNIT_DELIVERED', 'RESEND_AFTER_RETURN',
  ]);
  const src = fs.readFileSync(path.join(__dirname, '../services/supportReplacementService.js'), 'utf8');
  assert.equal((src.match(/async function createReplacement/g) || []).length, 1);
  assert.equal(src.includes('initiateSwapFromRepairPickup'), false);
  assert.equal(src.includes('initiateReturnRedelivery'), false);
  assert.equal(src.includes('initiateResendLaptop'), false);
  assert.ok(effects.REPLACEMENT_DELIVERY);
  assert.notEqual(effects.REPLACEMENT_DELIVERY, effects.RETURN_PICKUP);
});

test('phase 7: needsCollectLeg looks at location, not the button', () => {
  const atCustomer = { inventory_status: 'rented', current_customer_id: 88 };
  assert.equal(needsCollectLeg(atCustomer, 'FAULTY_IRREPARABLE'), true);
  assert.equal(needsCollectLeg(atCustomer, 'UPGRADE_DOWNGRADE'), true);
  assert.equal(needsCollectLeg(atCustomer, 'WRONG_UNIT_DELIVERED'), true);
  assert.equal(needsCollectLeg(atCustomer, 'REPAIR_TOO_LONG'), false);
  assert.equal(needsCollectLeg(atCustomer, 'RESEND_AFTER_RETURN'), false);
  assert.equal(needsCollectLeg({ inventory_status: 'returned', current_customer_id: null }, 'FAULTY_IRREPARABLE'), false);
  assert.equal(needsCollectLeg({ inventory_status: 'in_repair', current_customer_id: 88 }, 'FAULTY_IRREPARABLE'), false);
});

test('phase 7: collect before delivery is 409 COLLECT_BEFORE_DELIVERY', async () => {
  const client = {
    query: async (sql) => {
      if (/REPLACEMENT_DELIVERY/.test(sql)) return { rows: [{ wo_id: 2, status: 'ASSIGNED' }] };
      if (/collect_waived/.test(sql)) return { rows: [{ collect_waived: false }] };
      return { rows: [] };
    },
  };
  await assert.rejects(
    () => onComplete(client, { replacement_group_id: 'g1', wo_id: 1, ticket_id: 9, wo_number: 'WO-1' }),
    (e) => e.status === 409 && e.code === 'COLLECT_BEFORE_DELIVERY'
  );
});

test('phase 7: waived collect is allowed before delivery', async () => {
  const client = {
    query: async (sql) => {
      if (/REPLACEMENT_DELIVERY/.test(sql)) return { rows: [{ wo_id: 2, status: 'ASSIGNED' }] };
      if (/collect_waived/.test(sql)) return { rows: [{ collect_waived: true, collect_waived_reason: 'lead said so' }] };
      if (/FROM support_tickets_v2/.test(sql)) return { rows: [{ customer_id: 1 }] };
      if (/support_work_order_assets|support_ticket_assets/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  const r = await onComplete(client, {
    replacement_group_id: 'g1', wo_id: 1, ticket_id: 9, wo_number: 'WO-1',
  }, { collect_override: false });
  assert.ok(r.billing_stop_date);
});

test('phase 7: identical config scores 100; worse RAM is a named downgrade', () => {
  const old = { brand: 'Dell', model: 'Latitude 5420', processor: 'i5-1135G7', ram: '16 GB', storage: '512 GB', screen_size: '14' };
  const same = configMatchScore(old, { ...old });
  assert.equal(same.score, 100);
  assert.deepEqual(same.downgrade_fields, []);
  const worse = configMatchScore(old, { ...old, ram: '8 GB' });
  assert.ok(worse.score < 100);
  assert.ok(worse.downgrade_fields.includes('ram'));
});

test('phase 7: unit value ₹52,000 crosses the manager threshold', () => {
  assert.ok(unitValue({ extra: { purchase_cost: 52000 } }) > 40000);
  assert.ok(unitValue({ rent_monthly_rate: 2000, extra: {} }) < 40000);
});

test('phase 7: DATA_TRANSFER step is in migration 208', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/208_support_v2_replacement.sql'), 'utf8');
  assert.ok(sql.includes('support_replacements'));
  assert.ok(sql.includes('DATA_TRANSFER'));
  assert.ok(sql.includes('FAULTY_IRREPARABLE'));
});

test('phase 7: replacement files do not redeclare pickup eligibility or raw-update inventory_status', () => {
  const files = [
    'services/supportReplacementService.js',
    'services/workOrderEffects/replacement.js',
    'controllers/supportV2ReplacementController.js',
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
});
