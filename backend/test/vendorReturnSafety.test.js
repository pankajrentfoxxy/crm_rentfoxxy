/**
 * Procure-to-stock safety, batch D: vendor returns.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });
const pool = require('../config/db');
const { nextVendorReturnDcNumber } = require('../services/vendorReturnToVendorService');
const { nextVendorRepairDcNumber } = require('../services/vendorRepairDcShared');
const { redactVendor } = require('../controllers/vendorManagement/vendors.controller');

async function secondWaitsForFirst(allocate) {
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await a.query('BEGIN');
    await b.query('BEGIN');
    await allocate(a);
    const late = Symbol('still waiting');
    const second = allocate(b);
    const early = await Promise.race([second, new Promise((ok) => setTimeout(() => ok(late), 500))]);
    assert.equal(early, late, 'the second allocation must wait for the first transaction');
    await a.query('ROLLBACK');
    assert.match(await second, /\/\d{4}$/);
  } finally {
    await a.query('ROLLBACK').catch(() => {});
    await b.query('ROLLBACK').catch(() => {});
    a.release(); b.release();
  }
}

describe('return and repair DC numbers are allocated one at a time', () => {
  after(async () => { await pool.end(); });
  it('VRTDC', () => secondWaitsForFirst(nextVendorReturnDcNumber));
  it('VRDC', () => secondWaitsForFirst(nextVendorRepairDcNumber));
});

describe('vendor bank details', () => {
  it('are replaced for users without vendor or billing access', () => {
    const v = redactVendor({ vendor_id: 1, business_name: 'X', account_number: '1234', pan_number: 'ABCDE1234F', bank_ifsc_code: 'HDFC0001' }, false);
    assert.equal(v.account_number, 'hidden');
    assert.equal(v.pan_number, 'hidden');
    assert.equal(v.business_name, 'X');
    assert.equal(redactVendor({ account_number: '1234' }, true).account_number, '1234');
  });
});
