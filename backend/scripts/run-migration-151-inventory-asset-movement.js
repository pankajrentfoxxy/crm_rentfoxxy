#!/usr/bin/env node
/** Run migration 151 — Inventory asset movement permission section. */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const file = path.join(__dirname, '../migrations/151_inventory_asset_movement_permission.sql');
  const sql = fs.readFileSync(file, 'utf8');
  await pool.query(sql);
  console.log('Migration 151 applied: inventory_asset_movement permission');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
