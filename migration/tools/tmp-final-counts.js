require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');

function parseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      try {
        const p = JSON.parse(raw.replace(/\\"/g, '"'));
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    }
  }
  return [];
}

(async () => {
  const crm = getCrmPool();
  const r = await crm.query(`
    SELECT pickuped_serial_numbers
    FROM delivery_challan_lines
    WHERE COALESCE(movement_type, 'outbound') = 'outbound'
  `);
  const pairs = new Set();
  let rowsWithPickup = 0;
  for (const row of r.rows) {
    const combined = parseJsonArray(row.pickuped_serial_numbers);
    if (combined.length) rowsWithPickup += 1;
    for (const item of combined) {
      const parts = String(item).split('|');
      if (parts[1] && parts[2]) pairs.add(`${parts[1]}-${parts[2]}`);
    }
  }
  console.log('CRM pickup pairs (ERP return DC sidebar logic):', pairs.size);
  console.log('CRM rows with pickup json:', rowsWithPickup);

  const po = await crm.query('SELECT COUNT(*)::int c FROM vendor_purchase_orders WHERE deleted_at IS NULL');
  const so = await crm.query('SELECT COUNT(DISTINCT sales_order_number)::int c FROM sales_order_lines');
  const soLines = await crm.query("SELECT COUNT(*)::int c FROM erp_id_map WHERE entity='sales_orders'");
  const drP = await crm.query("SELECT COUNT(*)::int c FROM delivery_challan_lines WHERE COALESCE(movement_type,'outbound')='outbound' AND status='pending'");
  const drD = await crm.query("SELECT COUNT(DISTINCT dc_number)::int c FROM delivery_challan_lines WHERE COALESCE(movement_type,'outbound')='outbound' AND status='delivered'");
  console.log('PO', po.rows[0].c, 'SO distinct', so.rows[0].c, 'SO lines mapped', soLines.rows[0].c);
  console.log('DR pending rows', drP.rows[0].c, 'DR delivered distinct', drD.rows[0].c);
  await closePools();
})();
