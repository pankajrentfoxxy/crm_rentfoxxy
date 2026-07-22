#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '128_spare_part_brand_seed.sql'),
    'utf8'
  );
  await pool.query(sql);
  await pool.query(
    `INSERT INTO schema_migrations (name) VALUES ('128_spare_part_brand_seed.sql')
     ON CONFLICT (name) DO NOTHING`
  );

  const active = await pool.query(
    `SELECT name FROM asset_config_spare_brands
      WHERE deleted_at IS NULL AND status = 'active'
      ORDER BY name`
  );
  console.log('Migration 128 applied (spare part brand seed).');
  console.log('Active spare brands:', active.rows.map((r) => r.name).join(', '));
  console.log('Count:', active.rows.length);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
