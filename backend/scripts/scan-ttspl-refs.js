#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');

const OLD = process.argv[2] || 'TTSPL7117';
const NEW = process.argv[3] || 'TTSPL6170';

async function countInTable(client, table, col, val) {
  try {
    const r = await client.query(
      `SELECT COUNT(*)::int AS c FROM ${table} WHERE ${col}::text ILIKE $1`,
      [val]
    );
    return r.rows[0]?.c ?? 0;
  } catch {
    return null;
  }
}

(async () => {
  const client = await pool.connect();
  try {
    const cols = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name ILIKE '%ttspl%' OR column_name ILIKE '%asset_code%'
             OR column_name = 'machine_number' OR column_name = 'serial_number')
      ORDER BY table_name, column_name`);

    console.log(`\n=== Scanning for ${OLD} and ${NEW} ===\n`);
    for (const val of [OLD, NEW]) {
      console.log(`--- ${val} ---`);
      for (const c of cols.rows) {
        const n = await countInTable(client, c.table_name, c.column_name, val);
        if (n) {
          const sample = await client.query(
            `SELECT * FROM ${c.table_name} WHERE ${c.column_name}::text ILIKE $1 LIMIT 3`,
            [val]
          );
          console.log(`  ${c.table_name}.${c.column_name}: ${n} row(s)`);
          sample.rows.forEach((row) => {
            const keys = Object.keys(row).slice(0, 6);
            const preview = keys.map((k) => `${k}=${JSON.stringify(row[k])}`).join(', ');
            console.log(`    -> ${preview}`);
          });
        }
      }
      // JSON in extra
      const jsonR = await client.query(`
        SELECT serial_id, serial_number, inventory_asset_code
        FROM vendor_serial_numbers
        WHERE extra::text ILIKE $1 AND deleted_at IS NULL`, [`%${val}%`]);
      if (jsonR.rows.length) {
        console.log(`  vendor_serial_numbers.extra (json): ${jsonR.rows.length} row(s)`);
        jsonR.rows.forEach((r) => console.log(`    -> serial_id=${r.serial_id} sn=${r.serial_number} code=${r.inventory_asset_code}`));
      }
    }

    // DC lines with pipe format serial|sn|ttspl
    const dcl = await client.query(`
      SELECT dc_number, serial_number, status
      FROM delivery_challan_lines
      WHERE serial_number::text ILIKE $1 OR serial_number::text ILIKE $2`,
      [`%${OLD}%`, `%${NEW}%`]);
    if (dcl.rows.length) {
      console.log('\n--- delivery_challan_lines (array serial_number) ---');
      dcl.rows.forEach((r) => console.log(`  ${r.dc_number} status=${r.status} serials=${JSON.stringify(r.serial_number)}`));
    }

    // inventory table machine_number
    const inv = await client.query(`
      SELECT inventory_id, machine_number, serial_number
      FROM inventory WHERE machine_number ILIKE $1 OR machine_number ILIKE $2`,
      [OLD, NEW]);
    if (inv.rows.length) {
      console.log('\n--- inventory ---');
      inv.rows.forEach((r) => console.log(`  id=${r.inventory_id} machine=${r.machine_number} sn=${r.serial_number}`));
    }
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
