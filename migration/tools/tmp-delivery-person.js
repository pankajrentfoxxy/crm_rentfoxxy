require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
(async () => {
  const c = getCrmPool();
  const r = await c.query(`
    SELECT delivery_person_id, COUNT(*)::int AS n
    FROM delivery_challan_lines
    WHERE delivery_person_id IS NOT NULL
    GROUP BY 1 ORDER BY n DESC LIMIT 25
  `);
  const bad = await c.query(`
    SELECT id, dc_number, delivery_person_id, ship_by
    FROM delivery_challan_lines
    WHERE delivery_person_id IS NOT NULL
      AND delivery_person_id::text !~ '^[0-9]+$'
    LIMIT 30
  `);
  console.log('top delivery_person_id', r.rows);
  console.log('non-numeric count', bad.rows.length, bad.rows.slice(0, 10));

  const activeTech = await c.query(`
    SELECT COUNT(*)::int AS n FROM delivery_technicians WHERE is_active = TRUE
  `);
  const allTech = await c.query(`SELECT COUNT(*)::int AS n FROM delivery_technicians`);
  const mappedMen = await c.query(`SELECT COUNT(*)::int AS n FROM erp_id_map WHERE entity = 'delivery_men'`);
  console.log('technicians active/all', activeTech.rows[0].n, allTech.rows[0].n, 'mapped', mappedMen.rows[0].n);
  await closePools();
})();
