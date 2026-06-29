#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '116_ship_by_porter.sql'),
    'utf8'
  );
  await pool.query(sql);

  const chk = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conname = 'delivery_challan_lines_ship_by_check'`
  );
  console.log('Migration 116 applied.');
  console.log('ship_by check:', chk.rows[0]?.def || 'missing');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
