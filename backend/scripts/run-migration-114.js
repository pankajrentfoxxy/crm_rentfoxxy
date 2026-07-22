#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '114_support_replacement_so_line.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migration 114 applied.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
