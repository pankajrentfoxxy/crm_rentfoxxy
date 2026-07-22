/**
 * 039 — Remap delivery_challan_lines.delivery_person_id from ERP delivery_men.id
 *         to CRM delivery_technicians.technician_id (erp_id_map entity=delivery_men).
 */
const { writeLog } = require('../lib/logger');

module.exports = {
  id: '039',
  name: 'delivery_person_remap',
  async run({ crm }) {
    const { rowCount } = await crm.query(`
      UPDATE delivery_challan_lines d
         SET delivery_person_id = m.crm_id::bigint,
             updated_at = NOW()
        FROM erp_id_map m
       WHERE m.entity = 'delivery_men'
         AND m.erp_id::text = d.delivery_person_id::text
         AND d.delivery_person_id IS NOT NULL
         AND d.delivery_person_id <> m.crm_id::bigint
    `);
    writeLog('migration', `039 delivery_person remap: updated=${rowCount} rows`);
    return rowCount;
  },
};
