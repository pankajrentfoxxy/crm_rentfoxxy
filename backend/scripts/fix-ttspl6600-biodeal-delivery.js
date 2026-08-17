#!/usr/bin/env node
/**
 * Backfill delivery + DC on TTSPL6600 for BIODEAL (#183) from outbound DC-002724.
 *
 *   node scripts/fix-ttspl6600-biodeal-delivery.js           (dry-run)
 *   node scripts/fix-ttspl6600-biodeal-delivery.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { logTtsplEvent } = require('../services/ttsplAuditService');
const { checkSerialEligibleForSupportTicket } = require('../services/supportSerialEligibility');

const COMMIT = process.argv.includes('--commit');
const CUSTOMER_ID = 183;
const SERIAL_ID = 2673;
const TTSPL_ID = 'TTSPL6600';
const DC_NUMBER = 'DC-002724';

async function main() {
  const dcRes = await pool.query(
    `SELECT dc_number, customer_id, status, movement_type, entity_code, dispatch_mode,
            delivered_at, delivery_completed_at, dispatched_at, created_at, sales_order_number
       FROM delivery_challan_lines
      WHERE dc_number = $1
      LIMIT 1`,
    [DC_NUMBER]
  );
  if (!dcRes.rows.length) throw new Error(`${DC_NUMBER} not found`);
  const dc = dcRes.rows[0];
  if (Number(dc.customer_id) !== CUSTOMER_ID) {
    throw new Error(`${DC_NUMBER} belongs to customer ${dc.customer_id}, expected ${CUSTOMER_ID}`);
  }
  if (dc.movement_type !== 'outbound') {
    throw new Error(`${DC_NUMBER} is not an outbound DC`);
  }

  const deliveredAt = dc.delivered_at || dc.delivery_completed_at;
  if (!deliveredAt) throw new Error(`${DC_NUMBER} has no delivery timestamp`);

  const vsnRes = await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, current_customer_id,
            current_dc_number, current_entity, delivered_at, dispatched_at, rent_monthly_rate
       FROM vendor_serial_numbers
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [SERIAL_ID]
  );
  if (!vsnRes.rows.length) throw new Error(`${TTSPL_ID} (serial_id ${SERIAL_ID}) not found`);
  const before = vsnRes.rows[0];

  const dispatchedAt = before.dispatched_at || dc.dispatched_at || dc.created_at || deliveredAt;

  console.log('Customer:', CUSTOMER_ID, 'BIODEAL PHARMACEUTICALS LIMITED');
  console.log('Asset:', before.inventory_asset_code, '/', before.serial_number);
  console.log('DC:', DC_NUMBER, 'delivered_at:', deliveredAt);
  console.log('Before:', {
    inventory_status: before.inventory_status,
    current_customer_id: before.current_customer_id,
    current_dc_number: before.current_dc_number,
    delivered_at: before.delivered_at,
  });
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

  if (
    before.current_dc_number === DC_NUMBER
    && before.delivered_at
    && Number(before.current_customer_id) === CUSTOMER_ID
  ) {
    console.log('Already synced.');
    await pool.end();
    return;
  }

  if (!COMMIT) {
    console.log('Would set delivered_at, current_dc_number, current_entity on vendor serial.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE vendor_serial_numbers SET
          inventory_status = 'rented',
          current_customer_id = $2,
          current_dc_number = $3,
          current_entity = $4,
          delivered_at = $5,
          dispatched_at = COALESCE(dispatched_at, $6),
          updated_at = NOW()
        WHERE serial_id = $1`,
      [
        SERIAL_ID,
        CUSTOMER_ID,
        DC_NUMBER,
        dc.entity_code || 'rentfoxxy',
        deliveredAt,
        dispatchedAt,
      ]
    );

    await client.query(
      `UPDATE delivery_challan_lines SET
          status = 'delivered',
          delivered_at = COALESCE(delivered_at, $2),
          delivery_completed_at = COALESCE(delivery_completed_at, $2),
          updated_at = NOW()
        WHERE dc_number = $1`,
      [DC_NUMBER, deliveredAt]
    );

    await client.query(
      `UPDATE sales_order_serials SET
          dc_number = COALESCE(dc_number, $2),
          status = CASE WHEN status IN ('removed') THEN status ELSE 'dispatched' END,
          updated_at = NOW()
        WHERE serial_id = $1
          AND (dc_number IS NULL OR dc_number = $2)`,
      [SERIAL_ID, DC_NUMBER]
    );

    await logTtsplEvent({
      ttsplId: TTSPL_ID,
      vendorSerialId: SERIAL_ID,
      eventType: 'delivery_backfill',
      description: `Delivery backfilled from ${DC_NUMBER} for BIODEAL (#${CUSTOMER_ID})`,
      metadata: {
        dc_number: DC_NUMBER,
        delivered_at: deliveredAt,
        customer_id: CUSTOMER_ID,
      },
      actorName: 'fix-ttspl6600-biodeal-delivery',
      db: client,
    });

    await client.query('COMMIT');

    const afterRes = await pool.query(
      `SELECT inventory_status, current_customer_id, current_dc_number, current_entity, delivered_at
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [SERIAL_ID]
    );
    console.log('After:', afterRes.rows[0]);

    const elig = await checkSerialEligibleForSupportTicket(client, CUSTOMER_ID, {
      unique_serial_number: TTSPL_ID,
    }, { ticketCategory: 'complaint' });
    console.log('Support eligible:', elig.ok ? 'YES' : elig.message);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
