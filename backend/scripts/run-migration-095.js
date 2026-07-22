require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/095_qc_stage_dispatch.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  const col = await pool.query(
    `SELECT character_maximum_length FROM information_schema.columns
      WHERE table_name = 'qc_results' AND column_name = 'qc_stage'`
  );
  const con = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'qc_results'::regclass AND conname = 'qc_results_qc_stage_check'`
  );
  console.log('Migration 095 OK');
  console.log('  qc_stage length:', col.rows[0]?.character_maximum_length);
  console.log('  constraint     :', con.rows[0]?.def);
  process.exit(0);
}

main().catch((e) => { console.error('Migration 095 failed:', e.message); process.exit(1); });
