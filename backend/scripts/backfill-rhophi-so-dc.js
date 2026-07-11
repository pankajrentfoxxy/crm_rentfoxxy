#!/usr/bin/env node
/**
 * Backfill historical SO/DC for RHOPHI ANALYTICS LLP — TTSPL4280 / DQPXY962N5.
 *
 *   node scripts/backfill-rhophi-so-dc.js              # dry-run (default)
 *   node scripts/backfill-rhophi-so-dc.js --commit     # write to DB
 */
require('dotenv').config();
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { logTtsplEvent } = require('../services/ttsplAuditService');

const COMMIT = process.argv.includes('--commit');

const SO_NUMBER = 'SO/26-27/0792_A';
const DC_NUMBER = 'DC/26-27/0791_A';
const CUSTOMER_ID = 106;
const SERIAL_NUMBER = 'DQPXY962N5';
const TTSPL_ID = 'TTSPL4280';

const DISPATCH_AT = '2026-06-26T10:00:00+05:30';
const DELIVERED_AT = '2026-07-02T14:00:00+05:30';
const SO_CREATED_AT = '2026-06-25T12:00:00+05:30';

const BILLING_ADDRESS = {
  name: 'RHOPHI ANALYTICS LLP (Punjab)',
  email: 'harshita@a1apps.co',
  phone: '7901992964',
  address: 'A-40A, Ground Floor, Quarkcity India Private Limited, Industrial Area',
  city: 'Ujjain',
  state: 'Delhi',
  pincode: '160071',
  country: 'India',
  gst_number: '03ABBFR0912Q1Z8',
};

const SHIPPING_ADDRESS = {
  name: 'Sriveer',
  phone: '9133133157',
  address: 'Sky villa, flat 101, snbp school road keshav nagar 412307',
  city: 'PUNE',
  state: 'Maharashtra',
  pincode: '412307',
  country: 'India',
};

const LINE = {
  brand: 'Apple',
  model_name: 'MACBOOK AIR | 14-inch',
  processor: 'M4',
  generation: 'M4',
  ram: '16GB',
  storage: '256GB SSD',
  gpu: 'Intel UHD Graphics',
  screen_size: '14-inch',
  rate: 5499,
  locking_period: 3,
  shiping_charges: 799,
  security_amount: 0,
  remark: 'Product 1 : Rental',
};

const COURIER = {
  name: 'BlueDart',
  awb: '90564405120',
};

function rentStartDate(dispatchIso, deliveredIso) {
  const start = inventorySM.computeRentStart({
    dispatchMode: 'courier',
    dispatchedAt: dispatchIso,
    deliveredAt: deliveredIso,
  });
  return start.toISOString().slice(0, 10);
}

async function loadSerial(client) {
  const r = await client.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, qc_status,
            current_customer_id, current_dc_number, rent_monthly_rate, rent_start_date,
            extra
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (serial_number = $1 OR inventory_asset_code = $2)
      LIMIT 1`,
    [SERIAL_NUMBER, TTSPL_ID]
  );
  return r.rows[0] || null;
}

async function main() {
  const client = await pool.connect();
  const rentStart = rentStartDate(DISPATCH_AT, DELIVERED_AT);

  try {
    await client.query('BEGIN');

    const serial = await loadSerial(client);
    if (!serial) throw new Error(`Serial not found: ${SERIAL_NUMBER} / ${TTSPL_ID}`);

    const custRes = await client.query(
      `SELECT customer_id, name, company_name, email, phone, gst_no
         FROM customers WHERE customer_id = $1`,
      [CUSTOMER_ID]
    );
    if (!custRes.rows.length) throw new Error(`Customer #${CUSTOMER_ID} not found`);

    const dupSo = await client.query(
      `SELECT 1 FROM sales_order_lines WHERE sales_order_number = $1 LIMIT 1`,
      [SO_NUMBER]
    );
    if (dupSo.rows.length) throw new Error(`${SO_NUMBER} already exists`);

    const dupDc = await client.query(
      `SELECT 1 FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
      [DC_NUMBER]
    );
    if (dupDc.rows.length) throw new Error(`${DC_NUMBER} already exists`);

    const activeAlloc = await client.query(
      `SELECT allocation_id, sales_order_number, status
         FROM sales_order_serials
        WHERE serial_id = $1 AND status IN ('attached', 'dispatched')
        ORDER BY allocation_id DESC`,
      [serial.serial_id]
    );

    const allowedStatuses = new Set(['in_stock', 'passed', 'reserved']);
    if (!allowedStatuses.has(serial.inventory_status)) {
      console.warn(
        `WARN: serial status is "${serial.inventory_status}" (expected in_stock/passed/reserved). Proceeding anyway.`
      );
    }

    const customerName = custRes.rows[0].company_name || custRes.rows[0].name || BILLING_ADDRESS.name;
    const serialPipe = `${serial.serial_id}|${serial.serial_number}|${TTSPL_ID}`;
    const serialJson = JSON.stringify([serialPipe]);

    console.log('\n=== RHOPHI SO/DC backfill ===');
    console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
    console.log(`Serial: ${serial.serial_number} (${TTSPL_ID}) — current status: ${serial.inventory_status}`);
    console.log(`Customer: #${CUSTOMER_ID} ${customerName}`);
    console.log(`SO: ${SO_NUMBER}`);
    console.log(`DC: ${DC_NUMBER}`);
    console.log(`Courier: ${COURIER.name} AWB ${COURIER.awb}`);
    console.log(`Dispatch: ${DISPATCH_AT}`);
    console.log(`Delivered: ${DELIVERED_AT}`);
    console.log(`Rent start (courier rule): ${rentStart}`);
    if (activeAlloc.rows.length) {
      console.log(
        `Will release active SO allocation(s): ${activeAlloc.rows.map((r) => `${r.sales_order_number} (${r.status})`).join(', ')}`
      );
    }

    if (!COMMIT) {
      await client.query('ROLLBACK');
      console.log('\nDry-run OK — pass --commit to write.\n');
      return;
    }

    for (const alloc of activeAlloc.rows) {
      await client.query(
        `UPDATE sales_order_serials SET status = 'removed', updated_at = NOW() WHERE allocation_id = $1`,
        [alloc.allocation_id]
      );
    }

    const lineRes = await client.query(
      `INSERT INTO sales_order_lines (
          sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile,
          customer_shipping_address, customer_billing_address, gst_number, supply_state, security_amount,
          shiping_charges, quotation_type, entity_code, security_type, branch,
          brand, model_name, processor, generation, ram, storage, gpu, screen_size,
          quantity, main_qty, rate, locking_period, remark, status, created_at, updated_at
       ) VALUES (
          $1,'N/A',$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,'punjab',$9,$10,
          'rental','rentfoxxy','none','rentfoxxy',
          $11,$12,$13,$14,$15,$16,$17,$18,
          1,1,$19,$20,$21,'completed',$22::timestamptz,$22::timestamptz
       ) RETURNING id`,
      [
        SO_NUMBER,
        CUSTOMER_ID,
        customerName,
        BILLING_ADDRESS.email,
        BILLING_ADDRESS.phone,
        JSON.stringify(SHIPPING_ADDRESS),
        JSON.stringify(BILLING_ADDRESS),
        BILLING_ADDRESS.gst_number,
        LINE.security_amount,
        LINE.shiping_charges,
        LINE.brand,
        LINE.model_name,
        LINE.processor,
        LINE.generation,
        LINE.ram,
        LINE.storage,
        LINE.gpu,
        LINE.screen_size,
        LINE.rate,
        LINE.locking_period,
        LINE.remark,
        SO_CREATED_AT,
      ]
    );
    const lineId = lineRes.rows[0].id;

    const allocRes = await client.query(
      `INSERT INTO sales_order_serials (
          sales_order_number, line_id, serial_id, ttspl_id, serial_number,
          qc_status, status, dc_number, entity_code, delivery_address, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,'passed','dispatched',$6,'rentfoxxy',$7::jsonb,$8::timestamptz,$8::timestamptz)
       RETURNING allocation_id`,
      [
        SO_NUMBER,
        lineId,
        serial.serial_id,
        TTSPL_ID,
        serial.serial_number,
        DC_NUMBER,
        JSON.stringify(SHIPPING_ADDRESS),
        DISPATCH_AT,
      ]
    );

    await client.query(
      `INSERT INTO delivery_challan_lines (
          dc_number, sales_order_number, quotation_number, customer_id, customer_name, email,
          gst_number, supply_state, security_amount, shiping_charges, branch, entity_code,
          customer_billing_address, customer_shipping_address,
          brand, model_name, quantity, main_qty, serial_number,
          ship_by, dispatch_mode, courier_name, awb_number,
          movement_type, status, pre_dispatch_qc_passed,
          delivered_serial_numbers, dispatched_at, delivered_at, delivery_completed_at,
          date_and_time, remarks, created_at, updated_at
       ) VALUES (
          $1,$2,'N/A',$3,$4,$5,$6,'punjab',$7,$8,'rentfoxxy','rentfoxxy',
          $9::jsonb,$10::jsonb,
          $11,$12,1,1,$13::jsonb,
          'by_courier','courier',$14,$15,
          'outbound','delivered',true,
          $16::jsonb,$17::timestamptz,$18::timestamptz,$18::timestamptz,
          $18::timestamptz,$19,$17::timestamptz,$18::timestamptz
       )`,
      [
        DC_NUMBER,
        SO_NUMBER,
        CUSTOMER_ID,
        customerName,
        BILLING_ADDRESS.email,
        BILLING_ADDRESS.gst_number,
        LINE.security_amount,
        LINE.shiping_charges,
        JSON.stringify(BILLING_ADDRESS),
        JSON.stringify(SHIPPING_ADDRESS),
        LINE.brand,
        LINE.model_name,
        serialJson,
        COURIER.name,
        COURIER.awb,
        JSON.stringify([serialPipe]),
        DISPATCH_AT,
        DELIVERED_AT,
        `Historical backfill — ${COURIER.name} ${COURIER.awb}`,
      ]
    );

    await client.query(
      `INSERT INTO sm_courier_details (courier_name, awb_number, dc_number, created_at)
       VALUES ($1,$2,$3,$4::timestamptz)`,
      [COURIER.name, COURIER.awb, DC_NUMBER, DISPATCH_AT]
    );

    const fromStatus = serial.inventory_status;
    if (fromStatus === 'in_stock' || fromStatus === 'passed') {
      await inventorySM.markDispatched(client, serial.serial_id, {
        dcNumber: DC_NUMBER,
        customerId: CUSTOMER_ID,
        entityCode: 'rentfoxxy',
        dispatchMode: 'courier',
        actorUserId: null,
        actorName: 'backfill-rhophi-so-dc',
      });
    }

    await inventorySM.markDelivered(client, serial.serial_id, {
      quotationType: 'rental',
      dcNumber: DC_NUMBER,
      customerId: CUSTOMER_ID,
      entityCode: 'rentfoxxy',
      dispatchMode: 'courier',
      dispatchedAt: DISPATCH_AT,
      deliveredAt: DELIVERED_AT,
      rentMonthlyRate: LINE.rate,
      actorUserId: null,
      actorName: 'backfill-rhophi-so-dc',
    });

    await client.query(
      `UPDATE vendor_serial_numbers
          SET dispatched_at = $2::timestamptz,
              delivered_at = $3::timestamptz,
              rent_start_date = $4::date,
              rent_monthly_rate = $5,
              status_changed_at = $3::timestamptz,
              qc_status = 'passed',
              updated_at = NOW()
        WHERE serial_id = $1`,
      [serial.serial_id, DISPATCH_AT, DELIVERED_AT, rentStart, LINE.rate]
    );

    await logTtsplEvent({
      ttsplId: TTSPL_ID,
      vendorSerialId: serial.serial_id,
      eventType: 'historical_so_dc_backfill',
      description: `Backfilled ${SO_NUMBER} / ${DC_NUMBER} for RHOPHI — delivered ${DELIVERED_AT.slice(0, 10)}`,
      metadata: {
        sales_order_number: SO_NUMBER,
        dc_number: DC_NUMBER,
        customer_id: CUSTOMER_ID,
        courier: COURIER.name,
        awb: COURIER.awb,
        dispatch_at: DISPATCH_AT,
        delivered_at: DELIVERED_AT,
        rent_start_date: rentStart,
      },
      actorUserId: null,
      actorName: 'backfill-rhophi-so-dc',
      db: client,
    });

    await client.query('COMMIT');

    const verify = await pool.query(
      `SELECT vsn.inventory_status, vsn.current_customer_id, vsn.current_dc_number,
              vsn.rent_start_date, vsn.rent_monthly_rate, c.company_name
         FROM vendor_serial_numbers vsn
         LEFT JOIN customers c ON c.customer_id = vsn.current_customer_id
        WHERE vsn.serial_id = $1`,
      [serial.serial_id]
    );
    const v = verify.rows[0];
    console.log('\nCommitted successfully.');
    console.log(`  inventory_status: ${v.inventory_status}`);
    console.log(`  customer: ${v.company_name} (#${v.current_customer_id})`);
    console.log(`  dc: ${v.current_dc_number}`);
    console.log(`  rent_start: ${v.rent_start_date} @ ₹${v.rent_monthly_rate}/mo`);
    console.log(`  allocation_id: ${allocRes.rows[0].allocation_id}`);
    console.log('\nNext: verify Customer Assets + create support ticket for TTSPL4280.\n');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFailed:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
