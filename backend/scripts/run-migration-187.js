#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/187_inventory_master_data_permission.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Running 187_inventory_master_data_permission.sql …');
  await pool.query(sql);
  const r = await pool.query(
    `SELECT role, can_view FROM role_permissions WHERE section = 'inventory_master_data' ORDER BY role`
  );
  console.log('Done. role grants:');
  r.rows.forEach((row) => console.log(`  ${row.role}: view=${row.can_view}`));
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration 187 failed:', err.message);
  process.exit(1);
});
