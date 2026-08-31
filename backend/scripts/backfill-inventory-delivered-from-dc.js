#!/usr/bin/env node
/**
 * Backfill vendor_serial_numbers.delivered_at (and rent_start_date) from DC POD dates
 * when inventory was synced later with the wrong timestamp (e.g. bulk Jul-2026 correction).
 *
 *   node scripts/backfill-inventory-delivered-from-dc.js           # dry-run (date-only)
 *   node scripts/backfill-inventory-delivered-from-dc.js --commit  # apply date-only fixes
 *   node scripts/backfill-inventory-delivered-from-dc.js --commit --full-sync  # also status gaps
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { syncDeployedAssets, fetchDeploymentGaps } = require('../services/customerDeployedAssetsSyncService');
const { rentStartForSerial } = require('../services/deliveryDateService');
const { invalidateMasterDataCaches } = require('../services/masterDataCache');

const COMMIT = process.argv.includes('--commit');
const FULL_SYNC = process.argv.includes('--full-sync');

function isDateOnlyGap(row) {
  const target = inventorySM.deliveredStatusForType(row.quotation_type);
  return row.inventory_status === target
    && Number(row.current_customer_id) === Number(row.customer_id)
    && String(row.current_dc_number || '') === String(row.dc_number || '')
    && row.delivered_at;
}

async function applyDateCorrections(client, rows) {
  let updated = 0;
  for (const row of rows) {
    const rentStart = rentStartForSerial({
      dispatchMode: row.dispatch_mode || 'courier',
      dispatchedAt: row.inventory_dispatched_at,
      deliveredAt: row.delivered_at,
      inventoryStatus: row.inventory_status,
    });
    await client.query(
      `UPDATE vendor_serial_numbers
          SET delivered_at = $1,
              rent_start_date = COALESCE($2, rent_start_date),
              updated_at = NOW()
        WHERE serial_id = $3`,
      [
        row.delivered_at,
        rentStart ? rentStart.toISOString().slice(0, 10) : null,
        row.serial_id,
      ]
    );
    updated += 1;
  }
  return updated;
}

async function main() {
  const gaps = await fetchDeploymentGaps(pool);
  const dateGaps = gaps.filter(isDateOnlyGap);
  const statusGaps = gaps.filter((g) => !isDateOnlyGap(g));

  console.log('Deployment gaps found:', gaps.length);
  console.log('  date-only corrections:', dateGaps.length);
  console.log('  status/customer fixes:', statusGaps.length);
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN', FULL_SYNC ? '(+ full sync)' : '(date-only)');

  if (!COMMIT) {
    console.log('\nSample date corrections (first 10):');
    console.table(dateGaps.slice(0, 10).map((r) => ({
      serial: r.serial_number,
      dc: r.dc_number,
      inventory_date: r.inventory_delivered_at
        ? new Date(r.inventory_delivered_at).toISOString().slice(0, 10)
        : null,
      dc_pod_date: new Date(r.delivered_at).toISOString().slice(0, 10),
    })));
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dateUpdated = await applyDateCorrections(client, dateGaps);
    let syncOut = null;
    if (FULL_SYNC && statusGaps.length) {
      syncOut = await syncDeployedAssets(client, { actorName: 'backfill-inventory-delivered-from-dc' });
    }
    await client.query('COMMIT');
    await invalidateMasterDataCaches().catch(() => {});

    console.log('\nBackfill complete:');
    console.log('  date corrections applied:', dateUpdated);
    if (syncOut) {
      console.log('  full sync scanned:', syncOut.scanned);
      console.log('  full sync ok:', syncOut.synced);
      console.log('  full sync failed:', syncOut.failed.length);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
