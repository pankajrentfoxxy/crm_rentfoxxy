'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const effects = require('../services/workOrderEffects');
const { ALLOWED } = require('../services/inventoryStateMachine');
const { raiseReturnCreditNoteOnce } = require('../services/supportReturnCreditNote');
const {
  groupSerialsBySiteAndCapacity,
  lockInEndDate,
  earlyTerminationCharge,
  computeChargeable,
  validateGrade,
} = require('../services/supportReturnGuards');

test('phase 6: RETURN_PICKUP is a different effect module from REPAIR_PICKUP', () => {
  assert.ok(effects.RETURN_PICKUP);
  assert.ok(effects.REPAIR_PICKUP);
  assert.notEqual(effects.RETURN_PICKUP, effects.REPAIR_PICKUP);
  assert.equal(typeof effects.RETURN_PICKUP.onWarehouseReceipt, 'function');
  assert.equal(typeof effects.REPAIR_PICKUP.onWarehouseReceipt, 'undefined');
});

test('phase 6: repair holds billing; return stops billing and raises CN only at warehouse', () => {
  const repair = fs.readFileSync(path.join(__dirname, '../services/workOrderEffects/repairPickup.js'), 'utf8');
  const ret = fs.readFileSync(path.join(__dirname, '../services/workOrderEffects/returnPickup.js'), 'utf8');
  assert.ok(repair.includes('startBillingHold'));
  assert.equal(repair.includes('raiseReturnCreditNoteOnce'), false);
  assert.ok(ret.includes('recordBillingStop'));
  assert.ok(ret.includes('raiseReturnCreditNoteOnce'));
  assert.equal(ret.includes('startBillingHold'), false);
  assert.ok(ret.includes("purpose: 'return'"));
  assert.ok(ret.includes('SUPPORT_RETURN_PICKUP'));
});

test('phase 6: generateReturnDc accepts a purpose argument', () => {
  const file = fs.readFileSync(path.join(__dirname, '../services/supportWoDocuments.js'), 'utf8');
  assert.ok(/opts\.purpose|purpose = opts/.test(file));
});

test('phase 6: in_transit → returned is a legal inventory move', () => {
  assert.ok(ALLOWED.in_transit.includes('returned'));
});

test('phase 6: unique (serial_id, wo_id) is in migration 207', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/207_support_v2_return_pickup.sql'), 'utf8');
  assert.ok(sql.includes('uq_credit_notes_serial_wo'));
  assert.ok(sql.includes('support_asset_condition'));
  assert.ok(sql.includes('support_accessory_catalog'));
  assert.ok(/ADAPTER.*2400/.test(sql));
});

test('phase 6: raiseReturnCreditNoteOnce is idempotent for the same serial+wo', async () => {
  const rows = [];
  const client = {
    query: async (sql, params) => {
      if (/FROM customer_credit_notes/.test(sql)) {
        return { rows: rows.filter((r) => r.serial_id === params[0] && r.wo_id === params[1]) };
      }
      if (/FROM vendor_serial_numbers/.test(sql)) {
        return { rows: [{
          serial_id: 1,
          current_customer_id: 9,
          ttspl_id: 'T1',
          rent_billed_until: '2026-08-31',
          rent_monthly_rate: 3000,
        }] };
      }
      if (/sm_document_sequences/.test(sql)) {
        return { rows: [{ number: 'CN-0001' }] };
      }
      if (/INSERT INTO customer_credit_notes/.test(sql)) {
        if (rows.length) {
          const e = new Error('duplicate');
          e.code = '23505';
          throw e;
        }
        const row = { credit_note_id: 1, serial_id: params[11], wo_id: params[12], amount: params[4] };
        rows.push(row);
        return { rows: [row] };
      }
      return { rows: [] };
    },
  };
  const a = await raiseReturnCreditNoteOnce(client, {
    serialId: 1, customerId: 9, stopDate: '2026-08-15', woId: 44,
  });
  const b = await raiseReturnCreditNoteOnce(client, {
    serialId: 1, customerId: 9, stopDate: '2026-08-15', woId: 44,
  });
  assert.equal(a.credit_note_id, b.credit_note_id);
  assert.equal(rows.length, 1);
});

test('phase 6: grade C without damage is rejected; D without photo is rejected', () => {
  assert.throws(
    () => validateGrade({ grade: 'C', damage_items: [], attachment_ids: [1] }, 0),
    (e) => e.status === 400 && /damage item/i.test(e.message)
  );
  assert.throws(
    () => validateGrade({ grade: 'D', damage_items: ['DENT'], attachment_ids: [] }, 0),
    (e) => e.status === 400 && /photo/i.test(e.message)
  );
  assert.throws(
    () => validateGrade({ grade: 'B', damage_items: [], attachment_ids: [] }, 500),
    (e) => e.status === 400 && /evidence/i.test(e.message)
  );
  const ok = validateGrade({ grade: 'C', damage_items: ['DENT'], attachment_ids: [9] }, 800);
  assert.equal(ok.grade, 'C');
});

test('phase 6: missing adapter charge comes from the catalogue', () => {
  const catalogs = {
    accessories: { ADAPTER: { code: 'ADAPTER', charge_amount: 2400 } },
    damage: { DENT: { code: 'DENT', charge_amount: 800 } },
  };
  const r = computeChargeable({ accessories: { ADAPTER: 'MISSING' } }, catalogs);
  assert.equal(r.total, 2400);
  const both = computeChargeable({
    damage_items: [{ code: 'DENT' }],
    accessories: { ADAPTER: { status: 'MISSING' } },
  }, catalogs);
  assert.equal(both.total, 3200);
});

test('phase 6: 40 assets at one site with capacity 25 become 2 work orders', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ serial_id: i + 1, site_id: 141 }));
  const groups = groupSerialsBySiteAndCapacity(items, 25);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].serial_ids.length, 25);
  assert.equal(groups[1].serial_ids.length, 15);
});

test('phase 6: 40 assets across 3 sites group by site', () => {
  const items = [
    ...Array.from({ length: 10 }, (_, i) => ({ serial_id: i + 1, site_id: 1 })),
    ...Array.from({ length: 15 }, (_, i) => ({ serial_id: i + 11, site_id: 2 })),
    ...Array.from({ length: 15 }, (_, i) => ({ serial_id: i + 26, site_id: 3 })),
  ];
  const groups = groupSerialsBySiteAndCapacity(items, 25);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((g) => g.site_id).sort(), [1, 2, 3]);
});

test('phase 6: lock-in inside the window produces a charge; overdue notify does not throw', () => {
  const end = lockInEndDate('2026-01-01', 12);
  assert.ok(end > new Date('2026-08-16'));
  const charge = earlyTerminationCharge({
    rentMonthlyRate: 3000,
    lockInEnd: new Date('2027-01-01'),
    today: new Date('2026-08-16'),
  });
  assert.ok(charge > 0);
  const open = earlyTerminationCharge({
    rentMonthlyRate: 3000,
    lockInEnd: new Date('2026-01-01'),
    today: new Date('2026-08-16'),
  });
  assert.equal(open, 0);
});

test('phase 6: new return files do not raw-update inventory_status', () => {
  const files = [
    'services/workOrderEffects/returnPickup.js',
    'services/supportReturnPickupService.js',
    'services/supportReturnCreditNote.js',
    'services/supportReturnGuards.js',
    'services/supportCustomerInventoryState.js',
    'controllers/supportV2ReturnController.js',
  ];
  const offenders = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    if (/UPDATE\s+vendor_serial_numbers[\s\S]{0,200}inventory_status\s*=/i.test(text)) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, []);
});
