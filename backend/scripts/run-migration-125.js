#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '125_asset_config_brand_allowlist.sql'),
    'utf8'
  );
  await pool.query(sql);
  console.log('Migration 125 applied (asset config brand allowlist).');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
