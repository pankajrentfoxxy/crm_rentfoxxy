#!/usr/bin/env node
/**
 * Reverse mistaken lost-laptop sale + return pickup for Synergie (#25).
 * Customer found the five laptops; restore original rental so September bills them.
 *
 *   node scripts/fix-synergie-lost-found-5.js           (dry-run)
 *   node scripts/fix-synergie-lost-found-5.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { logTtsplEvent } = require('../services/ttsplAuditService');

const COMMIT = process.argv.includes('--commit');
const CUSTOMER_ID = 25;
const REASON = 'Customer found lost laptops — reverse mistaken sale SO/DC and return pickup; restore original rental';

const UNITS = [
  {
    ttspl: 'TTSPL2688',
    serialId: 1212,
    serial: 'DL6ZMF2',
    rate: 1349,
    rentStart: '2026-02-06',
    dc: 'DC-001637',
    so: 'SO-001637',
    ticketId: 2813,
    itemId: 3027,
    rdc: 'RDC002001',
    saleSo: 'SO/26-27/1154',
    saleDc: 'DC/26-27/1114',
    saleAlloc: 8215,
  },
  {
    ttspl: 'TTSPL4803',
    serialId: 1833,
    serial: 'HV370J3',
    rate: 2499,
    rentStart: '2026-02-19',
    dc: 'DC-002908',
    so: 'SO-002911',
    ticketId: 2809,
    itemId: 3023,
    rdc: 'RDC001997',
    saleSo: 'SO/26-27/1153',
    saleDc: 'DC/26-27/1115',
    saleAlloc: 8214,
  },
  {
    ttspl: 'TTSPL4826',
    serialId: 1545,
    serial: 'C1T50J3',
    rate: 2499,
    rentStart: '2026-05-11',
    dc: 'DC/26-27/0313',
    so: 'SO/26-27/0272',
    ticketId: 2811,
    itemId: 3025,
    rdc: 'RDC001999',
    saleSo: 'SO/26-27/1153',
    saleDc: 'DC/26-27/1115',
    saleAlloc: 8217,
  },
  {
    ttspl: 'TTSPL6323',
    serialId: 2324,
    serial: '8XN02J3',
    rate: 2499,
    rentStart: '2026-05-11',
    dc: 'DC/26-27/0313',
    so: 'SO/26-27/0272',
    ticketId: 2810,
    itemId: 3024,
    rdc: 'RDC001998',
    saleSo: 'SO/26-27/1153',
    saleDc: 'DC/26-27/1115',
    saleAlloc: 8213,
  },
  {
    ttspl: 'TTSPL6817',
    serialId: 1554,
    serial: '8G87ZD3',
    rate: 2499,
    rentStart: '2026-05-11',
    dc: 'DC/26-27/0316',
    so: 'SO/26-27/0276',
    ticketId: 2812,
    itemId: 3026,
    rdc: 'RDC002000',
    saleSo: 'SO/26-27/1153',
    saleDc: 'DC/26-27/1115',
    saleAlloc: 8216,
  },
];

const SALE_SOS = ['SO/26-27/1153', 'SO/26-27/1154'];
const SALE_DCS = ['DC/26-27/1114', 'DC/26-27/1115'];
const RDCS = UNITS.map((u) => u.rdc);
const TICKET_IDS = UNITS.map((u) => u.ticketId);
const ITEM_IDS = UNITS.map((u) => u.itemId);
const ALLOC_IDS = UNITS.map((u) => u.saleAlloc);

async function main() {
  console.log('Synergie (#25) lost-found restore');
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT serial_id, inventory_asset_code AS ttspl, inventory_status,
              current_customer_id, current_dc_number, rent_start_date::date,
              rent_monthly_rate, rent_billed_until::date, delivered_at::date
         FROM vendor_serial_numbers
        WHERE serial_id = ANY($1::int[])
        ORDER BY inventory_asset_code`,
      [UNITS.map((u) => u.serialId)]
    );
    console.log('Before VSN:', JSON.stringify(before.rows, null, 2));

    for (const row of before.rows) {
      if (Number(row.current_customer_id) !== CUSTOMER_ID) {
        throw new Error(`${row.ttspl} is not on customer ${CUSTOMER_ID}`);
      }
    }

    await client.query(
      `UPDATE delivery_challan_lines
          SET status = 'cancelled', updated_at = NOW()
        WHERE dc_number = ANY($1::text[])
          AND customer_id = $2
          AND COALESCE(movement_type, 'outbound') = 'outbound'`,
      [SALE_DCS, CUSTOMER_ID]
    );

    await client.query(
      `UPDATE delivery_challan_lines
          SET status = 'cancelled', updated_at = NOW()
        WHERE dc_number = ANY($1::text[])
          AND customer_id = $2
          AND movement_type = 'return'`,
      [RDCS, CUSTOMER_ID]
    );

    await client.query(
      `UPDATE support_ticket_items
          SET status = 'cancelled',
              return_dc_number = NULL,
              picked_up_at = NULL,
              warehouse_received_at = NULL,
              pickup_completed_at = NULL,
              reached_warehouse_at = NULL,
              updated_at = NOW()
        WHERE id = ANY($1::int[])
          AND ticket_id = ANY($2::int[])
          AND item_type = 'pickup'`,
      [ITEM_IDS, TICKET_IDS]
    );

    await client.query(
      `UPDATE support_tickets
          SET status = 'cancelled',
              cancelled_at = NOW(),
              cancellation_remark = $3,
              return_dc_number = NULL,
              updated_at = NOW()
        WHERE id = ANY($1::int[])
          AND customer_id = $2`,
      [TICKET_IDS, CUSTOMER_ID, REASON]
    );

    await client.query(
      `UPDATE sales_order_serials
          SET status = 'removed', updated_at = NOW()
        WHERE allocation_id = ANY($1::int[])
          AND sales_order_number = ANY($2::text[])`,
      [ALLOC_IDS, SALE_SOS]
    );

    await client.query(
      `UPDATE sales_order_lines
          SET status = 'cancelled'
        WHERE sales_order_number = ANY($1::text[])
          AND customer_id = $2
          AND LOWER(COALESCE(quotation_type, '')) IN ('sale', 'sales')`,
      [SALE_SOS, CUSTOMER_ID]
    );

    await client.query(
      `UPDATE dispatch_workflow
          SET status = 'cancelled', updated_at = NOW()
        WHERE sales_order_number = ANY($1::text[])`,
      [SALE_SOS]
    );

    for (const u of UNITS) {
      const extraRes = await client.query(
        `SELECT extra FROM vendor_serial_numbers WHERE serial_id = $1 FOR UPDATE`,
        [u.serialId]
      );
      const extra = { ...(extraRes.rows[0]?.extra || {}) };
      extra.inventory_tag = 'rental';
      extra.action_status = null;
      extra.action_remark = null;
      extra.awaiting_inventory_receive = false;
      extra.lost_found_restored_at = new Date().toISOString();
      extra.lost_found_restore_note = REASON;

      await client.query(
        `UPDATE vendor_serial_numbers
            SET inventory_status = 'rented',
                current_customer_id = $2,
                current_entity = 'rentfoxxy',
                current_dc_number = $3,
                rent_start_date = $4::date,
                rent_end_date = NULL,
                returned_at = NULL,
                delivered_at = $4::date,
                dispatched_at = $4::date,
                rent_monthly_rate = $5,
                rent_billed_until = '2026-08-31'::date,
                extra = $6::jsonb,
                updated_at = NOW()
          WHERE serial_id = $1
            AND deleted_at IS NULL`,
        [u.serialId, CUSTOMER_ID, u.dc, u.rentStart, u.rate, JSON.stringify(extra)]
      );

      await logTtsplEvent({
        db: client,
        vendorSerialId: u.serialId,
        ttsplId: u.ttspl,
        eventType: 'lost_found_rental_restore',
        description: `${u.ttspl} restored to Synergie rental ${u.dc} @ ₹${u.rate} after mistaken lost-laptop sale`,
        actorName: 'system',
        metadata: {
          customer_id: CUSTOMER_ID,
          original_dc: u.dc,
          original_so: u.so,
          cancelled_sale_so: u.saleSo,
          cancelled_sale_dc: u.saleDc,
          cancelled_rdc: u.rdc,
          cancelled_ticket_id: u.ticketId,
          rent_start: u.rentStart,
          rent_monthly_rate: u.rate,
          rent_billed_until: '2026-08-31',
        },
      });
    }

    const after = await client.query(
      `SELECT serial_id, inventory_asset_code AS ttspl, inventory_status,
              current_customer_id, current_dc_number, rent_start_date::date,
              rent_monthly_rate, rent_billed_until::date
         FROM vendor_serial_numbers
        WHERE serial_id = ANY($1::int[])
        ORDER BY inventory_asset_code`,
      [UNITS.map((u) => u.serialId)]
    );
    console.log('After VSN:', JSON.stringify(after.rows, null, 2));

    if (COMMIT) {
      await client.query('COMMIT');
      console.log('Committed.');
    } else {
      await client.query('ROLLBACK');
      console.log('Rolled back (dry-run). Re-run with --commit to apply.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
