#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sqlPath = path.join(__dirname, '..', 'migrations', '113_support_replacement_flow.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  console.log('Migration 113 applied.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
