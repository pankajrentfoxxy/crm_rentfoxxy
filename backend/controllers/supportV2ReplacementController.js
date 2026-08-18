'use strict';

const pool = require('../config/db');
const svc = require('../services/supportReplacementService');

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportV2 replacement:', e);
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

exports.context = async (req, res) => {
  try {
    const row = await svc.replacementContext(pool, Number(req.params.lineId));
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.candidates = async (req, res) => {
  try {
    const lineId = Number(req.query.line_id);
    if (!lineId) return res.status(400).json({ success: false, message: 'line_id required' });
    const row = await svc.listCandidates(pool, lineId);
    res.json({ success: true, candidates: row.candidates, old_asset: row.old_asset });
  } catch (e) { bad(res, e); }
};

exports.create = async (req, res) => {
  try {
    const row = await tx((c) => svc.createReplacement(c, Number(req.params.lineId), req.body || {}, req.user.user_id));
    res.status(201).json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.patch = async (req, res) => {
  try {
    const row = await tx((c) => svc.patchReplacement(c, Number(req.params.id), req.body || {}, req.user.user_id));
    res.json({ success: true, replacement: row });
  } catch (e) { bad(res, e); }
};

exports.waiveCollect = async (req, res) => {
  try {
    const row = await tx((c) => svc.waiveCollect(c, Number(req.params.id), (req.body || {}).reason, req.user.user_id));
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.cancel = async (req, res) => {
  try {
    const row = await tx((c) => svc.cancelReplacement(c, Number(req.params.id), req.user.user_id));
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};
