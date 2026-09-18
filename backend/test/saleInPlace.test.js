/**
 * Sale in Place (PHASE 21) — pure unit tests, no DB access.
 *
 * Covers the two things most likely to be got wrong silently: the refund maths
 * for the unused prepaid days, and the state-machine transition that lets a
 * rented unit become sold without ever moving.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { calcReturnCreditNoteAmount } = require('../services/billingMath');
const { ALLOWED, isAllowed, STATUS } = require('../services/inventoryStateMachine');
const { REASONS, VENDOR_RENTAL_PO_TYPES } = require('../services/saleInPlaceService');

/** The real case this feature was built for: customer 25, reported lost 15 Sep 2026. */
const CASE = {
  reportedOn: '2026-09-15',
  billedUntil: '2026-09-30',
  units: [
    { ttspl: 'TTSPL2688', rate: 1349 },
    { ttspl: 'TTSPL4803', rate: 2499 },
    { ttspl: 'TTSPL4826', rate: 2499 },
    { ttspl: 'TTSPL6817', rate: 2499 },
    { ttspl: 'TTSPL6323', rate: 2499 },
  ],
};

describe('sale in place — credit for unused prepaid days', () => {
  it('refunds 15 days when rent stops 15 Sep and the month is billed to 30 Sep', () => {
    const c = calcReturnCreditNoteAmount({
      rentMonthlyRate: 2499,
      returnDate: CASE.reportedOn,
      rentBilledUntil: CASE.billedUntil,
    });
    assert.ok(c, 'expected a credit');
    assert.equal(c.unusedDays, 15, '16 Sep to 30 Sep inclusive');
    assert.equal(c.monthDays, 30, 'September has 30 days');
    assert.equal(c.amount, 1249.5);
  });

  it('prices the odd unit off its own monthly rate, not a shared one', () => {
    const c = calcReturnCreditNoteAmount({
      rentMonthlyRate: 1349,
      returnDate: CASE.reportedOn,
      rentBilledUntil: CASE.billedUntil,
    });
    assert.equal(c.amount, 674.5);
  });

  it('the five-laptop batch totals 5672.50 ex-GST', () => {
    const total = CASE.units.reduce((sum, u) => {
      const c = calcReturnCreditNoteAmount({
        rentMonthlyRate: u.rate,
        returnDate: CASE.reportedOn,
        rentBilledUntil: CASE.billedUntil,
      });
      return sum + c.amount;
    }, 0);
    assert.equal(Number(total.toFixed(2)), 5672.5);
  });

  it('gives no credit when the unit was never billed past the stop date', () => {
    assert.equal(
      calcReturnCreditNoteAmount({
        rentMonthlyRate: 2499,
        returnDate: '2026-09-30',
        rentBilledUntil: '2026-09-30',
      }),
      null,
      'stopping on the last billed day leaves nothing to refund'
    );
  });

  it('gives no credit when rent stops after the billed period', () => {
    assert.equal(
      calcReturnCreditNoteAmount({
        rentMonthlyRate: 2499,
        returnDate: '2026-10-05',
        rentBilledUntil: '2026-09-30',
      }),
      null
    );
  });
});

describe('sale in place — state machine', () => {
  it('permits rented -> sold (the sale-in-place transition)', () => {
    assert.ok(ALLOWED.rented.includes(STATUS.SOLD));
    assert.equal(isAllowed(STATUS.RENTED, STATUS.SOLD), true);
  });

  it('still permits the ordinary rented -> returned path', () => {
    assert.equal(isAllowed(STATUS.RENTED, STATUS.RETURNED), true);
  });

  it('does not open rented up to unrelated states', () => {
    for (const bad of [STATUS.IN_STOCK, STATUS.RESERVED, STATUS.DISPATCH_READY, STATUS.SCRAPPED]) {
      assert.equal(isAllowed(STATUS.RENTED, bad), false, `rented -> ${bad} must stay blocked`);
    }
  });

  it('leaves a sold unit returnable, so a disputed sale can come back', () => {
    assert.equal(isAllowed(STATUS.SOLD, STATUS.RETURNED), true);
  });

  it('keeps scrapped terminal', () => {
    assert.deepEqual(ALLOWED.scrapped, []);
  });
});

describe('sale in place — service contract', () => {
  it('supports exactly the three agreed reasons', () => {
    assert.deepEqual([...REASONS].sort(), ['buyout', 'damaged', 'lost']);
  });

  it('treats both vendor rental PO types as needing a buyout', () => {
    assert.deepEqual([...VENDOR_RENTAL_PO_TYPES].sort(), ['rent_to_own', 'rental_purchase']);
    assert.ok(!VENDOR_RENTAL_PO_TYPES.includes('direct_purchase'),
      'an owned unit must never be flagged for vendor settlement');
  });
});

describe('sale in place — delivered address for the sale order', () => {
  const { toSoAddress } = require('../services/saleInPlaceService');

  it('unwraps the double-encoded ERP DC address into the SO address shape', () => {
    const raw = {
      name: 'karan Verma',
      address: JSON.stringify(JSON.stringify({
        name: 'Siddhartha Singh', phone: '9311672925', country: 'India',
        state: 'uttar_pradesh', city: 'ujjain', zip_code: '110058',
        address: '704, Tower 2, Janakpuri, New Delhi',
      })),
    };
    const a = toSoAddress(raw);
    assert.equal(a.address, '704, Tower 2, Janakpuri, New Delhi');
    assert.equal(a.zip_code, '110058');
    assert.equal(a.phone, '9311672925');
  });

  it('drops the ERP placeholder city/state so GST is never charged for the wrong state', () => {
    const a = toSoAddress({ address: 'Plot 4, Sector 18', city: 'ujjain', state: 'uttar_pradesh', zip_code: '122015' });
    assert.equal(a.city, '');
    assert.equal(a.state, '', 'the user must confirm the real state before the SO is raised');
  });

  it('keeps a real state and city untouched', () => {
    const a = toSoAddress({ address: 'Hosur Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560068' });
    assert.equal(a.state, 'Karnataka');
    assert.equal(a.city, 'Bengaluru');
    assert.equal(a.zip_code, '560068');
  });

  it('returns null when there is no street address to ship to', () => {
    assert.equal(toSoAddress(null), null);
    assert.equal(toSoAddress({ city: 'Delhi' }), null);
  });
});
