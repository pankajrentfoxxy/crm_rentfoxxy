#!/usr/bin/env node
/**
 * Sync active floor-ticket laptops into QC Process inventory (qc_status = pending).
 * Skips tickets at Dispatch QC stage.
 *
 * Usage:
 *   node scripts/sync-floor-tickets-to-qc-process.js [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { parseExtra } = require('../services/qcManagementService');

const OUTPUT_CSV = path.join(__dirname, '../data/floor_tickets_synced_to_qc_process.csv');
const DISPATCH_QC_STAGE = 'Dispatch QC';

const CANDIDATE_SQL = `
  SELECT tk.ticket_id,
         tk.serial_number AS ticket_serial,
         tk.status AS ticket_status,
         s.stage_name,
         vsn.serial_id,
         vsn.serial_number,
         vsn.inventory_asset_code,
         vsn.qc_status,
         vsn.inventory_status,
         vsn.extra,
         COALESCE(
           NULLIF(TRIM(vsn.qc_status), ''),
           NULLIF(TRIM(vsn.extra->>'status'), ''),
           'pending'
         ) AS effective_qc
    FROM tickets tk
    INNER JOIN stages s ON s.stage_id = tk.current_stage_id
    INNER JOIN vendor_serial_numbers vsn
            ON vsn.serial_id = tk.vendor_serial_id
           AND vsn.deleted_at IS NULL
   WHERE tk.status IN ('in_progress', 'on_hold')
     AND vsn.po_id IS NOT NULL
     AND s.stage_name <> $1
     AND COALESCE(vsn.extra->>'awaiting_inventory_receive', 'false') <> 'true'
     AND NOT (
       COALESCE(NULLIF(TRIM(vsn.qc_status), ''), NULLIF(TRIM(vsn.extra->>'status'), ''), 'pending') = 'pending'
       OR COALESCE(NULLIF(TRIM(vsn.qc_status), ''), NULLIF(TRIM(vsn.extra->>'status'), ''), 'pending') = 'failed'
     )
   ORDER BY tk.ticket_id ASC
`;

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildUpdatedExtra(existingExtra) {
  const extra = { ...parseExtra(existingExtra) };
  extra.status = 'pending';
  extra.action_status = 'pending';
  extra.came_from = extra.came_from || 'floor_ticket_qc_process_sync';
  delete extra.status2;
  delete extra.dispatch_qc_failed_at;
  return extra;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const client = await pool.connect();

  const summary = {
    dryRun,
    candidates: 0,
    updated: 0,
    skippedDispatchQc: 0,
    rows: [],
  };

  try {
    const { rows: dispatchSkipped } = await client.query(
      `SELECT COUNT(*)::int AS total
         FROM tickets tk
         INNER JOIN stages s ON s.stage_id = tk.current_stage_id
         INNER JOIN vendor_serial_numbers vsn
                 ON vsn.serial_id = tk.vendor_serial_id
                AND vsn.deleted_at IS NULL
        WHERE tk.status IN ('in_progress', 'on_hold')
          AND vsn.po_id IS NOT NULL
          AND s.stage_name = $1
          AND NOT (
            COALESCE(NULLIF(TRIM(vsn.qc_status), ''), NULLIF(TRIM(vsn.extra->>'status'), ''), 'pending') = 'pending'
            OR COALESCE(NULLIF(TRIM(vsn.qc_status), ''), NULLIF(TRIM(vsn.extra->>'status'), ''), 'pending') = 'failed'
          )`,
      [DISPATCH_QC_STAGE]
    );
    summary.skippedDispatchQc = dispatchSkipped[0]?.total || 0;

    const { rows: candidates } = await client.query(CANDIDATE_SQL, [DISPATCH_QC_STAGE]);
    summary.candidates = candidates.length;

    if (!dryRun && candidates.length) {
      await client.query('BEGIN');
    }

    for (const row of candidates) {
      const nextExtra = buildUpdatedExtra(row.extra);

      if (!dryRun) {
        await client.query(
          `UPDATE vendor_serial_numbers
              SET qc_status = 'pending',
                  inventory_status = 'in_stock',
                  extra = $1::jsonb,
                  updated_at = NOW()
            WHERE serial_id = $2`,
          [JSON.stringify(nextExtra), row.serial_id]
        );
      }

      summary.updated += 1;
      summary.rows.push({
        ticket_id: row.ticket_id,
        stage_name: row.stage_name,
        serial_id: row.serial_id,
        ttspl: row.inventory_asset_code,
        serial_number: row.serial_number,
        from_qc_status: row.effective_qc,
        from_inventory_status: row.inventory_status,
      });
    }

    if (!dryRun && candidates.length) {
      await client.query('COMMIT');
    }
  } catch (err) {
    if (!dryRun) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr.message);
      }
    }
    throw err;
  } finally {
    client.release();
  }

  try {
    const { invalidateInventoryListCachesFireAndForget } = require('../services/inventoryListCache');
    if (!dryRun) invalidateInventoryListCachesFireAndForget();
  } catch {
    // optional
  }

  const header = [
    'Ticket ID',
    'Stage',
    'Serial ID',
    'TTSPL',
    'Serial Number',
    'Previous QC Status',
    'Previous Inventory Status',
  ].join(',');
  const body = summary.rows.map((row) => [
    csvEscape(row.ticket_id),
    csvEscape(row.stage_name),
    csvEscape(row.serial_id),
    csvEscape(row.ttspl),
    csvEscape(row.serial_number),
    csvEscape(row.from_qc_status),
    csvEscape(row.from_inventory_status),
  ].join(',')).join('\n');
  fs.writeFileSync(OUTPUT_CSV, `${header}\n${body}${body ? '\n' : ''}`, 'utf8');

  await pool.end();

  console.log('\n=== Floor Tickets → QC Process Sync ===');
  console.log(`Mode:                    ${dryRun ? 'DRY RUN' : 'APPLIED'}`);
  console.log(`Updated to QC Process:   ${summary.updated}`);
  console.log(`Skipped (Dispatch QC):   ${summary.skippedDispatchQc}`);
  console.log(`Output CSV:              ${OUTPUT_CSV}`);

  if (summary.rows.length) {
    console.log('\nUpdated laptops:');
    summary.rows.forEach((row) => {
      console.log(
        `  #${row.ticket_id} ${row.stage_name} | ${row.ttspl || '-'} | ${row.serial_number} | ${row.from_qc_status} → pending`
      );
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
