#!/usr/bin/env node
/**
 * Link SO/25-26/3018 (rate 1149) to DC/25-26/3018 so billing shows the correct rate.
 *
 *   node scripts/repair-dc-25-26-3018-rate.js           (dry-run)
 *   node scripts/repair-dc-25-26-3018-rate.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { resolveDcBilling, getDeliveryChallanLines } = require('../services/salesManagementService');

const COMMIT = process.argv.includes('--commit');
const SO_NUMBER = 'SO/25-26/3018';
const DC_NUMBER = 'DC/25-26/3018';
const SERIAL_ID = 8729;
const TTSPL_ID = 'TTSPL3018';
const SERIAL_NUMBER = '884BKC2';
const RATE = 1149;
const SO_CREATED_AT = '2026-01-06T10:00:00+05:30';

const SPECS = {
  brand: 'Dell',
  model_name: 'Dell Latitude E7470',
  processor: 'I5',
  generation: '6TH',
  ram: '8',
  storage: '250 SSD',
  gpu: 'Integrated',
  screen_size: '14-inch',
};

async function main() {
  const dcRes = await pool.query(
    `SELECT * FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
    [DC_NUMBER]
  );
  if (!dcRes.rows.length) throw new Error(`${DC_NUMBER} not found`);
  const dc = dcRes.rows[0];

  const before = await resolveDcBilling(DC_NUMBER, await getDeliveryChallanLines(DC_NUMBER));
  console.log('Before billing:', before.billingLines, 'subtotal:', before.subtotal);
  console.log('DC sales_order_number:', dc.sales_order_number);

  const dupSo = await pool.query(
    `SELECT 1 FROM sales_order_lines WHERE sales_order_number = $1 LIMIT 1`,
    [SO_NUMBER]
  );
  if (dupSo.rows.length && dc.sales_order_number !== SO_NUMBER) {
    throw new Error(`${SO_NUMBER} already exists but DC is not linked`);
  }

  if (dc.sales_order_number === SO_NUMBER) {
    console.log('Already linked to', SO_NUMBER);
    return;
  }

  if (!COMMIT) {
    console.log('\nWould create', SO_NUMBER, 'with rate', RATE, 'and link', DC_NUMBER);
    console.log('Dry-run OK — pass --commit to apply.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lineRes = await client.query(
      `INSERT INTO sales_order_lines (
          sales_order_number, quotation_number, customer_id, customer_name, customer_email,
          customer_shipping_address, customer_billing_address, gst_number, supply_state,
          security_amount, shiping_charges, quotation_type, entity_code, security_type, branch,
          brand, model_name, processor, generation, ram, storage, gpu, screen_size,
          quantity, main_qty, rate, locking_period, remark, status, created_at, updated_at
       ) VALUES (
          $1,'N/A',$2,$3,$4,$5::jsonb,$6::jsonb,$7,'haryana',
          $8,$9,'rental','rentfoxxy','none','rentfoxxy',
          $10,$11,$12,$13,$14,$15,$16,$17,
          1,1,$18,0,$19,'completed',$20::timestamptz,$20::timestamptz
       ) RETURNING id`,
      [
        SO_NUMBER,
        dc.customer_id,
        dc.customer_name,
        dc.email,
        JSON.stringify(dc.customer_shipping_address || {}),
        JSON.stringify(dc.customer_billing_address || {}),
        dc.gst_number,
        dc.security_amount,
        dc.shiping_charges,
        SPECS.brand,
        SPECS.model_name,
        SPECS.processor,
        SPECS.generation,
        SPECS.ram,
        SPECS.storage,
        SPECS.gpu,
        SPECS.screen_size,
        RATE,
        'Historical deployment backfill — Dotnova TTSPL3018',
        SO_CREATED_AT,
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
        SERIAL_ID,
        TTSPL_ID,
        SERIAL_NUMBER,
        DC_NUMBER,
        JSON.stringify(dc.customer_shipping_address || {}),
        SO_CREATED_AT,
      ]
    );

    await client.query(
      `UPDATE delivery_challan_lines
          SET sales_order_number = $1, updated_at = NOW()
        WHERE dc_number = $2`,
      [SO_NUMBER, DC_NUMBER]
    );

    await client.query('COMMIT');

    const after = await resolveDcBilling(DC_NUMBER, await getDeliveryChallanLines(DC_NUMBER));
    console.log('\nDone.');
    console.log('After billing:', after.billingLines, 'subtotal:', after.subtotal);
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
