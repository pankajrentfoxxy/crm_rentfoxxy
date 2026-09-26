/**
 * Procure-to-stock step 0: a vendor bills each laptop at ITS OWN PO line's
 * monthly rent. Runs the exact SQL fragments the bill uses.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });
const pool = require('../config/db');
const { VENDOR_LINE_JOIN_SQL, VENDOR_LINE_RATE_SQL } = require('../services/billingSchedulerService');

async function rateFor(lines, extra) {
  const { rows } = await pool.query(
    `SELECT ${VENDOR_LINE_RATE_SQL} AS rate
       FROM (SELECT $1::jsonb AS line_items) vpo
      CROSS JOIN (SELECT $2::jsonb AS extra) vsn
      ${VENDOR_LINE_JOIN_SQL}`,
    [JSON.stringify(lines), JSON.stringify(extra)]
  );
  return rows[0].rate == null ? null : Number(rows[0].rate);
}

describe('vendor monthly rent per laptop', () => {
  after(async () => { await pool.end(); });

  it('uses the laptop’s own line, not line 1', async () => {
    const lines = [{ rate: '1200' }, { rate: '700' }, { rate: '6200' }];
    assert.equal(await rateFor(lines, { line_index: 1 }), 700);
    assert.equal(await rateFor(lines, { line_index: 2 }), 6200);
  });

  it('prefers Monthly rental over Rate on the same line (PO-0225)', async () => {
    assert.equal(await rateFor([{ rate: '25000', monthly_rental_amount: '1999' }], { line_index: 0 }), 1999);
  });

  it('falls back to Rate, then line 1 when the laptop has no line recorded', async () => {
    assert.equal(await rateFor([{ rate: '900' }, { rate: '700' }], {}), 900);
    assert.equal(await rateFor([{ rate: '900' }], { line_index: 5 }), 900, 'a line index past the end uses line 1');
  });

  it('bills nothing for a line with no usable rate (it is logged and skipped)', async () => {
    assert.equal(await rateFor([{ rate: '0', monthly_rental_amount: '' }], { line_index: 0 }), null);
    assert.equal(await rateFor([{ rate: '' }], { line_index: 0 }), null);
  });
});
