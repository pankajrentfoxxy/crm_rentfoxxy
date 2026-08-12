#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/190_parts_detach_permission.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Running 190_parts_detach_permission.sql …');
  await pool.query(sql);
  const r = await pool.query(
    `SELECT section FROM permission_sections WHERE section = 'parts_detach'`
  );
  console.log(r.rows.length ? 'Done — parts_detach permission ready.' : 'Section missing after migration.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration 190 failed:', err.message);
  process.exit(1);
});
