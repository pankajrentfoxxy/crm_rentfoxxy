/**
 * Lead flow (claude/carret-lead.md; decisions 26 Sep 2026): Deal = convert in
 * one step, follow-ups with outcomes, leads move forward on quote / SO, and an
 * assigned-only user cannot edit someone else's lead.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/rollbackHarness');

describe('lead flow', () => {
  let C; let ctrl; let flow; let admin; let leadId;
  const GST = '06AAHCT0310N1ZG';
  before(async () => {
    C = await H.open();
    ctrl = require('../controllers/leadController');
    flow = require('../services/leadFlowService');
    const u = (await C.query(`SELECT user_id FROM users WHERE role = 'super_admin' ORDER BY user_id LIMIT 1`)).rows[0];
    admin = { user_id: u.user_id, id: u.user_id, role: 'super_admin', permissions: [] };
    leadId = (await C.query(
      `INSERT INTO leads (name, company_name, email, phone, source, status, inquiry_type, created_at, updated_at)
       VALUES ('Test Buyer', 'Flowtest Pvt Ltd', 'buyer@flowtest.in', '9812345678', 'Google', 'Pending', 'rental', NOW(), NOW())
       RETURNING lead_id`
    )).rows[0].lead_id;
  });
  after(async () => { await H.close(); });

  it('no customer is created before Mark as Deal', async () => {
    const noCust = (await C.query('SELECT COUNT(*)::int AS n FROM customers WHERE source_lead_id = $1', [leadId])).rows[0].n;
    assert.equal(noCust, 0);
    const src = require('fs').readFileSync(require.resolve('../controllers/leadController'), 'utf8');
    assert.match(src, /CONVERT_REQUIRED/, 'plain Deal / Demo status change is refused without a customer');
    assert.doesNotMatch(src, /ensureCustomerFromLead/, 'the silent customer creator is gone');
  });

  it('a follow-up needs an outcome and the next date', async () => {
    const bad = await H.call(ctrl.completeLeadFollowUp, { user: admin, params: { id: String(leadId) }, body: { outcome: 'spoke', notes: 'Wants 10 laptops' } });
    assert.equal(bad.code, 400);
    assert.match(bad.body.message, /next follow-up/);
    const tomorrow = new Date(Date.now() + 330 * 60000 + 86400000).toISOString().slice(0, 10);
    const ok = await H.call(ctrl.completeLeadFollowUp, { user: admin, params: { id: String(leadId) }, body: { outcome: 'spoke', notes: 'Wants 10 laptops', next_date: tomorrow, next_time: '11:30' } });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));
    const l = (await C.query(`SELECT (follow_up_date AT TIME ZONE 'Asia/Kolkata')::date::text AS d, follow_up_time::text AS t FROM leads WHERE lead_id = $1`, [leadId])).rows[0];
    assert.equal(l.d, tomorrow);
    assert.equal(l.t, '11:30:00');
    const log = await H.call(ctrl.getLeadFollowUpLog, { user: admin, params: { id: String(leadId) } });
    assert.equal(log.body.log.length, 1);
    assert.equal(log.body.log[0].outcome, 'spoke');
  });

  it('a quote moves the lead forward, never back', async () => {
    assert.deepEqual(await flow.advanceLead(C, leadId, 'quote_sent', { ref: 'QT-1' }), { from: 'Pending', to: 'Cold' });
    assert.deepEqual(await flow.advanceLead(C, leadId, 'quote_accepted', { ref: 'QT-1' }), { from: 'Cold', to: 'Warm' });
    assert.equal(await flow.advanceLead(C, leadId, 'quote_sent', { ref: 'QT-2' }), null, 'a second quote does not move a Warm lead back');
    const l = (await C.query('SELECT status, lead_stage FROM leads WHERE lead_id = $1', [leadId])).rows[0];
    assert.deepEqual(l, { status: 'Warm', lead_stage: 'Price Agreed' });
  });

  it('Mark as Deal creates the customer with addresses and sets Deal in one step', async () => {
    const miss = await H.call(ctrl.winLead, { user: admin, params: { id: String(leadId) }, body: { status: 'Deal', gst_number: GST } });
    assert.equal(miss.code, 400);
    assert.match(miss.body.message, /Billing address/);
    const r = await H.call(ctrl.winLead, {
      user: admin,
      params: { id: String(leadId) },
      body: {
        status: 'Deal', gst_number: GST, billing_address: '12 MG Road', billing_city: 'Gurugram', billing_state: 'Haryana', billing_pincode: '122001',
        spock_person_name: 'Ravi Kumar', spock_person_email: 'ravi@flowtest.in', spock_person_mobile: '9812345678',
        shipping_same_as_billing: false, shipping_address: 'Plot 4, Sector 18', shipping_city: 'Noida', shipping_state: 'Uttar Pradesh', shipping_pincode: '201301',
      },
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const l = (await C.query('SELECT status, customer_id, converted_at FROM leads WHERE lead_id = $1', [leadId])).rows[0];
    assert.equal(l.status, 'Deal');
    assert.equal(l.customer_id, r.body.customer_id);
    assert.ok(l.converted_at);
    const addrs = (await C.query('SELECT address_type, is_head_office, state FROM customer_addresses WHERE customer_id = $1 ORDER BY is_head_office DESC', [l.customer_id])).rows;
    assert.deepEqual(addrs.map((a) => [a.address_type, a.is_head_office, a.state]), [['Billing', true, 'Haryana'], ['Shipping', false, 'Uttar Pradesh']]);
  });

  it('a sales order for the customer moves a lead to Deal, even from Gone', async () => {
    await C.query(`UPDATE leads SET status = 'Gone', lead_stage = 'Plan Cancelled' WHERE lead_id = $1`, [leadId]);
    const cust = (await C.query('SELECT customer_id FROM leads WHERE lead_id = $1', [leadId])).rows[0].customer_id;
    assert.equal(await flow.leadForCustomer(C, cust), leadId);
    assert.deepEqual(await flow.advanceLead(C, leadId, 'so_created', { ref: 'SO/TEST' }), { from: 'Gone', to: 'Deal' });
    assert.equal(await flow.advanceLead(C, leadId, 'quote_sent'), null);
  });

  it('an assigned-only user cannot edit a lead that is not theirs', async () => {
    const sales = (await C.query(`SELECT user_id FROM users WHERE role = 'sales' AND user_id <> $1 ORDER BY user_id LIMIT 1`, [admin.user_id])).rows[0];
    if (!sales) return;
    await C.query('UPDATE leads SET assigned_user_id = $2 WHERE lead_id = $1', [leadId, admin.user_id]);
    const ds = require('../services/dataScopeService');
    const orig = ds.isRestrictedToAssigned;
    ds.isRestrictedToAssigned = async () => true;
    try {
      const r = await H.call(ctrl.completeLeadFollowUp, { user: { user_id: sales.user_id, id: sales.user_id, role: 'sales', permissions: [] }, params: { id: String(leadId) }, body: { outcome: 'no_answer' } });
      assert.equal(r.code, 403);
    } finally {
      ds.isRestrictedToAssigned = orig;
    }
  });
});
