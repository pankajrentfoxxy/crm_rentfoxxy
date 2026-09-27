/**
 * Early return before lock-in ends — Support raises, Sales proposes, Accounts
 * decide (services/lockInBreakService.js).
 */
const pool = require('../config/db');
const svc = require('../services/lockInBreakService');

function sendError(res, e, where) {
  const status = e.status || e.statusCode || 500;
  if (status >= 500) console.error(`${where}:`, e);
  res.status(status).json({ success: false, message: e.message || 'Request failed', code: e.code });
}

async function inTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

exports.list = async (req, res) => {
  try {
    const rows = await svc.list({ status: req.query.status || null, customerId: req.query.customer_id || null });
    res.json({ success: true, data: rows });
  } catch (e) { sendError(res, e, 'earlyReturns.list'); }
};

exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    const row = await inTx((c) => svc.createRequest(c, {
      serialId: Number(b.serial_id),
      ticketId: b.ticket_id ? Number(b.ticket_id) : null,
      supportRequestId: b.support_request_id ? Number(b.support_request_id) : null,
      plannedReturnDate: b.planned_return_date || null,
      reason: b.reason,
      user: req.user,
    }));
    res.status(201).json({ success: true, data: row, message: `Early-return request raised for ${row.asset_code} — waiting for Sales` });
  } catch (e) { sendError(res, e, 'earlyReturns.create'); }
};

exports.propose = async (req, res) => {
  try {
    const b = req.body || {};
    const row = await inTx((c) => svc.propose(c, Number(req.params.id), {
      proposal: b.proposal, amount: b.amount, note: b.note, user: req.user,
    }));
    res.json({ success: true, data: row, message: 'Sent to Accounts for approval' });
  } catch (e) { sendError(res, e, 'earlyReturns.propose'); }
};

exports.decide = async (req, res) => {
  try {
    const b = req.body || {};
    const row = await inTx((c) => svc.decide(c, Number(req.params.id), {
      approve: b.approve === true || b.approve === 'true', note: b.note, user: req.user,
    }));
    res.json({
      success: true,
      data: row,
      message: row.status === 'approved'
        ? (Number(row.approved_amount) > 0
          ? `Approved — Rs ${row.approved_amount} goes on the next invoice. Support can now create the return pickup.`
          : 'Approved with no charge. Support can now create the return pickup.')
        : 'Rejected',
    });
  } catch (e) { sendError(res, e, 'earlyReturns.decide'); }
};

exports.cancel = async (req, res) => {
  try {
    const row = await inTx((c) => svc.cancel(c, Number(req.params.id), { note: req.body?.note, user: req.user }));
    res.json({ success: true, data: row, message: 'Early-return request withdrawn' });
  } catch (e) { sendError(res, e, 'earlyReturns.cancel'); }
};
