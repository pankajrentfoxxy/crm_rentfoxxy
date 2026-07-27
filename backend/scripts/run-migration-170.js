/**
 * Apply migration 170 — seed dynamic stage checklists (Assembly & Software, Final Testing)
 * Usage: node backend/scripts/run-migration-170.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/170_seed_stage_checklists.sql'),
    'utf8'
  );
  await pool.query(sql);
  await pool.query(
    `INSERT INTO schema_migrations (name) VALUES ('170_seed_stage_checklists.sql')
     ON CONFLICT (name) DO NOTHING`
  );
  const check = await pool.query(
    `SELECT s.stage_name, jsonb_array_length(sc.checklist_items) AS item_count
       FROM stage_checklists sc
       JOIN stages s ON s.stage_id = sc.stage_id
      WHERE s.stage_name IN ('Assembly & Software', 'Final Testing')
      ORDER BY s.stage_name`
  );
  console.log('Migration 170 applied. Seeded checklists:', check.rows);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
