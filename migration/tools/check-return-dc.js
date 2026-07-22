require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');

(async () => {
  const crm = getCrmPool();
  const movement = await crm.query(
    `SELECT movement_type, COUNT(*)::int c FROM delivery_challan_lines GROUP BY movement_type`
  );
  console.log('CRM DC by movement:', movement.rows);
  const ret = await crm.query(
    `SELECT COUNT(*)::int c FROM delivery_challan_lines WHERE movement_type = 'return'`
  );
  console.log('CRM return DC lines:', ret.rows[0].c);
  const tickets = await crm.query(
    `SELECT COUNT(*)::int c FROM support_tickets
      WHERE return_dc_number IS NOT NULL AND TRIM(return_dc_number) <> ''`
  );
  console.log('CRM tickets with return_dc_number:', tickets.rows[0].c);
  const pickups = await crm.query(
    `SELECT COUNT(*)::int c FROM support_ticket_items WHERE item_type = 'pickup'`
  );
  console.log('CRM pickup items:', pickups.rows[0].c);
  const linked = await crm.query(
    `SELECT COUNT(*)::int c FROM support_ticket_items
      WHERE item_type = 'pickup' AND return_dc_number IS NOT NULL AND TRIM(return_dc_number) <> ''`
  );
  console.log('CRM pickup items with return_dc_number:', linked.rows[0].c);
  const sample = await crm.query(
    `SELECT rl.dc_number, rl.customer_name, rl.status, rl.support_ticket_id
       FROM delivery_challan_lines rl
      WHERE rl.movement_type = 'return'
      ORDER BY rl.id DESC LIMIT 3`
  );
  console.log('Sample return DCs:', sample.rows);
  await closePools();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
