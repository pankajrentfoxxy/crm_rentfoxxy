/**
 * Field technician day and travel (migration 438, 17 Oct 2026).
 *
 *   start of day — check in at an office from the list, or where they are
 *   every stop    — a support visit, a pickup, a delivery, a vendor hand-over:
 *                   the road distance from the previous stop (or the check-in)
 *   end of day    — the leg back to the office
 *
 * Road distance: Google Distance Matrix when GOOGLE_MAPS_API_KEY is set,
 * else OSRM (OpenStreetMap, router.project-osrm.org or OSRM_URL). A leg whose
 * lookup fails is kept as 'failed' and retried when the day is next read.
 */
const pool = require('../config/db');

const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
const FIELD_ROLES = ['support_tech', 'technician', 'delivery', 'delivery_technician', 'field_technician'];
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const num = (v) => (v == null || v === '' ? null : Number(v));
const validPoint = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** { km, minutes, provider } by road. */
async function roadDistance(from, to) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    if (key) {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&mode=driving&origins=${from.lat},${from.lng}&destinations=${to.lat},${to.lng}&key=${encodeURIComponent(key)}`;
      const j = await (await fetch(url, { signal: ctl.signal })).json();
      const el = j?.rows?.[0]?.elements?.[0];
      if (j.status !== 'OK' || el?.status !== 'OK') throw new Error(`Google: ${el?.status || j.status || 'no route'}`);
      return { km: el.distance.value / 1000, minutes: el.duration.value / 60, provider: 'google' };
    }
    const base = (process.env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
    const j = await (await fetch(`${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`, { signal: ctl.signal })).json();
    if (j.code !== 'Ok' || !j.routes?.length) throw new Error(`OSRM: ${j.code || 'no route'}`);
    return { km: j.routes[0].distance / 1000, minutes: j.routes[0].duration / 60, provider: 'osrm' };
  } finally {
    clearTimeout(timer);
  }
}

async function measureLeg(db, leg) {
  try {
    const r = await roadDistance({ lat: Number(leg.from_lat), lng: Number(leg.from_lng) }, { lat: Number(leg.to_lat), lng: Number(leg.to_lng) });
    await db.query(
      `UPDATE field_travel_legs SET road_km = $2, road_min = $3, provider = $4, status = 'ok', error = NULL WHERE leg_id = $1`,
      [leg.leg_id, Math.round(r.km * 100) / 100, Math.round(r.minutes * 10) / 10, r.provider]
    );
  } catch (e) {
    await db.query(`UPDATE field_travel_legs SET status = 'failed', error = $2 WHERE leg_id = $1`, [leg.leg_id, String(e.message || e).slice(0, 300)]);
  }
}

async function isFieldUser(db, user) {
  if (FIELD_ROLES.includes(String(user?.role || '').toLowerCase())) return true;
  const r = await db.query('SELECT 1 FROM delivery_technicians WHERE user_id = $1 LIMIT 1', [user.user_id]).catch(() => ({ rows: [] }));
  return r.rows.length > 0;
}

async function currentDay(db, userId) {
  await autoCloseDays(db).catch(() => {});
  return (await db.query('SELECT * FROM field_days WHERE user_id = $1 AND day = $2', [userId, todayIst()])).rows[0] || null;
}

async function places(db) {
  return (await db.query('SELECT * FROM field_checkin_places WHERE active ORDER BY is_default DESC, name')).rows;
}

/** Check in for today at a place from the list, or at the GPS point given. */
async function startDay(db, user, { placeId, latitude, longitude, label }) {
  if (await currentDay(db, user.user_id)) throw httpError('You have already started today', 409);
  let point;
  if (placeId) {
    const p = (await db.query('SELECT * FROM field_checkin_places WHERE place_id = $1 AND active', [placeId])).rows[0];
    if (!p) throw httpError('Choose a check-in place');
    point = { lat: Number(p.latitude), lng: Number(p.longitude), label: p.name, placeId: p.place_id };
  } else {
    const lat = num(latitude); const lng = num(longitude);
    if (!validPoint(lat, lng)) throw httpError('Your location is not available — allow location, or check in at the office');
    point = { lat, lng, label: String(label || '').trim() || 'My location', placeId: null };
  }
  return (await db.query(
    `INSERT INTO field_days (user_id, day, start_label, start_lat, start_lng, start_place_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [user.user_id, todayIst(), point.label, point.lat, point.lng, point.placeId]
  )).rows[0];
}

async function lastPoint(db, day) {
  const leg = (await db.query('SELECT to_lat, to_lng FROM field_travel_legs WHERE day_id = $1 ORDER BY seq DESC LIMIT 1', [day.day_id])).rows[0];
  return leg ? { lat: Number(leg.to_lat), lng: Number(leg.to_lng) } : { lat: Number(day.start_lat), lng: Number(day.start_lng) };
}

/**
 * A field user reached a stop. Not checked in → refused (the day starts with a
 * check-in). No GPS → the stop is not measured (nothing to measure to).
 * Measuring happens after the response, so the technician never waits for it.
 */
async function recordStop(db, user, { kind, ref, label, latitude, longitude }) {
  if (!(await isFieldUser(db, user))) return null;
  const day = await currentDay(db, user.user_id);
  if (!day) throw httpError('Check in first — choose the office or your location at the top of My work', 409);
  if (day.ended_at) throw httpError('Your day has ended — ask your lead to reopen it', 409);
  const lat = num(latitude); const lng = num(longitude);
  // The distance is measured to this point, so a field "reached" needs it (17 Oct 2026).
  if (!validPoint(lat, lng)) throw httpError('Your location is off — turn on location (GPS) for this site and tap again. The distance travelled is measured from it.', 400);
  const from = await lastPoint(db, day);
  const seq = (await db.query('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM field_travel_legs WHERE day_id = $1', [day.day_id])).rows[0].n;
  const leg = (await db.query(
    `INSERT INTO field_travel_legs (day_id, user_id, seq, kind, ref, label, from_lat, from_lng, to_lat, to_lng)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [day.day_id, user.user_id, seq, kind, ref || null, label || null, from.lat, from.lng, lat, lng]
  )).rows[0];
  setImmediate(() => { measureLeg(pool, leg).catch(() => {}); });
  return leg;
}

/**
 * The latest stop for each ref (a support item "T<ticket>-<item>", a Return DC,
 * a challan): when it was reached and the road distance from the stop before.
 */
async function stopsFor(db, refs) {
  const out = new Map();
  const list = [...new Set((refs || []).filter(Boolean).map(String))];
  if (!list.length) return out;
  const r = await db.query(
    `SELECT DISTINCT ON (l.ref) l.ref, l.reached_at, l.road_km, l.road_min, l.status, l.label,
            COALESCE(prev.label, d.start_label) AS from_label
       FROM field_travel_legs l
       JOIN field_days d ON d.day_id = l.day_id
       LEFT JOIN field_travel_legs prev ON prev.day_id = l.day_id AND prev.seq = l.seq - 1
      WHERE l.ref = ANY($1::text[])
      ORDER BY l.ref, l.leg_id DESC`,
    [list]
  ).catch(() => ({ rows: [] }));
  for (const row of r.rows) {
    out.set(row.ref, {
      reached_at: row.reached_at,
      km: row.road_km == null ? null : Number(row.road_km),
      minutes: row.road_min == null ? null : Number(row.road_min),
      measuring: row.status !== 'ok',
      from: row.from_label,
    });
  }
  return out;
}

/** End the day: the leg back to an office (or where they are). */
async function endDay(db, user, { placeId, latitude, longitude }) {
  const day = await currentDay(db, user.user_id);
  if (!day) throw httpError('You have not started today', 409);
  if (day.ended_at) throw httpError('Your day has already ended', 409);
  let point;
  if (placeId) {
    const p = (await db.query('SELECT * FROM field_checkin_places WHERE place_id = $1', [placeId])).rows[0];
    if (!p) throw httpError('Choose where you end the day');
    point = { lat: Number(p.latitude), lng: Number(p.longitude), label: p.name };
  } else {
    const lat = num(latitude); const lng = num(longitude);
    if (!validPoint(lat, lng)) throw httpError('Your location is not available — choose the office');
    point = { lat, lng, label: 'My location' };
  }
  const from = await lastPoint(db, day);
  const seq = (await db.query('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM field_travel_legs WHERE day_id = $1', [day.day_id])).rows[0].n;
  const leg = (await db.query(
    `INSERT INTO field_travel_legs (day_id, user_id, seq, kind, label, from_lat, from_lng, to_lat, to_lng)
     VALUES ($1, $2, $3, 'end', $4, $5, $6, $7, $8) RETURNING *`,
    [day.day_id, user.user_id, seq, point.label, from.lat, from.lng, point.lat, point.lng]
  )).rows[0];
  await db.query('UPDATE field_days SET end_label = $2, end_lat = $3, end_lng = $4, ended_at = NOW() WHERE day_id = $1', [day.day_id, point.label, point.lat, point.lng]);
  await measureLeg(db, leg);
}

/**
 * A day nobody ended is closed at 10 PM IST at the default office (IFFCO
 * Chowk): the leg back from the last stop is added, as if they checked out
 * there (17 Oct 2026). Runs from a worker every 10 minutes and whenever days
 * are read, so a missed run never leaves a day open.
 */
async function autoCloseDays(db = pool) {
  const istNow = new Date(Date.now() + 330 * 60000);
  const pastTen = istNow.getUTCHours() >= 22;
  const open = (await db.query(
    `SELECT * FROM field_days WHERE ended_at IS NULL AND (day < $1 OR ($2 AND day = $1))`,
    [todayIst(), pastTen]
  )).rows;
  if (!open.length) return 0;
  const place = (await db.query('SELECT * FROM field_checkin_places WHERE active ORDER BY is_default DESC, place_id LIMIT 1')).rows[0];
  if (!place) return 0;
  for (const day of open) {
    const dayStr = day.day instanceof Date ? new Date(day.day.getTime() + 330 * 60000).toISOString().slice(0, 10) : String(day.day).slice(0, 10);
    const at = `${dayStr}T22:00:00+05:30`;
    const from = await lastPoint(db, day);
    const seq = (await db.query('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM field_travel_legs WHERE day_id = $1', [day.day_id])).rows[0].n;
    const label = `${place.name} (auto check-out, 10 PM)`;
    const leg = (await db.query(
      `INSERT INTO field_travel_legs (day_id, user_id, seq, kind, label, from_lat, from_lng, to_lat, to_lng, reached_at)
       VALUES ($1, $2, $3, 'end', $4, $5, $6, $7, $8, $9) ON CONFLICT (day_id, seq) DO NOTHING RETURNING *`,
      [day.day_id, day.user_id, seq, label, from.lat, from.lng, place.latitude, place.longitude, at]
    )).rows[0];
    const upd = await db.query(
      `UPDATE field_days SET end_label = $2, end_lat = $3, end_lng = $4, ended_at = $5 WHERE day_id = $1 AND ended_at IS NULL`,
      [day.day_id, label, place.latitude, place.longitude, at]
    );
    if (leg && upd.rowCount) await measureLeg(db, leg);
  }
  return open.length;
}

let autoCloseTimer = null;
function startAutoCloseWorker() {
  if (autoCloseTimer) return;
  const tick = () => autoCloseDays(pool).catch((e) => console.error('[field] auto check-out:', e.message));
  tick();
  autoCloseTimer = setInterval(tick, 10 * 60 * 1000);
  if (autoCloseTimer.unref) autoCloseTimer.unref();
}

/** Days with their legs for users in a date range; failed / pending legs are measured again. */
async function daysFor(db, { userIds = null, from, to }) {
  await autoCloseDays(db).catch(() => {});
  const days = (await db.query(
    `SELECT d.*, u.name AS user_name FROM field_days d JOIN users u ON u.user_id = d.user_id
      WHERE d.day BETWEEN $1 AND $2 AND ($3::int[] IS NULL OR d.user_id = ANY($3::int[]))
      ORDER BY d.day DESC, u.name`,
    [from, to, userIds]
  )).rows;
  if (!days.length) return [];
  let legs = (await db.query('SELECT * FROM field_travel_legs WHERE day_id = ANY($1::int[]) ORDER BY day_id, seq', [days.map((d) => d.day_id)])).rows;
  const retry = legs.filter((l) => l.status !== 'ok' && (l.status === 'failed' || Date.now() - new Date(l.reached_at).getTime() > 60000)).slice(0, 10);
  if (retry.length) {
    for (const l of retry) await measureLeg(db, l); // eslint-disable-line no-await-in-loop
    legs = (await db.query('SELECT * FROM field_travel_legs WHERE day_id = ANY($1::int[]) ORDER BY day_id, seq', [days.map((d) => d.day_id)])).rows;
  }
  return days.map((d) => {
    const own = legs.filter((l) => l.day_id === d.day_id);
    return {
      ...d,
      legs: own,
      stops: own.filter((l) => l.kind !== 'end').length,
      total_km: Math.round(own.reduce((s, l) => s + Number(l.road_km || 0), 0) * 10) / 10,
      total_min: Math.round(own.reduce((s, l) => s + Number(l.road_min || 0), 0)),
      unmeasured: own.filter((l) => l.status !== 'ok').length,
    };
  });
}

module.exports = { stopsFor, autoCloseDays, startAutoCloseWorker, FIELD_ROLES, roadDistance, isFieldUser, currentDay, places, startDay, recordStop, endDay, daysFor, todayIst };
