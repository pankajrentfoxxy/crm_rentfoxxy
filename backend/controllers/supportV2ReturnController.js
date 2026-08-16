'use strict';

const pool = require('../config/db');
const svc = require('../services/supportReturnPickupService');
const { GRADE_DEFS, loadCatalogs, computeLockIn, groupSerialsBySiteAndCapacity } = require('../services/supportReturnGuards');

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportV2 return:', e);
  return res.status(status).json({ success: false, message: e.message });
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

exports.saveCondition = async (req, res) => {
  try {
    const row = await tx((c) => svc.saveCondition(c, Number(req.params.woId), req.body || {}, req.user.user_id));
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.warehouseReceipt = async (req, res) => {
  try {
    const row = await tx((c) => svc.warehouseReceipt(c, Number(req.params.woId), req.body || {}, req.user.user_id));
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.createBulk = async (req, res) => {
  try {
    const row = await svc.createBulkReturn(pool, req.body || {}, req.user.user_id);
    res.status(201).json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.getBulk = async (req, res) => {
  try {
    const row = await svc.getBulkGroup(pool, req.params.groupId);
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.listApprovals = async (req, res) => {
  try {
    const status = String(req.query.status || '').toUpperCase();
    const type = String(req.query.type || '').toUpperCase();
    const mine = String(req.query.mine || '') === 'true';
    const tab = String(req.query.tab || 'pending').toLowerCase();
    const params = [];
    const where = [];
    if (tab === 'pending' && !status) where.push(`a.status = 'PENDING'`);
    if (tab === 'mine' || mine) {
      params.push(req.user.user_id);
      where.push(`a.decided_by = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`a.status = $${params.length}`);
    }
    if (type) {
      params.push(type);
      where.push(`a.approval_type = $${params.length}`);
    }
    const r = await pool.query(
      `SELECT a.*, t.ticket_number, t.priority, t.status AS ticket_status,
              COALESCE(c.company_name, c.name) AS customer_name,
              req.name AS requester_name,
              dec.name AS decided_by_name
         FROM support_approvals a
         LEFT JOIN support_tickets_v2 t ON t.ticket_id = a.ticket_id
         LEFT JOIN customers c ON c.customer_id = t.customer_id
         LEFT JOIN users req ON req.user_id = a.requested_by
         LEFT JOIN users dec ON dec.user_id = a.decided_by
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY
          CASE WHEN a.status = 'PENDING' THEN 0 ELSE 1 END,
          t.priority ASC NULLS LAST,
          a.created_at ASC`,
      params
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};

exports.decideApproval = async (req, res) => {
  try {
    const row = await tx((c) => svc.decideApproval(c, Number(req.params.id), req.body || {}, req.user.user_id));
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.catalog = async (_req, res) => {
  try {
    const catalogs = await loadCatalogs(pool);
    res.json({
      success: true,
      accessories: Object.values(catalogs.accessories),
      damage: Object.values(catalogs.damage),
      grades: GRADE_DEFS,
    });
  } catch (e) { bad(res, e); }
};

exports.preview = async (req, res) => {
  try {
    const customerId = Number(req.query.customer_id || req.body.customer_id);
    const serialIds = (req.body.serial_ids || String(req.query.serial_ids || '').split(','))
      .map(Number).filter(Boolean);
    const capacity = Number(req.body.vehicle_capacity || req.query.vehicle_capacity) || 25;
    const siteId = req.body.site_id || req.query.site_id || null;
    const items = serialIds.map((id) => ({ serial_id: id, site_id: siteId }));
    const groups = groupSerialsBySiteAndCapacity(items, capacity);
    const locks = [];
    for (const id of serialIds) {
      locks.push({ serial_id: id, ...(await computeLockIn(pool, id)) });
    }
    const locked = locks.filter((x) => x.locked);
    res.json({
      success: true,
      asset_count: serialIds.length,
      vehicle_capacity: capacity,
      group_count: groups.length,
      groups,
      lock_in: locked,
      early_termination_total: locked.reduce((s, x) => s + Number(x.charge || 0), 0),
    });
  } catch (e) { bad(res, e); }
};
