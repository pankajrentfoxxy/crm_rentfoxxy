#!/usr/bin/env node
/**
 * TTSPL6024 — backfill Pibit Technologies (#48) delivery so Support can raise pickup ticket.
 *
 * Unit was returned from EPIC (RDC000840, 27 Apr 2026) but outbound DC to Pibit was never recorded.
 * User confirmed: DC/26-27/0256, delivered 4 May 2026.
 *
 *   node scripts/fix-ttspl6024-pibit-delivery.js           (dry-run)
 *   node scripts/fix-ttspl6024-pibit-delivery.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { logTtsplEvent } = require('../services/ttsplAuditService');

const COMMIT = process.argv.includes('--commit');

const CUSTOMER_ID = 48;
const SERIAL_ID = 577;
const SERIAL_NUMBER = 'PG02RECR';
const TTSPL_ID = 'TTSPL6024';
const SO_NUMBER = 'SO/26-27/0256';
const DC_NUMBER = 'DC/26-27/0256';
const DISPATCH_AT = '2026-05-01T10:00:00+05:30';
const DELIVERED_AT = '2026-05-04T12:00:00+05:30';
const RENT_MONTHLY_RATE = 2374;

const SPECS = {
  brand: 'Dell',
  model: 'Lenovo Thinkpad E14',
  model_name: 'Lenovo Thinkpad E14',
  processor: 'I5',
  generation: '11TH',
  ram: '16',
  storage: '512 SSD',
  gpu: 'Intel UHD Graphics',
  screen_size: '14-inch',
};

async function main() {
  const custRes = await pool.query(
    `SELECT customer_id, company_name, email, gst_no, billing_address, shipping_address
       FROM customers WHERE customer_id = $1`,
    [CUSTOMER_ID]
  );
  if (!custRes.rows.length) throw new Error(`Customer #${CUSTOMER_ID} not found`);
  const customer = custRes.rows[0];

  const vsnRes = await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, current_customer_id,
            current_dc_number, rent_monthly_rate, delivered_at, dispatched_at, rent_start_date
       FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL`,
    [SERIAL_ID]
  );
  if (!vsnRes.rows.length) throw new Error(`${TTSPL_ID} not found`);
  const vsn = vsnRes.rows[0];

  const rentStart = inventorySM.computeRentStart({
    dispatchMode: 'courier',
    dispatchedAt: DISPATCH_AT,
    deliveredAt: DELIVERED_AT,
  }).toISOString().slice(0, 10);

  console.log('Customer:', customer.company_name, `(#${CUSTOMER_ID})`);
  console.log('Serial:', vsn.serial_number, vsn.inventory_asset_code);
  console.log('  status:', vsn.inventory_status, 'current_customer_id:', vsn.current_customer_id);
  console.log('  current_dc:', vsn.current_dc_number, 'delivered_at:', vsn.delivered_at);
  console.log('Target SO/DC:', SO_NUMBER, DC_NUMBER);
  console.log('Target delivery:', DELIVERED_AT.slice(0, 10), 'rent_start:', rentStart);
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

  if (
    Number(vsn.current_customer_id) === CUSTOMER_ID
    && vsn.inventory_status === 'rented'
    && vsn.current_dc_number === DC_NUMBER
    && vsn.delivered_at
  ) {
    console.log('Already deployed correctly.');
    await pool.end();
    return;
  }

  const dupDc = await pool.query(`SELECT dc_number FROM delivery_challan_lines WHERE dc_number = $1`, [DC_NUMBER]);
  if (dupDc.rows.length) {
    throw new Error(`${DC_NUMBER} already exists on customer ${dupDc.rows[0].customer_id || 'unknown'}`);
  }

  if (!COMMIT) {
    console.log('\nWould create SO/DC and set delivered_at on vendor_serial_numbers.');
    console.log('Dry-run OK — pass --commit to apply.');
    await pool.end();
    return;
  }

  const customerName = customer.company_name || customer.name;
  const serialPipe = `${SERIAL_ID}|${SERIAL_NUMBER}|${TTSPL_ID}`;
  const serialJson = JSON.stringify([serialPipe]);

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
          $1,'N/A',$2,$3,$4,$5::jsonb,$6::jsonb,$7,'karnataka',
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
        `Deployment — ${TTSPL_ID} Pibit`,
        DISPATCH_AT,
      ]
    );
    const lineId = lineRes.rows[0].id;

    await client.query(
      `UPDATE sales_order_serials
          SET sales_order_number = $1,
              line_id = $2,
              status = 'dispatched',
              dc_number = $3,
              updated_at = NOW()
        WHERE serial_id = $4 AND ttspl_id = $5`,
      [SO_NUMBER, lineId, DC_NUMBER, SERIAL_ID, TTSPL_ID]
    );

    const sosCheck = await client.query(
      `SELECT allocation_id FROM sales_order_serials WHERE serial_id = $1 AND ttspl_id = $2`,
      [SERIAL_ID, TTSPL_ID]
    );
    if (!sosCheck.rows.length) {
      await client.query(
        `INSERT INTO sales_order_serials (
            sales_order_number, line_id, serial_id, ttspl_id, serial_number,
            qc_status, status, dc_number, entity_code, delivery_address, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,'passed','dispatched',$6,'rentfoxxy',$7::jsonb,$8::timestamptz,$9::timestamptz)`,
        [
          SO_NUMBER,
          lineId,
          SERIAL_ID,
          TTSPL_ID,
          SERIAL_NUMBER,
          DC_NUMBER,
          JSON.stringify({ address: customer.shipping_address || '' }),
          DISPATCH_AT,
          DELIVERED_AT,
        ]
      );
    }

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
          $1,$2,'N/A',$3,$4,$5,$6,'karnataka',0,0,'rentfoxxy','rentfoxxy',
          $7::jsonb,$8::jsonb,
          $9,$10,1,1,$11::jsonb,
          'by_courier','courier',
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
        JSON.stringify({ address: customer.billing_address || '' }),
        JSON.stringify({ address: customer.shipping_address || '' }),
        SPECS.brand,
        SPECS.model_name,
        serialJson,
        JSON.stringify([serialPipe]),
        DISPATCH_AT,
        DELIVERED_AT,
        `Deployment — ${TTSPL_ID} Pibit (backfill)`,
      ]
    );

    await client.query(
      `UPDATE vendor_serial_numbers
          SET current_customer_id = $2,
              current_dc_number = $3,
              dispatched_at = $4::timestamptz,
              delivered_at = $5::timestamptz,
              rent_start_date = $6::date,
              rent_monthly_rate = $7,
              dispatch_mode = 'courier',
              inventory_status = 'rented',
              qc_status = 'passed',
              extra = COALESCE(extra, '{}'::jsonb) || $8::jsonb,
              updated_at = NOW()
        WHERE serial_id = $1`,
      [
        SERIAL_ID,
        CUSTOMER_ID,
        DC_NUMBER,
        DISPATCH_AT,
        DELIVERED_AT,
        rentStart,
        RENT_MONTHLY_RATE,
        JSON.stringify(SPECS),
      ]
    );

    await client.query(
      `UPDATE inventory SET status = 'Outward', updated_at = NOW()
        WHERE machine_number = $1`,
      [TTSPL_ID]
    );

    await logTtsplEvent({
      ttsplId: TTSPL_ID,
      vendorSerialId: SERIAL_ID,
      eventType: 'customer_deployment_backfill',
      description: `Backfilled ${TTSPL_ID} delivery to ${customerName} on ${DC_NUMBER}`,
      metadata: {
        dc_number: DC_NUMBER,
        sales_order_number: SO_NUMBER,
        customer_id: CUSTOMER_ID,
        delivered_at: DELIVERED_AT,
        previous_dc: vsn.current_dc_number,
        previous_delivered_at: vsn.delivered_at,
      },
      actorName: 'fix-ttspl6024-pibit-delivery',
      db: client,
    });

    await client.query('COMMIT');

    const verify = await pool.query(
      `SELECT serial_id, inventory_asset_code, inventory_status, current_customer_id,
              current_dc_number, delivered_at, rent_start_date, rent_monthly_rate
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [SERIAL_ID]
    );
    const supportAssets = await pool.query(
      `SELECT vsn.inventory_asset_code AS unique_serial_number
         FROM vendor_serial_numbers vsn
        WHERE vsn.current_customer_id = $1 AND vsn.deleted_at IS NULL
          AND vsn.inventory_status = 'rented'
          AND vsn.delivered_at IS NOT NULL
          AND vsn.inventory_asset_code = $2`,
      [CUSTOMER_ID, TTSPL_ID]
    );

    console.log('\nDone.');
    console.log('Serial state:', verify.rows[0]);
    console.log('Visible in Support assets:', supportAssets.rows.length > 0 ? 'YES' : 'NO');
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
