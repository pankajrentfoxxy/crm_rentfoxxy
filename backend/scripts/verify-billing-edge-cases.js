#!/usr/bin/env node
/**
 * Manual billing edge-case verifier — mirrors automated test scenarios.
 * Run: node scripts/verify-billing-edge-cases.js
 */
const {
  monthSegments,
  daysInclusive,
  calcReturnCreditNoteAmount,
  calcVendorLineAmount,
} = require('../services/billingMath');
const { deriveCustomerStatus } = require('../services/paymentLedgerService');

const scenarios = [];

function check(name, fn) {
  try {
    fn();
    scenarios.push({ name, ok: true });
  } catch (e) {
    scenarios.push({ name, ok: false, error: e.message });
  }
}

check('prepaid full month', () => {
  const ms = new Date(2026, 5, 1);
  const me = new Date(2026, 5, 30);
  const c = calcVendorLineAmount({ receivedAt: ms, returnedAt: null, monthStart: ms, monthEnd: me, monthlyRate: 3000 });
  if (c.amount !== 3000) throw new Error(`expected 3000 got ${c.amount}`);
});

check('mid-month start catch-up', () => {
  const segs = monthSegments(new Date(2026, 4, 15), new Date(2026, 5, 30));
  if (segs.length !== 2) throw new Error('expected 2 segments');
});

check('mid-month return credit note', () => {
  const c = calcReturnCreditNoteAmount({ rentMonthlyRate: 3000, returnDate: '2026-06-15', rentBilledUntil: '2026-06-30' });
  if (!c || c.amount !== 1500) throw new Error('bad credit amount');
});

check('leap Feb', () => {
  const segs = monthSegments(new Date(2024, 1, 1), new Date(2024, 1, 29));
  if (segs[0].daysInMonth !== 29) throw new Error('expected 29 day month');
});

check('partial payment status', () => {
  if (deriveCustomerStatus(40000, 50000, 'sent') !== 'partially_paid') throw new Error('bad status');
});

check('credit note larger than invoice (zero total)', () => {
  if (deriveCustomerStatus(0, 0, 'draft') !== 'draft') throw new Error('bad zero-total status');
});

const failed = scenarios.filter((s) => !s.ok);
for (const s of scenarios) {
  console.log(s.ok ? '✓' : '✗', s.name, s.error || '');
}
if (failed.length) {
  process.exit(1);
}
console.log(`All ${scenarios.length} billing edge-case checks passed.`);
