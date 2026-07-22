/**
 * 037 — Resync delivery_challan_lines.status from ERP delivery_challans.
 * Ensures Delivery Register in_transit/delivered counts match ERP row-level logic.
 */
const { progress, writeLog } = require('../lib/logger');
const { getCrmId, str } = require('../lib/helpers');

function mapDcStatus(raw) {
  const s = str(raw, 20, 'pending').toLowerCase();
  const allowed = ['pending', 'processing', 'shipped', 'in_transit', 'reached', 'delivered', 'rejected', 'cancelled'];
  if (allowed.includes(s)) return s;
  if (s === 'returned') return 'delivered';
  return 'pending';
}

module.exports = {
  id: '037',
  name: 'dc_status_resync',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `delivery_challans`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let updated = 0;
    let skipped = 0;

    const [rows] = await erp.query(
      `SELECT id, status FROM \`delivery_challans\` ORDER BY id`
    );

    for (const row of rows) {
      processed += 1;
      const crmLineId = await getCrmId(crm, 'delivery_challans', row.id);
      if (crmLineId == null) {
        skipped += 1;
        if (processed % batchSize === 0 || processed === total) progress('dc_status_resync', processed, total);
        continue;
      }

      const nextStatus = mapDcStatus(row.status);
      const { rowCount } = await crm.query(
        `UPDATE delivery_challan_lines
            SET status = $2, updated_at = NOW()
          WHERE id = $1 AND COALESCE(status, '') <> $2`,
        [crmLineId, nextStatus]
      );
      if (rowCount > 0) updated += 1;

      if (processed % batchSize === 0 || processed === total) {
        progress('dc_status_resync', processed, total);
      }
    }

    writeLog('migration', `037 DC status resync: updated=${updated} skipped=${skipped} total=${total}`);
    return updated;
  },
};
