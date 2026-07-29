/**
 * Apply ONLY the safe, recent schema migrations (idempotent DDL + roles-catalog upsert).
 * Each runs in its own transaction: on failure it rolls back, logs, and continues
 * (it is NOT recorded). On success it is recorded in schema_migrations.
 *
 * Intentionally excludes seed/data/reassign scripts and old out-of-band migrations.
 * Usage: node scripts/run-safe-pending-migrations.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const ALLOW = [
  '171_seed_all_roles.sql',
  '173_part_instance_serial_number.sql',
  '175_dispatch_qc_alert_dismiss.sql',
  '176_ticket_generation_column.sql',
];

async function main() {
  const dir = path.join(__dirname, '../migrations');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of ALLOW) {
    const already = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1 LIMIT 1',
      [file]
    );
    if (already.rows.length) {
      skipped += 1;
      console.log(`SKIP (already recorded) ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    try {
      await pool.query('BEGIN');
      await pool.query(sql);
      await pool.query(
        'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [file]
      );
      await pool.query('COMMIT');
      applied += 1;
      console.log(`APPLIED ${file}`);
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => {});
      failed += 1;
      console.error(`FAILED (skipped, not recorded) ${file} -> ${error.message}`);
    }
  }

  console.log(`\nDONE applied=${applied} skipped=${skipped} failed=${failed}`);
}

main()
  .then(async () => { await pool.end(); process.exit(0); })
  .catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
