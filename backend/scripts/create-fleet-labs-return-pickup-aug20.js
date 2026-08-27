#!/usr/bin/env node
/**
 * Fleet Labs (customer 94) — one return-pickup ticket for 4 rented laptops
 * DTDC AWB D4000659792, ticket + pickup dated 20 Aug 2026.
 * Leaves warehouse receive open so warehouse can e-sign today.
 *
 *   node scripts/create-fleet-labs-return-pickup-aug20.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { executePickupWithReturnDc } = require('../controllers/supportController');
const { markReturnPickupInTransit } = require('../services/supportReturnPickupInventory');
const { regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');

const CUSTOMER_ID = 94;
const ACTOR = { user_id: 14, name: 'Manish' };
const PICKUP_AT = '2026-08-20 18:13:00+05:30';
const CODES = ['TTSPL4586', 'TTSPL4767', 'TTSPL3762', 'TTSPL5782'];
const COMMIT = process.argv.includes('--commit');

const PICKUP_ADDRESS = {
  name: 'Nitish',
  phone: '9738219088',
  address: 'AC-3, 1st Floor, Kestopur, VIP East, Kolkata - 700101',
  city: 'Kolkata',
  state: 'West Bengal',
  pincode: '700101',
};

async function main() {
  const customer = (await pool.query(
    `SELECT customer_id, name, company_name, email, phone FROM customers WHERE customer_id = $1`,
    [CUSTOMER_ID]
  )).rows[0];
  if (!customer) throw new Error('Customer 94 not found');

  const vsn = await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, current_customer_id, extra
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (inventory_asset_code = ANY($1) OR extra->>'ttspl_id' = ANY($1))
      ORDER BY inventory_asset_code`,
    [CODES]
  );
  if (vsn.rows.length !== 4) {
    throw new Error(`Expected 4 serials, found ${vsn.rows.length}`);
  }
  for (const row of vsn.rows) {
    if (Number(row.current_customer_id) !== CUSTOMER_ID) {
      throw new Error(`${row.inventory_asset_code} is not with customer 94 (customer=${row.current_customer_id})`);
    }
    if (!['rented', 'on_demo', 'sold', 'out_stock'].includes(row.inventory_status)) {
      throw new Error(`${row.inventory_asset_code} status is ${row.inventory_status}`);
    }
  }

  const active = await pool.query(
    `SELECT sti.id, sti.ticket_id, sti.ttspl_id, sti.status, sti.return_dc_number
       FROM support_ticket_items sti
       JOIN support_tickets st ON st.id = sti.ticket_id
      WHERE sti.item_type = 'pickup'
        AND sti.ttspl_id = ANY($1)
        AND sti.status NOT IN ('resolved', 'closed', 'inventory_updated')
        AND COALESCE(st.status, '') NOT IN ('cancelled', 'closed')`,
    [CODES]
  );
  if (active.rows.length) {
    throw new Error(`Active pickup already exists: ${JSON.stringify(active.rows)}`);
  }

  const machines = vsn.rows.map((row) => ({
    ttspl_id: row.inventory_asset_code,
    unique_serial_number: row.inventory_asset_code,
    serial_number: row.serial_number,
    brand: row.extra?.brand || null,
    model: row.extra?.model || row.extra?.model_name || null,
    ram: row.extra?.ram || null,
    storage: row.extra?.storage || null,
    generation: row.extra?.generation || null,
  }));

  console.log('Customer:', customer.company_name, `(#${customer.customer_id})`);
  console.log('Units:', machines.map((m) => `${m.ttspl_id} / ${m.serial_number}`).join(', '));
  console.log('Courier: DTDC', 'D4000659792');
  console.log('Ticket + pickup date:', PICKUP_AT);

  if (!COMMIT) {
    console.log('\nDRY-RUN. Re-run with --commit to create the ticket.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ticketRes = await client.query(
      `INSERT INTO support_tickets (
          customer_id, customer_name, customer_phone, status, created_by, last_activity_at,
          priority, top_level_remarks, ticket_phone_override, ticket_email,
          ticket_category, ttspl_id, serial_number, complaint_type, created_at, updated_at
       ) VALUES ($1,$2,$3,'in_progress',$4,$5::timestamptz,'normal',$6,$7,$8,
                 'pickup',$9,$10,'pickup',$5::timestamptz,$5::timestamptz)
       RETURNING *`,
      [
        CUSTOMER_ID,
        customer.company_name,
        customer.phone,
        ACTOR.user_id,
        PICKUP_AT,
        'Customer return — 4 laptops via DTDC D4000659792. Pickup 20 Aug 2026. Parcel reached warehouse 26 Aug 2026.',
        customer.phone,
        customer.email,
        machines[0].ttspl_id,
        machines[0].serial_number,
      ]
    );
    const ticket = ticketRes.rows[0];

    const result = await executePickupWithReturnDc(client, ticket, ticket.id, ACTOR.user_id, {
      pickup_type: 'return',
      pickup_address: PICKUP_ADDRESS,
      dispatch_mode: 'courier',
      courier_name: 'DTDC',
      awb_number: 'D4000659792',
      machines,
      remarks: 'DTDC prepaid return D4000659792 — 4 Dell Latitude 5420 units from Fleet Labs / Nitish, Kolkata.',
    });

    await client.query(
      `UPDATE support_ticket_items
          SET status = 'picked_up',
              picked_up_at = $1::timestamptz,
              pickup_scheduled_at = $1::timestamptz,
              customer_otp_verified_at = $1::timestamptz,
              created_at = $1::timestamptz,
              updated_at = $1::timestamptz
        WHERE id = ANY($2::int[])`,
      [PICKUP_AT, result.pickupItemIds]
    );
    await client.query(
      `UPDATE delivery_challan_lines
          SET created_at = $1::timestamptz,
              dispatched_at = $1::timestamptz,
              updated_at = $1::timestamptz
        WHERE dc_number = $2 AND movement_type = 'return'`,
      [PICKUP_AT, result.rdc]
    );
    await client.query(
      `UPDATE support_tickets
          SET created_at = $1::timestamptz,
              last_activity_at = $1::timestamptz,
              updated_at = NOW()
        WHERE id = $2`,
      [PICKUP_AT, ticket.id]
    );

    const items = await client.query(
      `SELECT * FROM support_ticket_items WHERE id = ANY($1::int[])`,
      [result.pickupItemIds]
    );
    for (const item of items.rows) {
      await markReturnPickupInTransit(client, item, ACTOR);
    }

    await client.query('COMMIT');

    try {
      await regenerateReturnDcPdfByRdc(pool, result.rdc);
    } catch (pdfErr) {
      console.warn('PDF generate:', pdfErr.message);
    }

    console.log('\nCreated');
    console.log('  Ticket:', ticket.id);
    console.log('  Return DC:', result.rdc);
    console.log('  Pickup items:', result.pickupItemIds.join(', '));
    console.log('  Warehouse: open Return DC, e-sign, and confirm receive.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
