'use strict';

const pool = require('../config/db');
const svc = require('../services/supportPartsService');

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportV2 parts:', e);
  const body = { success: false, message: e.message };
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

function isLead(user) {
  return ['support_lead', 'support_manager', 'admin', 'super_admin'].includes(user && user.role);
}

exports.compatible = async (req, res) => {
  try {
    const row = await svc.compatibleParts(pool, Number(req.query.serial_id));
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.create = async (req, res) => {
  try {
    const row = await tx((c) => svc.createPartRequest(c, req.body || {}, req.user.user_id));
    res.status(201).json({ success: true, request: row });
  } catch (e) { bad(res, e); }
};

exports.list = async (req, res) => {
  try {
    const rows = await svc.listRequests(pool, { ...req.query, own_only: req.query.all !== '1' }, req.user);
    res.json({ success: true, rows });
  } catch (e) { bad(res, e); }
};

exports.queue = async (req, res) => {
  try {
    const rows = await svc.listQueue(pool, req.query || {});
    res.json({ success: true, rows });
  } catch (e) { bad(res, e); }
};

exports.approve = async (req, res) => {
  try {
    const row = await tx((c) => svc.approveRequest(
      c, Number(req.params.id), req.body || {}, req.user.user_id, { canLead: isLead(req.user) }
    ));
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.reject = async (req, res) => {
  try {
    const row = await tx((c) => svc.rejectRequest(c, Number(req.params.id), (req.body || {}).reason, req.user.user_id));
    res.json({ success: true, request: row });
  } catch (e) { bad(res, e); }
};

exports.escalate = async (req, res) => {
  try {
    const row = await tx((c) => svc.escalateRequest(c, Number(req.params.id), req.user.user_id));
    res.json({ success: true, request: row });
  } catch (e) { bad(res, e); }
};

exports.issue = async (req, res) => {
  try {
    const row = await tx((c) => svc.issueRequest(c, Number(req.params.id), req.body || {}, req.user.user_id));
    res.json({ success: true, request: row });
  } catch (e) { bad(res, e); }
};

exports.consume = async (req, res) => {
  try {
    const row = await tx((c) => svc.consumePart(c, Number(req.params.id), req.body || {}, req.user.user_id));
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.returnUnused = async (req, res) => {
  try {
    const row = await tx((c) => svc.returnUnused(c, Number(req.params.id), req.user.user_id));
    res.json({ success: true, request: row });
  } catch (e) { bad(res, e); }
};

exports.cancel = async (req, res) => {
  try {
    const row = await tx((c) => svc.cancelRequest(c, Number(req.params.id), req.user.user_id));
    res.json({ success: true, request: row });
  } catch (e) { bad(res, e); }
};
