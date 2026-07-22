/**
 * 038 — Re-parse Laravel JSON serial arrays on delivery_challan_lines from ERP.
 * Fixes empty pickuped/rejected/returned arrays caused by escaped dump JSON.
 */
const { progress, writeLog } = require('../lib/logger');
const { getCrmId, parseJson } = require('../lib/helpers');

function parseJsonArray(raw) {
  const parsed = parseJson(raw, null);
  if (Array.isArray(parsed)) return parsed;
  if (parsed != null) return [parsed];
  return [];
}

module.exports = {
  id: '038',
  name: 'dc_json_fields_resync',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `delivery_challans`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let updated = 0;
    let skipped = 0;

    const [rows] = await erp.query(
      `SELECT id, serial_number, delivered_serial_numbers, rejected_serial_numbers,
              returned_serial_numbers, pickuped_serial_numbers, old_pickuped_serial_numbers,
              old_rejected_serial_numbers
         FROM \`delivery_challans\`
        ORDER BY id`
    );

    for (const row of rows) {
      processed += 1;
      const crmLineId = await getCrmId(crm, 'delivery_challans', row.id);
      if (crmLineId == null) {
        skipped += 1;
        if (processed % batchSize === 0 || processed === total) progress('dc_json_resync', processed, total);
        continue;
      }

      // ERP Technician Bucket uses pickuped_serial_numbers only — do not merge old_pickuped.
      const pickup = parseJsonArray(row.pickuped_serial_numbers);
      const delivered = parseJsonArray(row.delivered_serial_numbers);
      const rejected = parseJsonArray(row.rejected_serial_numbers);
      const returned = parseJsonArray(row.returned_serial_numbers);
      const oldRejected = parseJsonArray(row.old_rejected_serial_numbers);

      const { rowCount } = await crm.query(
        `UPDATE delivery_challan_lines
            SET pickuped_serial_numbers = $2::jsonb,
                delivered_serial_numbers = $3::jsonb,
                rejected_serial_numbers = $4::jsonb,
                returned_serial_numbers = $5::jsonb,
                old_rejected_serial_numbers = $6::jsonb,
                updated_at = NOW()
          WHERE id = $1`,
        [
          crmLineId,
          JSON.stringify(pickup),
          JSON.stringify(delivered),
          JSON.stringify(rejected),
          JSON.stringify(returned),
          JSON.stringify(oldRejected),
        ]
      );
      if (rowCount > 0) updated += 1;

      if (processed % batchSize === 0 || processed === total) {
        progress('dc_json_resync', processed, total);
      }
    }

    writeLog('migration', `038 DC JSON resync: updated=${updated} skipped=${skipped} total=${total}`);
    return updated;
  },
};
