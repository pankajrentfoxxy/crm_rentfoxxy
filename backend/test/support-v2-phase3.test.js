'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');

async function q(t, sql, params) {
  try {
    return await pool.query(sql, params);
  } catch (e) {
    t.skip(`database unavailable: ${e.message}`);
    return null;
  }
}

test('phase 3: seven system saved views exist', async (t) => {
  const r = await q(t, `
    SELECT slug FROM support_saved_views WHERE is_system = TRUE ORDER BY slug`);
  if (!r) return;
  assert.deepEqual(r.rows.map((x) => x.slug), [
    'all_open', 'breaching', 'field_jobs_today', 'mine',
    'pending_customer', 'resolved_7d', 'unassigned',
  ]);
});

after(async () => {
  await pool.end().catch(() => {});
});
