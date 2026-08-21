'use strict';

const pool = require('../config/db');
const { hasPermission } = require('../services/permissionService');
const { WO_TYPE_SECTION } = require('../services/supportWorkOrderService');

async function may(req, section, action) {
  if (!req.user) return false;
  if (req.user.role === 'super_admin') return true;
  if (!req.permissionCache) req.permissionCache = {};
  return hasPermission(req.user.user_id, req.user.role, section, action, req.permissionCache);
}

function requireWoType(action, { fromBody, generalSection = 'support_work_orders' } = {}) {
  return async (req, res, next) => {
    try {
      let woType = fromBody ? String((req.body && req.body.wo_type) || '').toUpperCase() : null;
      if (!woType && req.params.woId) {
        const r = await pool.query('SELECT wo_type FROM support_work_orders WHERE wo_id = $1', [req.params.woId]);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Work order not found' });
        woType = r.rows[0].wo_type;
        req.woType = woType;
      }
      const section = WO_TYPE_SECTION[woType];
      if (!section) return res.status(400).json({ success: false, message: 'Unknown work order type' });
      const general = generalSection ? await may(req, generalSection, action) : true;
      const typed = await may(req, section, action);
      if (!general || !typed) {
        return res.status(403).json({ success: false, message: 'Permission denied' });
      }
      next();
    } catch (e) {
      console.error('requireWoType:', e);
      res.status(500).json({ success: false, message: e.message });
    }
  };
}

function requireOwnWo() {
  return async (req, res, next) => {
    try {
      const r = await pool.query(
        'SELECT wo_id, assigned_to FROM support_work_orders WHERE wo_id = $1',
        [req.params.woId]
      );
      if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Work order not found' });
      if (Number(r.rows[0].assigned_to) !== Number(req.user.user_id)) {
        const field = ['support_tech', 'technician'].includes(req.user.role);
        return res.status(field ? 404 : 403).json({
          success: false,
          message: field ? 'Work order not found' : 'You can only act on your own job',
        });
      }
      next();
    } catch (e) {
      console.error('requireOwnWo:', e);
      res.status(500).json({ success: false, message: e.message });
    }
  };
}

async function withIdempotency(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key) return next();
  try {
    const hit = await pool.query(
      'SELECT response FROM support_wo_idempotency WHERE key = $1',
      [key]
    );
    if (hit.rows[0] && hit.rows[0].response) {
      return res.json(hit.rows[0].response);
    }
    const orig = res.json.bind(res);
    res.json = (body) => {
      const woId = (body && (body.wo_id || (body.wo && body.wo.wo_id) || req.params.woId)) || null;
      pool.query(
        `INSERT INTO support_wo_idempotency (key, wo_id, response)
         VALUES ($1,$2,$3::jsonb)
         ON CONFLICT (key) DO NOTHING`,
        [key, woId, JSON.stringify(body)]
      ).catch((e) => console.error('idempotency store:', e));
      return orig(body);
    };
    next();
  } catch (e) {
    console.error('withIdempotency:', e);
    next();
  }
}

module.exports = { requireWoType, requireOwnWo, withIdempotency, may, WO_TYPE_SECTION };
