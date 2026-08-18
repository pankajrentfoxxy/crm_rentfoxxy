'use strict';

const pool = require('../config/db');
const engine = require('../services/supportAssignmentEngine');
const wo = require('../services/supportWorkOrderService');

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportV2 dispatch:', e);
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

exports.myBucket = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const data = await engine.loadMyBucket(pool, userId, { tab: req.query.tab, group_by: req.query.group_by });
    res.json({ success: true, ...data });
  } catch (e) { bad(res, e); }
};

exports.myBucketSummary = async (req, res) => {
  try {
    const summary = await engine.bucketSummary(pool, req.user.user_id);
    res.json({ success: true, summary });
  } catch (e) { bad(res, e); }
};

exports.syncBucket = async (req, res) => {
  try {
    const items = Array.isArray((req.body || {}).items) ? req.body.items : [];
    const results = [];
    for (const item of items) {
      const key = item.key || item.idempotency_key;
      const action = String(item.action || '').toLowerCase();
      const woId = Number(item.wo_id);
      if (!woId || !action) {
        results.push({ key, ok: false, message: 'wo_id and action required' });
        continue;
      }
      try {
        const row = await tx(async (c) => {
          const owned = await c.query(
            'SELECT assigned_to FROM support_work_orders WHERE wo_id = $1',
            [woId]
          );
          if (!owned.rows[0]) throw Object.assign(new Error('Work order not found'), { status: 404 });
          if (Number(owned.rows[0].assigned_to) !== Number(req.user.user_id)) {
            throw Object.assign(new Error('You can only act on your own job'), { status: 403 });
          }
          if (action === 'accept') return wo.advance(c, woId, 'ACCEPTED', req.user.user_id);
          if (action === 'en_route' || action === 'en-route') return wo.advance(c, woId, 'EN_ROUTE', req.user.user_id);
          if (action === 'on_site' || action === 'on-site') return wo.advance(c, woId, 'ON_SITE', req.user.user_id);
          if (action === 'complete_step' || action === 'step') {
            return wo.completeStep(c, { woId, stepCode: item.step_code || item.body?.step_code, payload: item.body || {}, userId: req.user.user_id });
          }
          if (action === 'complete') return wo.completeWorkOrder(c, woId, item.body || {}, req.user.user_id);
          if (action === 'fail') return wo.failWorkOrder(c, woId, item.body || {}, req.user.user_id);
          throw Object.assign(new Error('Unknown sync action'), { status: 400 });
        });
        results.push({ key, ok: true, wo_id: row && (row.wo_id || woId) });
      } catch (e) {
        results.push({ key, ok: false, message: e.message, status: e.status || 500 });
      }
    }
    res.json({ success: true, results });
  } catch (e) { bad(res, e); }
};

exports.board = async (req, res) => {
  try {
    const data = await engine.dispatchBoard(pool, req.query || {});
    res.json({ success: true, ...data });
  } catch (e) { bad(res, e); }
};

exports.assign = async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.wo_id || !b.user_id) {
      return res.status(400).json({ success: false, message: 'wo_id and user_id required' });
    }
    const row = await tx((c) => engine.dispatchAssign(c, {
      wo_id: Number(b.wo_id),
      user_id: Number(b.user_id),
      slot_start: b.slot_start || null,
      slot_end: b.slot_end || null,
    }, req.user.user_id));
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.autoAssign = async (req, res) => {
  try {
    const b = req.body || {};
    const row = await tx((c) => engine.autoAssign(c, {
      date: b.date,
      zone: b.zone,
      dry_run: Boolean(b.dry_run),
      actorId: req.user.user_id,
    }));
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.capacity = async (req, res) => {
  try {
    const row = await engine.dispatchCapacity(pool, req.query || {});
    res.json({ success: true, ...row });
  } catch (e) { bad(res, e); }
};

exports.assigneeAvailability = async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });
    const data = await engine.assigneeAvailability(pool, userId, {
      from: req.query.from,
      days: req.query.days,
    });
    res.json({ success: true, ...data });
  } catch (e) { bad(res, e); }
};
