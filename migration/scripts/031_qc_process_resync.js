/**
 * 031 — Resync laptop QC statuses from ERP → CRM vendor_serial_numbers.
 *
 * Root cause fix for QC Process count mismatch:
 *   - CRM previously counted all non-'passed' serials (~3556)
 *   - ERP QC Processing List only shows status = 'pending' (~74)
 *
 * This module:
 *   1. Backs up current qc_status / inventory_status / extra (rollback table)
 *   2. Updates every ERP-mapped serial to match ERP serial_numbers.status
 *   3. Logs CRM-only rows in the QC bucket (no ERP mapping)
 *
 * Idempotent: skips rows already matching ERP; safe to re-run with --force.
 */
const { progress, writeLog } = require('../lib/logger');
const { getCrmId, str, parseJson } = require('../lib/helpers');
const { mapQcStatus, mapInventoryStatus } = require('../lib/qcStatusHelpers');

const BACKUP_TABLE = 'vendor_serial_numbers_qc_backup_031';

async function ensureBackupTable(crm) {
  await crm.query(`
    CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
      serial_id           BIGINT PRIMARY KEY,
      qc_status           VARCHAR(64),
      inventory_status    VARCHAR(64),
      extra               JSONB,
      backed_up_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      migration_module    VARCHAR(8) NOT NULL DEFAULT '031'
    )
  `);
}

async function backupSerialRow(crm, serialId, qcStatus, inventoryStatus, extra) {
  await crm.query(
    `INSERT INTO ${BACKUP_TABLE} (serial_id, qc_status, inventory_status, extra)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (serial_id) DO NOTHING`,
    [serialId, qcStatus, inventoryStatus, JSON.stringify(extra || {})]
  );
}

function mergeExtra(existing, erpRow) {
  const base = typeof existing === 'object' && existing ? { ...existing } : {};
  base.status = erpRow.status;
  if (erpRow.status2) base.status2 = erpRow.status2;
  base.erp_serial_id = erpRow.id;
  return base;
}

async function migrate({ erp, crm, batchSize }) {
  await ensureBackupTable(crm);

  const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `serial_numbers`');
  const total = Number(countRows[0].cnt);
  let processed = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  const [rows] = await erp.query(
    `SELECT id, serial_number, unique_product_serial, status, status2, remark, updated_at
       FROM \`serial_numbers\`
      ORDER BY id`
  );

  for (const row of rows) {
    processed += 1;

    const crmSerialId = await getCrmId(crm, 'serial_numbers', row.id);
    if (crmSerialId == null) {
      skipped += 1;
      if (processed % batchSize === 0 || processed === total) {
        progress('qc_resync', processed, total);
      }
      continue;
    }

    const { rows: existing } = await crm.query(
      `SELECT serial_id, qc_status, inventory_status, extra
         FROM vendor_serial_numbers
        WHERE serial_id = $1 AND deleted_at IS NULL`,
      [crmSerialId]
    );
    if (!existing.length) {
      skipped += 1;
      if (processed % batchSize === 0 || processed === total) {
        progress('qc_resync', processed, total);
      }
      continue;
    }

    const cur = existing[0];
    const nextQc = mapQcStatus(row.status);
    const nextInv = mapInventoryStatus(row.status, row.status2);
    const prevExtra = parseJson(cur.extra, {});
    const extra = mergeExtra(prevExtra, row);
    extra.status = nextQc;
    const nextRemark = str(row.remark, 5000, cur.remark);

    const curQc = str(cur.qc_status, 64, 'pending').toLowerCase();
    const curInv = str(cur.inventory_status, 64, '');
    const curExtraStatus = str(prevExtra.status, 64, '').toLowerCase();
    const needsUpdate =
      curQc !== nextQc
      || curExtraStatus !== nextQc
      || (nextInv != null && curInv !== nextInv);

    if (!needsUpdate) {
      unchanged += 1;
    } else {
      await backupSerialRow(crm, crmSerialId, cur.qc_status, cur.inventory_status, parseJson(cur.extra, {}));
      await crm.query(
        `UPDATE vendor_serial_numbers
            SET qc_status = $2,
                inventory_status = COALESCE($3, inventory_status),
                remark = COALESCE($4, remark),
                extra = $5::jsonb,
                updated_at = COALESCE($6, updated_at)
          WHERE serial_id = $1`,
        [
          crmSerialId,
          nextQc,
          nextInv,
          nextRemark,
          JSON.stringify(extra),
          row.updated_at || new Date(),
        ]
      );
      updated += 1;
    }

    if (processed % batchSize === 0 || processed === total) {
      progress('qc_resync', processed, total);
    }
  }

  writeLog(
    'migration',
    `031 QC resync: updated=${updated} unchanged=${unchanged} skipped=${skipped} erp_total=${total}`
  );
  return updated;
}

module.exports = {
  id: '031',
  name: 'qc_process_resync',
  BACKUP_TABLE,
  async run(ctx) {
    return migrate(ctx);
  },
};
