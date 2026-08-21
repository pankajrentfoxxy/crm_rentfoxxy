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
    res.status(201).json({ success: true, wo: wo.serializeWorkOrder(row), wo_id: row.wo_id });
  } catch (e) { bad(res, e); }
};

exports.getOne = async (req, res) => {
  try {
    const id = Number(req.params.woId);
    const { assertOwnWorkOrder } = require('../services/supportTicketScope');
    await assertOwnWorkOrder(pool, req.user, id);
    const row = await wo.loadWo(pool, id);
    const ticket = (await pool.query(
      `SELECT t.ticket_number, t.priority, t.sla_resolution_due_at, t.internal_note,
              t.site_label, t.site_pincode, t.contact_name, t.contact_phone, t.customer_id,
              COALESCE(c.company_name, c.name) AS customer_name
         FROM support_tickets_v2 t
         LEFT JOIN customers c ON c.customer_id = t.customer_id
        WHERE t.ticket_id = $1`,
      [row.ticket_id]
    )).rows[0] || {};
    const [steps, assets, actions] = await Promise.all([
      pool.query(
        `SELECT s.*, cfg.help_text, cfg.per_asset, cfg.offline_safe, cfg.method_scope
           FROM support_work_order_steps s
           LEFT JOIN support_work_order_type_config cfg
             ON cfg.wo_type = $2 AND cfg.step_code = s.step_code
          WHERE s.wo_id = $1
          ORDER BY s.sort_order, s.asset_seq`,
        [id, row.wo_type]
      ),
      pool.query(
        `SELECT a.*, l.wo_asset_id,
                rt.name AS reported_type_name, rs.name AS reported_subtype_name,
                ri.name AS reported_issue_name,
                COALESCE(vsn.extra->>'brand','') AS brand,
                COALESCE(vsn.extra->>'model', vsn.extra->>'model_name','') AS model,
                COALESCE(vsn.extra->>'assigned_employee','') AS assigned_employee
           FROM support_work_order_assets l
           JOIN support_ticket_assets a ON a.line_id = l.line_id
           LEFT JOIN support_issue_catalog rt ON rt.catalog_id = a.reported_type_id
           LEFT JOIN support_issue_catalog rs ON rs.catalog_id = a.reported_subtype_id
           LEFT JOIN support_issue_catalog ri ON ri.catalog_id = a.reported_issue_id
           LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = a.serial_id
          WHERE l.wo_id = $1 ORDER BY a.line_code`,
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
    const partReqs = await pool.query(
      `SELECT request_id, status_v2, request_number, collect_old_part, part_id
         FROM part_requests WHERE work_order_id = $1 OR return_wo_id = $1
         ORDER BY request_id DESC`,
      [id]
    ).catch(() => ({ rows: [] }));
    const attachments = await pool.query(
      `SELECT attachment_id, line_id, kind, file_path
         FROM support_attachments
        WHERE ticket_id = $1 AND kind = 'PHOTO_CUSTOMER'`,
      [row.ticket_id]
    ).catch(() => ({ rows: [] }));
    const serialIds = assets.rows.map((a) => a.serial_id).filter(Boolean);
    let history = [];
    if (serialIds.length) {
      history = (await pool.query(
        `SELECT w.wo_number, w.wo_type, w.completed_at, w.outcome
           FROM support_work_orders w
           JOIN support_work_order_assets l ON l.wo_id = w.wo_id
           JOIN support_ticket_assets a ON a.line_id = l.line_id
          WHERE a.serial_id = ANY($1) AND w.status = 'COMPLETED' AND w.wo_id <> $2
          ORDER BY w.completed_at DESC NULLS LAST LIMIT 3`,
        [serialIds, id]
      )).rows;
    }
    const skips = await wo.typeSkipsTravel(pool, row.wo_type);
    const conditions = (await pool.query(
      `SELECT * FROM support_asset_condition WHERE wo_id = $1 ORDER BY serial_id`,
      [id]
    ).catch(() => ({ rows: [] }))).rows;
    res.json({
      success: true,
      wo: wo.serializeWorkOrder({ ...row, ...ticket, skips_travel: skips }),
      ticket,
      steps: steps.rows,
      assets: assets.rows,
      actions: actions.rows,
      conditions,
      attachments: attachments.rows,
      history,
      part_requests: partReqs.rows,
      part_request: partReqs.rows[0] || null,
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
    res.json({ success: true, wo: wo.serializeWorkOrder(row) });
  } catch (e) { bad(res, e); }
};

exports.accept = async (req, res) => {
  try {
    const row = await tx((c) => wo.advance(c, Number(req.params.woId), 'ACCEPTED', req.user.user_id));
    res.json({ success: true, wo: wo.serializeWorkOrder(row), wo_id: row.wo_id });
  } catch (e) { bad(res, e); }
};

exports.enRoute = async (req, res) => {
  try {
    const row = await tx((c) => wo.advance(c, Number(req.params.woId), 'EN_ROUTE', req.user.user_id));
    notifyTechnicianVisit(pool, row, 'TECHNICIAN_EN_ROUTE').catch((e) => console.error('en-route notify:', e));
    res.json({ success: true, wo: wo.serializeWorkOrder(row), wo_id: row.wo_id });
  } catch (e) { bad(res, e); }
};

exports.onSite = async (req, res) => {
  try {
    const row = await tx(async (c) => {
      const advanced = await wo.advance(c, Number(req.params.woId), 'ON_SITE', req.user.user_id);
      if (String(advanced.method || 'TECHNICIAN').toUpperCase() === 'TECHNICIAN') {
        const otp = require('../services/supportOtpService');
        await otp.sendOtp(c, advanced.wo_id, req.user.user_id, {}).catch((e) => console.error('otp on-site:', e));
      }
      return advanced;
    });
    res.json({ success: true, wo: wo.serializeWorkOrder(row), wo_id: row.wo_id });
  } catch (e) { bad(res, e); }
};

exports.start = async (req, res) => {
  try {
    const row = await tx((c) => wo.advance(c, Number(req.params.woId), 'IN_PROGRESS', req.user.user_id));
    res.json({ success: true, wo: wo.serializeWorkOrder(row), wo_id: row.wo_id });
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
    if (result.wo) result.wo = wo.serializeWorkOrder(result.wo);
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
    res.json({ success: true, wo: wo.serializeWorkOrder(row), wo_id: row.wo_id });
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
    res.json({ success: true, wo: wo.serializeWorkOrder(row) });
  } catch (e) { bad(res, e); }
};

exports.sendOtp = async (req, res) => {
  try {
    const otp = require('../services/supportOtpService');
    const out = await tx((c) => otp.sendOtp(c, Number(req.params.woId), req.user.user_id, req.body || {}));
    res.json({ success: true, ...out });
  } catch (e) { bad(res, e); }
};

exports.resendOtp = async (req, res) => {
  try {
    const otp = require('../services/supportOtpService');
    const out = await tx((c) => otp.sendOtp(c, Number(req.params.woId), req.user.user_id, { ...(req.body || {}), resend: true }));
    res.json({ success: true, ...out });
  } catch (e) { bad(res, e); }
};

exports.revealOtp = async (req, res) => {
  try {
    const otp = require('../services/supportOtpService');
    const out = await tx((c) => otp.revealOtp(c, Number(req.params.woId), req.user.user_id, req.body && req.body.reason));
    res.json({ success: true, ...out });
  } catch (e) { bad(res, e); }
};

exports.bypassOtp = async (req, res) => {
  try {
    const otp = require('../services/supportOtpService');
    const out = await tx((c) => otp.requestBypass(c, Number(req.params.woId), req.user.user_id, req.body && req.body.reason));
    res.json({ success: true, ...out });
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
