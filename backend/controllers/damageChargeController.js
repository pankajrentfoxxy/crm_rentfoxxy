/** Damage charges (services/damageChargeService.js). */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const svc = require('../services/damageChargeService');

function sendError(res, e, where) {
  const status = e.status || e.statusCode || 500;
  if (status >= 500) console.error(`${where}:`, e);
  res.status(status).json({ success: false, message: e.message || 'Request failed' });
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
const wrap = (where, fn) => async (req, res) => { try { await fn(req, res); } catch (e) { sendError(res, e, where); } };

exports.catalog = wrap('damage.catalog', async (req, res) => res.json({ success: true, data: await svc.listCatalog() }));

exports.uploadPhotos = wrap('damage.uploadPhotos', async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ success: false, message: 'Choose a photo' });
  const root = path.join(__dirname, '..');
  return res.json({ success: true, data: files.map((f) => path.relative(root, f.path)) });
});

exports.photo = wrap('damage.photo', async (req, res) => {
  const full = svc.assertOwnPhoto(req.query.path);
  res.sendFile(full);
});

exports.list = wrap('damage.list', async (req, res) => {
  const q = req.query || {};
  res.json({ success: true, data: await svc.list({ status: q.status || null, customerId: q.customer_id, ticketId: q.ticket_id, returnDcNumber: q.return_dc_number }) });
});

exports.get = wrap('damage.get', async (req, res) => {
  const c = await svc.get(Number(req.params.id));
  if (!c) return res.status(404).json({ success: false, message: 'Damage case not found' });
  return res.json({ success: true, data: c });
});

exports.create = wrap('damage.create', async (req, res) => {
  const b = req.body || {};
  const c = await inTx((client) => svc.createCase(client, {
    source: b.source, serialId: b.serial_id, assetCode: b.asset_code, customerId: b.customer_id, ticketId: b.ticket_id,
    ticketItemId: b.ticket_item_id, returnDcNumber: b.return_dc_number, notes: b.notes, lines: b.lines, user: req.user,
  }));
  res.status(201).json({ success: true, data: c, message: `Damage recorded on ${c.asset_code} — the warehouse will price it` });
});

exports.price = wrap('damage.price', async (req, res) => {
  const c = await inTx((client) => svc.price(client, Number(req.params.id), { lines: req.body?.lines, user: req.user }));
  res.json({ success: true, data: c, message: 'Priced — Sales / Accounts will take it to the customer' });
});

exports.propose = wrap('damage.propose', async (req, res) => {
  const b = req.body || {};
  const c = await inTx((client) => svc.propose(client, Number(req.params.id), {
    note: b.note, emailTo: b.email_to, sendEmail: b.send_email !== false, user: req.user,
  }));
  res.json({
    success: true,
    data: c,
    message: c.email_sent_at && !c.email_error ? `Emailed to ${c.email_to} — waiting for Accounts to approve` : `Proposed — email not sent (${c.email_error || 'not requested'}). Waiting for Accounts.`,
  });
});

exports.decide = wrap('damage.decide', async (req, res) => {
  const b = req.body || {};
  const c = await inTx((client) => svc.decide(client, Number(req.params.id), { decision: b.decision, amount: b.amount, note: b.note, user: req.user }));
  res.json({ success: true, data: c, message: c.status === 'approved' ? `Approved — Rs ${c.approved_amount} goes on the next invoice` : `Case ${c.status}` });
});

exports.cancel = wrap('damage.cancel', async (req, res) => {
  const c = await inTx((client) => svc.cancel(client, Number(req.params.id), { note: req.body?.note, user: req.user }));
  res.json({ success: true, data: c, message: 'Damage case cancelled' });
});
