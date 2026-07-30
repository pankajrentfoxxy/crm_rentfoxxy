#!/usr/bin/env node
/**
 * Restore TTSPL4376 / PC261P42 (Lenovo Thinkpad X-13) to active rented assets
 * for SLEEP MANAGEMENT PRIVATE LIMITED (customer #41).
 *
 * Unit already has DC-003813 / SO-003919 (rate 1999) but inventory_status drifted to returned.
 *
 *   node scripts/add-ttspl4376-sleep-management-active.js           (dry-run)
 *   node scripts/add-ttspl4376-sleep-management-active.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { logTtsplEvent } = require('../services/ttsplAuditService');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('../services/customerDeployedAssets');
const { resolveDcBilling, getDeliveryChallanLines } = require('../services/salesManagementService');

const COMMIT = process.argv.includes('--commit');

const CUSTOMER_ID = 41;
const SERIAL_ID = 3062;
const SERIAL_NUMBER = 'PC261P42';
const TTSPL_ID = 'TTSPL4376';
const SO_NUMBER = 'SO-003919';
const DC_NUMBER = 'DC-003813';
const DISPATCH_AT = '2025-09-22T10:00:00+05:30';
const DELIVERED_AT = '2025-09-22T12:00:00+05:30';
const RENT_MONTHLY_RATE = 1999;

const SPECS = {
  brand: 'Lenovo',
  model: 'Lenovo Thinkpad X-13',
  model_name: 'Lenovo Thinkpad X-13',
  processor: 'I5',
  generation: '11TH',
  ram: '16',
  storage: '512 SSD',
};

async function main() {
  const vsnRes = await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, qc_status,
            current_customer_id, current_dc_number, rent_monthly_rate, delivered_at, extra
       FROM vendor_serial_numbers
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [SERIAL_ID]
  );
  if (!vsnRes.rows.length) throw new Error(`${TTSPL_ID} / serial_id ${SERIAL_ID} not found`);
  const vsn = vsnRes.rows[0];

  const custRes = await pool.query(
    `SELECT customer_id, company_name FROM customers WHERE customer_id = $1`,
    [CUSTOMER_ID]
  );
  if (!custRes.rows.length) throw new Error(`Customer #${CUSTOMER_ID} not found`);

  const rentStart = inventorySM.computeRentStart({
    dispatchMode: 'inhouse',
    dispatchedAt: DISPATCH_AT,
    deliveredAt: DELIVERED_AT,
  }).toISOString().slice(0, 10);

  console.log('Customer:', custRes.rows[0].company_name, `(#${CUSTOMER_ID})`);
  console.log('Serial:', vsn.serial_number, vsn.inventory_asset_code);
  console.log('  status:', vsn.inventory_status, 'qc:', vsn.qc_status);
  console.log('  current_customer_id:', vsn.current_customer_id, 'dc:', vsn.current_dc_number);
  console.log('  rent_monthly_rate:', vsn.rent_monthly_rate);
  console.log('Target rate:', RENT_MONTHLY_RATE, 'delivery:', DELIVERED_AT.slice(0, 10));
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

  if (vsn.inventory_status === 'rented' && Number(vsn.current_customer_id) === CUSTOMER_ID
      && Number(vsn.rent_monthly_rate) === RENT_MONTHLY_RATE) {
    console.log('Already active rented with correct rate.');
    await pool.end();
    return;
  }

  if (!COMMIT) {
    console.log('\nWould restore to rented on', DC_NUMBER, 'with rate', RENT_MONTHLY_RATE);
    console.log('Dry-run OK — pass --commit to apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tr = await inventorySM.markDelivered(client, SERIAL_ID, {
      quotationType: 'rental',
      dcNumber: DC_NUMBER,
      customerId: CUSTOMER_ID,
      entityCode: 'rentfoxxy',
      dispatchMode: 'inhouse',
      dispatchedAt: DISPATCH_AT,
      deliveredAt: DELIVERED_AT,
      rentMonthlyRate: RENT_MONTHLY_RATE,
      actorUserId: null,
      actorName: 'add-ttspl4376-sleep-management-active',
    });
    console.log('Transition:', tr.from, '->', tr.to);

    await client.query(
      `UPDATE vendor_serial_numbers
          SET dispatched_at = $2::timestamptz,
              delivered_at = $3::timestamptz,
              rent_start_date = $4::date,
              rent_monthly_rate = $5,
              current_customer_id = $6,
              current_dc_number = $7,
              qc_status = 'passed',
              extra = COALESCE(extra, '{}'::jsonb) || $8::jsonb,
              updated_at = NOW()
        WHERE serial_id = $1`,
      [
        SERIAL_ID,
        DISPATCH_AT,
        DELIVERED_AT,
        rentStart,
        RENT_MONTHLY_RATE,
        CUSTOMER_ID,
        DC_NUMBER,
        JSON.stringify(SPECS),
      ]
    );

    await client.query(
      `UPDATE delivery_challan_lines
          SET dispatched_at = $2::timestamptz,
              delivered_at = $3::timestamptz,
              delivery_completed_at = $3::timestamptz,
              date_and_time = $3::timestamptz,
              updated_at = NOW()
        WHERE dc_number = $1`,
      [DC_NUMBER, DISPATCH_AT, DELIVERED_AT]
    );

    await client.query(
      `UPDATE sales_order_lines
          SET rate = $2, brand = $3, model_name = $4, processor = $5,
              generation = $6, ram = $7, storage = $8, status = 'completed', updated_at = NOW()
        WHERE id = (
          SELECT line_id FROM sales_order_serials
           WHERE serial_id = $1 AND sales_order_number = $9
           ORDER BY allocation_id DESC LIMIT 1
        )`,
      [
        SERIAL_ID,
        RENT_MONTHLY_RATE,
        SPECS.brand,
        SPECS.model_name,
        SPECS.processor,
        SPECS.generation,
        SPECS.ram,
        SPECS.storage,
        SO_NUMBER,
      ]
    );

    await logTtsplEvent({
      ttsplId: TTSPL_ID,
      vendorSerialId: SERIAL_ID,
      eventType: 'active_asset_restore',
      description: `Restored ${TTSPL_ID} to active rented with ${custRes.rows[0].company_name}`,
      metadata: {
        dc_number: DC_NUMBER,
        sales_order_number: SO_NUMBER,
        customer_id: CUSTOMER_ID,
        rent_monthly_rate: RENT_MONTHLY_RATE,
        delivered_at: DELIVERED_AT,
      },
      actorName: 'add-ttspl4376-sleep-management-active',
      db: client,
    });

    await client.query('COMMIT');

    const verify = await pool.query(
      `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, qc_status,
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
    console.log('DC billing rate:', billing.billingLines.find((l) => l.model_name?.includes('X-13')) || billing.billingLines);
    console.log('Customer active deployed count:', active.rows[0].n);
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
