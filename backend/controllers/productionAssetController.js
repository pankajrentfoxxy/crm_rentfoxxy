const pool = require('../config/db');
const productionAssetService = require('../services/productionAssetService');
const warehouseLocationService = require('../services/warehouseLocationService');

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
      production_asset: productionAssetService.rowToDisplayConfig(result.production_asset),
      verification: result.verification,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'QC2 verify failed' });
  }
};

exports.listPending = async (req, res) => {
  try {
    const rows = await productionAssetService.listPendingInventory(pool, req.query);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (e) {
    console.error('listPending inventory:', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to list' });
  }
};

exports.getCarretAvailability = async (req, res) => {
  try {
    const carret = req.query.carret != null ? parseInt(req.query.carret, 10) : null;
    if (carret != null && !warehouseLocationService.isValidCarret(carret)) {
      return res.status(400).json({ success: false, message: 'Invalid carret number' });
    }
    const data = await warehouseLocationService.getCarretOccupancy(pool, carret);
    const payload = carret != null
      ? {
          ...data,
          next_available_slot: warehouseLocationService.findNextAvailableSlot(data),
        }
      : data;
    res.json({ success: true, data: payload });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Failed to load carret availability' });
  }
};

exports.receive = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = parseId(req.params.id);
    const serial = req.body?.serial_number;
    const warehouseCarret = req.body?.warehouse_carret ?? req.body?.carret;
    const warehouseCarretSlot = req.body?.warehouse_carret_slot ?? req.body?.carret_slot ?? req.body?.slot;

    if (warehouseCarret == null || warehouseCarretSlot == null) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Warehouse carret and slot are required',
      });
    }

    const row = await productionAssetService.receiveIntoInventory(client, id, {
      serialNumber: serial,
      warehouseCarret,
      warehouseCarretSlot,
      actorUserId: req.user?.user_id,
      actorName: req.user?.name,
    });
    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Received into inventory',
      production_asset: productionAssetService.rowToDisplayConfig(row),
      warehouse_location: row.warehouse_location || null,
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
