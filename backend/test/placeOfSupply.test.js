/**
 * Place of supply: an empty shipping state falls back to the billing state
 * (29 Sep 2026 — 44 QA customers had shipping_state = '' and were billed as
 * if the state were unknown). Rolled back.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const hx = require('./helpers/rollbackHarness');

describe('customer place of supply', () => {
  let C; let svc; let id;
  before(async () => {
    C = await hx.open();
    svc = require('../services/billingGstService');
    id = (await C.query('SELECT customer_id FROM customers ORDER BY customer_id LIMIT 1')).rows[0].customer_id;
  });
  after(async () => { await hx.close(); });

  it('empty shipping state uses the billing state', async () => {
    await C.query("UPDATE customers SET shipping_state = '', billing_state = 'Karnataka' WHERE customer_id = $1", [id]);
    assert.equal(await svc.customerPlaceOfSupply(C, id), 'Karnataka');
  });
  it('a real shipping state wins', async () => {
    await C.query("UPDATE customers SET shipping_state = 'Delhi', billing_state = 'Karnataka' WHERE customer_id = $1", [id]);
    assert.equal(await svc.customerPlaceOfSupply(C, id), 'Delhi');
  });
  it('both empty is unknown', async () => {
    await C.query("UPDATE customers SET shipping_state = '  ', billing_state = NULL WHERE customer_id = $1", [id]);
    assert.equal(await svc.customerPlaceOfSupply(C, id), null);
  });
});
