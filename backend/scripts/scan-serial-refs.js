#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');

const serialNumber = process.argv[2];
const oldTtspl = process.argv[3];

(async () => {
  const vsn = await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, extra, inventory_status, current_dc_number
       FROM vendor_serial_numbers WHERE serial_number ILIKE $1 AND deleted_at IS NULL`,
    [serialNumber]
  );
  console.log('vendor_serial_numbers:', vsn.rows[0]);
  const serialId = vsn.rows[0]?.serial_id;
  if (!serialId) process.exit(1);

  const checks = [
    ['sales_order_serials', `serial_id = ${serialId}`],
    ['customer_invoice_lines', `serial_id = ${serialId}`],
    ['inventory_status_transitions', `serial_id = ${serialId}`],
    ['ttspl_audit_log', `vendor_serial_id = ${serialId}`],
    ['tickets', `vendor_serial_id = ${serialId}`],
    ['support_ticket_items', `serial_number ILIKE '${serialNumber}'`],
    ['demo_agreements', `serial_id = ${serialId}`],
  ];
  for (const [table, where] of checks) {
    const r = await pool.query(`SELECT * FROM ${table} WHERE ${where} LIMIT 20`).catch(() => ({ rows: [] }));
    if (r.rows.length) console.log(`\n${table} (${r.rows.length}):`, JSON.stringify(r.rows, null, 2));
  }

  const dcl = await pool.query(
    `SELECT id, dc_number, serial_number FROM delivery_challan_lines
      WHERE serial_number::text ILIKE $1 OR serial_number::text ILIKE $2`,
    [`%${serialId}%`, `%${serialNumber}%`]
  );
  if (dcl.rows.length) console.log('\ndelivery_challan_lines:', dcl.rows);

  if (oldTtspl) {
    const cols = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema='public' AND column_name ILIKE '%ttspl%'`
    );
    console.log(`\n=== Rows with ${oldTtspl} linked to ${serialNumber} ===`);
    for (const c of cols.rows) {
      const r = await pool.query(
        `SELECT * FROM ${c.table_name}
          WHERE ${c.column_name}::text ILIKE $1
            AND row_to_json(${c.table_name}.*)::text ILIKE $2
          LIMIT 5`,
        [oldTtspl, `%${serialNumber}%`]
      ).catch(() => ({ rows: [] }));
      if (r.rows.length) console.log(`${c.table_name}.${c.column_name}:`, r.rows);
    }
  }

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
