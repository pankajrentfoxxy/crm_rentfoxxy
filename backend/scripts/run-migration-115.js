#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '115_spare_parts_catalog_master.sql'),
    'utf8'
  );
  await pool.query(sql);
  console.log('Migration 115 applied.');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
