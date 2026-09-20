/**
 * Part 0 — the remaining money leaks.
 *
 * BL3 is one defect on three paths. The prepaid customer path was fixed first;
 * these tests cover the two that were left behind, and they are written to fail
 * against the code as it stood before this branch:
 *
 *   0.1  postpaid customer — a serial with no rate pushed a Rs 0 line and then
 *        advanced rent_billed_until, so the month was skipped for good.
 *   0.2  vendor — a PO with no usable rate produced a Rs 0 line on the vendor
 *        bill, which reads as "billed" when the unit was never priced.
 *
 * The postpaid builder is exercised through a stub client rather than a real
 * database: what matters is observable from the calls it makes — whether a line
 * was pushed, and whether the watermark UPDATE was issued at all.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { calcVendorLineAmount } = require('../services/billingMath');
const { buildPostpaidInvoiceLines } = require('../services/billingSchedulerService');

const MONTH = 9;
const YEAR = 2026;
const MONTH_START = new Date(YEAR, MONTH - 1, 1);
const MONTH_END = new Date(YEAR, MONTH, 0);

/**
 * Minimal stand-in for a pg client. Returns the serial rows for the first
 * SELECT, empty sets for the two delivery/return loaders, and records every
 * UPDATE so a test can assert the watermark was left alone.
 */
function stubClient({ serials, deliveredOn }) {
  const updates = [];
  return {
    updates,
    async query(sql, params) {
      if (/UPDATE\s+vendor_serial_numbers/i.test(sql)) {
        updates.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }
      if (/FROM\s+vendor_serial_numbers\s+vsn\s+JOIN\s+support_ticket_items/i.test(sql)) {
        return { rows: [] }; // no warehouse returns
      }
      if (/delivered_at AT TIME ZONE/i.test(sql) && /delivery_date/i.test(sql)) {
        return {
          rows: serials.map((s) => ({
            serial_id: s.serial_id,
            delivery_date: deliveredOn,
          })),
        };
      }
      return { rows: serials };
    },
  };
}

const SERIAL_WITH_RATE = {
  serial_id: 101,
  ttspl_id: 'TTSPL1001',
  serial_number: 'SN-1001',
  dc_number: 'DC/26-27/0001',
  inventory_status: 'rented',
  rent_monthly_rate: 3000,
  rent_billed_until: '2026-08-31',
  billed_rate: 3000,
  brand: 'Dell', model: 'Latitude', processor: 'i5',
  generation: '11th', ram: '16GB', storage: '512GB',
};

/** The defect case: no rate anywhere. */
const SERIAL_NO_RATE = {
  ...SERIAL_WITH_RATE,
  serial_id: 202,
  ttspl_id: 'TTSPL2002',
  serial_number: 'SN-2002',
  rent_monthly_rate: null,
  billed_rate: null,
  rent_billed_until: '2026-08-31',
};

describe('0.1 BL3 postpaid — a serial with no rate is skipped, watermark preserved', () => {
  it('writes no line for an unpriced serial', async () => {
    const client = stubClient({ serials: [SERIAL_NO_RATE], deliveredOn: '2026-08-01' });
    const { lineItems } = await buildPostpaidInvoiceLines(client, {
      customerId: 25, month: MONTH, year: YEAR,
      monthStart: MONTH_START, monthEnd: MONTH_END,
    });
    assert.equal(lineItems.length, 0, 'an unpriced serial must not produce a line');
  });

  it('does not advance rent_billed_until for an unpriced serial', async () => {
    const client = stubClient({ serials: [SERIAL_NO_RATE], deliveredOn: '2026-08-01' });
    await buildPostpaidInvoiceLines(client, {
      customerId: 25, month: MONTH, year: YEAR,
      monthStart: MONTH_START, monthEnd: MONTH_END,
    });
    assert.equal(
      client.updates.length, 0,
      'the watermark UPDATE must not run — moving it is what loses the month permanently'
    );
  });

  it('still bills a serial that does have a rate, and advances its watermark', async () => {
    const client = stubClient({ serials: [SERIAL_WITH_RATE], deliveredOn: '2026-08-01' });
    const { lineItems } = await buildPostpaidInvoiceLines(client, {
      customerId: 25, month: MONTH, year: YEAR,
      monthStart: MONTH_START, monthEnd: MONTH_END,
    });
    assert.equal(lineItems.length, 1, 'a priced serial still bills');
    assert.equal(lineItems[0].amount, 3000, 'held all September at Rs 3000/mo');
    assert.equal(client.updates.length, 1, 'watermark advances for a billed serial');
    assert.equal(client.updates[0].params[0], '2026-09-30');
  });

  it('skips only the unpriced serial when both are on the same invoice', async () => {
    const client = stubClient({
      serials: [SERIAL_WITH_RATE, SERIAL_NO_RATE],
      deliveredOn: '2026-08-01',
    });
    const { lineItems } = await buildPostpaidInvoiceLines(client, {
      customerId: 25, month: MONTH, year: YEAR,
      monthStart: MONTH_START, monthEnd: MONTH_END,
    });
    assert.equal(lineItems.length, 1, 'one line, not two');
    assert.equal(lineItems[0].ttspl_id, 'TTSPL1001');
    assert.equal(client.updates.length, 1, 'only the billed serial moves its watermark');
    assert.equal(client.updates[0].params[1], 101);
  });
});

describe('0.2 BL3 vendor — an unpriced PO line produces no vendor line', () => {
  const base = {
    receivedAt: '2026-08-01',
    returnedAt: null,
    monthStart: MONTH_START,
    monthEnd: MONTH_END,
  };

  it('returns null when the rate is null', () => {
    assert.equal(calcVendorLineAmount({ ...base, monthlyRate: null }), null);
  });

  it('returns null when the rate is zero', () => {
    assert.equal(calcVendorLineAmount({ ...base, monthlyRate: 0 }), null);
  });

  it('returns null when the rate is a non-numeric string', () => {
    assert.equal(calcVendorLineAmount({ ...base, monthlyRate: '' }), null);
    assert.equal(calcVendorLineAmount({ ...base, monthlyRate: 'n/a' }), null);
  });

  it('returns null rather than a negative line for a negative rate', () => {
    assert.equal(calcVendorLineAmount({ ...base, monthlyRate: -500 }), null);
  });

  it('still prices a normal vendor line', () => {
    const calc = calcVendorLineAmount({ ...base, monthlyRate: 3000 });
    assert.ok(calc, 'a priced line is unaffected');
    assert.equal(calc.days, 30, 'held all September');
    assert.equal(calc.amount, 3000);
    assert.equal(calc.monthlyRate, 3000);
  });

  it('still returns null for a serial outside the month, as it always did', () => {
    const calc = calcVendorLineAmount({
      ...base,
      receivedAt: '2026-10-05',
      monthlyRate: 3000,
    });
    assert.equal(calc, null, 'received after month end — unrelated to the rate guard');
  });
});
