#!/usr/bin/env node
/**
 * Applies migration 115 (includes prerequisite columns from 089 if missing on prod).
 */
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

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vendor_spare_parts_catalog'
        AND column_name IN (
          'floor_part_id', 'category', 'specifications', 'compatible_brands',
          'part_type', 'default_brand', 'erp_spare_part_id'
        )
      ORDER BY column_name`
  );
  console.log('Migration 115 applied.');
  console.log('vendor_spare_parts_catalog columns:', cols.rows.map((r) => r.column_name).join(', '));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
