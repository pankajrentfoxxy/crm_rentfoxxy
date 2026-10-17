/**
 * Field technician day, travel and report (migration 438, 17 Oct 2026).
 *   /api/field/day            today's check-in, stops and km (+ the places)
 *   /api/field/day/start|end  check in / end the day
 *   /api/field/my-report      what I did in a date range, with travel
 *   /api/field/team           leads: every technician (field_travel view)
 *   /api/field/places         check-in places (field_travel edit to change)
 */
const express = require('express');
const pool = require('../config/db');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const travel = require('../services/fieldTravelService');
const report = require('../services/fieldReportService');

const router = express.Router();
router.use(authMiddleware);

const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const range = (q) => {
  const to = ymd(q.to) || travel.todayIst();
  const from = ymd(q.from) || to;
  if (from > to) return { from: to, to: from };
  return { from, to };
};
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (!e.status) console.error('[field]', e);
    res.status(e.status || 500).json({ success: false, code: e.code, message: e.status ? e.message : 'Something went wrong' });
  }
};

router.get('/day', wrap(async (req, res) => {
  const today = travel.todayIst();
  const [day] = await travel.daysFor(pool, { userIds: [req.user.user_id], from: today, to: today });
  res.json({ success: true, is_field_user: await travel.isFieldUser(pool, req.user), day: day || null, places: await travel.places(pool) });
}));
router.post('/day/start', wrap(async (req, res) => {
  const b = req.body || {};
  await travel.startDay(pool, req.user, { placeId: Number(b.place_id) || null, latitude: b.latitude, longitude: b.longitude, label: b.label });
  res.json({ success: true, message: 'Day started — have a safe day' });
}));
router.post('/day/end', wrap(async (req, res) => {
  const b = req.body || {};
  await travel.endDay(pool, req.user, { placeId: Number(b.place_id) || null, latitude: b.latitude, longitude: b.longitude });
  res.json({ success: true, message: 'Day ended' });
}));
router.get('/my-report', wrap(async (req, res) => {
  res.json({ success: true, ...(await report.myReport(pool, req.user.user_id, range(req.query))) });
}));
router.get('/team', checkSectionPermission('field_travel', 'view'), wrap(async (req, res) => {
  res.json({ success: true, ...(await report.teamReport(pool, range(req.query))) });
}));
// ── Tasks: one at a time, in the lead's order (migration 439) ──────────────
const tasks = require('../services/fieldTaskService');
const LEAD_ROLES = ['super_admin', 'admin', 'manager', 'support_lead'];
const { hasPermission } = require('../services/permissionService');
async function isFieldLead(user) {
  if (LEAD_ROLES.includes(String(user?.role || '').toLowerCase())) return true;
  return hasPermission(user.user_id, user.role, 'field_travel', 'edit');
}
const forUser = async (req) => {
  const id = Number(req.query.user_id || req.body?.user_id || 0) || req.user.user_id;
  if (id !== req.user.user_id && !(await isFieldLead(req.user))) throw Object.assign(new Error('Only a lead can see or change another technician\'s tasks'), { status: 403 });
  return id;
};
router.get('/tasks', wrap(async (req, res) => {
  const userId = await forUser(req);
  const target = userId === req.user.user_id ? req.user : (await pool.query('SELECT user_id, role FROM users WHERE user_id = $1', [userId])).rows[0];
  res.json({ success: true, user_id: userId, is_field_user: target ? await travel.isFieldUser(pool, target) : false, ...(await tasks.listTasks(pool, userId)) });
}));
router.put('/tasks/order', wrap(async (req, res) => {
  const userId = await forUser(req);
  if (userId === req.user.user_id && !(await isFieldLead(req.user))) return res.status(403).json({ success: false, message: 'Your lead sets the order' });
  const n = await tasks.setOrder(pool, { userId, keys: req.body?.keys, setBy: req.user.user_id });
  res.json({ success: true, message: `Order saved — ${n} task${n === 1 ? '' : 's'}`, ...(await tasks.listTasks(pool, userId)) });
}));
router.post('/tasks/release', wrap(async (req, res) => {
  if (!(await isFieldLead(req.user))) return res.status(403).json({ success: false, message: 'Only a lead can put a task back' });
  const userId = await forUser(req);
  const n = await tasks.releaseTask(pool, { userId, key: String(req.body?.key || '') });
  if (!n) return res.status(409).json({ success: false, message: 'Nothing to put back — it is already finished, or something was collected / delivered' });
  res.json({ success: true, message: 'Put back to not started', ...(await tasks.listTasks(pool, userId)) });
}));
// Back at the warehouse / office mid-day (to pick up or hand over): a travel stop.
router.post('/day/warehouse', wrap(async (req, res) => {
  const b = req.body || {};
  let point = { latitude: b.latitude, longitude: b.longitude, label: 'Warehouse (my location)' };
  if (b.place_id) {
    const p = (await pool.query('SELECT * FROM field_checkin_places WHERE place_id = $1 AND active', [Number(b.place_id)])).rows[0];
    if (!p) return res.status(400).json({ success: false, message: 'Choose the place' });
    point = { latitude: p.latitude, longitude: p.longitude, label: p.name };
  }
  const leg = await travel.recordStop(pool, req.user, { kind: 'warehouse', ref: null, label: point.label, latitude: point.latitude, longitude: point.longitude });
  if (!leg) return res.status(400).json({ success: false, message: 'Your location is not available — choose the place' });
  res.json({ success: true, message: `Recorded at ${point.label}` });
}));

router.get('/places', wrap(async (_req, res) => res.json({ success: true, places: await travel.places(pool) })));
router.post('/places', checkSectionPermission('field_travel', 'edit'), wrap(async (req, res) => {
  const b = req.body || {};
  const lat = Number(b.latitude); const lng = Number(b.longitude);
  if (!String(b.name || '').trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ success: false, message: 'Name, latitude and longitude are required' });
  await pool.query('INSERT INTO field_checkin_places (name, latitude, longitude) VALUES ($1, $2, $3)', [String(b.name).trim(), lat, lng]);
  res.json({ success: true, places: await travel.places(pool) });
}));
router.patch('/places/:id', checkSectionPermission('field_travel', 'edit'), wrap(async (req, res) => {
  const b = req.body || {};
  const lat = Number(b.latitude); const lng = Number(b.longitude);
  if (!String(b.name || '').trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ success: false, message: 'Name, latitude and longitude are required' });
  await pool.query('UPDATE field_checkin_places SET name = $2, latitude = $3, longitude = $4 WHERE place_id = $1', [Number(req.params.id), String(b.name).trim(), lat, lng]);
  res.json({ success: true, places: await travel.places(pool) });
}));
// The default place: preselected at check-in and where an unended day closes at 10 PM.
router.post('/places/:id/default', checkSectionPermission('field_travel', 'edit'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const p = (await pool.query('SELECT 1 FROM field_checkin_places WHERE place_id = $1 AND active', [id])).rows[0];
  if (!p) return res.status(404).json({ success: false, message: 'Place not found' });
  await pool.query('UPDATE field_checkin_places SET is_default = (place_id = $1)', [id]);
  res.json({ success: true, places: await travel.places(pool) });
}));
router.delete('/places/:id', checkSectionPermission('field_travel', 'edit'), wrap(async (req, res) => {
  await pool.query('UPDATE field_checkin_places SET active = FALSE WHERE place_id = $1 AND NOT is_default', [Number(req.params.id)]);
  res.json({ success: true, places: await travel.places(pool) });
}));

module.exports = router;
