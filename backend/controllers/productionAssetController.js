const pool = require('../config/db');
const productionAssetService = require('../services/productionAssetService');

function parseId(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

exports.getByTicket = async (req, res) => {
  try {
    const ticketId = parseId(req.params.ticketId);
    if (!ticketId) return res.status(400).json({ success: false, message: 'Invalid ticket id' });
    const ticketRes = await pool.query(`SELECT * FROM tickets WHERE ticket_id = $1`, [ticketId]);
    if (!ticketRes.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });
    const result = await productionAssetService.getConfigForTicket(pool, ticketRes.rows[0]);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('getByTicket production asset:', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load production asset' });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const row = await productionAssetService.getById(pool, id);
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, production_asset: productionAssetService.rowToDisplayConfig(row) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Failed to load' });
  }
};

exports.updateConfig = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const { change_type, notes, stage_name, ...patch } = req.body || {};
    const result = await productionAssetService.updateConfig(
      pool,
      id,
      patch,
      req.user?.user_id,
      stage_name || null
    );
    res.json({
      success: true,
      production_asset: productionAssetService.rowToDisplayConfig(result.production_asset),
      changes: result.changes,
      change_type: change_type || null,
      notes: notes || null,
    });
  } catch (e) {
    const status = e.message === 'Production asset not found' ? 404 : 500;
    res.status(status).json({ success: false, message: e.message || 'Update failed' });
  }
};

exports.saveQc1Checklist = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const row = await productionAssetService.saveQc1Checklist(
      pool,
      id,
      req.body || {},
      req.user?.user_id
    );
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, production_asset: productionAssetService.rowToDisplayConfig(row) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Failed to save checklist' });
  }
};

exports.verifyQc2 = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const { actual, matched_flags, remarks } = req.body || {};
    const result = await productionAssetService.verifyQc2Specs(pool, id, {
      actual,
      matchedFlags: matched_flags,
      remarks,
      userId: req.user?.user_id,
    });
    res.json({
      success: true,
      ok: result.ok,
      verification: result.verification,
      production_asset: productionAssetService.rowToDisplayConfig(result.production_asset),
    });
  } catch (e) {
    const status = e.message === 'Production asset not found' ? 404 : 500;
    res.status(status).json({ success: false, message: e.message || 'Verify failed' });
  }
};

exports.listPending = async (req, res) => {
  try {
    const rows = await productionAssetService.listPendingInventory(pool);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('listPending inventory:', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to list' });
  }
};

exports.receive = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = parseId(req.params.id);
    const serial = req.body?.serial_number;
    const row = await productionAssetService.receiveIntoInventory(client, id, {
      serialNumber: serial,
      actorUserId: req.user?.user_id,
      actorName: req.user?.name,
    });
    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Received into inventory',
      production_asset: productionAssetService.rowToDisplayConfig(row),
    });
  } catch (e) {
    await client.query('ROLLBACK');
    const status = e.status || 500;
    res.status(status).json({ success: false, message: e.message || 'Receive failed' });
  } finally {
    client.release();
  }
};

exports.backfill = async (req, res) => {
  try {
    const result = await productionAssetService.backfillOpenTickets(pool, {
      limit: parseInt(req.body?.limit, 10) || 500,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Backfill failed' });
  }
};
