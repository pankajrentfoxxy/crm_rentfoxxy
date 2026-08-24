#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const FILE = '203_delivery_refusal_warehouse_receive.sql';
const EXPECTED_COLUMNS = [
  'warehouse_received_at',
  'warehouse_received_by',
  'warehouse_receiver_name',
  'warehouse_esign_url',
  'warehouse_receive_remarks',
];

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations', FILE), 'utf8');
  console.log(`Running ${FILE} …`);
  await pool.query(sql);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'delivery_challan_lines' AND column_name = ANY($1::text[])
      ORDER BY column_name`,
    [EXPECTED_COLUMNS]
  );
  const found = cols.rows.map((r) => r.column_name);
  const missing = EXPECTED_COLUMNS.filter((c) => !found.includes(c));

  const idx = await pool.query(
    `SELECT indexname FROM pg_indexes
      WHERE tablename = 'delivery_challan_lines'
        AND indexname IN ('idx_dcl_refused_awaiting_warehouse', 'idx_dcl_warehouse_received_at')
      ORDER BY indexname`
  );

  // Refused challans that predate this migration: still cancel-eligible through
  // return_to_warehouse_at, so nothing needs backfilling — just report them.
  const pending = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE return_to_warehouse_at IS NULL)::int AS awaiting_receipt,
            COUNT(*) FILTER (WHERE return_to_warehouse_at IS NOT NULL
                               AND warehouse_received_at IS NULL)::int AS legacy_otp_returned
       FROM delivery_challan_lines
      WHERE status = 'rejected'`
  );

  console.log('columns added:', found.join(', ') || '(none)');
  if (missing.length) console.log('MISSING columns:', missing.join(', '));
  console.log('indexes:', idx.rows.map((r) => r.indexname).join(', ') || '(none)');
  console.log('rejected lines awaiting warehouse receipt:', pending.rows[0].awaiting_receipt);
  console.log('rejected lines returned via legacy OTP (no e-sign):', pending.rows[0].legacy_otp_returned);
  console.log(missing.length ? 'Done WITH MISSING COLUMNS.' : 'Done.');
  process.exit(missing.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Migration 203 failed:', err.message);
  process.exit(1);
});
