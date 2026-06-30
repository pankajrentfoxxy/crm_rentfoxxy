#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '120_delivery_rejection_flow.sql'),
    'utf8'
  );
  await pool.query(sql);
  await pool.query(
    `INSERT INTO schema_migrations (name) VALUES ('120_delivery_rejection_flow.sql')
     ON CONFLICT (name) DO NOTHING`
  );

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'delivery_challan_lines'
        AND column_name IN (
          'rejected_at', 'rejected_by', 'rejection_source', 'rejection_remarks',
          'warehouse_return_otp', 'warehouse_return_otp_sent_at',
          'warehouse_return_otp_verified_at', 'warehouse_return_verified_by',
          'return_to_warehouse_at'
        )
      ORDER BY column_name`
  );
  const idx = await pool.query(
    `SELECT indexname FROM pg_indexes
      WHERE tablename = 'delivery_challan_lines' AND indexname = 'idx_dcl_rejected_at'`
  );
  console.log('Migration 120 applied.');
  console.log('Columns:', cols.rows.map((r) => r.column_name).join(', '));
  console.log('Index idx_dcl_rejected_at:', idx.rows.length ? 'yes' : 'missing');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
