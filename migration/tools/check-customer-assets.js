require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, getErpPool, closePools } = require('../lib/db');

(async () => {
  const crm = getCrmPool();
  const erp = await getErpPool();

  const ascentErp = (
    await erp.query(
      `SELECT id, customer_name FROM customers WHERE customer_name LIKE '%ASCENT RISK%' LIMIT 3`
    )
  )[0];
  const ascentCrm = await crm.query(
    `SELECT customer_id, name FROM customers WHERE name ILIKE '%ASCENT RISK%' LIMIT 3`
  );

  console.log('ERP ASCENT:', ascentErp);
  console.log('CRM ASCENT:', ascentCrm.rows);

  const erpId = ascentErp?.[0]?.id;
  const crmId = ascentCrm.rows[0]?.customer_id;

  if (erpId) {
    const erpAssets = (
      await erp.query(
        `SELECT COUNT(*) AS cnt FROM customer_rent_devices
          WHERE customer_id = ? AND status IN ('pending','active')
            AND (rent_stop_date IS NULL OR rent_stop_date = '')`,
        [erpId]
      )
    )[0][0];
    const erpAssetsAll = (
      await erp.query(
        `SELECT COUNT(*) AS cnt FROM customer_rent_devices WHERE customer_id = ?`,
        [erpId]
      )
    )[0][0];
    const erpRentDevices = (
      await erp.query(
        `SELECT COUNT(*) AS cnt FROM rent_devices WHERE customer_id = ? AND status = 'active'`,
        [erpId]
      )
    )[0][0];
    console.log('ERP customer_rent_devices (active):', erpAssets.cnt);
    console.log('ERP customer_rent_devices (all):', erpAssetsAll.cnt);
    console.log('ERP rent_devices (active):', erpRentDevices.cnt);

    const erpDcDelivered = (
      await erp.query(
        `SELECT COUNT(*) AS cnt FROM delivery_challans
          WHERE customer_id = ? AND delivered_serial_numbers IS NOT NULL AND delivered_serial_numbers != '' AND delivered_serial_numbers != 'null'`,
        [erpId]
      )
    )[0][0];
    console.log('ERP DCs with delivered serials:', erpDcDelivered.cnt);
  }

  if (crmId) {
    const crmActive = await crm.query(
      `SELECT COUNT(*)::int c FROM vendor_serial_numbers
        WHERE current_customer_id = $1 AND deleted_at IS NULL
          AND inventory_status IN ('rented','on_demo','sold')`,
      [crmId]
    );
    const crmAnyCustomer = await crm.query(
      `SELECT COUNT(*)::int c FROM vendor_serial_numbers WHERE current_customer_id = $1 AND deleted_at IS NULL`,
      [crmId]
    );
    const crmViaSo = await crm.query(
      `SELECT COUNT(DISTINCT sos.serial_id)::int c
         FROM sales_order_serials sos
         JOIN sales_order_lines sol ON sol.sales_order_number = sos.sales_order_number
        WHERE sol.customer_id = $1 AND sos.status IN ('allocated','dispatched','delivered')`,
      [crmId]
    );
    const crmViaDc = await crm.query(
      `SELECT COUNT(*)::int c FROM delivery_challan_lines WHERE customer_id = $1`,
      [crmId]
    );
    console.log('CRM vendor_serial_numbers with current_customer_id (active):', crmActive.rows[0].c);
    console.log('CRM vendor_serial_numbers with current_customer_id (any):', crmAnyCustomer.rows[0].c);
    console.log('CRM sales_order_serials via SO lines:', crmViaSo.rows[0].c);
    console.log('CRM delivery_challan_lines:', crmViaDc.rows[0].c);
  }

  const global = await crm.query(
    `SELECT COUNT(*)::int total,
            COUNT(*) FILTER (WHERE current_customer_id IS NOT NULL)::int with_customer
       FROM vendor_serial_numbers WHERE deleted_at IS NULL`
  );
  console.log('CRM all serials:', global.rows[0]);

  await closePools();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
