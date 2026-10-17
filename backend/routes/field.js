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
// Lead: the whole plan — order, day and time per task (Task board, migration 440).
router.put('/tasks/plan', wrap(async (req, res) => {
  if (!(await isFieldLead(req.user))) return res.status(403).json({ success: false, message: 'Your lead plans the tasks' });
  const userId = await forUser(req);
  const n = await tasks.savePlan(pool, { userId, items: req.body?.items, setBy: req.user.user_id });
  res.json({ success: true, message: `Plan saved — ${n} task${n === 1 ? '' : 's'}`, ...(await tasks.listTasks(pool, userId)) });
}));
// Lead: one task — next (after what is in progress) or at the end of a day, at a time.
router.post('/tasks/plan-one', wrap(async (req, res) => {
  if (!(await isFieldLead(req.user))) return res.status(403).json({ success: false, message: 'Your lead plans the tasks' });
  const userId = await forUser(req);
  const b = req.body || {};
  await tasks.planTask(pool, { userId, key: String(b.key || ''), date: b.date, time: b.time, position: b.position === 'next' ? 'next' : 'end', setBy: req.user.user_id });
  res.json({ success: true, message: b.position === 'next' ? 'Planned next — it opens as soon as the current task is done' : 'Planned', ...(await tasks.listTasks(pool, userId)) });
}));
// Lead: every field technician with today / tomorrow / later counts and the task in progress,
// plus support jobs nobody holds yet (Task board).
router.get('/board', wrap(async (req, res) => {
  if (!(await isFieldLead(req.user))) return res.status(403).json({ success: false, message: 'Only a lead can see the task board' });
  const people = (await pool.query(
    `SELECT u.user_id, u.name, u.role FROM users u
      WHERE COALESCE(u.active, TRUE) AND COALESCE(u.status, 'active') <> 'inactive'
        AND (LOWER(u.role) = ANY($1::text[]) OR EXISTS (SELECT 1 FROM delivery_technicians d WHERE d.user_id = u.user_id AND d.is_active))
      ORDER BY u.name`,
    [travel.FIELD_ROLES]
  )).rows;
  const today = travel.todayIst();
  const days = await travel.daysFor(pool, { userIds: people.map((p) => p.user_id), from: today, to: today }).catch(() => []);
  const technicians = [];
  for (const p of people) {
    // eslint-disable-next-line no-await-in-loop
    const l = await tasks.listTasks(pool, p.user_id);
    const open = l.tasks.filter((t) => t.state !== 'carrying');
    const day = days.find((d) => d.user_id === p.user_id);
    technicians.push({
      ...p,
      today: open.filter((t) => t.bucket === 'today' && t.state !== 'waiting').length,
      tomorrow: open.filter((t) => t.bucket === 'tomorrow').length,
      later: open.filter((t) => t.bucket === 'later').length,
      waiting: open.filter((t) => t.state === 'waiting').length,
      active: l.active.map((t) => ({ key: t.key, title: t.title, customer: t.customer })),
      checked_in: Boolean(day && !day.ended_at),
      km: day ? day.total_km : 0,
    });
  }
  // Not with anyone yet: complaint visits, and technician pickups (one per Return DC).
  const unassigned = (await pool.query(
    `SELECT i.id AS item_id, i.ticket_id, i.item_type, i.return_dc_number, i.pickup_type, i.source_item_id,
            i.ttspl_id, i.serial_number, i.brand, i.model, i.issue_category_label, i.visit_scheduled_at, i.pickup_scheduled_at,
            t.customer_name, t.priority, t.ticket_address, t.pickup_address
       FROM support_ticket_items i JOIN support_tickets t ON t.id = i.ticket_id
      WHERE t.status NOT IN ('closed', 'cancelled')
        AND i.status NOT IN ('resolved', 'closed', 'inventory_updated', 'cancelled', 'removed', 'delivered', 'picked_up', 'awaiting_service_return')
        AND ((i.item_type = 'complaint' AND i.assigned_to IS NULL AND i.outcome IS NULL)
          OR (i.item_type = 'pickup' AND i.return_dc_number IS NOT NULL AND i.pickup_assigned_to IS NULL AND i.assigned_to IS NULL
              AND COALESCE(i.pickup_method, 'inhouse') NOT IN ('courier', 'porter')
              AND i.customer_otp_verified_at IS NULL AND i.picked_up_at IS NULL))
      ORDER BY i.ticket_id, i.id`
  )).rows;
  const addr = (a) => {
    if (!a) return '';
    if (typeof a === 'string') { try { return addr(JSON.parse(a)); } catch { return a; } }
    return [a.address || a.line1, a.city, a.state, a.pincode].filter(Boolean).join(', ');
  };
  const lanes = [];
  const byRdc = new Map();
  for (const r of unassigned) {
    const laptop = [r.ttspl_id || r.serial_number, [r.brand, r.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    if (r.item_type === 'pickup') {
      if (byRdc.has(r.return_dc_number)) { byRdc.get(r.return_dc_number).laptops.push(laptop); continue; }
      const card = {
        key: `rdc:${r.return_dc_number}`, kind: 'pickup', item_id: r.item_id, ticket_id: r.ticket_id, return_dc_number: r.return_dc_number,
        title: `${(r.pickup_type || (r.source_item_id ? 'repair' : 'return')) === 'repair' ? 'Repair pickup' : 'Pickup'} · ${r.return_dc_number}`,
        customer: r.customer_name, address: addr(r.pickup_address || r.ticket_address), appointment: r.pickup_scheduled_at, priority: r.priority, laptops: [laptop],
      };
      byRdc.set(r.return_dc_number, card);
      lanes.push(card);
    } else {
      lanes.push({
        key: `item:${r.item_id}`, kind: 'visit', item_id: r.item_id, ticket_id: r.ticket_id, title: `Visit · ${r.ttspl_id || r.serial_number || `#${r.ticket_id}`}`,
        customer: r.customer_name, address: addr(r.ticket_address || r.pickup_address), appointment: r.visit_scheduled_at, priority: r.priority,
        laptops: [laptop], issue: r.issue_category_label || null,
      });
    }
  }
  res.json({ success: true, today, technicians, unassigned: lanes });
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
