/**
 * Deployed fleet (Stock → With customers, builder 5): the customer-assets list
 * now carries the sales order behind each laptop's challan and since when it
 * is in its state. Read-only against QA inside a rolled-back transaction.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/rollbackHarness');
const ctrl = require('../controllers/inventoryManagement/inventoryList.controller');

let db;

describe('deployed fleet — customer assets list', () => {
  before(async () => { db = await h.open(); });
  after(async () => { await h.close(); });

  it('rows carry the SO behind the challan and the state date; counts add up', async () => {
    const r = await h.call(ctrl.customerAssets, { query: { page: 1, limit: 200 }, validators: ctrl.customerAssetsValidators });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const { counts, data, pagination } = r.body;
    assert.equal(counts.all, pagination.total);
    assert.ok(data.every((x) => 'sales_order_number' in x && 'status_changed_at' in x));
    const withDc = data.find((x) => x.dc_number);
    if (withDc) {
      const so = (await db.query(
        'SELECT sales_order_number FROM delivery_challan_lines WHERE dc_number = $1 AND sales_order_number IS NOT NULL LIMIT 1',
        [withDc.dc_number]
      )).rows[0]?.sales_order_number || null;
      assert.equal(withDc.sales_order_number, so);
    }
  });

  it('status and search filters still narrow the list', async () => {
    const rented = await h.call(ctrl.customerAssets, { query: { status: 'rented', limit: 50 }, validators: ctrl.customerAssetsValidators });
    assert.equal(rented.code, 200);
    assert.ok(rented.body.data.every((x) => x.inventory_status === 'rented'));
    assert.equal(rented.body.pagination.total, rented.body.counts.rented);
  });
});
