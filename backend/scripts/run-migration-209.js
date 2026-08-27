#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/209_support_complaint_visit_scheduled.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Running 209_support_complaint_visit_scheduled.sql …');
  await pool.query(sql);
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration 209 failed:', err.message);
  process.exit(1);
});
