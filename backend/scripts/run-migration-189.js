#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/189_vendor_part_repair_return.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Running 189_vendor_part_repair_return.sql …');
  await pool.query(sql);

  const status = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'part_instances_status_check'`
  );
  const mov = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'part_movements_type_check'`
  );
  const domain = await pool.query(
    `SELECT column_default FROM information_schema.columns
      WHERE table_name = 'vendor_repair_delivery_challans' AND column_name = 'item_domain'`
  );
  const partsTable = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_name = 'vendor_repair_dc_part_items'`
  );
  const linkCol = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'part_instances' AND column_name = 'vendor_repair_dc_number'`
  );

  console.log('part_instances_status_check:', status.rows[0]?.def);
  console.log('part_movements_type_check:', mov.rows[0]?.def);
  console.log('item_domain default:', domain.rows[0]?.column_default);
  console.log('vendor_repair_dc_part_items exists:', partsTable.rows[0]?.n === 1);
  console.log('part_instances.vendor_repair_dc_number exists:', linkCol.rows[0]?.n === 1);
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration 189 failed:', err.message);
  process.exit(1);
});
