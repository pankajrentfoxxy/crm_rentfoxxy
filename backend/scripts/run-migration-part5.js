/**
 * Part 5 migrations — 268 to 272.
 *
 *   268  GRN config verification link   (additive columns + backfill of a new column)
 *   269  inventory_status backfill      (rewrites ~27 rows of live data)
 *   270  stage seed integrity           (seeds Hold, fixes stage_order, adds UNIQUE)
 *   271  stage_transition_rules         (additive rows)
 *   272  QC rework escalation columns   (additive columns)
 *
 * Usage: node scripts/run-migration-part5.js [--dry-run]
 *
 * Staging shares the production database, so this IS a production run. It backs
 * up every row it will change BEFORE changing it, writes the backup to
 * backend/backups/, prints the before/after counts for the promotion note, and
 * rolls everything back on any error. --dry-run applies the whole set inside a
 * transaction and then rolls back, so the SQL can be proved without keeping it.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATIONS = [
  '268_grn_config_verification_link.sql',
  '269_grn_inventory_status_backfill.sql',
  '270_stage_seed_integrity.sql',
  '271_stage_transition_rules_complete.sql',
  '272_qc_rework_escalation.sql',
];

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const client = await pool.connect();
  try {
    // ── Pre-flight: the UNIQUE constraints in 270 fail loudly rather than
    // silently if live data still collides after the fixes above them. ──
    const stages = await client.query(
      `SELECT stage_id, stage_name, stage_order FROM stages ORDER BY stage_order, stage_id`
    );
    console.log('stages before:', stages.rows.map((r) => `${r.stage_order}:${r.stage_name}`).join(', '));

    // ── Backup: the rows 269 rewrites, and the stage table 270 renumbers. ──
    const backupDir = path.join(__dirname, '../backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');

    const nullStatus = await client.query(
      `SELECT serial_id,
              COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl_id,
              serial_number, inventory_status, status_changed_at, extra
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND spo_id IS NULL AND inventory_status IS NULL`
    );
    const rules = await client.query(`SELECT * FROM stage_transition_rules ORDER BY rule_id`);

    const backupPath = path.join(backupDir, `part5-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({
      taken_at: new Date().toISOString(),
      vendor_serial_numbers_null_inventory_status: nullStatus.rows,
      stages: stages.rows,
      stage_transition_rules: rules.rows,
    }, null, 2));
    console.log(`Backup (${nullStatus.rowCount} serials, ${stages.rowCount} stages, ${rules.rowCount} rules) -> ${backupPath}`);

    await client.query('BEGIN');
    for (const name of MIGRATIONS) {
      const sqlPath = path.join(__dirname, '../migrations', name);
      await client.query(fs.readFileSync(sqlPath, 'utf8'));
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
          [name]
        );
      }
      console.log('applied:', name);
    }

    const after = {
      linked: (await client.query(
        `SELECT COUNT(*)::int AS n FROM vendor_serial_numbers WHERE capture_token_id IS NOT NULL`
      )).rows[0].n,
      stillNull: (await client.query(
        `SELECT COUNT(*)::int AS n FROM vendor_serial_numbers
          WHERE deleted_at IS NULL AND spo_id IS NULL AND inventory_status IS NULL`
      )).rows[0].n,
      events: (await client.query(
        `SELECT COUNT(*)::int AS n FROM events WHERE event_type = 'inventory_status_backfilled'`
      )).rows[0].n,
      rules: (await client.query(`SELECT COUNT(*)::int AS n FROM stage_transition_rules`)).rows[0].n,
      hold: (await client.query(`SELECT COUNT(*)::int AS n FROM stages WHERE stage_name = 'Hold'`)).rows[0].n,
      stages: (await client.query(
        `SELECT stage_name, stage_order FROM stages ORDER BY stage_order`
      )).rows,
    };

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\n--- DRY RUN: everything above was rolled back ---');
    } else {
      await client.query('COMMIT');
      console.log('\n--- committed ---');
    }

    console.log('stages after                      :', after.stages.map((r) => `${r.stage_order}:${r.stage_name}`).join(', '));
    console.log('serials linked to a capture token :', after.linked);
    console.log('NULL inventory_status before      :', nullStatus.rowCount);
    console.log('NULL inventory_status after       :', after.stillNull);
    console.log('backfill events written           :', after.events);
    console.log('transition rules before / after   :', rules.rowCount, '/', after.rules);
    console.log("'Hold' stage rows                 :", after.hold);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
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
