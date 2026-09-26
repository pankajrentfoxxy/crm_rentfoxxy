/**
 * #6 (26 Sep 2026): a laptop rented from a vendor gets a purchase-equivalent
 * and the rent paid to date, from the same daily maths as the vendor bill.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { rentAccrued, monthlyRentOfLine, modelKey } = require('../services/laptopCostService');

describe('rented laptop cost', () => {
  it('monthly rent is read like the vendor bill: Monthly rental, then monthly_rate, then Rate', () => {
    assert.equal(monthlyRentOfLine({ rate: 25000, monthly_rental_amount: 1999 }), 1999);
    assert.equal(monthlyRentOfLine({ rate: 1500 }), 1500);
    assert.equal(monthlyRentOfLine({}), null);
  });

  it('rent paid to date is daily, across months, with repair pauses left out', () => {
    assert.deepEqual(rentAccrued({ start: new Date(2026, 8, 1), end: new Date(2026, 8, 30), monthlyRate: 3000 }), { amount: 3000, days: 30 });
    // 16 Sep → 15 Oct: 15 days of Sep (30) + 15 days of Oct (31)
    const two = rentAccrued({ start: new Date(2026, 8, 16), end: new Date(2026, 9, 15), monthlyRate: 3100 });
    assert.equal(two.days, 30);
    assert.equal(two.amount, 1550 + 1500);
    const paused = rentAccrued({ start: new Date(2026, 8, 1), end: new Date(2026, 8, 30), monthlyRate: 3000, pauses: [{ from: new Date(2026, 8, 10), to: new Date(2026, 8, 19) }] });
    assert.deepEqual(paused, { amount: 2000, days: 20 });
    assert.deepEqual(rentAccrued({ start: new Date(2027, 1, 7), end: new Date(2026, 8, 26), monthlyRate: 900 }), { amount: 0, days: 0 });
  });

  it('same model written two ways matches', () => {
    assert.equal(modelKey('Dell Latitude 5490'), modelKey('latitude-5490'));
    assert.notEqual(modelKey('Latitude 5490'), modelKey('Latitude 5410'));
  });
});
