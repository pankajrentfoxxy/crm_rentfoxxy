const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  previousMonthRange,
  deliveryInPreviousMonth,
} = require('../services/billingSecurityService');
const { countUniqueLaptops } = require('../utils/invoiceItemFormatting');
const { uniqueCustomerPdfName } = require('../services/customerInvoicePdfService');
const { toLocalYmd } = require('../services/billingMath');

describe('billingSecurity window', () => {
  it('previousMonthRange for September is August', () => {
    const { prevStart, prevEnd, prevMonth, prevYear } = previousMonthRange(9, 2026);
    assert.equal(prevMonth, 8);
    assert.equal(prevYear, 2026);
    assert.equal(toLocalYmd(prevStart), '2026-08-01');
    assert.equal(toLocalYmd(prevEnd), '2026-08-31');
  });

  it('bills security only for the previous calendar month', () => {
    assert.equal(deliveryInPreviousMonth('2026-07-03', 9, 2026), false);
    assert.equal(deliveryInPreviousMonth('2026-08-08', 9, 2026), true);
    assert.equal(deliveryInPreviousMonth('2026-09-01', 9, 2026), false);
    assert.equal(deliveryInPreviousMonth('2026-09-01', 10, 2026), true);
  });

  it('counts each laptop once across rent and security lines', () => {
    assert.equal(countUniqueLaptops([
      { serial_id: 1, ttspl_id: 'TTSPL7637' },
      { serial_id: 1, ttspl_id: 'TTSPL7637', line_type: 'security' },
      { serial_id: 2, ttspl_id: 'TTSPL7563' },
    ]), 2);
  });
});

describe('invoice zip file names', () => {
  it('uses the customer name and keeps collisions unique', () => {
    const used = new Set();
    assert.equal(uniqueCustomerPdfName('NUTRITIONALAB PRIVATE LIMITED', 'INV-1009', used), 'NUTRITIONALAB PRIVATE LIMITED.pdf');
    assert.equal(uniqueCustomerPdfName('NUTRITIONALAB PRIVATE LIMITED', 'INV-1010', used), 'NUTRITIONALAB PRIVATE LIMITED - INV-1010.pdf');
  });
});
