#!/usr/bin/env node
/**
 * Surface migrated ERP Technician Bucket DCs on /sales-pipeline/technician-bucket.
 *
 * The sales-pipeline "Technician Delivery Bucket" page reads delivery-flow
 * status=inhouse, which filters:
 *     dispatch_mode = 'inhouse' AND status IN ('in_transit','reached')
 *
 * The migrated ERP bucket DCs land as status='pending' (assigned to a technician
 * but not yet dispatched in CRM terms), so they don't match that filter. ERP
 * semantics for a `pending` DC with a delivery_man assigned == "out with the
 * technician" == CRM `in_transit`. This script remaps ONLY those rows.
 *
 * Data-only change. Fully reversible: original statuses are stored in
 * technician_bucket_status_backup before any update.
 *
 *   node tools/migrate-technician-bucket-inhouse.js            # apply
 *   node tools/migrate-technician-bucket-inhouse.js --rollback # undo
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');

const BACKUP_TABLE = 'technician_bucket_status_backup';

// ERP-bucket pending in-house DC lines assigned to a valid (mapped) technician.
const TARGET_WHERE = `
  d.status = 'pending'
  AND d.dispatch_mode = 'inhouse'
  AND EXISTS (
    SELECT 1 FROM delivery_technicians dt
     WHERE dt.technician_id = d.delivery_person_id
  )
`;

async function ensureBackupTable(crm) {
  await crm.query(`
    CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
      line_id      BIGINT PRIMARY KEY,
      dc_number    TEXT,
      old_status   TEXT,
      new_status   TEXT,
      changed_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function apply(crm) {
  await ensureBackupTable(crm);
  await crm.query('BEGIN');
  try {
    // Snapshot originals (idempotent: don't overwrite an existing backup row).
    const ins = await crm.query(
      `INSERT INTO ${BACKUP_TABLE} (line_id, dc_number, old_status, new_status)
       SELECT d.id, d.dc_number, d.status, 'in_transit'
         FROM delivery_challan_lines d
        WHERE ${TARGET_WHERE}
       ON CONFLICT (line_id) DO NOTHING`,
    );

    const upd = await crm.query(
      `UPDATE delivery_challan_lines d
          SET status = 'in_transit', updated_at = NOW()
        WHERE ${TARGET_WHERE}`,
    );

    await crm.query('COMMIT');

    const dcs = await crm.query(
      `SELECT COUNT(DISTINCT dc_number)::int AS c FROM ${BACKUP_TABLE}`,
    );
    console.log(`Backed up : ${ins.rowCount} line(s)`);
    console.log(`Updated   : ${upd.rowCount} line(s) -> status='in_transit'`);
    console.log(`DCs total : ${dcs.rows[0].c} distinct DC(s) now on the bucket page`);
  } catch (e) {
    await crm.query('ROLLBACK');
    throw e;
  }
}

async function rollback(crm) {
  const exists = await crm.query(
    `SELECT to_regclass($1) AS t`, [BACKUP_TABLE],
  );
  if (!exists.rows[0].t) {
    console.log('No backup table found — nothing to roll back.');
    return;
  }
  await crm.query('BEGIN');
  try {
    const upd = await crm.query(
      `UPDATE delivery_challan_lines d
          SET status = b.old_status, updated_at = NOW()
         FROM ${BACKUP_TABLE} b
        WHERE d.id = b.line_id
          AND d.status = b.new_status`,
    );
    await crm.query(`DELETE FROM ${BACKUP_TABLE}`);
    await crm.query('COMMIT');
    console.log(`Reverted  : ${upd.rowCount} line(s) back to original status`);
  } catch (e) {
    await crm.query('ROLLBACK');
    throw e;
  }
}

(async () => {
  const crm = getCrmPool();
  const isRollback = process.argv.includes('--rollback');
  try {
    if (isRollback) await rollback(crm);
    else await apply(crm);

    const after = await crm.query(
      `SELECT COUNT(DISTINCT dc_number)::int AS c
         FROM delivery_challan_lines
        WHERE dispatch_mode = 'inhouse' AND status IN ('in_transit','reached')`,
    );
    console.log(`\nVerify    : delivery-flow status=inhouse now returns ${after.rows[0].c} DC(s)`);
  } finally {
    await closePools();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
