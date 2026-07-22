/**
 * One-time normalize: legacy ERP status `out_for_repare` → canonical `in_repair`
 * via inventoryStateMachine.transitionAsset (audited).
 *
 *   node scripts/normalize-out-for-repare-to-in-repair.js
 *   node scripts/normalize-out-for-repare-to-in-repair.js --dry-run
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');
const { transitionAsset, STATUS } = require('../services/inventoryStateMachine');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code, inventory_status,
              qc_status, extra
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (
            inventory_status = 'out_for_repare'
            OR (
              inventory_status IS NULL
              AND (
                COALESCE(NULLIF(TRIM(qc_status), ''), '') = 'out_for_repare'
                OR COALESCE(NULLIF(TRIM(extra->>'action_status'), ''), '') = 'out_for_repare'
              )
            )
          )
        ORDER BY serial_id ASC`
    );
    console.log(`Found ${rows.length} legacy out_for_repare inventory row(s)${dryRun ? ' (dry-run)' : ''}`);

    // Also clean stale extra/qc labels on units that are NOT currently out for repair
    // (e.g. sold with leftover action_status) without changing inventory_status.
    const staleExtra = await client.query(
      `SELECT serial_id, inventory_asset_code, inventory_status
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND inventory_status IS DISTINCT FROM 'out_for_repare'
          AND inventory_status IS DISTINCT FROM 'in_repair'
          AND (
            COALESCE(NULLIF(TRIM(qc_status), ''), '') = 'out_for_repare'
            OR COALESCE(NULLIF(TRIM(extra->>'action_status'), ''), '') = 'out_for_repare'
            OR COALESCE(NULLIF(TRIM(extra->>'status'), ''), '') = 'out_for_repare'
          )
        ORDER BY serial_id ASC`
    );
    console.log(`Found ${staleExtra.rows.length} row(s) with stale out_for_repare labels (extra/qc only)`);

    let updated = 0;
    for (const row of rows) {
      if (dryRun) {
        console.log(`  would normalize serial_id=${row.serial_id} ${row.inventory_asset_code || row.serial_number} status=${row.inventory_status}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        if (row.inventory_status !== STATUS.IN_REPAIR) {
          await transitionAsset(client, {
            serialId: row.serial_id,
            toStatus: STATUS.IN_REPAIR,
            reason: 'Normalize legacy out_for_repare → in_repair',
            actorName: 'normalize-out-for-repare-script',
          });
        }
        await client.query(
          `UPDATE vendor_serial_numbers SET
              qc_status = CASE
                WHEN COALESCE(NULLIF(TRIM(qc_status), ''), '') IN ('out_for_repare', 'out_for_repair')
                  THEN 'out_for_repair'
                ELSE qc_status
              END,
              extra = COALESCE(extra, '{}'::jsonb)
                || jsonb_build_object(
                  'action_status', 'in_repair',
                  'status', CASE
                    WHEN COALESCE(NULLIF(TRIM(extra->>'status'), ''), '') = 'out_for_repare'
                      THEN 'in_repair'
                    ELSE COALESCE(extra->>'status', 'in_repair')
                  END,
                  'normalized_from_out_for_repare_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                ),
              updated_at = NOW()
            WHERE serial_id = $1`,
          [row.serial_id]
        );
        await client.query('COMMIT');
        updated += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  FAIL serial_id=${row.serial_id}: ${err.message}`);
      }
    }

    let cleaned = 0;
    for (const row of staleExtra.rows) {
      if (dryRun) {
        console.log(`  would clean labels serial_id=${row.serial_id} keep status=${row.inventory_status}`);
        continue;
      }
      await client.query(
        `UPDATE vendor_serial_numbers SET
            qc_status = CASE
              WHEN COALESCE(NULLIF(TRIM(qc_status), ''), '') = 'out_for_repare' THEN 'pending'
              ELSE qc_status
            END,
            extra = (COALESCE(extra, '{}'::jsonb)
              - 'action_status'
              || CASE
                   WHEN COALESCE(NULLIF(TRIM(extra->>'status'), ''), '') = 'out_for_repare'
                     THEN jsonb_build_object('status', COALESCE(inventory_status, 'pending'))
                   ELSE '{}'::jsonb
                 END
              || jsonb_build_object(
                   'cleared_stale_out_for_repare_at',
                   to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                 )
            ),
            updated_at = NOW()
          WHERE serial_id = $1`,
        [row.serial_id]
      );
      cleaned += 1;
    }
    console.log(
      dryRun
        ? 'Dry-run complete.'
        : `Normalized ${updated}/${rows.length} inventory row(s); cleaned ${cleaned} stale label row(s).`
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
