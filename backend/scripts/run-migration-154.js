/**
 * Run migration 154 — reassign leads from user 13 → 31 (Harshit).
 * Usage: node scripts/run-migration-154.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const before = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM leads WHERE assigned_user_id = 13) AS leads_still_13,
      (SELECT COUNT(*)::int FROM leads WHERE assigned_user_id = 31) AS leads_now_31,
      (SELECT COUNT(*)::int FROM lead_assignments WHERE assigned_to = 13) AS assignments_still_13
  `);

  const sqlPath = path.join(__dirname, '../migrations/154_reassign_leads_13_to_31.sql');
  await pool.query(fs.readFileSync(sqlPath, 'utf8'));

  const after = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM leads WHERE assigned_user_id = 13) AS leads_still_13,
      (SELECT COUNT(*)::int FROM leads WHERE assigned_user_id = 31) AS leads_now_31,
      (SELECT COUNT(*)::int FROM lead_assignments WHERE assigned_to = 13) AS assignments_still_13,
      (SELECT COUNT(*)::int FROM lead_assignments WHERE assigned_to = 31) AS assignments_now_31
  `);

  console.log('Migration 154 applied:', sqlPath);
  console.log('Before:', before.rows[0]);
  console.log('After:', after.rows[0]);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
