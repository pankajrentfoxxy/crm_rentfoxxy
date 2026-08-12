#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/188_users_remember_pass_plain.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Running 188_users_remember_pass_plain.sql …');
  await pool.query(sql);
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'remember_pass_plain'`
  );
  console.log(r.rows.length ? 'Done — remember_pass_plain column ready.' : 'Column missing after migration.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration 188 failed:', err.message);
  process.exit(1);
});
