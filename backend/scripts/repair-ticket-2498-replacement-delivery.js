#!/usr/bin/env node
/**
 * Repair support ticket 2498 — replacement DC/26-27/0980 was physically delivered
 * but POD was never submitted, leaving ticket in_progress.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { finalizeDeliveryInventory } = require('../controllers/salesManagementController');

const TICKET_ID = 2498;
const DC_NUMBER = 'DC/26-27/0980';
const ACTOR = { user_id: 1, name: 'repair-ticket-2498' };

async function main() {
  const client = await pool.connect();
  try {
    const before = await client.query(
      `SELECT id, status FROM support_tickets WHERE id = $1`,
      [TICKET_ID]
    );
    const dc = await client.query(
      `SELECT dc_number, status, movement_type, dc_purpose FROM delivery_challan_lines WHERE dc_number = $1`,
      [DC_NUMBER]
    );
    if (!dc.rows.length) throw new Error(`${DC_NUMBER} not found`);
    if (dc.rows[0].status === 'delivered') {
      console.log('DC already delivered — running finalize only');
    }

    await client.query('BEGIN');

    if (dc.rows[0].status !== 'delivered') {
      await client.query(
        `UPDATE delivery_challan_lines
            SET status = 'delivered',
                delivered_at = COALESCE(delivered_at, NOW()),
                delivery_completed_at = COALESCE(delivery_completed_at, NOW()),
                pod_type = COALESCE(pod_type, 'admin_repair'),
                delivery_notes = COALESCE(delivery_notes, 'Delivery backfilled — repair ticket 2498'),
                updated_at = NOW()
          WHERE dc_number = $1`,
        [DC_NUMBER]
      );
    }

    const out = await finalizeDeliveryInventory(client, DC_NUMBER, ACTOR);
    await client.query('COMMIT');

    const after = await client.query(
      `SELECT id, status, closed_at FROM support_tickets WHERE id = $1`,
      [TICKET_ID]
    );
    const items = await client.query(
      `SELECT id, item_type, status FROM support_ticket_items WHERE ticket_id = $1 ORDER BY id`,
      [TICKET_ID]
    );
    const order = await client.query(
      `SELECT id, status, delivery_completed_at, pickup_completed_at FROM support_replacement_orders WHERE ticket_id = $1`,
      [TICKET_ID]
    );
    const serial = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, current_customer_id
         FROM vendor_serial_numbers WHERE serial_id = 8431`
    );

    console.log('Before ticket status:', before.rows[0]?.status);
    console.log('finalizeDeliveryInventory:', out);
    console.log('After ticket:', after.rows[0]);
    console.log('Items:', items.rows);
    console.log('Replacement order:', order.rows[0]);
    console.log('New serial:', serial.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Repair failed:', e.message || e);
  process.exit(1);
});
