#!/usr/bin/env node
/**
 * Deploy TTSPL4385 / PC28HQ2R (Lenovo Thinkpad X-13) to EXOTALENT (#182) active assets.
 *
 *   node scripts/add-ttspl4385-exotalent-active.js           (dry-run)
 *   node scripts/add-ttspl4385-exotalent-active.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { logTtsplEvent } = require('../services/ttsplAuditService');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('../services/customerDeployedAssets');
const { resolveDcBilling, getDeliveryChallanLines } = require('../services/salesManagementService');

const COMMIT = process.argv.includes('--commit');

const CUSTOMER_ID = 182;
const SERIAL_ID = 903;
const SERIAL_NUMBER = 'PC28HQ2R';
const TTSPL_ID = 'TTSPL4385';
const SO_NUMBER = 'SO/26-27/0164';
const DC_NUMBER = 'DC/26-27/0197';
const DISPATCH_AT = '2026-04-23T10:00:00+05:30';
const DELIVERED_AT = '2026-04-26T12:00:00+05:30';
const RENT_MONTHLY_RATE = 1799;

const SPECS = {
  brand: 'Lenovo',
  model: 'Lenovo Thinkpad X-13',
  model_name: 'Lenovo Thinkpad X-13',
  processor: 'I5',
  generation: '11TH',
  ram: '16',
  storage: '512 SSD',
  gpu: 'Integrated',
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
            current_dc_number, rent_monthly_rate, delivered_at
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
  console.log('  current_dc:', vsn.current_dc_number, 'rate:', vsn.rent_monthly_rate);
  console.log('Target SO/DC:', SO_NUMBER, DC_NUMBER);
  console.log('Target rate:', RENT_MONTHLY_RATE, 'dispatch:', DISPATCH_AT.slice(0, 10), 'delivery:', DELIVERED_AT.slice(0, 10));
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

  if (Number(vsn.current_customer_id) === CUSTOMER_ID && vsn.inventory_status === 'rented'
      && vsn.current_dc_number === DC_NUMBER && Number(vsn.rent_monthly_rate) === RENT_MONTHLY_RATE) {
    console.log('Already deployed correctly.');
    await pool.end();
    return;
  }

  const dupDc = await pool.query(`SELECT 1 FROM delivery_challan_lines WHERE dc_number = $1`, [DC_NUMBER]);
  const dupSo = await pool.query(`SELECT 1 FROM sales_order_lines WHERE sales_order_number = $1`, [SO_NUMBER]);
  if (dupDc.rows.length || dupSo.rows.length) {
    throw new Error(`${DC_NUMBER} or ${SO_NUMBER} already exists`);
  }

  if (!COMMIT) {
    console.log('\nWould deploy to customer 182 with SO/DC above.');
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
          $1,'N/A',$2,$3,$4,$5::jsonb,$6::jsonb,$7,'uttar_pradesh',
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
        `Deployment — ${TTSPL_ID} Exotalent`,
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
        SERIAL_ID,
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
          $1,$2,'N/A',$3,$4,$5,$6,'uttar_pradesh',0,0,'rentfoxxy','rentfoxxy',
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
        `Deployment — ${TTSPL_ID} Exotalent`,
      ]
    );

    if (vsn.inventory_status === 'in_stock' || vsn.inventory_status === 'passed') {
      await inventorySM.markDispatched(client, SERIAL_ID, {
        dcNumber: DC_NUMBER,
        customerId: CUSTOMER_ID,
        entityCode: 'rentfoxxy',
        dispatchMode: 'courier',
        actorName: 'add-ttspl4385-exotalent-active',
      });
    }

    await inventorySM.markDelivered(client, SERIAL_ID, {
      quotationType: 'rental',
      dcNumber: DC_NUMBER,
      customerId: CUSTOMER_ID,
      entityCode: 'rentfoxxy',
      dispatchMode: 'courier',
      dispatchedAt: DISPATCH_AT,
      deliveredAt: DELIVERED_AT,
      rentMonthlyRate: RENT_MONTHLY_RATE,
      actorName: 'add-ttspl4385-exotalent-active',
    });

    await client.query(
      `UPDATE vendor_serial_numbers
          SET current_customer_id = $2,
              current_dc_number = $3,
              dispatched_at = $4::timestamptz,
              delivered_at = $5::timestamptz,
              rent_start_date = $6::date,
              rent_monthly_rate = $7,
              dispatch_mode = 'courier',
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

    await logTtsplEvent({
      ttsplId: TTSPL_ID,
      vendorSerialId: SERIAL_ID,
      eventType: 'customer_deployment_backfill',
      description: `Deployed ${TTSPL_ID} to ${customerName} on ${DC_NUMBER}`,
      metadata: {
        dc_number: DC_NUMBER,
        sales_order_number: SO_NUMBER,
        customer_id: CUSTOMER_ID,
        rent_monthly_rate: RENT_MONTHLY_RATE,
        delivered_at: DELIVERED_AT,
        previous_customer_id: vsn.current_customer_id,
      },
      actorName: 'add-ttspl4385-exotalent-active',
      db: client,
    });

    await client.query('COMMIT');

    const verify = await pool.query(
      `SELECT serial_id, serial_number, inventory_asset_code, inventory_status,
              current_customer_id, current_dc_number, rent_monthly_rate, rent_start_date, delivered_at
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [SERIAL_ID]
    );
    const active = await pool.query(
      `SELECT COUNT(*)::int AS n FROM vendor_serial_numbers
        WHERE current_customer_id = $1 AND inventory_status = ANY($2::text[]) AND deleted_at IS NULL`,
      [CUSTOMER_ID, DEPLOYED_WITH_CUSTOMER_STATUSES]
    );
    const billing = await resolveDcBilling(DC_NUMBER, await getDeliveryChallanLines(DC_NUMBER));

    console.log('\nDone.');
    console.log('Serial state:', verify.rows[0]);
    console.log('DC billing:', billing.billingLines, 'subtotal:', billing.subtotal);
    console.log('Exotalent active deployed count:', active.rows[0].n);
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
