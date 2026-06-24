/**
 * 025 — Backfill ERP serial_numbers.status2='replace' on CRM vendor_serial_numbers
 * Fixes Replaced Products list (inventory_status + old serial metadata).
 */
const { progress, writeLog } = require('../lib/logger');
const { getCrmId, str, parseJson } = require('../lib/helpers');

function oldSerialFromErp(dataoldSerialNumber) {
  const parsed = parseJson(dataoldSerialNumber, null);
  if (!parsed || typeof parsed !== 'object') return null;
  const v = parsed.oldSerial ?? parsed.old_serial_number ?? parsed.old_serial;
  return v != null && String(v).trim() !== '' ? String(v).trim() : null;
}

module.exports = {
  id: '025',
  name: 'replaced_products_backfill',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query(
      `SELECT COUNT(*) AS cnt FROM \`serial_numbers\`
        WHERE status2 = 'replace' OR status = 'replace'`
    );
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let updated = 0;
    let skipped = 0;

    const [rows] = await erp.query(
      `SELECT id, serial_number, unique_product_serial, status, status2, remark, dataoldSerialNumber
         FROM \`serial_numbers\`
        WHERE status2 = 'replace' OR status = 'replace'
        ORDER BY id`
    );

    for (const row of rows) {
      processed += 1;

      const crmSerialId = await getCrmId(crm, 'serial_numbers', row.id);
      if (crmSerialId == null) {
        skipped += 1;
        writeLog('migration', `025 skip ERP serial ${row.id}: not mapped in CRM`);
        if (processed % batchSize === 0 || processed === total) {
          progress('replaced_products_backfill', processed, total);
        }
        continue;
      }

      const { rows: existing } = await crm.query(
        `SELECT serial_id, extra FROM vendor_serial_numbers
          WHERE serial_id = $1 AND deleted_at IS NULL`,
        [crmSerialId]
      );
      if (!existing.length) {
        skipped += 1;
        if (processed % batchSize === 0 || processed === total) {
          progress('replaced_products_backfill', processed, total);
        }
        continue;
      }

      const extra = typeof existing[0].extra === 'object' && existing[0].extra
        ? { ...existing[0].extra }
        : parseJson(existing[0].extra, {}) || {};

      extra.status2 = 'replace';
      extra.inventory_status = 'replace';
      if (row.status) extra.status = row.status;

      const oldSerial = oldSerialFromErp(row.dataoldSerialNumber);
      if (oldSerial) extra.old_serial_number = oldSerial;

      const dataOld = parseJson(row.dataoldSerialNumber, null);
      if (dataOld != null) extra.dataoldSerialNumber = dataOld;

      const remark = str(row.remark, 5000, null);

      await crm.query(
        `UPDATE vendor_serial_numbers
            SET inventory_status = 'replace',
                remark = COALESCE($2, remark),
                extra = $3::jsonb,
                updated_at = NOW()
          WHERE serial_id = $1`,
        [crmSerialId, remark, JSON.stringify(extra)]
      );
      updated += 1;

      if (processed % batchSize === 0 || processed === total) {
        progress('replaced_products_backfill', processed, total);
      }
    }

    writeLog('migration', `025 complete: updated=${updated} skipped=${skipped} total=${total}`);
    return updated;
  },
};
