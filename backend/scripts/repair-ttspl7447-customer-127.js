#!/usr/bin/env node
/**
 * Repair TTSPL7447 — returned from customer 220 (DC/26-27/0911, Jul 27) but inventory
 * never cleared; re-deployed on DC/26-27/0999 to customer 127 (dispatch Jul 29, delivery Aug 1).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');

const SERIAL_ID = 8211;
const TTSPL = 'TTSPL7447';
const OLD_DC = 'DC/26-27/0911';
const NEW_DC = 'DC/26-27/0999';
const NEW_CUSTOMER_ID = 127;
const RETURN_DATE = '2026-07-27';
const DISPATCH_DATE = '2026-07-29T12:00:00.000Z';
const DELIVERY_DATE = '2026-08-01T12:00:00.000Z';
const ACTOR = { user_id: 1, name: 'repair-ttspl7447' };

async function main() {
  const client = await pool.connect();
  try {
    const before = await client.query(
      `SELECT serial_id, inventory_status, current_customer_id, current_dc_number,
              dispatched_at, delivered_at, rent_start_date, rent_end_date, rent_monthly_rate
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [SERIAL_ID]
    );
    console.log('Before:', before.rows[0]);

    const dc = await client.query(
      `SELECT customer_id, status, dispatched_at, delivered_at, dispatch_mode, entity_code
         FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
      [NEW_DC]
    );
    if (!dc.rows.length) throw new Error(`${NEW_DC} not found`);
    const dcRow = dc.rows[0];
    if (parseInt(dcRow.customer_id, 10) !== NEW_CUSTOMER_ID) {
      throw new Error(`Expected customer ${NEW_CUSTOMER_ID} on ${NEW_DC}`);
    }

    const rateRes = await client.query(
      `SELECT sol.rate
         FROM sales_order_serials sos
         JOIN sales_order_lines sol ON sol.id = sos.line_id
        WHERE sos.serial_id = $1 AND sos.dc_number = $2 AND sos.status <> 'removed'
        ORDER BY sos.allocation_id DESC LIMIT 1`,
      [SERIAL_ID, NEW_DC]
    );
    const rentMonthlyRate = parseFloat(rateRes.rows[0]?.rate || 0) || null;

    const rentStart = inventorySM.computeRentStart({
      dispatchMode: dcRow.dispatch_mode || 'courier',
      dispatchedAt: dcRow.dispatched_at || DISPATCH_DATE,
      deliveredAt: dcRow.delivered_at || DELIVERY_DATE,
    });

    await client.query('BEGIN');

    // Re-assert delivery on the new DC (rented -> rented idempotent with new customer/DC).
    await inventorySM.markDelivered(client, SERIAL_ID, {
      quotationType: 'rental',
      dcNumber: NEW_DC,
      customerId: NEW_CUSTOMER_ID,
      entityCode: dcRow.entity_code || 'rentfoxxy',
      dispatchMode: dcRow.dispatch_mode || 'courier',
      dispatchedAt: dcRow.dispatched_at || DISPATCH_DATE,
      deliveredAt: dcRow.delivered_at || DELIVERY_DATE,
      rentMonthlyRate,
      actorUserId: ACTOR.user_id,
      actorName: ACTOR.name,
    });

    // markDelivered sets delivered_at to NOW() — apply authoritative DC dates.
    await client.query(
      `UPDATE vendor_serial_numbers
          SET dispatched_at = COALESCE($1::timestamptz, dispatched_at),
              delivered_at = COALESCE($2::timestamptz, delivered_at),
              rent_start_date = COALESCE($3::date, rent_start_date),
              rent_monthly_rate = COALESCE($4, rent_monthly_rate),
              rent_end_date = NULL,
              returned_at = NULL,
              updated_at = NOW()
        WHERE serial_id = $5`,
      [
        dcRow.dispatched_at || DISPATCH_DATE,
        dcRow.delivered_at || DELIVERY_DATE,
        rentStart ? rentStart.toISOString().slice(0, 10) : null,
        rentMonthlyRate,
        SERIAL_ID,
      ]
    );

    await client.query(
      `UPDATE sales_order_serials
          SET status = 'dispatched', updated_at = NOW()
        WHERE serial_id = $1 AND dc_number = $2`,
      [SERIAL_ID, NEW_DC]
    );

    await client.query(
      `INSERT INTO inventory_status_transitions
         (serial_id, from_status, to_status, reason, dc_number, customer_id, actor_user_id, actor_name)
       VALUES ($1, $2, 'rented', $3, $4, $5, $6, $7)`,
      [
        SERIAL_ID,
        before.rows[0]?.inventory_status || 'rented',
        `Repair: ${TTSPL} moved from ${OLD_DC} (cust ${before.rows[0]?.current_customer_id}) to ${NEW_DC} (cust ${NEW_CUSTOMER_ID}); prior return ${RETURN_DATE}`,
        NEW_DC,
        NEW_CUSTOMER_ID,
        ACTOR.user_id,
        ACTOR.name,
      ]
    ).catch(() => {});

    await client.query('COMMIT');

    const after = await client.query(
      `SELECT serial_id, inventory_status, current_customer_id, current_dc_number,
              dispatched_at, delivered_at, rent_start_date, rent_monthly_rate
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [SERIAL_ID]
    );
    console.log('After:', after.rows[0]);

    const on127 = await pool.query(
      `SELECT inventory_asset_code, current_dc_number, inventory_status, delivered_at, dispatched_at
         FROM vendor_serial_numbers
        WHERE current_customer_id = $1 AND inventory_asset_code = $2`,
      [NEW_CUSTOMER_ID, TTSPL]
    );
    console.log('Customer 127 bucket:', on127.rows[0] || 'NOT FOUND');

    const on220 = await pool.query(
      `SELECT inventory_asset_code FROM vendor_serial_numbers
        WHERE current_customer_id = 220 AND inventory_asset_code = $1
          AND inventory_status = ANY('{rented,in_transit,on_demo,sold,reserved,out_stock}')`,
      [TTSPL]
    );
    console.log('Still on customer 220:', on220.rows.length ? 'YES' : 'NO');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
