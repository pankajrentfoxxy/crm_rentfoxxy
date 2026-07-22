/**
 * 040 — Sync delivery_challan_lines.delivery_person_id from ERP delivery_challans.
 * Clears invalid ERP values (by_courier, unknown ids) and remaps valid delivery_men → CRM technician_id.
 */
const { progress, writeLog } = require('../lib/logger');
const { getCrmId, parseJson } = require('../lib/helpers');

function parseOptionalInt(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function resolveCrmDeliveryPersonId(crm, erpDeliveryPersonId) {
  const erpId = parseOptionalInt(erpDeliveryPersonId);
  if (erpId == null) return null;
  const mapped = await getCrmId(crm, 'delivery_men', erpId);
  return mapped != null ? Number(mapped) : null;
}

module.exports = {
  id: '040',
  name: 'delivery_person_erp_sync',
  async run({ erp, crm, batchSize }) {
    const [rows] = await erp.query(
      `SELECT id, delivery_person_id FROM delivery_challans ORDER BY id`
    );
    const total = rows.length;
    let processed = 0;
    let updated = 0;
    let cleared = 0;

    for (const row of rows) {
      processed += 1;
      const crmLineId = await getCrmId(crm, 'delivery_challans', row.id);
      if (crmLineId == null) {
        if (processed % batchSize === 0 || processed === total) progress('delivery_person_sync', processed, total);
        continue;
      }

      const nextPersonId = await resolveCrmDeliveryPersonId(crm, row.delivery_person_id);
      const { rows: cur } = await crm.query(
        `SELECT delivery_person_id FROM delivery_challan_lines WHERE id = $1`,
        [crmLineId]
      );
      const prev = cur[0]?.delivery_person_id ?? null;
      if (Number(prev) === Number(nextPersonId) || (prev == null && nextPersonId == null)) {
        if (processed % batchSize === 0 || processed === total) progress('delivery_person_sync', processed, total);
        continue;
      }

      await crm.query(
        `UPDATE delivery_challan_lines SET delivery_person_id = $2, updated_at = NOW() WHERE id = $1`,
        [crmLineId, nextPersonId]
      );
      updated += 1;
      if (nextPersonId == null && prev != null) cleared += 1;

      if (processed % batchSize === 0 || processed === total) {
        progress('delivery_person_sync', processed, total);
      }
    }

    writeLog(
      'migration',
      `040 delivery_person ERP sync: updated=${updated} cleared=${cleared} total=${total}`
    );
    return updated;
  },
};
