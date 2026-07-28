/**
 * Run migration 173 — physical serial_number on part_instances (+ indexes).
 * Usage: node scripts/run-migration-173.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/173_part_instance_serial_number.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  console.log('Migration 173 applied:', sqlPath);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
