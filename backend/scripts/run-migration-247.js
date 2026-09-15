/**
 * Run migration 247 — store DC e-way asset value.
 * Usage: node scripts/run-migration-247.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_NAME = '247_dc_eway_asset_value.sql';

async function backfillAssetFlags() {
  const {
    computeDcAssetValue,
    requiresOutboundEway,
    markDcEwayRequired,
  } = require('../services/saleDcComplianceService');
  const { getDeliveryChallanLines } = require('../services/salesManagementService');

  const open = await pool.query(
    `SELECT DISTINCT dc_number
       FROM delivery_challan_lines
      WHERE COALESCE(movement_type, 'outbound') = 'outbound'
        AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'delivered', 'rejected')
        AND COALESCE(eway_bill_number, '') = ''`
  );

  let flagged = 0;
  for (const row of open.rows) {
    try {
      const lines = await getDeliveryChallanLines(row.dc_number);
      if (!lines.length) continue;
      const asset = await computeDcAssetValue(row.dc_number, lines);
      if (requiresOutboundEway(lines[0], asset.total)) {
        await markDcEwayRequired(row.dc_number, true, asset.total);
        flagged += 1;
        console.log(`  flagged ${row.dc_number} (asset ₹${Number(asset.total).toLocaleString('en-IN')})`);
      }
    } catch (err) {
      console.warn(`  skip ${row.dc_number}: ${err.message}`);
    }
  }
  console.log(`Backfill: ${flagged} outbound DC(s) marked eway_required from asset value`);
}

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
    console.log('Migration 247 applied:', sqlPath);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  try {
    await backfillAssetFlags();
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
