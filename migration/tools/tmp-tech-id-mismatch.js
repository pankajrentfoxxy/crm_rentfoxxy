require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
(async () => {
  const c = getCrmPool();
  const maps = await c.query(`
    SELECT erp_id, crm_id FROM erp_id_map WHERE entity = 'delivery_men' ORDER BY erp_id::int
  `);
  console.log('delivery_men maps', maps.rows);

  const mismatch = await c.query(`
    SELECT d.delivery_person_id AS erp_person_on_line,
           m.crm_id AS mapped_technician_id,
           dt.technician_id, dt.is_active
    FROM delivery_challan_lines d
    JOIN erp_id_map m ON m.entity = 'delivery_men' AND m.erp_id = d.delivery_person_id::text
    LEFT JOIN delivery_technicians dt ON dt.technician_id = m.crm_id::bigint
    WHERE d.delivery_person_id IS NOT NULL
      AND d.delivery_person_id::text <> m.crm_id
    LIMIT 20
  `);
  console.log('Lines where erp id on line != mapped crm technician_id:', mismatch.rowCount);
  console.log(mismatch.rows.slice(0, 10));

  const sample = await c.query(`
    SELECT COUNT(*)::int AS n
    FROM delivery_challan_lines d
    WHERE d.delivery_person_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM erp_id_map m
        WHERE m.entity = 'delivery_men' AND m.erp_id = d.delivery_person_id::text
      )
  `);
  console.log('Lines with erp delivery_person_id mapped', sample.rows[0].n);
  await closePools();
})();
