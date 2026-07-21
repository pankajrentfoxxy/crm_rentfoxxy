/**
 * Run migration 155 — warehouse carret slots + QC2 inventory tag on production_assets.
 * Usage (from backend/): node scripts/run-migration-155.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_NAME = '155_warehouse_carret_qc2_tag.sql';

async function main() {
  const sqlPath = path.join(__dirname, '../migrations', MIGRATION_NAME);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING`,
      [MIGRATION_NAME]
    );
    await client.query('COMMIT');

    const check = await pool.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name = 'vendor_serial_numbers'
             AND column_name = 'warehouse_carret'
        ) AS has_warehouse_carret,
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name = 'vendor_serial_numbers'
             AND column_name = 'warehouse_carret_slot'
        ) AS has_warehouse_carret_slot,
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name = 'production_assets'
             AND column_name = 'inventory_tag'
        ) AS has_inventory_tag,
        EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE indexname = 'idx_vsn_warehouse_carret_slot'
        ) AS has_carret_slot_index
    `);

    console.log(`Migration 155 applied: ${sqlPath}`);
    console.log('Verification:', check.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
