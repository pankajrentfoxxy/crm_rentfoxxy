#!/usr/bin/env node
/** Run migration 137 — Delivery Register OTP permission section. */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const file = path.join(__dirname, '../migrations/137_delivery_register_otp_permission.sql');
  const sql = fs.readFileSync(file, 'utf8');
  await pool.query(sql);
  console.log('Migration 137 applied: delivery_register_otp permission');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
