#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '129_vendor_repair_dispatch_pod.sql'),
    'utf8'
  );
  await pool.query(sql);
  console.log('Migration 129 applied (vendor repair dispatch POD).');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
