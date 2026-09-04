const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  toLocalYmd,
  addDays,
  daysInclusive,
  monthSegments,
  calcReturnCreditNoteAmount,
  calcVendorLineAmount,
} = require('../services/billingMath');
const {
  deriveCustomerStatus,
  deriveVendorStatus,
} = require('../services/paymentLedgerService');

describe('billingMath', () => {
  it('daysInclusive counts calendar days inclusively', () => {
    const a = new Date(2026, 5, 1);
    const b = new Date(2026, 5, 30);
    assert.equal(daysInclusive(a, b), 30);
  });

  it('monthSegments splits mid-month start across two months (catch-up)', () => {
    const start = new Date(2026, 4, 15); // May 15
    const end = new Date(2026, 5, 30); // Jun 30
    const segs = monthSegments(start, end);
    assert.equal(segs.length, 2);
    assert.equal(segs[0].month, 5);
    assert.equal(segs[1].month, 6);
    assert.equal(daysInclusive(segs[0].segStart, segs[0].segEnd), 17);
    assert.equal(daysInclusive(segs[1].segStart, segs[1].segEnd), 30);
  });

  it('leap February uses 29 days in month denominator', () => {
    const start = new Date(2024, 1, 1);
    const end = new Date(2024, 1, 29);
    const segs = monthSegments(start, end);
    assert.equal(segs[0].daysInMonth, 29);
    const monthlyRate = 2900;
    const daily = monthlyRate / segs[0].daysInMonth;
    const amount = parseFloat((daily * daysInclusive(start, end)).toFixed(2));
    assert.equal(amount, 2900);
  });

  it('calcReturnCreditNoteAmount refunds unused prepaid days after return', () => {
    const calc = calcReturnCreditNoteAmount({
      rentMonthlyRate: 3000,
      returnDate: '2026-06-15',
      rentBilledUntil: '2026-06-30',
    });
    assert.ok(calc);
    assert.equal(calc.unusedDays, 15);
    assert.equal(calc.amount, 1500);
  });

  it('calcReturnCreditNoteAmount returns null when nothing prepaid beyond return', () => {
    const calc = calcReturnCreditNoteAmount({
      rentMonthlyRate: 3000,
      returnDate: '2026-06-30',
      rentBilledUntil: '2026-06-30',
    });
    assert.equal(calc, null);
  });

  it('calcReturnCreditNoteAmount returns null when occupancy was never invoiced past return', () => {
    const calc = calcReturnCreditNoteAmount({
      rentMonthlyRate: 1699,
      returnDate: '2026-08-19',
      rentBilledUntil: '2026-08-19',
    });
    assert.equal(calc, null);
  });

  it('calcVendorLineAmount pro-rates mid-month receive', () => {
    const monthStart = new Date(2026, 5, 1);
    const monthEnd = new Date(2026, 5, 30);
    const calc = calcVendorLineAmount({
      receivedAt: '2026-06-15',
      returnedAt: null,
      monthStart,
      monthEnd,
      monthlyRate: 3000,
    });
    assert.ok(calc);
    assert.equal(calc.days, 16);
    assert.equal(calc.amount, 1600);
  });

  it('calcVendorLineAmount stops at return date within month', () => {
    const monthStart = new Date(2026, 5, 1);
    const monthEnd = new Date(2026, 5, 30);
    const calc = calcVendorLineAmount({
      receivedAt: '2026-06-01',
      returnedAt: '2026-06-10',
      monthStart,
      monthEnd,
      monthlyRate: 3000,
    });
    assert.ok(calc);
    assert.equal(calc.days, 10);
    assert.equal(calc.amount, 1000);
  });

  it('prepaid full month equals monthly rate', () => {
    const monthStart = new Date(2026, 6, 1);
    const monthEnd = new Date(2026, 6, 31);
    const calc = calcVendorLineAmount({
      receivedAt: '2026-06-01',
      returnedAt: null,
      monthStart,
      monthEnd,
      monthlyRate: 3100,
    });
    assert.equal(calc.days, 31);
    assert.equal(calc.amount, 3100);
  });

  it('toLocalYmd avoids UTC day shift', () => {
    const d = new Date(2026, 5, 15, 23, 30, 0);
    assert.equal(toLocalYmd(d), '2026-06-15');
  });
});

describe('paymentLedger status derivation', () => {
  it('marks partially_paid when 0 < paid < total', () => {
    assert.equal(deriveCustomerStatus(40000, 50000, 'sent'), 'partially_paid');
  });

  it('marks paid when amount_paid >= grand_total', () => {
    assert.equal(deriveCustomerStatus(50000, 50000, 'sent'), 'paid');
    assert.equal(deriveCustomerStatus(60000, 50000, 'sent'), 'paid');
  });

  it('zero-total invoice stays draft when unpaid', () => {
    assert.equal(deriveCustomerStatus(0, 0, 'draft'), 'draft');
    assert.equal(deriveVendorStatus(0, 0, 'generated'), 'generated');
  });

  it('vendor partially_paid status', () => {
    assert.equal(deriveVendorStatus(500, 1000, 'approved'), 'partially_paid');
    assert.equal(deriveVendorStatus(1000, 1000, 'approved'), 'paid');
  });
});
