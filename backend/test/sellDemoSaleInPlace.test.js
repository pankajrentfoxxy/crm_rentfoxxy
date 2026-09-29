/**
 * Sell → Demo agreements and Sale in Place (Builder 6, 29 Sep 2026).
 *
 * DB tests inside one rolled-back transaction (test/helpers/rollbackHarness):
 *   - decideDemo refuses a bad billing-start date / rate before touching anything,
 *     and a demo outside the caller's Customer Access scope (404, unchanged);
 *   - the all-customers Sale in Place list: stage filter is whitelisted, rows are
 *     newest first, Customer Access scope applies;
 *   - the per-customer case list now honours Customer Access scope (403).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/rollbackHarness');

const demoCtrl = require('../controllers/demoController');
const custCtrl = require('../controllers/customerManagementController');

const USER = { user_id: 1, name: 'Test', role: 'super_admin' };

/** Like H.call, but lets the test set req.allowedCustomerTypes (customerScope middleware). */
async function call(fn, { params = {}, body = {}, query = {}, allowedCustomerTypes } = {}) {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = () => {};
  const req = { params, body, query, user: USER, permissionCache: {}, allowedCustomerTypes };
  await fn(req, res);
  return res;
}

let db;
let rentalCustomerId;
let demoId;

before(async () => {
  db = await H.open();
  const c = await db.query(
    `INSERT INTO customers (name, company_name, customer_type)
     VALUES ('B6 demo test', 'B6 Demo Test Pvt Ltd', 'rental') RETURNING customer_id`,
  );
  rentalCustomerId = c.rows[0].customer_id;
  // No serial: "keep" then only records the decision (no asset transition, no invoice).
  const d = await db.query(
    `INSERT INTO demo_agreements (customer_id, ttspl_id, delivered_at, decision_due_at, decision)
     VALUES ($1, 'TTSPLB6TEST', NOW() - INTERVAL '8 days', NOW() - INTERVAL '1 day', 'pending')
     RETURNING demo_id`,
    [rentalCustomerId],
  );
  demoId = d.rows[0].demo_id;
});

after(async () => { await H.close(); });

describe('decideDemo — input checks', () => {
  it('refuses an unknown decision', async () => {
    const r = await call(demoCtrl.decideDemo, { params: { demoId }, body: { decision: 'maybe' } });
    assert.equal(r.code, 400);
  });

  it('refuses a billing start that is not a real date', async () => {
    for (const bad of ['2026-02-30', '30/09/2026', 'tomorrow']) {
      const r = await call(demoCtrl.decideDemo, { params: { demoId }, body: { decision: 'keep', rent_start_date: bad } });
      assert.equal(r.code, 400, bad);
      assert.match(r.body.message, /valid date/);
    }
  });

  it('refuses a zero / negative / non-numeric monthly rate', async () => {
    for (const bad of [0, -100, 'abc']) {
      const r = await call(demoCtrl.decideDemo, { params: { demoId }, body: { decision: 'keep', rent_start_date: '2026-09-29', monthly_rate: bad } });
      assert.equal(r.code, 400, String(bad));
    }
    const row = await db.query('SELECT decision FROM demo_agreements WHERE demo_id = $1', [demoId]);
    assert.equal(row.rows[0].decision, 'pending');
  });
});

describe('decideDemo — Customer Access scope', () => {
  it('a sales-only user cannot decide a rental customer\'s demo', async () => {
    const r = await call(demoCtrl.decideDemo, {
      params: { demoId }, body: { decision: 'keep', rent_start_date: '2026-09-29' }, allowedCustomerTypes: ['sales', 'both'],
    });
    assert.equal(r.code, 404);
    const row = await db.query('SELECT decision FROM demo_agreements WHERE demo_id = $1', [demoId]);
    assert.equal(row.rows[0].decision, 'pending');
  });

  it('an unrestricted user can keep it, and a second decision is refused', async () => {
    const r = await call(demoCtrl.decideDemo, { params: { demoId }, body: { decision: 'keep', rent_start_date: '2026-09-29' } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const row = await db.query('SELECT decision, rent_start_date::text AS d FROM demo_agreements WHERE demo_id = $1', [demoId]);
    assert.equal(row.rows[0].decision, 'keep');
    assert.equal(row.rows[0].d, '2026-09-29');
    const again = await call(demoCtrl.decideDemo, { params: { demoId }, body: { decision: 'return' } });
    assert.equal(again.code, 409);
  });
});

describe('Sale in Place — all-customers list', () => {
  it('lists newest first with a derived stage', async () => {
    const r = await call(custCtrl.listAllSaleInPlaceCases, { query: {} });
    assert.equal(r.code, 200);
    const rows = r.body.data;
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(new Date(rows[i - 1].created_at) >= new Date(rows[i].created_at), 'newest first');
    }
    rows.forEach((x) => assert.ok(custCtrl.SALE_IN_PLACE_STAGES.includes(x.stage), x.stage));
  });

  it('filters by stage and ignores an unknown stage', async () => {
    const all = await call(custCtrl.listAllSaleInPlaceCases, { query: {} });
    const bogus = await call(custCtrl.listAllSaleInPlaceCases, { query: { stage: "sold' OR 1=1 --" } });
    assert.equal(bogus.body.data.length, all.body.data.length, 'unknown stage = no filter');
    for (const stage of custCtrl.SALE_IN_PLACE_STAGES) {
      const r = await call(custCtrl.listAllSaleInPlaceCases, { query: { stage } });
      assert.equal(r.code, 200);
      r.body.data.forEach((x) => assert.equal(x.stage, stage));
    }
  });

  it('applies Customer Access scope', async () => {
    const r = await call(custCtrl.listAllSaleInPlaceCases, { query: {}, allowedCustomerTypes: ['sales'] });
    assert.equal(r.code, 200);
    r.body.data.forEach((x) => assert.equal(x.customer_type, 'sales'));
  });

  it('per-customer case list refuses a customer outside the scope', async () => {
    const r = await call(custCtrl.listSaleInPlaceCases, { params: { customerId: String(rentalCustomerId) }, allowedCustomerTypes: ['sales', 'both'] });
    assert.equal(r.code, 403);
    const ok = await call(custCtrl.listSaleInPlaceCases, { params: { customerId: String(rentalCustomerId) } });
    assert.equal(ok.code, 200);
  });
});
