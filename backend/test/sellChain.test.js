/**
 * Part 4 — Sell: the entity mapping, the quotation gate, the attach races.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });

const {
  entityForQuotationType, UnknownQuotationType, QUOTATION_TYPES,
} = require('../services/salesManagementService');

describe('4.1 — a typo can no longer pick which brand bills the customer (S1)', () => {
  it('maps the three legal types', () => {
    assert.equal(entityForQuotationType('sale'), 'gorefurbo');
    assert.equal(entityForQuotationType('rental'), 'rentfoxxy');
    assert.equal(entityForQuotationType('demo'), 'rentfoxxy');
  });

  it('honours the branch on a demo, which is the one case it varies', () => {
    assert.equal(entityForQuotationType('demo', 'gorefurbo'), 'gorefurbo');
    assert.equal(entityForQuotationType('demo', 'rentfoxxy'), 'rentfoxxy');
    assert.equal(entityForQuotationType('demo', 'nonsense'), 'rentfoxxy');
  });

  it('tolerates case and whitespace, which are not typos', () => {
    assert.equal(entityForQuotationType('Sale'), 'gorefurbo');
    assert.equal(entityForQuotationType('  SALE  '), 'gorefurbo');
    assert.equal(entityForQuotationType('RENTAL'), 'rentfoxxy');
  });

  it('treats NULL and empty as rental EXPLICITLY, not by falling through', () => {
    // Older ERP-imported lines predate the column and are genuinely rentals.
    // The distinction matters: falling through is what made every typo a
    // RentFoxxy order too.
    assert.equal(entityForQuotationType(null), 'rentfoxxy');
    assert.equal(entityForQuotationType(undefined), 'rentfoxxy');
    assert.equal(entityForQuotationType(''), 'rentfoxxy');
    assert.equal(entityForQuotationType('   '), 'rentfoxxy');
  });

  it('THROWS on anything else rather than defaulting to RentFoxxy', () => {
    // This is the finding. A bare `return 'rentfoxxy'` at the end of the
    // if-chain meant 'rentaal' silently billed from the wrong entity with the
    // wrong GSTIN, and the first sign was the invoice.
    for (const bad of ['rentaal', 'N/A', 'sold', 'lease', 'rent', '0']) {
      assert.throws(
        () => entityForQuotationType(bad),
        (e) => {
          assert.ok(e instanceof UnknownQuotationType);
          assert.equal(e.code, 'UNKNOWN_QUOTATION_TYPE');
          assert.equal(e.statusCode, 400);
          return true;
        },
        `"${bad}" should have thrown`
      );
    }
  });

  it('names the three legal values so a caller can be told what to send', () => {
    assert.deepEqual([...QUOTATION_TYPES].sort(), ['demo', 'rental', 'sale']);
  });

  it('says WHY it refused rather than just that it did', () => {
    try {
      entityForQuotationType('rentaal');
      assert.fail('should have thrown');
    } catch (e) {
      assert.match(e.message, /sale, rental or demo/);
      assert.match(e.message, /which brand bills the customer/);
    }
  });
});

describe('4.3 — the quotation gate (Q1)', () => {
  // storeSalesOrder never queried sales_quotations at all, so a rejected quote,
  // a pending quote, a number that does not exist and the literal 'N/A' all
  // produced a valid order. These assert the SHAPE of the fix; the handler
  // itself needs a live request, which the integration suite covers.
  const fs = require('fs');
  const src = fs.readFileSync(`${__dirname}/../controllers/salesManagementController.js`, 'utf8');
  const handler = src.slice(src.indexOf('exports.storeSalesOrder'), src.indexOf('exports.storeSalesOrder') + 9000);

  it('queries sales_quotations, which it never did before', () => {
    assert.match(handler, /FROM sales_quotations/);
  });

  it('refuses a quotation that does not exist', () => {
    assert.match(handler, /does not exist/);
  });

  it('refuses a quotation that is not accepted', () => {
    assert.match(handler, /QUOTATION_NOT_ACCEPTED/);
    assert.match(handler, /only be raised against an accepted quotation/);
  });

  it('still allows an order with no quotation at all', () => {
    // 4,827 of 4,828 existing orders reference 'N/A'. Quotation-less ordering
    // is the normal path on this system, not the exception the plan assumes,
    // and blocking it would stop essentially all order creation.
    assert.match(handler, /isPlaceholder/);
  });
});

describe('4.4 — document numbers are allocated inside their transaction (S2)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(`${__dirname}/../controllers/salesManagementController.js`, 'utf8');

  it('the SO number is allocated on the caller client', () => {
    assert.match(src, /nextFinancialYearNumber\('sales_order', client\)/);
  });

  it('every return_dc allocation passes a client', () => {
    const bare = src.match(/nextDocumentNumber\('return_dc'\)/g) || [];
    assert.equal(bare.length, 0, 'a bare allocation commits and releases the lock, so a rollback burns the number');
  });

  it('allocation comes after BEGIN, not merely with a client', () => {
    // Passing a client with no open transaction changes nothing — that is the
    // trap this code was already in.
    const so = src.indexOf("nextFinancialYearNumber('sales_order', client)");
    const begin = src.lastIndexOf("client.query('BEGIN')", so);
    assert.ok(begin > 0 && begin < so, 'BEGIN must precede the allocation');
  });
});

describe('4.4 — the attach race (S3, I18)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(`${__dirname}/../controllers/salesOrderSerialController.js`, 'utf8');

  it('opens the transaction before the eligibility check', () => {
    const begin = src.indexOf("client.query('BEGIN')");
    const check = src.indexOf('FROM asset_available');
    assert.ok(begin > 0 && check > begin, 'checking outside the transaction you write in IS the race');
  });

  it('locks the serial row it is about to claim', () => {
    assert.match(src, /FOR UPDATE OF vsn/);
  });

  it('asks the ONE availability predicate rather than a fourth hand-rolled rule', () => {
    assert.match(src, /FROM asset_available WHERE serial_id/);
  });

  it('no longer demands qc_status=passed on the per-serial path', () => {
    // Only 48 of 1,930 in-stock units carry that value, so the list offered
    // 1,800 and attach refused all but 48 — I18 surviving where 2.5 did not
    // reach. Decision D5 settled it.
    assert.ok(
      !/qc_status.*!==.*'passed'/.test(src),
      'the per-serial QC gate contradicts asset_available and decision D5'
    );
  });
});

describe('4.4 — the challan races (DC2, DC3)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(`${__dirname}/../controllers/salesManagementController.js`, 'utf8');

  it('claims allocations only while they are still attached (DC2)', () => {
    assert.match(src, /WHERE allocation_id = ANY\(\$2::int\[\]\)\s*\n\s*AND status = 'attached'/);
    assert.match(src, /ALLOCATIONS_TAKEN/);
  });

  it('decrements ONE order line by id, not every line with the same config (DC3)', () => {
    assert.match(src, /NO_LINE_CAPACITY/);
    assert.match(src, /UPDATE sales_order_lines SET quantity = GREATEST\(0, quantity - \$1\), updated_at = NOW\(\)\s*\n\s*WHERE id = \(/);
  });
});
