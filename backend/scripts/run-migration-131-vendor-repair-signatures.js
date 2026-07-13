#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '131_vendor_repair_signatures.sql'),
    'utf8'
  );
  await pool.query(sql);
  console.log('Migration 131 applied (vendor repair signatures + signer names).');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
