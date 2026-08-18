'use strict';

const DEFAULTS = {
  auto_close_hours: 48,
  reopen_window_days: 7,
  csat_token_days: 14,
  escalation_thresholds: [50, 75, 100, 125, 150],
  free_repair_days: 3,
  max_repair_days: 7,
  max_jobs_per_day: 6,
  accept_window_minutes: 30,
  photo_min_count: 4,
  parts_lead_threshold: 5000,
  parts_manager_threshold: 10000,
  field_visit_cost: 0,
  notifications: {},
  portal: { can_create: true, can_reopen: true, can_approve_charge: true },
};

const GROUPS = {
  sla: ['auto_close_hours', 'reopen_window_days', 'csat_token_days', 'escalation_thresholds'],
  repair: ['free_repair_days', 'max_repair_days'],
  field: ['max_jobs_per_day', 'accept_window_minutes', 'photo_min_count'],
  parts: ['parts_lead_threshold', 'parts_manager_threshold'],
  notifications: ['notifications'],
  portal: ['portal'],
};

let cache = null;
let cacheAt = 0;
const TTL_MS = 15000;

function unwrap(raw, fallback) {
  if (raw == null) return fallback;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && Object.keys(raw).length === 1 && raw.n != null) {
    return raw.n;
  }
  return raw;
}

function parseRow(row) {
  if (!row) return null;
  if (row.value != null) return unwrap(row.value, null);
  if (row.setting_value == null) return null;
  try {
    return JSON.parse(row.setting_value);
  } catch {
    const n = Number(row.setting_value);
    return Number.isFinite(n) ? n : row.setting_value;
  }
}

async function loadAll(db) {
  const now = Date.now();
  if (cache && now - cacheAt < TTL_MS) return cache;
  const map = { ...DEFAULTS };
  try {
    const r = await db.query(
      'SELECT setting_key, setting_value, value, updated_by, updated_at FROM support_settings_v2'
    );
    for (const row of r.rows) {
      const parsed = parseRow(row);
      if (parsed != null) map[row.setting_key] = parsed;
    }
  } catch (e) {
    if (!/does not exist/i.test(e.message || '')) throw e;
  }
  cache = map;
  cacheAt = now;
  return map;
}

function invalidateSettingsCache() {
  cache = null;
  cacheAt = 0;
}

async function getAllSettings(db) {
  return loadAll(db);
}

async function getSetting(db, key, fallback) {
  const all = await loadAll(db);
  if (all[key] == null) return fallback != null ? fallback : DEFAULTS[key];
  return all[key];
}

async function getNumber(db, key, fallback) {
  const n = Number(await getSetting(db, key, fallback));
  return Number.isFinite(n) ? n : Number(fallback != null ? fallback : DEFAULTS[key]) || 0;
}

async function setSetting(db, key, value, userId) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key) && !['notifications', 'portal'].includes(key)) {
    const err = new Error(`Unknown setting ${key}`);
    err.status = 400;
    throw err;
  }
  const json = JSON.stringify(value);
  await db.query(
    `INSERT INTO support_settings_v2 (setting_key, setting_value, value, updated_by, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, NOW())
     ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [key, typeof value === 'string' ? value : json, json, userId || null]
  );
  invalidateSettingsCache();
  return getAllSettings(db);
}

async function setMany(db, patch, userId) {
  const keys = Object.keys(patch || {});
  for (const key of keys) {
    await setSetting(db, key, patch[key], userId);
  }
  return getAllSettings(db);
}

function grouped(all) {
  const out = {};
  for (const [group, keys] of Object.entries(GROUPS)) {
    out[group] = {};
    for (const key of keys) out[group][key] = all[key];
  }
  return out;
}

module.exports = {
  DEFAULTS,
  GROUPS,
  getAllSettings,
  getSetting,
  getNumber,
  setSetting,
  setMany,
  grouped,
  invalidateSettingsCache,
};
