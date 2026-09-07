#!/usr/bin/env node
/**
 * Remove timeline noise from the warehouse-receive backfill:
 * - Delete backfill audit + transition rows (logged at run time, not esign date)
 * - Restore returned_at / status_changed_at to warehouse e-sign date
 * - Restore delivery_challan_lines.updated_at so TTSPL History stops showing fake
 *   "DC marked delivered" entries on the backfill run date
 *
 * Usage:
 *   node scripts/cleanup-rdc-backfill-timeline-noise.js
 *   node scripts/cleanup-rdc-backfill-timeline-noise.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');

const COMMIT = process.argv.includes('--commit');
const BACKFILL_ACTOR = 'backfill-rdc-warehouse-received-esign-date';

async function main() {
  const targets = await pool.query(
    `SELECT ist.serial_id,
            ist.ttspl_id,
            ist.reason,
            sti.warehouse_esign_at,
            sti.return_dc_number AS rdc_number,
            dcl.delivered_at,
            dcl.created_at AS dcl_created_at,
            dcl.updated_at AS dcl_updated_at
       FROM inventory_status_transitions ist
       JOIN support_ticket_items sti
         ON sti.item_type = 'pickup'
        AND sti.return_dc_number IS NOT NULL
        AND UPPER(COALESCE(sti.ttspl_id, '')) = UPPER(COALESCE(ist.ttspl_id, ''))
        AND ist.reason LIKE '%' || sti.return_dc_number || '%'
       JOIN delivery_challan_lines dcl
         ON dcl.dc_number = sti.return_dc_number
        AND dcl.movement_type = 'return'
      WHERE ist.reason ILIKE 'Warehouse receive backfill via %'
      ORDER BY ist.ttspl_id`
  );

  const auditPreview = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM ttspl_audit_log WHERE actor_name = $1`,
    [BACKFILL_ACTOR]
  );
  const transPreview = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM inventory_status_transitions
      WHERE reason ILIKE 'Warehouse receive backfill via %'`
  );

  console.log(JSON.stringify({
    dry_run: !COMMIT,
    serial_rows: targets.rows.length,
    audit_rows_to_delete: auditPreview.rows[0].cnt,
    transition_rows_to_delete: transPreview.rows[0].cnt,
    sample: targets.rows.slice(0, 5),
  }, null, 2));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of targets.rows) {
      const esignAt = row.warehouse_esign_at;
      if (!esignAt) continue;
      if (COMMIT) {
        const rentEndDate = esignAt.toISOString().slice(0, 10);
        await client.query(
          `UPDATE vendor_serial_numbers SET
              returned_at = $2,
              status_changed_at = $2,
              rent_end_date = COALESCE(rent_end_date, $3::date),
              updated_at = NOW()
           WHERE serial_id = $1`,
          [row.serial_id, esignAt, rentEndDate]
        );
      }
    }

    const rdcs = [...new Set(targets.rows.map((r) => r.rdc_number).filter(Boolean))];
    for (const rdc of rdcs) {
      const row = targets.rows.find((r) => r.rdc_number === rdc);
      const restoreAt = row?.delivered_at || row?.dcl_created_at;
      if (!restoreAt) continue;
      if (COMMIT) {
        await client.query(
          `UPDATE delivery_challan_lines SET
              updated_at = $2
           WHERE dc_number = $1
             AND movement_type = 'return'
             AND updated_at > COALESCE(delivered_at, created_at) + interval '1 hour'`,
          [rdc, restoreAt]
        );
      }
    }

    if (COMMIT) {
      await client.query(
        `DELETE FROM ttspl_audit_log WHERE actor_name = $1`,
        [BACKFILL_ACTOR]
      );
      await client.query(
        `DELETE FROM inventory_status_transitions
          WHERE reason ILIKE 'Warehouse receive backfill via %'`
      );
    }

    if (!COMMIT) {
      await client.query('ROLLBACK');
      console.log('\nDry-run — re-run with --commit to apply.');
    } else {
      await client.query('COMMIT');
      console.log('\nCommitted cleanup.');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
