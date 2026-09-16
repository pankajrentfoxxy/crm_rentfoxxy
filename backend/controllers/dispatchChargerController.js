const pool = require('../config/db');
const svc = require('../services/dispatchChargerService');

function sendError(res, err, fallback) {
  const status = err.status || 500;
  if (status >= 500) console.error(fallback, err);
  return res.status(status).json({ success: false, message: err.message || fallback });
}

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

exports.getTicketCharger = async (req, res) => {
  try {
    const ticketId = Number(req.params.ticketId);
    const row = await svc.getActiveByTicket(pool, ticketId);
    const ctx = await svc.loadTicketContext(pool, ticketId);
    res.json({
      success: true,
      data: {
        ticket_id: ticketId,
        ttspl_id: ctx.ttspl_id,
        sales_order_number: ctx.sales_order_number,
        stage_name: ctx.stage_name,
        charger: svc.publicRequest(row),
      },
    });
  } catch (e) {
    sendError(res, e, 'Failed to load charger');
  }
};

exports.markAlreadyWithCustomer = async (req, res) => {
  try {
    const row = await withTx((db) =>
      svc.markAlreadyWithCustomer(db, Number(req.params.ticketId), req.user, req.body?.remarks)
    );
    res.json({ success: true, message: 'Marked charger already with customer', data: svc.publicRequest(row) });
  } catch (e) {
    sendError(res, e, 'Failed to save charger status');
  }
};

exports.raiseRequest = async (req, res) => {
  try {
    const row = await withTx((db) =>
      svc.raiseAttachRequest(db, Number(req.params.ticketId), req.user, req.body?.remarks)
    );
    res.json({
      success: true,
      message: 'Charger request sent to warehouse',
      data: svc.publicRequest(row),
    });
  } catch (e) {
    sendError(res, e, 'Failed to raise charger request');
  }
};

exports.cancelRequest = async (req, res) => {
  try {
    const row = await withTx((db) =>
      svc.cancelRequest(db, Number(req.params.requestId), req.user, req.body?.remarks)
    );
    res.json({ success: true, message: 'Charger request cancelled', data: svc.publicRequest(row) });
  } catch (e) {
    sendError(res, e, 'Failed to cancel charger request');
  }
};

exports.warehouseQueue = async (req, res) => {
  try {
    const rows = await svc.listWarehouseQueue(pool, req.query.status || 'pending');
    res.json({ success: true, data: rows });
  } catch (e) {
    sendError(res, e, 'Failed to load charger queue');
  }
};

exports.availableUnits = async (req, res) => {
  try {
    const rows = await svc.listAvailableChargers(pool, req.query.search, {
      role: req.query.role,
      limit: req.query.limit,
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    sendError(res, e, 'Failed to load charger stock');
  }
};

exports.approveHandover = async (req, res) => {
  try {
    const row = await withTx((db) =>
      svc.approveAndHandover(db, Number(req.params.requestId), req.user, req.body || {})
    );
    res.json({
      success: true,
      message: 'Adapter and power cable handed over',
      data: svc.publicRequest(row),
    });
  } catch (e) {
    sendError(res, e, 'Failed to hand over charger');
  }
};

exports.attach = async (req, res) => {
  try {
    const row = await withTx((db) =>
      svc.attachCharger(db, Number(req.params.requestId), req.user, req.body || {})
    );
    res.json({
      success: true,
      message: 'Charger and power cable attached',
      data: svc.publicRequest(row),
    });
  } catch (e) {
    sendError(res, e, 'Failed to attach charger');
  }
};

exports.qcScan = async (req, res) => {
  try {
    const row = await withTx((db) =>
      svc.recordQcScan(db, Number(req.params.ticketId), req.user, req.body || {})
    );
    res.json({
      success: true,
      message: 'TTSPL, charger, and power cable matched',
      data: svc.publicRequest(row),
    });
  } catch (e) {
    sendError(res, e, 'Charger scan failed');
  }
};

exports.getPickupCharger = async (req, res) => {
  try {
    const data = await svc.getPickupChargerState(pool, Number(req.params.itemId));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, 'Failed to load pickup charger');
  }
};

exports.pickupScan = async (req, res) => {
  try {
    const data = await withTx((db) =>
      svc.recordReturnScan(db, Number(req.params.itemId), req.user, req.body || {})
    );
    res.json({ success: true, message: 'Laptop, charger, and power cable matched', data });
  } catch (e) {
    sendError(res, e, 'Return charger scan failed');
  }
};

exports.getReturnDcChargers = async (req, res) => {
  try {
    const data = await svc.getReturnDcChargerState(pool, req.params.rdcNumber);
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, 'Failed to load return charger');
  }
};

exports.returnDcScan = async (req, res) => {
  try {
    const data = await withTx((db) =>
      svc.recordReturnScanForRdc(db, req.params.rdcNumber, req.user, req.body || {})
    );
    res.json({ success: true, message: 'Laptop, charger, and power cable matched', data });
  } catch (e) {
    sendError(res, e, 'Return charger scan failed');
  }
};
