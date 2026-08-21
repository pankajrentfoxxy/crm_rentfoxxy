/**
 * Apply Support v2 schema migrations 197–212 only.
 * Does not run run-all-migrations.js or dummy seeds.
 *
 * Usage (env must already point at the target DB):
 *   node scripts/run-support-v2-migrations.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATIONS = [
  '197_support_v2_rbac.sql',
  '198_support_v2_sequences.sql',
  '199_support_v2_taxonomy.sql',
  '200_support_v2_sla.sql',
  '201_support_v2_core.sql',
  '202_support_v2_groups.sql',
  '203_support_v2_billing_hooks.sql',
  '204_support_v2_saved_views.sql',
  '205_support_v2_ticket_flow.sql',
  '206_support_v2_wo_engine.sql',
  '207_support_v2_return_pickup.sql',
  '208_support_v2_replacement.sql',
  '209_support_v2_parts_unify.sql',
  '210_support_v2_identity.sql',
  '211_support_v2_notifications.sql',
  '212_support_v2_reports_cutover.sql',
  '213_support_v2_attendance.sql',
  '214_support_v2_flow_fix.sql',
  '215_support_v2_wo_logistics.sql',
  '216_support_v2_part_pricing.sql',
  '217_support_v2_charge_billing.sql',
  '218_support_v2_site_key.sql',
  '219_support_v2_tech_access.sql',
  '220_support_v2_wo_execution.sql',
  '221_support_v2_warehouse_receipt.sql',
  '222_support_v2_repair_loop.sql',
];

async function main() {
  const dir = path.join(__dirname, '../migrations');
  const client = await pool.connect();
  try {
    console.log(
      `Applying ${MIGRATIONS.length} support-v2 migrations to ${process.env.DB_NAME} @ ${process.env.DB_HOST}:${process.env.DB_PORT}`
    );
    for (const name of MIGRATIONS) {
      const already = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (already.rows.length) {
        console.log(`SKIP  ${name} (already in schema_migrations)`);
        continue;
      }
      const sqlPath = path.join(dir, name);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
          [name]
        );
        await client.query('COMMIT');
        console.log(`OK    ${name}`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`FAIL  ${name}`);
        throw e;
      }
    }
    console.log('Support v2 migrations 197–212 complete. Phase 12 has no SQL.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
