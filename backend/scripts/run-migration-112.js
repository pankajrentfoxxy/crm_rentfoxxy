require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/112_backfill_grn_serial_config.sql'),
    'utf8'
  );
  const client = await pool.connect();
  try {
    await client.query(sql);
    const sample = await client.query(`
      SELECT s.serial_number, s.inventory_asset_code,
             s.extra->>'brand' AS brand, s.extra->>'model' AS model,
             i.brand AS inv_brand, i.model AS inv_model
        FROM vendor_serial_numbers s
        LEFT JOIN inventory i ON i.machine_number = s.inventory_asset_code
       WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
       ORDER BY s.serial_id DESC
       LIMIT 5
    `);
    console.log('Migration 112 applied. Sample serials:', sample.rows);
    process.exit(0);
  } catch (e) {
    console.error('112 FAILED:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
