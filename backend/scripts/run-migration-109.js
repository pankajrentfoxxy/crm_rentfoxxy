require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/109_mismatch_repair_routing.sql'), 'utf8');
  await pool.query(sql);
  await pool.query(
    `INSERT INTO schema_migrations (name) VALUES ('109_mismatch_repair_routing.sql')
     ON CONFLICT (name) DO NOTHING`
  );
  const r = await pool.query(
    `SELECT from_stage_name, to_stage_name FROM stage_transition_rules
     WHERE from_stage_name IN ('Assembly & Software', 'Final Testing')
       AND to_stage_name IN ('Chip Level Repair', 'Body & Paint')
     ORDER BY 1, 2`
  );
  console.log('Migration 109 applied. Rules:', r.rows);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
