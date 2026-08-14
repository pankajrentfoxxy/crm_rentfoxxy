#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/196_scrap_challan.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Running 196_scrap_challan.sql …');
  await pool.query(sql);

  const status = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'part_instances_status_check'`
  );
  const mov = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'part_movements_type_check'`
  );
  const tables = await pool.query(
    `SELECT to_regclass('public.scrap_challans') AS header,
            to_regclass('public.scrap_challan_items') AS items`
  );
  const col = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'part_instances' AND column_name = 'scrap_challan_number'`
  );

  console.log('part_instances_status_check:', status.rows[0]?.def);
  console.log('part_movements_type_check:', mov.rows[0]?.def);
  console.log('tables:', tables.rows[0]);
  console.log('scrap_challan_number column:', col.rows[0]?.n === 1);
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration 196 failed:', err.message);
  process.exit(1);
});
