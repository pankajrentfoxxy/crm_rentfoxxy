#!/usr/bin/env node
/**
 * Run migration 185 — qc_results_history (Production QC Report snapshots)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/185_qc_results_history.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Running 185_qc_results_history.sql …');
  await pool.query(sql);
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM qc_results_history');
  console.log(`Done. qc_results_history rows: ${count.rows[0].n}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration 185 failed:', err.message);
  process.exit(1);
});
