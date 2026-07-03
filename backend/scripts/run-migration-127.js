#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '127_asset_config_spare_brands.sql'),
    'utf8'
  );
  await pool.query(sql);
  console.log('Migration 127 applied (asset config spare part brands).');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
