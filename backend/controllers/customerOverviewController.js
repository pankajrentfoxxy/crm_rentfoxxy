/** Customers in the new UI — list, record summary, orders (services/customerOverviewService.js). */
const svc = require('../services/customerOverviewService');

const fail = (res, e, where) => {
  console.error(`${where}:`, e);
  res.status(500).json({ success: false, message: e.message || 'Request failed' });
};

exports.list = async (req, res) => {
  try {
    const q = req.query || {};
    const out = await svc.listCustomers({
      search: q.search, tag: q.tag, status: q.status || 'active', activity: q.activity, kyc: q.kyc,
      page: q.page, limit: q.limit, allowedTypes: req.allowedCustomerTypes,
    });
    res.json({ success: true, ...out });
  } catch (e) { fail(res, e, 'customerOverview.list'); }
};

exports.get = async (req, res) => {
  try {
    const row = await svc.getOverview(req.params.customerId, { allowedTypes: req.allowedCustomerTypes });
    if (!row) return res.status(404).json({ success: false, message: 'Customer not found or outside your Customer Access scope' });
    return res.json({ success: true, data: row });
  } catch (e) { return fail(res, e, 'customerOverview.get'); }
};

exports.orders = async (req, res) => {
  try {
    const row = await svc.getOverview(req.params.customerId, { allowedTypes: req.allowedCustomerTypes });
    if (!row) return res.status(404).json({ success: false, message: 'Customer not found or outside your Customer Access scope' });
    return res.json({ success: true, data: await svc.listOrders(req.params.customerId) });
  } catch (e) { return fail(res, e, 'customerOverview.orders'); }
};

exports.closureCheck = async (req, res) => {
  try {
    const pool = require('../config/db');
    const row = await svc.getOverview(req.params.customerId, { allowedTypes: req.allowedCustomerTypes });
    if (!row) return res.status(404).json({ success: false, message: 'Customer not found or outside your Customer Access scope' });
    return res.json({ success: true, data: await svc.closureCheck(pool, req.params.customerId) });
  } catch (e) { return fail(res, e, 'customerOverview.closureCheck'); }
};

exports.closeAccount = async (req, res) => {
  const pool = require('../config/db');
  // Customer Access scope, as the read endpoints above: an out-of-scope
  // customer is "not found" here too (it used to close regardless).
  try {
    const row = await svc.getOverview(req.params.customerId, { allowedTypes: req.allowedCustomerTypes });
    if (!row) return res.status(404).json({ success: false, message: 'Customer not found or outside your Customer Access scope' });
  } catch (e) { return fail(res, e, 'customerOverview.closeAccount'); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await svc.closeAccount(client, req.params.customerId, {
      note: req.body?.note, refundReference: req.body?.refund_reference, user: req.user,
    });
    await client.query('COMMIT');
    res.json({ success: true, data: out, message: `Account closed — Rs ${out.refundable} of the deposit refunded` });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    const status = e.status || 500;
    if (status >= 500) console.error('customerOverview.closeAccount:', e);
    res.status(status).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};
