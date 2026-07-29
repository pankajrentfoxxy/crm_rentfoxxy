#!/usr/bin/env node
/**
 * Add TTSPL5573 / PG02V2BX to CITY COMPUTERS (customer 235):
 *   1. Fix specs, mark as deployed with customer
 *   2. Create delivered Return DC (shows in Returned assets tab)
 *   3. Process return -> floor QC ticket
 *
 * Usage:
 *   node scripts/add-ttspl5573-city-computers-return.js           (dry-run)
 *   node scripts/add-ttspl5573-city-computers-return.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { transitionAsset } = require('../services/inventoryStateMachine');
const { nextDocumentNumber } = require('../services/salesManagementService');
const { processReturnedSerials } = require('../services/returnCompletionService');

const SERIAL_ID = 3208;
const CUSTOMER_ID = 235;
const TTSPL = 'TTSPL5573';
const SERIAL = 'PG02V2BX';
const COMMIT = process.argv.includes('--commit');

async function main() {
  const cust = await pool.query(
    `SELECT customer_id, name, company_name, email FROM customers WHERE customer_id = $1`,
    [CUSTOMER_ID]
  );
  if (!cust.rows.length) throw new Error(`Customer ${CUSTOMER_ID} not found`);
  const customer = cust.rows[0];

  const vsnRes = await pool.query(
    `SELECT * FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL`,
    [SERIAL_ID]
  );
  if (!vsnRes.rows.length) throw new Error(`${TTSPL} / serial_id ${SERIAL_ID} not found`);
  const vsn = vsnRes.rows[0];

  const existingRdc = await pool.query(
    `SELECT dc_number FROM delivery_challan_lines
      WHERE movement_type = 'return' AND customer_id = $1
        AND (
          serial_number::text ILIKE $2
          OR serial_number::text ILIKE $3
        )
      LIMIT 1`,
    [CUSTOMER_ID, `%${SERIAL}%`, `%${TTSPL}%`]
  );
  if (existingRdc.rows.length) {
    console.log(`Return DC already exists: ${existingRdc.rows[0].dc_number}`);
  }

  const openTicket = await pool.query(
    `SELECT ticket_id FROM tickets WHERE serial_number = $1 AND status IN ('in_progress', 'on_hold')`,
    [SERIAL]
  );

  console.log('Customer:', customer.company_name, `(#${customer.customer_id})`);
  console.log('Serial:', vsn.serial_number, vsn.inventory_asset_code);
  console.log('  status:', vsn.inventory_status, 'qc:', vsn.qc_status);
  console.log('  current_customer_id:', vsn.current_customer_id);
  console.log('  extra.brand:', vsn.extra?.brand);
  if (openTicket.rows.length) console.log('  open floor ticket:', openTicket.rows[0].ticket_id);

  if (!COMMIT) {
    console.log('\nDRY-RUN. Would:');
    console.log('  1. Fix extra.brand -> Lenovo');
    console.log('  2. transition -> rented with customer 235');
    console.log('  3. Create Return DC (delivered) for returned assets tab');
    console.log('  4. processReturnedSerials -> floor return_qc ticket');
    console.log('Run with --commit to apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE vendor_serial_numbers SET
          extra = COALESCE(extra, '{}'::jsonb)
            || jsonb_build_object(
              'brand', 'Lenovo',
              'model', 'Thinkbook 14 (Gen2)',
              'model_name', 'Thinkbook 14 (Gen2)',
              'processor', 'I5',
              'generation', '11TH',
              'ram', '16',
              'storage', '512 SSD'
            ),
          updated_at = NOW()
       WHERE serial_id = $1`,
      [SERIAL_ID]
    );

    if (!['rented', 'on_demo', 'sold'].includes(vsn.inventory_status)) {
      const tr = await transitionAsset(client, {
        serialId: SERIAL_ID,
        toStatus: 'rented',
        customerId: CUSTOMER_ID,
        reason: `Backfill deployment with ${customer.company_name} before return`,
        rentStartDate: new Date(Date.now() - 30 * 86400000),
        actorName: 'add-ttspl5573-city-computers-return',
      });
      console.log(`Deployed: ${tr.from} -> ${tr.to}`);
    } else if (Number(vsn.current_customer_id) !== CUSTOMER_ID) {
      await client.query(
        `UPDATE vendor_serial_numbers SET current_customer_id = $1, updated_at = NOW() WHERE serial_id = $2`,
        [CUSTOMER_ID, SERIAL_ID]
      );
      console.log('Updated current_customer_id to', CUSTOMER_ID);
    }

    let rdcNumber = existingRdc.rows[0]?.dc_number || null;
    if (!rdcNumber) {
      rdcNumber = await nextDocumentNumber('return_dc');
      const serialToken = `${SERIAL_ID}|${SERIAL}|${TTSPL}`;
      const now = new Date();
      await client.query(
        `INSERT INTO delivery_challan_lines (
           dc_number, movement_type, customer_id, customer_name, email,
           brand, model_name, quantity, serial_number,
           dispatch_mode, status,
           dispatched_at, delivered_at, delivery_completed_at,
           pod_submitted_at, pod_type,
           created_at, updated_at
         ) VALUES (
           $1, 'return', $2, $3, $4,
           'Lenovo', 'Thinkbook 14 (Gen2)', 1, $5::jsonb,
           'inhouse', 'delivered',
           $6, $6, $6,
           $6, 'pickup',
           $6, $6
         )`,
        [
          rdcNumber,
          CUSTOMER_ID,
          customer.company_name || customer.name,
          customer.email,
          JSON.stringify([serialToken]),
          now,
        ]
      );
      console.log('Return DC created:', rdcNumber);
    }

    const [out] = await processReturnedSerials(client, {
      serialIds: [SERIAL_ID],
      dcNumber: rdcNumber,
      customerLabel: customer.company_name || customer.name,
      actorName: 'add-ttspl5573-city-computers-return',
    });

    if (out?.skipped) {
      throw new Error(`processReturnedSerials skipped: ${out.reason}`);
    }

    console.log('Return processed:', {
      returnTicketId: out?.returnTicketId,
      creditNote: out?.creditNote,
    });

    await client.query('COMMIT');

    const verify = await pool.query(
      `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, qc_status, current_customer_id
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [SERIAL_ID]
    );
    const returned = await pool.query(
      `SELECT dc_number, brand, model_name, serial_number, delivered_at
         FROM delivery_challan_lines
        WHERE movement_type = 'return' AND customer_id = $1
          AND dc_number = $2`,
      [CUSTOMER_ID, rdcNumber]
    );
    const ticket = out?.returnTicketId
      ? (await pool.query(`SELECT ticket_id, status, ticket_type, ttspl_id FROM tickets WHERE ticket_id = $1`, [out.returnTicketId])).rows[0]
      : null;

    console.log('\nDone.');
    console.log('Serial state:', verify.rows[0]);
    console.log('Return DC line:', returned.rows[0]);
    console.log('Floor ticket:', ticket);
  } catch (e) {
    await client.query('ROLLBACK');
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
