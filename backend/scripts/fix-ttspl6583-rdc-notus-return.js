#!/usr/bin/env node
/**
 * TTSPL6583 — close superseded RDC001402 (customer 252), warehouse-receive
 * RDC001524 (Notus / customer 61) on 29 Aug 2026, raise 2-day return CN.
 *
 *   node scripts/fix-ttspl6583-rdc-notus-return.js
 *   node scripts/fix-ttspl6583-rdc-notus-return.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const billing = require('../services/billingSchedulerService');
const inventorySM = require('../services/inventoryStateMachine');
const {
  createFloorTicketFromSupportPickup,
  resetVendorSerialForQcReentry,
} = require('../services/grnTicketService');
const { regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');
const { calcReturnCreditNoteAmount, toLocalYmd } = require('../services/billingMath');

const TTSPL = 'TTSPL6583';
const SERIAL_ID = 3173;
const OLD_CUSTOMER_ID = 252;
const NOTUS_CUSTOMER_ID = 61;
const OLD_RDC = 'RDC001402';
const OLD_TICKET_ID = 1926;
const OLD_PICKUP_ID = 1926;
const NEW_RDC = 'RDC001524';
const NEW_TICKET_ID = 2101;
const NEW_PICKUP_ID = 2116;
const ACTOR_USER_ID = 11;
const ACTOR_NAME = 'Sujoy';
const RETURN_AT = new Date('2026-08-29T15:00:00+05:30');
const COMMIT = process.argv.includes('--commit');

const OLD_RDC_REMARK =
  'Closed/superseded: TTSPL6583 was never warehouse-received from customer 252. ' +
  'Unit was re-delivered to Notus on DC/26-27/0697 (19 Jun 2026). ' +
  'Physical return received 29 Aug 2026 on RDC001524.';

async function snapshot(client) {
  const vsn = (await client.query(
    `SELECT serial_id, inventory_asset_code, inventory_status, qc_status,
            current_customer_id, current_dc_number, rent_start_date, rent_end_date,
            rent_monthly_rate, rent_billed_until, returned_at
       FROM vendor_serial_numbers WHERE serial_id = $1`,
    [SERIAL_ID]
  )).rows[0];
  const rdcs = (await client.query(
    `SELECT dc_number, customer_id, status, warehouse_received_at, delivered_at, remarks
       FROM delivery_challan_lines
      WHERE dc_number IN ($1, $2) AND movement_type = 'return'
      ORDER BY dc_number`,
    [OLD_RDC, NEW_RDC]
  )).rows;
  const items = (await client.query(
    `SELECT id, ticket_id, status, return_dc_number, warehouse_received_at,
            warehouse_esign_at, warehouse_esign_url, floor_ticket_id, picked_up_at
       FROM support_ticket_items WHERE id IN ($1, $2)`,
    [OLD_PICKUP_ID, NEW_PICKUP_ID]
  )).rows;
  const cn = (await client.query(
    `SELECT credit_note_number, customer_id, amount, from_date, to_date, status, description
       FROM customer_credit_notes
      WHERE serial_id = $1 OR ttspl_ids::text ILIKE $2
      ORDER BY credit_note_id DESC`,
    [SERIAL_ID, `%${TTSPL}%`]
  )).rows;
  const inv = (await client.query(
    `SELECT status, stage FROM inventory WHERE machine_number = $1`,
    [TTSPL]
  )).rows[0] || null;
  return { vsn, rdcs, items, credit_notes: cn, inventory: inv };
}

async function main() {
  const preview = await snapshot(pool);
  const calc = calcReturnCreditNoteAmount({
    rentMonthlyRate: preview.vsn?.rent_monthly_rate,
    returnDate: RETURN_AT,
    rentBilledUntil: preview.vsn?.rent_billed_until,
  });

  console.log(JSON.stringify({
    dry_run: !COMMIT,
    return_date: toLocalYmd(RETURN_AT),
    credit_preview: calc,
    before: preview,
  }, null, 2));

  if (!COMMIT) {
    console.log('Pass --commit to apply.');
    await pool.end();
    return;
  }

  if (!preview.vsn) throw new Error(`${TTSPL} not found`);
  if (Number(preview.vsn.current_customer_id) !== NOTUS_CUSTOMER_ID) {
    throw new Error(`${TTSPL} is not currently on Notus (customer ${NOTUS_CUSTOMER_ID})`);
  }
  if (preview.vsn.inventory_status !== 'rented') {
    throw new Error(`${TTSPL} inventory_status is ${preview.vsn.inventory_status}, expected rented`);
  }
  if (!calc) throw new Error('Credit note amount could not be calculated');

  const client = await pool.connect();
  let floorTicketId = null;
  let creditNote = null;
  try {
    await client.query('BEGIN');

    // 1. Close superseded RDC001402 — do not restore inventory to customer 252.
    await client.query(
      `UPDATE delivery_challan_lines
          SET status = 'cancelled',
              remarks = CASE
                WHEN remarks IS NULL OR BTRIM(remarks) = '' THEN $2
                ELSE remarks || E'\\n' || $2
              END,
              updated_at = NOW()
        WHERE dc_number = $1 AND movement_type = 'return'`,
      [OLD_RDC, OLD_RDC_REMARK]
    );
    await client.query(
      `UPDATE support_ticket_items
          SET status = 'cancelled',
              warehouse_received_at = NULL,
              warehouse_esign_url = NULL,
              warehouse_esign_at = NULL,
              warehouse_esign_by = NULL,
              warehouse_esign_name = NULL,
              reached_warehouse_at = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [OLD_PICKUP_ID]
    );
    await client.query(
      `UPDATE support_tickets
          SET cancellation_remark = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [OLD_TICKET_ID, OLD_RDC_REMARK]
    );
    await client.query(
      `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        OLD_PICKUP_ID,
        OLD_TICKET_ID,
        ACTOR_USER_ID,
        'return_dc_superseded',
        JSON.stringify({
          return_dc_number: OLD_RDC,
          customer_id: OLD_CUSTOMER_ID,
          reason: OLD_RDC_REMARK,
        }),
      ]
    );

    // 2. Credit note first — warehouse receive clears current_customer_id.
    creditNote = await billing.createReturnCreditNote(client, {
      serialId: SERIAL_ID,
      returnDate: RETURN_AT,
      returnTicketId: NEW_TICKET_ID,
      actorUserId: ACTOR_USER_ID,
    });
    if (!creditNote) throw new Error('createReturnCreditNote returned null');

    // 3. Warehouse-receive RDC001524 as of 29 Aug 2026.
    await client.query(
      `UPDATE support_ticket_items
          SET warehouse_received_at = NULL,
              warehouse_esign_url = NULL,
              warehouse_esign_at = NULL,
              warehouse_esign_by = NULL,
              warehouse_esign_name = NULL,
              reached_warehouse_at = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [NEW_PICKUP_ID]
    );

    const pickup = (await client.query(
      'SELECT * FROM support_ticket_items WHERE id = $1',
      [NEW_PICKUP_ID]
    )).rows[0];
    if (!pickup) throw new Error(`Pickup item ${NEW_PICKUP_ID} not found`);

    const ft = await createFloorTicketFromSupportPickup(client, pickup, ACTOR_USER_ID);
    floorTicketId = ft.ticket_id || null;
    if (!floorTicketId) {
      throw new Error(`Floor ticket was not created: ${ft.reason || 'unknown'}`);
    }

    await client.query(
      `UPDATE support_ticket_items SET
          warehouse_received_at = $2,
          reached_warehouse_at = COALESCE(reached_warehouse_at, $2),
          warehouse_received_by = $3,
          warehouse_esign_url = $4,
          warehouse_esign_at = $2,
          warehouse_esign_by = $3,
          warehouse_esign_name = $5,
          picked_up_at = COALESCE(picked_up_at, $2),
          customer_otp_verified_at = COALESCE(customer_otp_verified_at, $2),
          status = 'inventory_updated',
          resolved_at = COALESCE(resolved_at, $2),
          floor_ticket_id = $6,
          pickup_type = COALESCE(pickup_type, 'return'),
          updated_at = NOW()
        WHERE id = $1`,
      [
        NEW_PICKUP_ID,
        RETURN_AT,
        ACTOR_USER_ID,
        'system:received-2026-08-29-rdc001524',
        `${ACTOR_NAME} — warehouse received 29 Aug 2026`,
        floorTicketId,
      ]
    );

    await inventorySM.markReturned(client, SERIAL_ID, {
      reason: `Warehouse received via ${NEW_RDC} from Notus (29 Aug 2026)`,
      rentEndDate: toLocalYmd(RETURN_AT),
      actorUserId: ACTOR_USER_ID,
      actorName: ACTOR_NAME,
    });
    await client.query(
      `UPDATE vendor_serial_numbers SET
          current_customer_id = NULL,
          current_dc_number = NULL,
          returned_at = $2,
          rent_end_date = $3::date,
          extra = COALESCE(extra, '{}'::jsonb) || $4::jsonb,
          updated_at = NOW()
        WHERE serial_id = $1`,
      [
        SERIAL_ID,
        RETURN_AT,
        toLocalYmd(RETURN_AT),
        JSON.stringify({
          action_status: 'return',
          action_remark: `Returned from Notus on ${NEW_RDC} (warehouse received 29 Aug 2026)`,
          returned_at: RETURN_AT.toISOString(),
        }),
      ]
    );
    await resetVendorSerialForQcReentry(client, SERIAL_ID);

    await client.query(
      `UPDATE inventory SET status = 'Floor', stage = 'Floor Manager', updated_at = NOW()
        WHERE machine_number = $1 OR serial_number = $2`,
      [TTSPL, '5CD101G0N6']
    );

    await client.query(
      `UPDATE delivery_challan_lines SET
          status = 'delivered',
          delivered_at = $2,
          warehouse_received_at = $2,
          warehouse_received_by = $3,
          warehouse_receiver_name = $4,
          warehouse_receive_remarks = $5,
          updated_at = NOW()
        WHERE dc_number = $1 AND movement_type = 'return'`,
      [
        NEW_RDC,
        RETURN_AT,
        ACTOR_USER_ID,
        `${ACTOR_NAME} — warehouse received 29 Aug 2026`,
        `Physical return from Notus received 29 Aug 2026. Credit note for unused 30–31 Aug.`,
      ]
    );

    await client.query(
      `UPDATE support_tickets
          SET status = 'closed',
              last_activity_at = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [NEW_TICKET_ID, RETURN_AT]
    );

    await client.query(
      `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        NEW_PICKUP_ID,
        NEW_TICKET_ID,
        ACTOR_USER_ID,
        'warehouse_receipt_confirmed',
        JSON.stringify({
          pickup_type: 'return',
          floor_ticket_id: floorTicketId,
          signer_name: `${ACTOR_NAME} — warehouse received 29 Aug 2026`,
          credit_note_number: creditNote.credit_note_number,
          return_date: toLocalYmd(RETURN_AT),
        }),
      ]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  try {
    await regenerateReturnDcPdfByRdc(pool, NEW_RDC);
  } catch (pdfErr) {
    console.error('PDF regen failed:', pdfErr.message);
  }

  const after = await snapshot(pool);
  console.log(JSON.stringify({
    applied: true,
    credit_note: creditNote && {
      number: creditNote.credit_note_number,
      amount: creditNote.amount,
      from: creditNote.from_date,
      to: creditNote.to_date,
      status: creditNote.status,
    },
    floor_ticket_id: floorTicketId,
    after,
  }, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
