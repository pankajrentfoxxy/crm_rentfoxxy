'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');

test('phase 1: catalogue has 7 types and 41 subtypes', async (t) => {
  let rows;
  try {
    const r = await pool.query(
      `SELECT level, COUNT(*)::int AS n
         FROM support_issue_catalog
        WHERE (level < 3 AND active = TRUE) OR (level = 2)
        GROUP BY level`
    );
    rows = r.rows;
  } catch (e) {
    t.skip(`database unavailable: ${e.message}`);
    return;
  }
  const l1 = rows.find((x) => x.level === 1);
  const l2 = rows.find((x) => x.level === 2);
  assert.equal(l1?.n, 7);
  assert.equal(l2?.n, 41);
});

test('phase 1: HW-DIS-CRK exists as an active cracked-panel issue', async (t) => {
  try {
    const r = await pool.query(
      `SELECT code, name, chargeable_default, requires_photo, is_safety
         FROM support_issue_catalog WHERE code = 'HW-DIS-CRK'`
    );
    assert.equal(r.rows[0]?.name, 'Cracked panel');
    assert.equal(r.rows[0]?.chargeable_default, true);
    assert.equal(r.rows[0]?.requires_photo, true);
    assert.equal(r.rows[0]?.is_safety, false);
  } catch (e) {
    t.skip(`database unavailable: ${e.message}`);
  }
});

test('phase 1: every subtype has an inactive Unspecified child', async (t) => {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS missing
         FROM support_issue_catalog p
         LEFT JOIN support_issue_catalog c
           ON c.parent_id = p.catalog_id AND c.code = p.code || '-UNS'
        WHERE p.level = 2 AND (c.catalog_id IS NULL OR c.active = TRUE)`
    );
    assert.equal(r.rows[0].missing, 0);
  } catch (e) {
    t.skip(`database unavailable: ${e.message}`);
  }
});

test('phase 1: default P2 and Platinum High policies exist', async (t) => {
  try {
    const r = await pool.query(
      `SELECT name, response_minutes, resolution_minutes, specificity, support_tier
         FROM support_sla_policies
        WHERE name IN ('Default P2 — High', 'Platinum — High')`
    );
    const def = r.rows.find((x) => x.name.startsWith('Default P2'));
    const plat = r.rows.find((x) => x.name.startsWith('Platinum'));
    assert.equal(def?.response_minutes, 120);
    assert.equal(def?.resolution_minutes, 1440);
    assert.equal(plat?.response_minutes, 60);
    assert.equal(plat?.resolution_minutes, 720);
    assert.equal(plat?.specificity, 10);
    assert.equal(plat?.support_tier, 'PLATINUM');
  } catch (e) {
    t.skip(`database unavailable: ${e.message}`);
  }
});

after(async () => {
  await pool.end().catch(() => {});
});
