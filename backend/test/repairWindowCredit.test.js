const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calcRepairWindowCreditAmount, toLocalYmd } = require('../services/billingMath');

// Rule: a repair pickup does not end the rental. Billing runs continuously and
// the days the unit actually sat in the warehouse are credited back. The two
// transit legs stay billed, so the credit is arrival+1 .. dispatch-1.
describe('repair window credit', () => {
  it('credits only the full days spent in the warehouse', () => {
    // Arrived 10 Sep, sent back 20 Sep. Billed for both transit legs, so the
    // credit covers 11-19 Sep = 9 days. Sept has 30 days, 1800/30 = 60/day.
    const r = calcRepairWindowCreditAmount({
      rentMonthlyRate: 1800,
      warehouseReceivedAt: '2026-09-10',
      dispatchedBackAt: '2026-09-20',
    });
    assert.equal(r.days, 9);
    assert.equal(toLocalYmd(r.creditStart), '2026-09-11');
    assert.equal(toLocalYmd(r.creditEnd), '2026-09-19');
    assert.equal(r.dailyRate, 60);
    assert.equal(r.amount, 540);
  });

  it('credits nothing when the unit arrives and leaves the same day', () => {
    assert.equal(calcRepairWindowCreditAmount({
      rentMonthlyRate: 1800,
      warehouseReceivedAt: '2026-09-10',
      dispatchedBackAt: '2026-09-10',
    }), null);
  });

  it('credits nothing for a turnaround with no full day in between', () => {
    // In on the 10th, out on the 11th: both days are transit, nothing to credit.
    assert.equal(calcRepairWindowCreditAmount({
      rentMonthlyRate: 1800,
      warehouseReceivedAt: '2026-09-10',
      dispatchedBackAt: '2026-09-11',
    }), null);
  });

  it('credits a single day for a two-night stay', () => {
    const r = calcRepairWindowCreditAmount({
      rentMonthlyRate: 1800,
      warehouseReceivedAt: '2026-09-10',
      dispatchedBackAt: '2026-09-12',
    });
    assert.equal(r.days, 1);
    assert.equal(r.amount, 60);
  });

  it('uses the divisor of the month the warehouse days fall in', () => {
    // February 2026 has 28 days, so 1800/28 = 64.2857/day, not 60.
    const r = calcRepairWindowCreditAmount({
      rentMonthlyRate: 1800,
      warehouseReceivedAt: '2026-02-10',
      dispatchedBackAt: '2026-02-20',
    });
    assert.equal(r.monthDays, 28);
    assert.equal(r.days, 9);
    assert.equal(r.amount, 578.57);
  });

  it('refuses nonsense input rather than guessing', () => {
    assert.equal(calcRepairWindowCreditAmount({ rentMonthlyRate: 1800, warehouseReceivedAt: null, dispatchedBackAt: '2026-09-20' }), null);
    assert.equal(calcRepairWindowCreditAmount({ rentMonthlyRate: 1800, warehouseReceivedAt: '2026-09-10', dispatchedBackAt: null }), null);
    // Dispatched before it arrived.
    assert.equal(calcRepairWindowCreditAmount({ rentMonthlyRate: 1800, warehouseReceivedAt: '2026-09-20', dispatchedBackAt: '2026-09-10' }), null);
    // No rate on the unit means no credit can be computed.
    assert.equal(calcRepairWindowCreditAmount({ rentMonthlyRate: 0, warehouseReceivedAt: '2026-09-10', dispatchedBackAt: '2026-09-20' }), null);
  });
});
