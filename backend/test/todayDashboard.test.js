/**
 * Today dashboard (claude/pending.md item 11): every tile must equal the count
 * the list it links to shows, for an all-seeing user and for a scoped one.
 * Read-only against QA, inside the rollback harness so nothing can stick.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/rollbackHarness');
const { todayDashboard, istToday, NOT_KEPT } = require('../services/todayDashboardService');
const { getAllowedCustomerTypes } = require('../services/customerAccessScope');
const lead = require('../controllers/leadController');
const sm = require('../controllers/salesManagementController');
const stock = require('../controllers/stockController');
const floor = require('../controllers/floorBoard.controller');
const support = require('../controllers/supportController');
const billing = require('../controllers/customerBillingController');
const vendorBilling = require('../controllers/vendorBillingController');
const dispatch = require('../controllers/dispatchWorkflowController');

/** Like h.call, but lets the caller set request fields middleware would set. */
async function call(fn, { query = {}, user, extra = {} }) {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = () => {};
  await fn({ params: {}, body: {}, query, user, permissionCache: {}, ...extra }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  return res.body;
}

describe('Today dashboard counts equal the lists they open (read-only)', () => {
  let C;
  const users = {};
  const today = istToday();
  const month = `${today.slice(0, 7)}-01`;

  before(async () => {
    C = await h.open();
    const pick = async (role) => (await C.query(
      "SELECT user_id, role, status FROM users WHERE role = $1 AND COALESCE(status, 'active') = 'active' ORDER BY user_id LIMIT 1",
      [role]
    )).rows[0];
    users.admin = await pick('super_admin');
    users.sales = await pick('sales'); // data_scope 'assigned' on QA
    users.support = await pick('support_tech');
  });
  after(() => h.close());

  const dash = (user, date) => todayDashboard({ user, permissionCache: {} }, { date });

  it('leads: created today / this month and follow-ups match /api/leads and the follow-up board', async () => {
    for (const who of ['admin', 'sales']) {
      const user = users[who];
      if (!user) continue;
      const d = (await dash(user)).blocks.leads;
      const day = await call(lead.getLeads, { user, query: { date_from: today, date_to: today, limit: 5000 } });
      const mon = await call(lead.getLeads, { user, query: { date_from: month, date_to: today, limit: 5000 } });
      assert.equal(d.new_day.count, day.total, `${who} new today`);
      assert.equal(d.new_month.count, mon.total, `${who} new this month`);
      const board = await call(lead.getFollowUpBoard, { user });
      assert.equal(d.follow_ups_today.count, board.today.length, `${who} follow-ups today`);
      assert.equal(d.follow_ups_overdue.count, board.overdue.length, `${who} overdue`);
    }
  });

  it('quotations and sales orders (all books and the sale book) match the Sell lists with the same dates', async () => {
    for (const who of ['admin', 'sales']) {
      const user = users[who];
      if (!user) continue;
      const b = (await dash(user)).blocks;
      const q = await call(sm.listQuotations, { user, query: { date_from: month, date_to: today, limit: 1 } });
      assert.equal(b.quotations.month.count, q.pagination.total, `${who} quotations`);
      const so = await call(sm.listSalesOrders, { user, query: { date_from: month, date_to: today, limit: 1 } });
      assert.equal(b.sales_orders.month.count, so.pagination.total, `${who} sales orders`);
      const sold = await call(sm.listSalesOrders, { user, query: { entity_scope: 'sale', date_from: month, date_to: today, limit: 1 } });
      assert.equal(b.sales.month.count, sold.pagination.total, `${who} sold`);
    }
  });

  it('a past day is rebuilt for dated figures and refused for right-now figures', async () => {
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const b = (await dash(users.admin, yesterday)).blocks;
    const so = await call(sm.listSalesOrders, { user: users.admin, query: { date_from: yesterday, date_to: yesterday, limit: 1 } });
    assert.equal(b.sales_orders.day.count, so.pagination.total);
    const del = await call(sm.listDeliveryChallans, { user: users.admin, query: { status: 'delivered', delivered_from: yesterday, delivered_to: yesterday, limit: 1 } });
    assert.equal(b.dispatch.delivered.count, del.pagination.total);
    const went = await call(stock.listAssets, { user: users.admin, query: { moved_to: 'rented', moved_on: yesterday, limit: 1 } });
    assert.equal(b.rentals.went_on_rent.count, went.total);
    assert.equal(b.support.open.unavailable, NOT_KEPT);
    assert.equal(b.stock.ready.unavailable, NOT_KEPT);
    assert.equal(b.money.outstanding.unavailable, NOT_KEPT);
    await assert.rejects(() => dash(users.admin, '2999-01-01'), /today or an earlier day/);
    await assert.rejects(() => dash(users.admin, '29-09-2026'), /YYYY-MM-DD/);
  });

  it('dispatch, stock and floor match the Movement / Stock / Floor lists', async () => {
    const user = users.admin;
    const b = (await dash(user)).blocks;
    const gate = await call(sm.listDeliveryChallans, { user, query: { status: 'dispatch_ready', limit: 1 } });
    assert.equal(b.dispatch.at_gate.count, gate.pagination.total);
    const del = await call(sm.listDeliveryChallans, { user, query: { status: 'delivered', delivered_from: today, delivered_to: today, limit: 1 } });
    assert.equal(b.dispatch.delivered.count, del.pagination.total);
    const accept = await call(dispatch.listPendingOrders, { user });
    assert.equal(b.dispatch.to_accept.count, accept.total);
    const fb = await call(floor.board, { user, query: { stage: 'Dispatch QC' } });
    assert.equal(b.dispatch.dispatch_qc.count, fb.stages.find((s) => s.name === 'Dispatch QC')?.count || 0);
    const withCust = await call(stock.listAssets, { user, query: { view: 'with_customer', limit: 1 } });
    assert.equal(b.rentals.with_customer.count, withCust.total);
    const onRent = await call(stock.listAssets, { user, query: { status: 'rented', limit: 1 } });
    assert.equal(b.rentals.on_rent.count, onRent.total);
    const repair = await call(stock.listAssets, { user, query: { status: 'in_repair', limit: 1 } });
    assert.equal(b.stock.in_repair.count, repair.total);
    const ready = await call(stock.readyStock, { user });
    assert.equal(b.stock.ready.count, ready.summary.total);
    const rdc = await call(sm.listReturnDeliveryChallans, { user, query: { status: 'pending,in_transit', limit: 1 } });
    assert.equal(b.rentals.returns_due.count, rdc.pagination.total);
  });

  it('support and money match the SLA board, ageing, invoices and vendor bills', async () => {
    for (const who of ['admin', 'support']) {
      const user = users[who];
      if (!user) continue;
      const b = (await dash(user)).blocks;
      const sla = await call(support.getSlaBoard, { user, extra: { allowedCustomerTypes: await getAllowedCustomerTypes(user) } });
      assert.equal(b.support.open.count, sla.tickets.length, `${who} open tickets`);
      assert.equal(b.support.breached.count, sla.counts.breached, `${who} SLA breaches`);
    }
    const user = users.admin;
    const m = (await dash(user)).blocks.money;
    const ageing = await call(billing.getAgeing, { user });
    assert.equal(m.outstanding.amount, Number(ageing.totals.outstanding || 0));
    const inv = await call(billing.listInvoices, { user, query: { month: String(Number(today.slice(5, 7))), year: today.slice(0, 4), limit: 10 } });
    assert.equal(m.invoiced_month.count, Number(inv.summary.total_count));
    const bills = await call(vendorBilling.listVendorBills, { user, query: { status: 'generated', limit: 1 } });
    assert.equal(m.vendor_bills_to_approve.count, bills.pagination.total);
  });

  it('a user sees only the blocks their sections allow', async () => {
    const user = users.support;
    if (!user) return;
    const b = (await dash(user)).blocks;
    assert.ok(b.support, 'support block for a support user');
    assert.equal(b.leads, null);
    assert.equal(b.money, null);
  });
});
