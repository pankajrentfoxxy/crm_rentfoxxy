#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/207_diagnosis_failed_permission.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Running 207_diagnosis_failed_permission.sql …');
  await pool.query(sql);
  const r = await pool.query(
    `SELECT role, can_view, can_create, can_edit
       FROM role_permissions
      WHERE section = 'diagnosis_failed'
      ORDER BY role`
  );
  console.log('Done. role grants:');
  r.rows.forEach((row) => {
    console.log(`  ${row.role}: view=${row.can_view} create=${row.can_create} edit=${row.can_edit}`);
  });
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration 207 failed:', err.message);
  process.exit(1);
});
