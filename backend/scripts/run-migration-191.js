#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/191_bluedart_awb_pdf_path.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Running 191_bluedart_awb_pdf_path.sql …');
  await pool.query(sql);
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'delivery_challan_lines' AND column_name = 'bluedart_awb_pdf_path'`
  );
  console.log(r.rows.length ? 'Column bluedart_awb_pdf_path OK' : 'Column missing!');
  process.exit(r.rows.length ? 0 : 1);
}

main().catch((err) => {
  console.error('Migration 191 failed:', err.message);
  process.exit(1);
});
