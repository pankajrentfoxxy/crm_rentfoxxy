require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/082_dispatch_qc_stage.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  const stage = await pool.query(
    `SELECT s.stage_name, t.team_name
     FROM stages s
     LEFT JOIN teams t ON t.team_id = s.team_id
     WHERE s.stage_name = 'Dispatch QC'`
  );
  const rules = await pool.query(
    `SELECT COUNT(*)::int AS n FROM stage_transition_rules
     WHERE from_stage_name IN ('QC1', 'Dispatch QC') AND to_stage_name IN ('Dispatch QC', 'Inventory', 'Assembly & Software')`
  );
  console.log('Migration 082 OK — Dispatch QC stage:', stage.rows[0]?.stage_name, 'rules:', rules.rows[0].n);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
