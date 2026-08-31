#!/usr/bin/env node
/**
 * Backdated PO + sale for Lenovo Thinkpad T14 (PF2PSZ81 / TTSPL6191)
 * so Support can raise a repair pickup for RRA Project Management (#95).
 *
 *   node scripts/add-ttspl6191-rra-backlog.js           (dry-run)
 *   node scripts/add-ttspl6191-rra-backlog.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { logTtsplEvent, logGrnReceive } = require('../services/ttsplAuditService');
const { getTotalAmountOfPurchaseOrder } = require('../utils/purchaseOrderGst');
const { allocatePurchaseOrderNumber } = require('../services/vendorNumberService');
const { insertProductDetailsForPo, buildAssetsDetailsFromLines } = require('../services/purchaseOrderProductDetailsService');
const { freezeAcceptedReceiveConfig } = require('../services/grnReceivedConfigService');
const { allocatePartAssetCodes } = require('../services/partIdService');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('../services/customerDeployedAssets');

const COMMIT = process.argv.includes('--commit');

const VENDOR_ID = 94;
const CUSTOMER_ID = 95;
const SERIAL_NUMBER = 'PF2PSZ81';
const TTSPL_ID = 'TTSPL6191';
const SPARE_SERIAL_ID = 8045;
const PO_NUMBER_PREFERRED = 'PO-BACKLOG';
const SO_NUMBER = 'SO/25-26/3019';
const DC_NUMBER = 'DC/25-26/3019';
const PO_DATE = '2025-11-25';
const GRN_AT = '2025-11-25T14:00:00+05:30';
const SO_AT = '2026-01-16T11:00:00+05:30';
const DISPATCH_AT = '2026-01-19T12:00:00+05:30';
const DELIVERED_AT = '2026-01-19T16:00:00+05:30';
const UNIT_PRICE = 20000;
const SALE_RATE = 20000;
const IMPORT_REMARK = 'Historical backlog — TTSPL6191 / PF2PSZ81 for repair pickup (RRA #95)';

const SPECS = {
  brand: 'Lenovo',
  model: 'Thinkpad T14',
  model_name: 'Thinkpad T14',
  processor: 'I5',
  generation: '10TH',
  ram: '16',
  storage: '512 SSD',
  gpu: 'Integrated',
  screen_size: '14-inch',
};

const SHIP_ADDRESS = {
  name: 'Umesh',
  phone: '9871077924',
  address: '203 ABW Tower, MG Road',
  city: 'Gurgaon',
  state: 'Haryana',
  pincode: '122002',
  country: 'India',
  zip_code: '122002',
};

async function freeConflictingSpareCode(client) {
  const spare = await client.query(
    `SELECT serial_id, serial_number, inventory_asset_code, extra, spo_id, inventory_status
       FROM vendor_serial_numbers
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [SPARE_SERIAL_ID]
  );
  if (!spare.rows.length) return { skipped: true, reason: 'spare_missing' };
  const row = spare.rows[0];
  if (row.inventory_asset_code !== TTSPL_ID) {
    return { skipped: true, reason: 'already_freed', current: row.inventory_asset_code };
  }

  const [prtCode] = await allocatePartAssetCodes(client, 'Legacy spare', 1);
  const extra = {
    ...(row.extra && typeof row.extra === 'object' ? row.extra : {}),
    previous_inventory_asset_code: TTSPL_ID,
    freed_for: 'ttspl6191_rra_backlog',
  };
  await client.query(
    `UPDATE vendor_serial_numbers
        SET inventory_asset_code = $2,
            extra = $3::jsonb,
            updated_at = NOW()
      WHERE serial_id = $1`,
    [SPARE_SERIAL_ID, prtCode, JSON.stringify(extra)]
  );
  await logTtsplEvent({
    ttsplId: TTSPL_ID,
    vendorSerialId: SPARE_SERIAL_ID,
    eventType: 'asset_code_reassigned',
    description: `Freed ${TTSPL_ID} from unused spare ${row.serial_number}; spare is now ${prtCode}`,
    metadata: { spare_serial_id: SPARE_SERIAL_ID, new_code: prtCode },
    actorName: 'add-ttspl6191-rra-backlog',
    db: client,
  });
  return { freed: true, from: TTSPL_ID, to: prtCode, spareSerial: row.serial_number };
}

async function createPoGrnSerial(client, vendor) {
  const line = {
    brand: SPECS.brand,
    model: SPECS.model,
    model_name: SPECS.model_name,
    processor: SPECS.processor,
    generation: SPECS.generation,
    ram: SPECS.ram,
    storage: SPECS.storage,
    gpu: SPECS.gpu,
    screen_size: SPECS.screen_size,
    quantity: 1,
    rate: UNIT_PRICE,
    unit_price: UNIT_PRICE,
    price: UNIT_PRICE,
    warranty_months: 12,
    remarks: IMPORT_REMARK,
  };
  const subTotal = UNIT_PRICE;
  const isSameState = false;
  const totalAmount = getTotalAmountOfPurchaseOrder(subTotal, isSameState);
  const purchaseOrderNumber = await allocatePurchaseOrderNumber(client, PO_NUMBER_PREFERRED);

  const poIns = await client.query(
    `INSERT INTO vendor_purchase_orders (
       purchase_order_number, purchase_order_date, purchase_order_type, vendor_id,
       po_state, is_same_state, sub_total_amount, total_amount,
       line_items, assets_details, product_details_legacy_ids, remarks,
       status, invoice_created, approved_at, sent_to_vendor_at,
       status_updated_by_name, created_at, updated_at
     ) VALUES (
       $1, $2::date, 'direct_purchase', $3, $4, $5, $6, $7,
       $8::jsonb, $9::jsonb, '[]'::jsonb, $10,
       'completed', TRUE, $11::timestamptz, $11::timestamptz,
       $12, $11::timestamptz, $11::timestamptz
     )
     RETURNING po_id, purchase_order_number`,
    [
      purchaseOrderNumber,
      PO_DATE,
      VENDOR_ID,
      vendor.state || 'MH',
      isSameState,
      subTotal,
      totalAmount,
      JSON.stringify([line]),
      JSON.stringify(buildAssetsDetailsFromLines([line])),
      IMPORT_REMARK,
      GRN_AT,
      'add-ttspl6191-rra-backlog',
    ]
  );
  const poId = poIns.rows[0].po_id;

  const { insertedIds } = await insertProductDetailsForPo(client, poId, [line], 'direct_purchase');
  const productDetailId = insertedIds[0] || null;
  if (productDetailId) {
    await client.query(
      `UPDATE vendor_purchase_orders
          SET product_details_legacy_ids = $2::jsonb, updated_at = $3::timestamptz
        WHERE po_id = $1`,
      [poId, JSON.stringify([productDetailId]), GRN_AT]
    );
  }

  const grnIns = await client.query(
    `INSERT INTO vendor_goods_received_notes (po_id, meta, bill_status, bill_files, created_at, updated_at)
     VALUES ($1, $2::jsonb, 'received', '[]'::jsonb, $3::timestamptz, $3::timestamptz)
     RETURNING grn_id`,
    [
      poId,
      JSON.stringify({
        backlog: true,
        received_at: PO_DATE,
        received_by: 'add-ttspl6191-rra-backlog',
        notes: IMPORT_REMARK,
      }),
      GRN_AT,
    ]
  );
  const grnId = grnIns.rows[0].grn_id;

  const extra = {
    line_index: 0,
    rental_start_date: PO_DATE,
    unique_product_serial: TTSPL_ID,
    ttspl_id: TTSPL_ID,
    intake_source: 'rra_backlog',
    inventory_tag: 'sale',
    product_detail_id: productDetailId ? String(productDetailId) : undefined,
    ...SPECS,
  };

  const serialIns = await client.query(
    `INSERT INTO vendor_serial_numbers (
       po_id, grn_id, serial_number, inventory_asset_code, rental_start_date,
       qc_status, inventory_status, extra, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5::date,
       'passed', 'in_stock', $6::jsonb, $7::timestamptz, $7::timestamptz
     )
     RETURNING serial_id, serial_number, inventory_asset_code`,
    [poId, grnId, SERIAL_NUMBER, TTSPL_ID, PO_DATE, JSON.stringify(extra), GRN_AT]
  );
  const serial = serialIns.rows[0];

  await freezeAcceptedReceiveConfig(client, {
    serialId: serial.serial_id,
    grnId,
    productDetailId,
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

  return {
    ...serial,
    poId,
    grnId,
    purchaseOrderNumber,
    productDetailId,
    subTotal,
    totalAmount,
  };
}

async function deploySale(client, serial, customer) {
  const customerName = customer.company_name || customer.name;
  const serialPipe = `${serial.serial_id}|${SERIAL_NUMBER}|${TTSPL_ID}`;
  const serialJson = JSON.stringify([serialPipe]);
  const billingAddress = {
    name: customerName,
    address: customer.billing_address || customer.address || SHIP_ADDRESS.address,
    city: customer.billing_city || SHIP_ADDRESS.city,
    state: customer.billing_state || SHIP_ADDRESS.state,
    pincode: customer.billing_pincode || SHIP_ADDRESS.pincode,
    phone: customer.phone || SHIP_ADDRESS.phone,
  };

  const lineRes = await client.query(
    `INSERT INTO sales_order_lines (
        sales_order_number, quotation_number, customer_id, customer_name, customer_email,
        customer_mobile, customer_shipping_address, customer_billing_address, gst_number, supply_state,
        security_amount, shiping_charges, quotation_type, entity_code, security_type, branch,
        brand, model_name, processor, generation, ram, storage, gpu, screen_size,
        quantity, main_qty, rate, locking_period, remark, status, hsn_code,
        created_at, updated_at
     ) VALUES (
        $1,'N/A',$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,'haryana',
        0,0,'sale','gorefurbo','none','gorefurbo',
        $9,$10,$11,$12,$13,$14,$15,$16,
        1,1,$17,0,$18,'completed','847130',
        $19::timestamptz,$19::timestamptz
     ) RETURNING id`,
    [
      SO_NUMBER,
      CUSTOMER_ID,
      customerName,
      customer.email,
      customer.phone || SHIP_ADDRESS.phone,
      JSON.stringify(SHIP_ADDRESS),
      JSON.stringify(billingAddress),
      customer.gst_no,
      SPECS.brand,
      SPECS.model_name,
      SPECS.processor,
      SPECS.generation,
      SPECS.ram,
      SPECS.storage,
      SPECS.gpu,
      SPECS.screen_size,
      SALE_RATE,
      IMPORT_REMARK,
      SO_AT,
    ]
  );
  const lineId = lineRes.rows[0].id;

  await client.query(
    `INSERT INTO sales_order_serials (
        sales_order_number, line_id, serial_id, ttspl_id, serial_number,
        qc_status, status, dc_number, entity_code, delivery_address, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,'passed','dispatched',$6,'gorefurbo',$7::jsonb,$8::timestamptz,$9::timestamptz)`,
    [
      SO_NUMBER,
      lineId,
      serial.serial_id,
      TTSPL_ID,
      SERIAL_NUMBER,
      DC_NUMBER,
      JSON.stringify(SHIP_ADDRESS),
      SO_AT,
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
        $1,$2,'N/A',$3,$4,$5,$6,'haryana',0,0,'gorefurbo','gorefurbo',
        $7::jsonb,$8::jsonb,
        $9,$10,1,1,$11::jsonb,
        'by_porter','porter',
        'outbound','delivered',true,
        $12::jsonb,$13::timestamptz,$14::timestamptz,$14::timestamptz,
        $14::timestamptz,$15,$13::timestamptz,$14::timestamptz
     )`,
    [
      DC_NUMBER,
      SO_NUMBER,
      CUSTOMER_ID,
      customerName,
      customer.email,
      customer.gst_no,
      JSON.stringify(billingAddress),
      JSON.stringify(SHIP_ADDRESS),
      SPECS.brand,
      SPECS.model_name,
      serialJson,
      JSON.stringify([serialPipe]),
      DISPATCH_AT,
      DELIVERED_AT,
      IMPORT_REMARK,
    ]
  );

  await inventorySM.markDispatched(client, serial.serial_id, {
    dcNumber: DC_NUMBER,
    customerId: CUSTOMER_ID,
    entityCode: 'gorefurbo',
    dispatchMode: 'porter',
    actorName: 'add-ttspl6191-rra-backlog',
  });

  await inventorySM.markDelivered(client, serial.serial_id, {
    quotationType: 'sale',
    dcNumber: DC_NUMBER,
    customerId: CUSTOMER_ID,
    entityCode: 'gorefurbo',
    dispatchMode: 'porter',
    dispatchedAt: DISPATCH_AT,
    deliveredAt: DELIVERED_AT,
    rentMonthlyRate: SALE_RATE,
    actorName: 'add-ttspl6191-rra-backlog',
  });

  await client.query(
    `UPDATE vendor_serial_numbers
        SET dispatched_at = $2::timestamptz,
            delivered_at = $3::timestamptz,
            rent_start_date = NULL,
            rent_monthly_rate = $4,
            dispatch_mode = 'porter',
            current_customer_id = $5,
            current_dc_number = $6,
            current_entity = 'gorefurbo',
            qc_status = 'passed',
            extra = COALESCE(extra, '{}'::jsonb) || $7::jsonb,
            updated_at = $3::timestamptz
      WHERE serial_id = $1`,
    [
      serial.serial_id,
      DISPATCH_AT,
      DELIVERED_AT,
      SALE_RATE,
      CUSTOMER_ID,
      DC_NUMBER,
      JSON.stringify({ ...SPECS, inventory_tag: 'sale', backlog: true }),
    ]
  );

  await logTtsplEvent({
    ttsplId: TTSPL_ID,
    vendorSerialId: serial.serial_id,
    eventType: 'customer_deployment_backfill',
    description: `Sold ${TTSPL_ID} to ${customerName} on ${DC_NUMBER} (Porter, backlog)`,
    metadata: {
      dc_number: DC_NUMBER,
      sales_order_number: SO_NUMBER,
      customer_id: CUSTOMER_ID,
      sale_rate: SALE_RATE,
      delivered_at: DELIVERED_AT,
      dispatch_mode: 'porter',
    },
    actorName: 'add-ttspl6191-rra-backlog',
    db: client,
  });
}

async function main() {
  const client = await pool.connect();
  try {
    const vendorRes = await client.query(
      `SELECT vendor_id, business_name, state FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`,
      [VENDOR_ID]
    );
    if (!vendorRes.rows.length) throw new Error(`Vendor #${VENDOR_ID} not found`);
    const vendor = vendorRes.rows[0];

    const customerRes = await client.query(
      `SELECT customer_id, name, company_name, email, phone, gst_no,
              billing_address, billing_city, billing_state, billing_pincode, address
         FROM customers WHERE customer_id = $1`,
      [CUSTOMER_ID]
    );
    if (!customerRes.rows.length) throw new Error(`Customer #${CUSTOMER_ID} not found`);
    const customer = customerRes.rows[0];

    const existingLaptop = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, current_customer_id, po_id
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (serial_number = $1 OR (inventory_asset_code = $2 AND COALESCE(extra->>'part_type','') <> 'spare'))
        LIMIT 1`,
      [SERIAL_NUMBER, TTSPL_ID]
    );

    const spare = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code, extra->>'part_type' AS part_type
         FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL`,
      [SPARE_SERIAL_ID]
    );

    const dupPo = await client.query(
      `SELECT po_id, purchase_order_number FROM vendor_purchase_orders
        WHERE purchase_order_number = $1 AND deleted_at IS NULL`,
      [PO_NUMBER_PREFERRED]
    );
    const dupSo = await client.query(
      `SELECT 1 FROM sales_order_lines WHERE sales_order_number = $1 LIMIT 1`,
      [SO_NUMBER]
    );
    const dupDc = await client.query(
      `SELECT 1 FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
      [DC_NUMBER]
    );

    console.log('Vendor:', vendor.business_name, `(#${vendor.vendor_id})`, vendor.state);
    console.log('Customer:', customer.company_name, `(#${customer.customer_id})`);
    console.log('Laptop:', SERIAL_NUMBER, TTSPL_ID, SPECS);
    console.log('PO:', PO_NUMBER_PREFERRED, PO_DATE, `₹${UNIT_PRICE} + IGST 18%`);
    console.log('SO/DC:', SO_NUMBER, DC_NUMBER, 'sale', SALE_RATE, 'Porter', DISPATCH_AT.slice(0, 10));
    console.log('Spare occupying TTSPL6191:', spare.rows[0] || null);
    console.log('Existing laptop row:', existingLaptop.rows[0] || null);
    console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

    if (existingLaptop.rows.length) {
      const row = existingLaptop.rows[0];
      if (Number(row.current_customer_id) === CUSTOMER_ID && row.inventory_status === 'sold') {
        console.log('Already deployed as sold to customer 95.');
        return;
      }
      throw new Error(`Laptop serial already exists: ${JSON.stringify(row)}`);
    }
    if (dupPo.rows.length) throw new Error(`${PO_NUMBER_PREFERRED} already exists`);
    if (dupSo.rows.length) throw new Error(`${SO_NUMBER} already exists`);
    if (dupDc.rows.length) throw new Error(`${DC_NUMBER} already exists`);

    if (!COMMIT) {
      console.log('\nWould:');
      console.log('  1. Reassign unused spare #8045 off TTSPL6191 onto a PRT_ code');
      console.log('  2. Create PO-BACKLOG (vendor 94, 25 Nov 2025, ₹20000 + IGST)');
      console.log('  3. Receive GRN + serial PF2PSZ81 / TTSPL6191');
      console.log('  4. Create sale SO/25-26/3019 (16 Jan 2026) for customer 95');
      console.log('  5. Deliver DC/25-26/3019 Porter on 19 Jan 2026 (sold)');
      console.log('Dry-run OK — pass --commit to apply.');
      return;
    }

    await client.query('BEGIN');
    const spareMove = await freeConflictingSpareCode(client);
    console.log('Spare reassignment:', spareMove);
    const serial = await createPoGrnSerial(client, vendor);
    console.log('Created intake:', serial.serial_id, serial.purchaseOrderNumber, 'GRN', serial.grnId);
    await deploySale(client, serial, customer);
    await client.query('COMMIT');

    const verify = await pool.query(
      `SELECT serial_id, serial_number, inventory_asset_code, inventory_status,
              current_customer_id, current_dc_number, current_entity,
              rent_monthly_rate, delivered_at, dispatch_mode
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [serial.serial_id]
    );
    const deployed = await pool.query(
      `SELECT COUNT(*)::int AS n FROM vendor_serial_numbers
        WHERE current_customer_id = $1 AND inventory_status = ANY($2::text[]) AND deleted_at IS NULL`,
      [CUSTOMER_ID, DEPLOYED_WITH_CUSTOMER_STATUSES]
    );
    console.log('\nDone.');
    console.log('Serial state:', verify.rows[0]);
    console.log('Customer 95 deployed count:', deployed.rows[0].n);
    console.log('PO', serial.purchaseOrderNumber, 'SO', SO_NUMBER, 'DC', DC_NUMBER);
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
