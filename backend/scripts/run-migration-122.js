#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '122_out_for_repare_unified.sql'),
    'utf8'
  );
  await pool.query(sql);
  await pool.query(
    `INSERT INTO schema_migrations (name) VALUES ('122_out_for_repare_unified.sql')
     ON CONFLICT (name) DO NOTHING`
  );

  const r = await pool.query(
    `SELECT COUNT(*)::int AS c
       FROM vendor_serial_numbers vsn
      WHERE vsn.deleted_at IS NULL AND vsn.po_id IS NOT NULL
        AND COALESCE(NULLIF(TRIM(vsn.qc_status), ''), NULLIF(TRIM(vsn.extra->>'status'), ''), 'pending') = 'out_for_repare'`
  );
  console.log('Migration 122 applied.');
  console.log('Serials with qc_status out_for_repare:', r.rows[0]?.c ?? 0);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
