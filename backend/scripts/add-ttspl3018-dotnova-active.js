#!/usr/bin/env node
/**
 * Backfill TTSPL3018 / 884BKC2 (Dell Latitude E7470) as an active rented asset
 * for Dotnova Aitech Private Limited (customer #152).
 *
 *   node scripts/add-ttspl3018-dotnova-active.js           (dry-run)
 *   node scripts/add-ttspl3018-dotnova-active.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { logTtsplEvent } = require('../services/ttsplAuditService');
const { getTotalAmountOfPurchaseOrder } = require('../utils/purchaseOrderGst');
const { allocatePurchaseOrderNumber } = require('../services/vendorNumberService');
const { freezeAcceptedReceiveConfig } = require('../services/grnReceivedConfigService');
const { logGrnReceive } = require('../services/ttsplAuditService');

const COMMIT = process.argv.includes('--commit');

const CUSTOMER_ID = 152;
const SERIAL_NUMBER = '884BKC2';
const TTSPL_ID = 'TTSPL3018';
const SO_NUMBER = 'SO/25-26/3018';
const DC_NUMBER = 'DC/25-26/3018';
const DISPATCH_AT = '2026-01-06T10:00:00+05:30';
const DELIVERED_AT = '2026-01-06T12:00:00+05:30';
const RENT_MONTHLY_RATE = 1149;

const SELF_VENDOR_NAME = 'RENTFOXXY SELF';
const PO_TYPE = 'direct_purchase';
const PO_STATE = 'Haryana';
const IMPORT_REMARK = 'Historical deployment backfill — TTSPL3018 Dotnova';

const SPECS = {
  brand: 'Dell',
  model: 'Dell Latitude E7470',
  model_name: 'Dell Latitude E7470',
  processor: 'I5',
  generation: '6TH',
  ram: '8',
  storage: '250 SSD',
  gpu: 'Integrated',
  screen_size: '14-inch',
};

async function resolveSelfVendor(client) {
  const { rows } = await client.query(
    `SELECT vendor_id, business_name, state
       FROM vendors
      WHERE deleted_at IS NULL
        AND TRIM(UPPER(business_name)) = TRIM(UPPER($1))
      LIMIT 1`,
    [SELF_VENDOR_NAME]
  );
  if (!rows.length) throw new Error(`Vendor "${SELF_VENDOR_NAME}" not found`);
  return rows[0];
}

async function loadExisting(client) {
  const { rows } = await client.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, current_customer_id
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (serial_number = $1 OR inventory_asset_code = $2)
      LIMIT 1`,
    [SERIAL_NUMBER, TTSPL_ID]
  );
  return rows[0] || null;
}

async function createSerialIntake(client, vendor) {
  const rentalStartDate = DELIVERED_AT.slice(0, 10);
  const line = {
    brand: SPECS.brand,
    model: SPECS.model,
    product_name: SPECS.model,
    processor: SPECS.processor,
    generation: SPECS.generation,
    ram: SPECS.ram,
    storage: SPECS.storage,
    gpu: SPECS.gpu,
    screen_size: SPECS.screen_size,
    unit_price: RENT_MONTHLY_RATE,
    price: RENT_MONTHLY_RATE,
    warranty_months: 12,
  };
  const subTotal = 0;
  const totalAmount = getTotalAmountOfPurchaseOrder(subTotal, true);

  const purchaseOrderNumber = await allocatePurchaseOrderNumber(client, null);
  const poIns = await client.query(
    `INSERT INTO vendor_purchase_orders (
       purchase_order_number, purchase_order_date, purchase_order_type, vendor_id,
       po_state, is_same_state, sub_total_amount, total_amount,
       line_items, assets_details, product_details_legacy_ids, remarks,
       status, invoice_created, approved_at, sent_to_vendor_at,
       status_updated_by_name, created_at, updated_at
     ) VALUES (
       $1, $2::date, $3, $4, $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11::jsonb, $12,
       'approved', TRUE, NOW(), NOW(),
       $13, NOW(), NOW()
     )
     RETURNING po_id, purchase_order_number`,
    [
      purchaseOrderNumber,
      rentalStartDate,
      PO_TYPE,
      vendor.vendor_id,
      PO_STATE,
      true,
      subTotal,
      totalAmount,
      JSON.stringify([line]),
      JSON.stringify({ intake: true, source: 'dotnova_active_backfill', lines: [line] }),
      JSON.stringify([]),
      IMPORT_REMARK,
      'add-ttspl3018-dotnova-active',
    ]
  );
  const poId = poIns.rows[0].po_id;

  const grnIns = await client.query(
    `INSERT INTO vendor_goods_received_notes (po_id, meta, bill_status, bill_files, created_at, updated_at)
     VALUES ($1, $2::jsonb, 'received', '[]'::jsonb, NOW(), NOW())
     RETURNING grn_id`,
    [
      poId,
      JSON.stringify({
        intake_source: 'dotnova_active_backfill',
        received_by: 'add-ttspl3018-dotnova-active',
        notes: IMPORT_REMARK,
      }),
    ]
  );
  const grnId = grnIns.rows[0].grn_id;

  const extra = {
    line_index: 0,
    rental_start_date: rentalStartDate,
    unique_product_serial: TTSPL_ID,
    intake_source: 'dotnova_active_backfill',
    ...SPECS,
  };

  const serialIns = await client.query(
    `INSERT INTO vendor_serial_numbers (
       po_id, grn_id, serial_number, inventory_asset_code, rental_start_date,
       qc_status, inventory_status, extra, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5::date,
       'passed', 'in_stock', $6::jsonb, NOW(), NOW()
     )
     RETURNING serial_id, serial_number, inventory_asset_code`,
    [poId, grnId, SERIAL_NUMBER, TTSPL_ID, rentalStartDate, JSON.stringify(extra)]
  );
  const serial = serialIns.rows[0];

  await freezeAcceptedReceiveConfig(client, {
    serialId: serial.serial_id,
    grnId,
    productDetailId: null,
    config: SPECS,
  });

  await logGrnReceive({
    ttsplId: TTSPL_ID,
    vendorSerialId: serial.serial_id,
    serialNumber: SERIAL_NUMBER,
    poLabel: purchaseOrderNumber,
    actorUserId: null,
    db: client,
  });

  return { ...serial, poId, grnId, purchaseOrderNumber };
}

async function deployToCustomer(client, serial, customer) {
  const customerName = customer.company_name || customer.name;
  const serialPipe = `${serial.serial_id}|${SERIAL_NUMBER}|${TTSPL_ID}`;
  const serialJson = JSON.stringify([serialPipe]);
  const rentStart = inventorySM.computeRentStart({
    dispatchMode: 'inhouse',
    dispatchedAt: DISPATCH_AT,
    deliveredAt: DELIVERED_AT,
  }).toISOString().slice(0, 10);

  const dupDc = await client.query(
    `SELECT 1 FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
    [DC_NUMBER]
  );
  if (dupDc.rows.length) throw new Error(`${DC_NUMBER} already exists`);

  const dupSo = await client.query(
    `SELECT 1 FROM sales_order_lines WHERE sales_order_number = $1 LIMIT 1`,
    [SO_NUMBER]
  );
  if (dupSo.rows.length) throw new Error(`${SO_NUMBER} already exists`);

  const lineRes = await client.query(
    `INSERT INTO sales_order_lines (
        sales_order_number, quotation_number, customer_id, customer_name, customer_email,
        customer_shipping_address, customer_billing_address, gst_number, supply_state,
        security_amount, shiping_charges, quotation_type, entity_code, security_type, branch,
        brand, model_name, processor, generation, ram, storage, gpu, screen_size,
        quantity, main_qty, rate, locking_period, remark, status, created_at, updated_at
     ) VALUES (
        $1,'N/A',$2,$3,$4,$5::jsonb,$6::jsonb,$7,'haryana',
        0,0,'rental','rentfoxxy','none','rentfoxxy',
        $8,$9,$10,$11,$12,$13,$14,$15,
        1,1,$16,0,$17,'completed',$18::timestamptz,$18::timestamptz
     ) RETURNING id`,
    [
      SO_NUMBER,
      CUSTOMER_ID,
      customerName,
      customer.email,
      JSON.stringify({ address: customer.shipping_address || '' }),
      JSON.stringify({ address: customer.billing_address || '' }),
      customer.gst_no,
      SPECS.brand,
      SPECS.model_name,
      SPECS.processor,
      SPECS.generation,
      SPECS.ram,
      SPECS.storage,
      SPECS.gpu,
      SPECS.screen_size,
      RENT_MONTHLY_RATE,
      'Historical deployment backfill — Dotnova TTSPL3018',
      DISPATCH_AT,
    ]
  );
  const lineId = lineRes.rows[0].id;

  await client.query(
    `INSERT INTO sales_order_serials (
        sales_order_number, line_id, serial_id, ttspl_id, serial_number,
        qc_status, status, dc_number, entity_code, delivery_address, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,'passed','dispatched',$6,'rentfoxxy',$7::jsonb,$8::timestamptz,$8::timestamptz)`,
    [
      SO_NUMBER,
      lineId,
      serial.serial_id,
      TTSPL_ID,
      SERIAL_NUMBER,
      DC_NUMBER,
      JSON.stringify({ address: customer.shipping_address || '' }),
      DISPATCH_AT,
    ]
  );

  await client.query(
    `INSERT INTO delivery_challan_lines (
        dc_number, sales_order_number, quotation_number, customer_id, customer_name, email,
        gst_number, supply_state, security_amount, shiping_charges, branch, entity_code,
        customer_billing_address, customer_shipping_address,
        brand, model_name, quantity, main_qty, serial_number,
        ship_by, dispatch_mode,
        movement_type, status, pre_dispatch_qc_passed,
        delivered_serial_numbers, dispatched_at, delivered_at, delivery_completed_at,
        date_and_time, remarks, created_at, updated_at
     ) VALUES (
        $1,'N/A',$2,$3,$4,$5,'haryana',0,0,'rentfoxxy','rentfoxxy',
        $6::jsonb,$7::jsonb,
        $8,$9,1,1,$10::jsonb,
        'by_hand','inhouse',
        'outbound','delivered',true,
        $11::jsonb,$12::timestamptz,$13::timestamptz,$13::timestamptz,
        $13::timestamptz,$14,$12::timestamptz,$13::timestamptz
     )`,
    [
      DC_NUMBER,
      SO_NUMBER,
      CUSTOMER_ID,
      customerName,
      customer.email,
      customer.gst_no,
      JSON.stringify({ address: customer.billing_address || '' }),
      JSON.stringify({ address: customer.shipping_address || '' }),
      SPECS.brand,
      SPECS.model_name,
      serialJson,
      JSON.stringify([serialPipe]),
      DISPATCH_AT,
      DELIVERED_AT,
      'Historical deployment backfill — Dotnova TTSPL3018',
    ]
  );

  await inventorySM.markDelivered(client, serial.serial_id, {
    quotationType: 'rental',
    dcNumber: DC_NUMBER,
    customerId: CUSTOMER_ID,
    entityCode: 'rentfoxxy',
    dispatchMode: 'inhouse',
    dispatchedAt: DISPATCH_AT,
    deliveredAt: DELIVERED_AT,
    rentMonthlyRate: RENT_MONTHLY_RATE,
    actorUserId: null,
    actorName: 'add-ttspl3018-dotnova-active',
  });

  await client.query(
    `UPDATE vendor_serial_numbers
        SET dispatched_at = $2::timestamptz,
            delivered_at = $3::timestamptz,
            rent_start_date = $4::date,
            rent_monthly_rate = $5,
            status_changed_at = $3::timestamptz,
            qc_status = 'passed',
            extra = COALESCE(extra, '{}'::jsonb) || $6::jsonb,
            updated_at = NOW()
      WHERE serial_id = $1`,
    [
      serial.serial_id,
      DISPATCH_AT,
      DELIVERED_AT,
      rentStart,
      RENT_MONTHLY_RATE,
      JSON.stringify(SPECS),
    ]
  );

  await logTtsplEvent({
    ttsplId: TTSPL_ID,
    vendorSerialId: serial.serial_id,
    eventType: 'historical_deployment_backfill',
    description: `Deployed ${TTSPL_ID} to ${customerName} on ${DC_NUMBER}`,
    metadata: {
      dc_number: DC_NUMBER,
      customer_id: CUSTOMER_ID,
      rent_monthly_rate: RENT_MONTHLY_RATE,
      delivered_at: DELIVERED_AT,
    },
    actorName: 'add-ttspl3018-dotnova-active',
    db: client,
  });

  return { dcNumber: DC_NUMBER, rentStart };
}

async function main() {
  const client = await pool.connect();
  try {
    const customerRes = await client.query(
      `SELECT customer_id, name, company_name, email, gst_no, billing_address, shipping_address
         FROM customers WHERE customer_id = $1`,
      [CUSTOMER_ID]
    );
    if (!customerRes.rows.length) throw new Error(`Customer #${CUSTOMER_ID} not found`);
    const customer = customerRes.rows[0];

    const existing = await loadExisting(client);
    if (existing?.current_customer_id === CUSTOMER_ID && existing.inventory_status === 'rented') {
      console.log('Already deployed:', existing);
      return;
    }
    if (existing && existing.current_customer_id && Number(existing.current_customer_id) !== CUSTOMER_ID) {
      throw new Error(
        `${TTSPL_ID} exists and is linked to customer #${existing.current_customer_id} (${existing.inventory_status})`
      );
    }

    console.log('Customer:', customer.company_name, `(#${customer.customer_id})`);
    console.log('Serial:', SERIAL_NUMBER, TTSPL_ID);
    console.log('Specs:', SPECS);
    console.log('Rate:', RENT_MONTHLY_RATE);
    console.log('DC:', DC_NUMBER);
    console.log('Dispatch/Delivery:', DISPATCH_AT, '->', DELIVERED_AT);
    console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

    if (!COMMIT) {
      console.log('\nDry-run OK — pass --commit to apply.');
      return;
    }

    await client.query('BEGIN');

    let serial = existing;
    if (!serial) {
      const vendor = await resolveSelfVendor(client);
      serial = await createSerialIntake(client, vendor);
      console.log('Created serial intake:', serial.serial_id, serial.purchaseOrderNumber);
    }

    const out = await deployToCustomer(client, serial, customer);
    await client.query('COMMIT');

    const verify = await pool.query(
      `SELECT serial_id, serial_number, inventory_asset_code, inventory_status,
              current_customer_id, current_dc_number, rent_monthly_rate, rent_start_date, delivered_at
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [serial.serial_id]
    );
    const activeCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM vendor_serial_numbers
        WHERE current_customer_id = $1 AND inventory_status = 'rented' AND deleted_at IS NULL`,
      [CUSTOMER_ID]
    );

    console.log('\nDone.');
    console.log('Serial state:', verify.rows[0]);
    console.log('DC:', out.dcNumber, 'rent start:', out.rentStart);
    console.log('Dotnova active rented count:', activeCount.rows[0].n);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Failed:', e.message || e);
  process.exit(1);
});
