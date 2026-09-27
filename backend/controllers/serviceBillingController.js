/**
 * Out-of-warranty service on sold (gorefurbo) laptops: ticket charges, Accounts
 * approval, service orders (SVO) and their Zoho invoice
 * (services/supportServiceBillingService.js).
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const svc = require('../services/supportServiceBillingService');

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

exports.listTicketCharges = async (req, res) => {
  try {
    res.json({ success: true, data: await svc.listTicketCharges(Number(req.params.ticketId)) });
  } catch (e) { sendError(res, e, 'serviceBilling.listTicketCharges'); }
};

exports.addTicketCharge = async (req, res) => {
  try {
    const b = req.body || {};
    const row = await inTx((c) => svc.addServiceCharge(c, {
      ticketId: Number(req.params.ticketId),
      ticketItemId: b.ticket_item_id ? Number(b.ticket_item_id) : null,
      description: b.description,
      amount: b.amount,
      quantity: b.quantity,
      user: req.user,
    }));
    res.status(201).json({ success: true, data: row, message: 'Service charge added — Accounts will approve and bill it' });
  } catch (e) { sendError(res, e, 'serviceBilling.addTicketCharge'); }
};

exports.removeTicketCharge = async (req, res) => {
  try {
    await inTx((c) => svc.removeServiceCharge(c, Number(req.params.id)));
    res.json({ success: true, message: 'Service charge removed' });
  } catch (e) { sendError(res, e, 'serviceBilling.removeTicketCharge'); }
};

exports.listCharges = async (req, res) => {
  try {
    res.json({ success: true, data: await svc.listCharges({ status: req.query.status || null, customerId: req.query.customer_id || null }) });
  } catch (e) { sendError(res, e, 'serviceBilling.listCharges'); }
};

exports.decideCharge = async (req, res) => {
  try {
    const b = req.body || {};
    const row = await inTx((c) => svc.decideCharge(c, Number(req.params.id), {
      approve: b.approve === true || b.approve === 'true', note: b.note, user: req.user,
    }));
    res.json({ success: true, data: row, message: row.status === 'approved' ? 'Charge approved' : 'Charge rejected' });
  } catch (e) { sendError(res, e, 'serviceBilling.decideCharge'); }
};

exports.raiseOrder = async (req, res) => {
  try {
    const b = req.body || {};
    const so = await inTx((c) => svc.raiseServiceOrder(c, {
      customerId: Number(b.customer_id), chargeIds: b.charge_ids, user: req.user,
    }));
    res.status(201).json({ success: true, data: so, message: `Service order ${so.order_number} raised — attach the Zoho invoice when it is made` });
  } catch (e) { sendError(res, e, 'serviceBilling.raiseOrder'); }
};

exports.listOrders = async (req, res) => {
  try {
    res.json({ success: true, data: await svc.listServiceOrders({ status: req.query.status || null }) });
  } catch (e) { sendError(res, e, 'serviceBilling.listOrders'); }
};

exports.attachInvoice = async (req, res) => {
  try {
    const file = req.file || null;
    const pdfPath = file ? path.relative(path.join(__dirname, '..'), file.path) : null;
    const so = await inTx((c) => svc.attachInvoice(c, Number(req.params.id), {
      invoiceNumber: req.body?.invoice_number, pdfPath, user: req.user,
    }));
    res.json({ success: true, data: so, message: `Invoice ${so.invoice_number} attached to ${so.order_number}` });
  } catch (e) { sendError(res, e, 'serviceBilling.attachInvoice'); }
};

exports.downloadInvoice = async (req, res) => {
  try {
    const so = (await pool.query('SELECT invoice_pdf_path, order_number FROM support_service_orders WHERE id = $1', [Number(req.params.id)])).rows[0];
    if (!so?.invoice_pdf_path) return res.status(404).json({ success: false, message: 'No invoice file attached' });
    const root = path.join(__dirname, '..', 'private-uploads');
    const full = path.resolve(path.join(__dirname, '..'), so.invoice_pdf_path);
    if (!full.startsWith(root) || !fs.existsSync(full)) return res.status(404).json({ success: false, message: 'Invoice file missing' });
    res.download(full, `${String(so.order_number).replace(/[^\w-]+/g, '_')}${path.extname(full)}`);
  } catch (e) { sendError(res, e, 'serviceBilling.downloadInvoice'); }
};

exports.cancelOrder = async (req, res) => {
  try {
    const so = await inTx((c) => svc.cancelServiceOrder(c, Number(req.params.id)));
    res.json({ success: true, data: so, message: `${so.order_number} cancelled — its charges are back to approved` });
  } catch (e) { sendError(res, e, 'serviceBilling.cancelOrder'); }
};
