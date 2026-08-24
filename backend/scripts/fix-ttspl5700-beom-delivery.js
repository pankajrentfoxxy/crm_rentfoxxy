#!/usr/bin/env node
/**
 * TTSPL5700 — Beom Commerce (#131): backfill delivery so Support can raise a ticket.
 *
 * Unit is rented + billed to Beom, but vendor_serial_numbers.delivered_at and
 * current_dc_number were never synced from outbound DC-003247 (7 Mar 2026).
 * Support create hides any laptop without delivered_at.
 *
 *   node scripts/fix-ttspl5700-beom-delivery.js           (dry-run)
 *   node scripts/fix-ttspl5700-beom-delivery.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { logTtsplEvent } = require('../services/ttsplAuditService');
const { checkSerialEligibleForSupportTicket } = require('../services/supportSerialEligibility');

const COMMIT = process.argv.includes('--commit');
const CUSTOMER_ID = 131;
const SERIAL_ID = 2625;
const TTSPL_ID = 'TTSPL5700';
const DC_NUMBER = 'DC-003247';

async function main() {
  const dcRes = await pool.query(
    `SELECT dc_number, customer_id, status, movement_type, entity_code,
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
            current_dc_number, current_entity, delivered_at, dispatched_at, rent_start_date
       FROM vendor_serial_numbers
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [SERIAL_ID]
  );
  if (!vsnRes.rows.length) throw new Error(`${TTSPL_ID} (serial_id ${SERIAL_ID}) not found`);
  const before = vsnRes.rows[0];
  if (Number(before.current_customer_id) !== CUSTOMER_ID) {
    throw new Error(`${TTSPL_ID} is assigned to customer ${before.current_customer_id}, expected ${CUSTOMER_ID}`);
  }

  const dispatchedAt = before.dispatched_at || dc.dispatched_at || dc.created_at || deliveredAt;

  console.log('Customer:', CUSTOMER_ID, 'Beom Commerce Private Limited');
  console.log('Asset:', before.inventory_asset_code, '/', before.serial_number);
  console.log('DC:', DC_NUMBER, 'delivered_at:', deliveredAt);
  console.log('Before:', {
    inventory_status: before.inventory_status,
    current_customer_id: before.current_customer_id,
    current_dc_number: before.current_dc_number,
    delivered_at: before.delivered_at,
    rent_start_date: before.rent_start_date,
  });
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

  if (
    before.current_dc_number === DC_NUMBER
    && before.delivered_at
    && Number(before.current_customer_id) === CUSTOMER_ID
  ) {
    const client = await pool.connect();
    try {
      const elig = await checkSerialEligibleForSupportTicket(client, CUSTOMER_ID, {
        unique_serial_number: TTSPL_ID,
      }, { ticketCategory: 'complaint' });
      console.log('Already synced. Support eligible:', elig.ok ? 'YES' : elig.message);
    } finally {
      client.release();
      await pool.end();
    }
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
          current_entity = COALESCE(current_entity, $4),
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

    await logTtsplEvent({
      ttsplId: TTSPL_ID,
      vendorSerialId: SERIAL_ID,
      eventType: 'delivery_backfill',
      description: `Delivery backfilled from ${DC_NUMBER} for Beom Commerce (#${CUSTOMER_ID}) so Support can raise tickets`,
      metadata: {
        dc_number: DC_NUMBER,
        delivered_at: deliveredAt,
        customer_id: CUSTOMER_ID,
        reason: 'support_ticket_create_missing_delivered_at',
      },
      actorName: 'fix-ttspl5700-beom-delivery',
      db: client,
    });

    await client.query('COMMIT');

    const afterRes = await client.query(
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
