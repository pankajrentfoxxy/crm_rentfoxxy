'use strict';

const pool = require('../config/db');
const wo = require('../services/supportWorkOrderService');
const { regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');
const { may } = require('../middleware/supportWoAccess');
const { notifyTechnicianVisit } = require('../services/supportNotificationService');

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportV2 wo:', e);
  const body = { success: false, message: e.message };
  if (e.missing) body.missing = e.missing;
  if (e.code) body.code = e.code;
  return res.status(status).json(body);
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

exports.create = async (req, res) => {
  try {
    const row = await tx((c) => wo.createWorkOrder(c, Number(req.params.id), req.body || {}, req.user.user_id));
    res.status(201).json({ success: true, wo: row, wo_id: row.wo_id });
  } catch (e) { bad(res, e); }
};

exports.getOne = async (req, res) => {
  try {
    const id = Number(req.params.woId);
    const row = await wo.loadWo(pool, id);
    const [steps, assets, actions] = await Promise.all([
      pool.query(
        `SELECT * FROM support_work_order_steps WHERE wo_id = $1 ORDER BY sort_order`,
        [id]
      ),
      pool.query(
        `SELECT a.*, l.wo_asset_id
           FROM support_work_order_assets l
           JOIN support_ticket_assets a ON a.line_id = l.line_id
          WHERE l.wo_id = $1`,
        [id]
      ),
      pool.query(
        `SELECT a.*, c.name, c.group_name
           FROM support_work_order_actions a
           JOIN support_action_codes c ON c.action_id = a.action_code_id
          WHERE a.wo_id = $1`,
        [id]
      ),
    ]);
    const partReq = await pool.query(
      `SELECT request_id, status_v2, request_number, collect_old_part
         FROM part_requests WHERE work_order_id = $1 OR return_wo_id = $1
         ORDER BY request_id DESC LIMIT 1`,
      [id]
    ).catch(() => ({ rows: [] }));
    const skips = await wo.typeSkipsTravel(pool, row.wo_type);
    const conditions = row.wo_type === 'RETURN_PICKUP'
      ? (await pool.query(
        `SELECT * FROM support_asset_condition WHERE wo_id = $1 ORDER BY serial_id`,
        [id]
      ).catch(() => ({ rows: [] }))).rows
      : [];
    res.json({
      success: true,
      wo: { ...row, skips_travel: skips },
      steps: steps.rows,
      assets: assets.rows,
      actions: actions.rows,
      conditions,
      part_request: partReq.rows[0] || null,
    });
  } catch (e) { bad(res, e); }
};

exports.patch = async (req, res) => {
  try {
    const id = Number(req.params.woId);
    const b = req.body || {};
    await pool.query(
      `UPDATE support_work_orders SET
         scheduled_start = COALESCE($2, scheduled_start),
         scheduled_end = COALESCE($3, scheduled_end),
         method = COALESCE($4, method),
         notes = COALESCE($5, notes),
         updated_at = NOW()
       WHERE wo_id = $1`,
      [id, b.scheduled_start || null, b.scheduled_end || null, b.method || null, b.notes || null]
    );
    res.json({ success: true, wo: await wo.loadWo(pool, id) });
  } catch (e) { bad(res, e); }
};

exports.assign = async (req, res) => {
  try {
    const row = await tx((c) => wo.assignWorkOrder(c, Number(req.params.woId), {
      userId: req.body.user_id || null,
      groupId: req.body.group_id || null,
      slot_start: req.body.slot_start || null,
      slot_end: req.body.slot_end || null,
    }, req.user.user_id));
    if (row && row.assigned_to) {
      notifyTechnicianVisit(pool, row, 'TECHNICIAN_ASSIGNED').catch((e) => console.error('tech assigned notify:', e));
    }
    res.json({ success: true, wo: row });
  } catch (e) { bad(res, e); }
};

exports.accept = async (req, res) => {
  try {
    const row = await tx((c) => wo.advance(c, Number(req.params.woId), 'ACCEPTED', req.user.user_id));
    res.json({ success: true, wo: row, wo_id: row.wo_id });
  } catch (e) { bad(res, e); }
};

exports.enRoute = async (req, res) => {
  try {
    const row = await tx((c) => wo.advance(c, Number(req.params.woId), 'EN_ROUTE', req.user.user_id));
    notifyTechnicianVisit(pool, row, 'TECHNICIAN_EN_ROUTE').catch((e) => console.error('en-route notify:', e));
    res.json({ success: true, wo: row, wo_id: row.wo_id });
  } catch (e) { bad(res, e); }
};

exports.onSite = async (req, res) => {
  try {
    const row = await tx((c) => wo.advance(c, Number(req.params.woId), 'ON_SITE', req.user.user_id));
    res.json({ success: true, wo: row, wo_id: row.wo_id });
  } catch (e) { bad(res, e); }
};

exports.start = async (req, res) => {
  try {
    const row = await tx((c) => wo.advance(c, Number(req.params.woId), 'IN_PROGRESS', req.user.user_id));
    res.json({ success: true, wo: row, wo_id: row.wo_id });
  } catch (e) { bad(res, e); }
};

exports.completeStep = async (req, res) => {
  try {
    const result = await tx((c) => wo.completeStep(c, {
      woId: Number(req.params.woId),
      stepCode: req.params.code,
      payload: req.body || {},
      userId: req.user.user_id,
    }));
    res.json({ success: true, ...result, wo_id: Number(req.params.woId) });
  } catch (e) { bad(res, e); }
};

exports.verifyOtp = async (req, res) => {
  try {
    const result = await tx((c) => wo.verifyOtp(c, Number(req.params.woId), req.body.otp, req.user.user_id));
    res.json({ success: true, ...result, wo_id: Number(req.params.woId) });
  } catch (e) { bad(res, e); }
};

exports.complete = async (req, res) => {
  try {
    if (req.body && req.body.collect_override) {
      const ok = await may(req, 'support_replacement', 'edit');
      if (!ok) {
        return res.status(403).json({ success: false, message: 'Only a lead can override collect-before-delivery' });
      }
    }
    const row = await tx((c) => wo.completeWorkOrder(c, Number(req.params.woId), req.body || {}, req.user.user_id));
    res.json({ success: true, wo: row, wo_id: row.wo_id });
  } catch (e) { bad(res, e); }
};

exports.fail = async (req, res) => {
  try {
    const result = await tx((c) => wo.failWorkOrder(c, Number(req.params.woId), req.body || {}, req.user.user_id));
    res.json({ success: true, ...result, wo_id: Number(req.params.woId) });
  } catch (e) { bad(res, e); }
};

exports.cancel = async (req, res) => {
  try {
    const row = await tx((c) => wo.cancelWorkOrder(c, Number(req.params.woId), req.user.user_id, req.body.reason));
    res.json({ success: true, wo: row });
  } catch (e) { bad(res, e); }
};

exports.document = async (req, res) => {
  try {
    const row = await wo.loadWo(pool, Number(req.params.woId));
    if (!row.document_number) {
      return res.status(404).json({ success: false, message: 'No document on this work order' });
    }
    if (row.wo_type === 'SERVICE_RETURN') {
      return res.json({ success: true, document_number: row.document_number, kind: 'SDC' });
    }
    try {
      await regenerateReturnDcPdfByRdc(pool, row.document_number);
    } catch (e) {
      console.error('wo document pdf:', e);
    }
    res.json({ success: true, document_number: row.document_number, kind: 'RDC' });
  } catch (e) { bad(res, e); }
};
