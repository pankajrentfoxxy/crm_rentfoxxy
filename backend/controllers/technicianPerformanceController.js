const pool = require('../config/db');
const svc = require('../services/technicianPerformanceService');

/** Technician performance (migration 415). Read-only except the targets. */
const send = (res, e, where) => {
  if (e instanceof svc.PerformanceError) return res.status(e.status).json({ success: false, message: e.message });
  console.error(`technicianPerformance.${where}:`, e);
  return res.status(500).json({ success: false, message: 'Could not load technician performance' });
};

exports.summary = async (req, res) => {
  try {
    res.json({ success: true, data: await svc.summary(pool, { from: req.query.from, to: req.query.to }) });
  } catch (e) { send(res, e, 'summary'); }
};

exports.technician = async (req, res) => {
  try {
    res.json({ success: true, data: await svc.technicianDetail(pool, { userId: req.params.userId, from: req.query.from, to: req.query.to }) });
  } catch (e) { send(res, e, 'technician'); }
};

exports.getTargets = async (req, res) => {
  try {
    res.json({ success: true, data: await svc.getTargets(pool) });
  } catch (e) { send(res, e, 'getTargets'); }
};

exports.saveTargets = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const data = await svc.saveTargets(client, req.body || {}, req.user?.user_id || null);
    await client.query('COMMIT');
    res.json({ success: true, data });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    send(res, e, 'saveTargets');
  } finally {
    client.release();
  }
};
