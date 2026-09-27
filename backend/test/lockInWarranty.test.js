const test = require('node:test');
const assert = require('node:assert');
const { addMonths, daysUntil, lockInActive, warrantyStatus } = require('../services/lockInWarrantyService');
const { fullAmount } = require('../services/lockInBreakService');
const { partOutOfWarranty, isBatteryOrChargerPart } = require('../services/supportServiceBillingService');

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

test('lock-in end = start + N months, clamped to month end', () => {
  assert.strictEqual(addMonths('2026-08-10', 3), '2026-11-10');
  assert.strictEqual(addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(addMonths('2026-11-15', 3), '2027-02-15');
  assert.strictEqual(addMonths('2026-08-10', 0), null);
  assert.strictEqual(addMonths(null, 3), null);
});

test('replacement example: rented Aug with 3 months, replaced in Sep, lock-in still ends in Nov', () => {
  const end = addMonths('2026-08-10', 3);
  assert.strictEqual(daysUntil(end, '2026-09-20'), 51);
});

test('lock-in is active only for a rented laptop before its end date', () => {
  assert.strictEqual(lockInActive({ inventory_status: 'rented', lock_in_end_date: day(5) }), true);
  assert.strictEqual(lockInActive({ inventory_status: 'rented', lock_in_end_date: day(0) }), false);
  assert.strictEqual(lockInActive({ inventory_status: 'sold', lock_in_end_date: day(5) }), false);
  assert.strictEqual(lockInActive({ inventory_status: 'rented', lock_in_end_date: null }), false);
});

test('early-return full amount = remaining days x monthly rate / 30', () => {
  assert.strictEqual(fullAmount(3000, 45), 4500);
  assert.strictEqual(fullAmount(5999, 147), 29395.1);
});

test('warranty status of a sold laptop', () => {
  assert.strictEqual(warrantyStatus({ inventory_status: 'sold', warranty_end_date: day(10), battery_warranty_end_date: day(-1) }), 'in');
  assert.strictEqual(warrantyStatus({ inventory_status: 'sold', warranty_end_date: day(-1), battery_warranty_end_date: day(10) }), 'battery_only');
  assert.strictEqual(warrantyStatus({ inventory_status: 'sold', warranty_end_date: null }), 'out');
  assert.strictEqual(warrantyStatus({ inventory_status: 'rented' }), null);
});

test('out-of-warranty parts are chargeable; battery parts follow the battery warranty', () => {
  const lap = { inventory_status: 'sold', warranty_end_date: day(30), battery_warranty_end_date: day(-2) };
  assert.strictEqual(partOutOfWarranty(lap, { category: 'ram' }), null);
  assert.match(partOutOfWarranty(lap, { category: 'battery' }), /battery \/ charger warranty ended/);
  assert.match(partOutOfWarranty(lap, { part_name: '65W Charger' }), /Out of warranty/);
  assert.strictEqual(partOutOfWarranty({ ...lap, inventory_status: 'rented' }, { category: 'ram' }), null);
  assert.match(partOutOfWarranty({ inventory_status: 'sold' }, { category: 'ram' }), /no warranty/);
  assert.strictEqual(isBatteryOrChargerPart({ category: 'power' }), true);
});
