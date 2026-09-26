const pool = require('../../config/db');
const { actorFromReq, requireWarehouseRole } = require('../../services/vendorReturnToVendorService');
const svc = require('../../services/vendorReturnTicketService');

function handleError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({ success: false, message: err.message });
}

function ticketNumberFromReq(req) {
  return req.params.ticketNumber || req.params.dcNumber;
}

exports.listEligibleVendors = async (req, res) => {
  try {
    const data = await svc.listEligibleVendors();
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
};

exports.listEligible = async (req, res) => {
  try {
    const result = await svc.listEligibleLaptops({
      vendorId: req.query.vendor_id,
      search: req.query.search,
      page: Number(req.query.page) || 1,
      limit: Math.min(200, Number(req.query.limit) || 50),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
};

exports.listTickets = async (req, res) => {
  try {
    const result = await svc.listTickets({
      status: req.query.status,
      vendorId: req.query.vendor_id,
      page: Number(req.query.page) || 1,
      limit: Math.min(100, Number(req.query.limit) || 25),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
};

exports.getTicket = async (req, res) => {
  try {
    const ticket = await svc.getTicket(ticketNumberFromReq(req));
    if (!ticket) return res.status(404).json({ success: false, message: 'Return ticket not found' });
    res.json({ success: true, ticket });
  } catch (err) {
    handleError(res, err);
  }
};

exports.createTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const body = req.body || {};
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const ticket = await svc.createTicket(client, {
      vendorId: body.vendor_id || body.vendorId,
      serialIds: body.serial_ids || body.serialIds || [],
      returnReason: body.return_reason || body.returnReason,
      reasonCode: body.reason_code || body.reasonCode,
      rentStopDate: body.rent_stop_date || body.rentStopDate,
      pickupDate: body.pickup_date || body.pickupDate,
      pickupTime: body.pickup_time || body.pickupTime,
      remarks: body.remarks,
      ...actor,
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, ticket });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Laptop is already on an open return ticket' });
    }
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.updateTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const body = req.body || {};
    const pick = (a, b) => (body[a] !== undefined ? body[a] : body[b]);
    await client.query('BEGIN');
    const ticket = await svc.updateTicket(client, {
      ticketNumber: ticketNumberFromReq(req),
      reasonCode: pick('reason_code', 'reasonCode'),
      returnReason: pick('return_reason', 'returnReason'),
      rentStopDate: pick('rent_stop_date', 'rentStopDate'),
      pickupDate: pick('pickup_date', 'pickupDate'),
      pickupTime: pick('pickup_time', 'pickupTime'),
      remarks: body.remarks,
      actorUserId: actorFromReq(req).actorUserId,
    });
    await client.query('COMMIT');
    res.json({ success: true, ticket });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.previewRequest = async (req, res) => {
  try {
    const preview = await svc.previewRequest(ticketNumberFromReq(req));
    res.json({ success: true, preview });
  } catch (err) {
    handleError(res, err);
  }
};

exports.downloadRequestPdf = async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const ticketNumber = ticketNumberFromReq(req);
    const rel = await svc.requestPdf(ticketNumber);
    const abs = path.join(__dirname, '../../uploads', rel);
    if (!fs.existsSync(abs)) return res.status(404).json({ success: false, message: 'PDF file missing' });
    const name = `Return_request_${String(ticketNumber).replace(/[^\w-]+/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.download(abs, name);
  } catch (err) {
    handleError(res, err);
  }
};

exports.notifyVendor = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const result = await svc.notifyVendor(client, {
      ticketNumber: ticketNumberFromReq(req),
      ...actor,
    });
    await client.query('COMMIT');
    res.json({
      success: true,
      already_notified: result.already_notified,
      ticket: result.ticket,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    // Now that the row is unlocked, record why the email failed.
    if (err.notifyError && err.ticketNumber) {
      await svc.writeNotifyError(err.ticketNumber, err.notifyError).catch(() => {});
    }
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.createDc = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const body = req.body || {};
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const result = await svc.createDcFromTicket(client, {
      ticketNumber: ticketNumberFromReq(req),
      serialIds: body.serial_ids || body.serialIds || [],
      returnReason: body.return_reason || body.returnReason,
      remarks: body.remarks,
      ...actor,
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, dc_number: result.dc_number, ticket: result.ticket });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.cancelItems = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const body = req.body || {};
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const ticket = await svc.cancelTicketItems(client, {
      ticketNumber: ticketNumberFromReq(req),
      serialIds: body.serial_ids || body.serialIds || [],
      reason: body.reason,
      ...actor,
    });
    await client.query('COMMIT');
    res.json({ success: true, ticket });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.cancelTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const body = req.body || {};
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const ticket = await svc.cancelTicket(client, {
      ticketNumber: ticketNumberFromReq(req),
      reason: body.reason,
      ...actor,
    });
    await client.query('COMMIT');
    res.json({ success: true, ticket });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};
