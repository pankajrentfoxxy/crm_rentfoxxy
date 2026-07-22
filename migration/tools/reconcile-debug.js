#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
const { createErpSource } = require('../lib/erpSource');

async function main() {
  const crm = getCrmPool();
  const erp = await createErpSource();

  const poDup = await crm.query(`
    SELECT crm_id, array_agg(erp_id ORDER BY erp_id) AS erp_ids, COUNT(*)::int AS n
    FROM erp_id_map WHERE entity = 'purchase_orders'
    GROUP BY crm_id HAVING COUNT(*) > 1
  `);
  console.log('PO duplicate maps:', poDup.rows);

  const poCnt = await crm.query('SELECT COUNT(*)::int AS c FROM vendor_purchase_orders WHERE deleted_at IS NULL');
  const mapCnt = await crm.query("SELECT COUNT(*)::int AS c FROM erp_id_map WHERE entity = 'purchase_orders'");
  console.log('CRM PO', poCnt.rows[0].c, 'mapped', mapCnt.rows[0].c);

  for (const id of [6, 2879]) {
    const r = await crm.query(
      `SELECT s.serial_id, s.qc_status, s.inventory_status, s.extra->>'status' AS ex, m.erp_id
       FROM vendor_serial_numbers s
       JOIN erp_id_map m ON m.entity = 'serial_numbers' AND m.crm_id::bigint = s.serial_id
       WHERE m.erp_id = $1`,
      [String(id)]
    );
    const erpRows = erp.getTableRows
      ? erp.getTableRows('serial_numbers').filter((r) => String(r.id) === String(id))
      : (await erp.query('SELECT id, status, status2 FROM serial_numbers WHERE id = ?', [id]))[0];
    console.log('ERP serial', id, erpRows[0], 'CRM', r.rows[0]);
  }

  const extraPassed = await crm.query(`
    SELECT s.serial_id, m.erp_id, s.qc_status, s.inventory_status
    FROM vendor_serial_numbers s
    JOIN erp_id_map m ON m.entity = 'serial_numbers' AND m.crm_id::bigint = s.serial_id
    INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
    WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
      AND COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') = 'passed'
      AND COALESCE(NULLIF(TRIM(s.inventory_status), ''), 'in_stock') <> ALL(
        ARRAY['reserved','in_transit','rented','on_demo','sold','returned','scrapped']::text[])
  `);
  const erpPassed = new Set(
    (await erp.query("SELECT id FROM serial_numbers WHERE status = 'passed'"))[0].map((r) => String(r.id))
  );
  const extras = extraPassed.rows.filter((r) => !erpPassed.has(String(r.erp_id)));
  console.log('Extra passed in CRM (not passed in ERP):', extras.length, extras.slice(0, 15));

  for (const id of [4648, 4649, 4650]) {
    const [rows] = await erp.query(
      'SELECT id, customer_id, sales_order_number FROM sales_orders WHERE id = ?',
      [id]
    );
    const row = rows[0];
    const cust = await crm.query(
      "SELECT crm_id FROM erp_id_map WHERE entity = 'customers' AND erp_id = $1",
      [String(row?.customer_id)]
    );
    console.log('SO line', id, row, 'customer mapped', cust.rows[0]?.crm_id ?? 'NO');
  }

  const missingDc = [];
  const [allDc] = await erp.query('SELECT id FROM delivery_challans ORDER BY id');
  const mapped = await crm.query("SELECT erp_id FROM erp_id_map WHERE entity = 'delivery_challans'");
  const mappedSet = new Set(mapped.rows.map((r) => r.erp_id));
  for (const r of allDc) {
    if (!mappedSet.has(String(r.id))) missingDc.push(r.id);
  }
  console.log('Missing DC count', missingDc.length, 'ids', missingDc);

  for (const id of missingDc.slice(0, 5)) {
    const [rows] = await erp.query(
      'SELECT id, customer_id, dc_number FROM delivery_challans WHERE id = ?',
      [id]
    );
    const row = rows[0];
    const cust = await crm.query(
      "SELECT crm_id FROM erp_id_map WHERE entity = 'customers' AND erp_id = $1",
      [String(row?.customer_id)]
    );
    console.log('DC', id, row?.dc_number, 'customer', row?.customer_id, 'mapped', cust.rows[0]?.crm_id ?? 'NO');
  }

  await erp.close();
  await closePools();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
