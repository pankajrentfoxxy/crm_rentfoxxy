#!/usr/bin/env node
/**
 * TTSPL6170 was physically warehouse-received on 31 Aug 2026 but CRM recorded
 * TTSPL6107 (wrong support pickup / RDC001191). This script:
 *   1. Reverts the erroneous warehouse receipt on TTSPL6107 (PRO-ALIGN repair)
 *   2. Warehouse-receives TTSPL6170 on RDC002163 (Easy Fix return)
 *
 *   node scripts/fix-ttspl6170-6107-warehouse-mismatch.js
 *   node scripts/fix-ttspl6170-6107-warehouse-mismatch.js --commit
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

const COMMIT = process.argv.includes('--commit');

const WRONG = {
  ttspl: 'TTSPL6107',
  serialId: 3236,
  pickupId: 1470,
  ticketId: 1470,
  rdc: 'RDC001191',
  customerId: 260,
  floorTicketId: 3101,
  wrongWhAt: new Date('2026-08-31T09:03:01.754Z'),
};

const CORRECT = {
  ttspl: 'TTSPL6170',
  serialId: 3771,
  serialNumber: 'PF31SJBW',
  pickupId: 3467,
  ticketId: 3141,
  rdc: 'RDC002163',
  customerId: 141,
};

const ACTOR_USER_ID = 54;
const ACTOR_NAME = 'System fix — TTSPL6170/6107 warehouse mismatch';
const RETURN_AT = new Date('2026-08-31T15:00:00+05:30');

const REMARK =
  'Data fix 1 Sep 2026: warehouse receipt was logged on TTSPL6107 in error; ' +
  'physical unit received was TTSPL6170 (RDC002163 / Easy Fix).';

async function snapshot(client) {
  const pick = async (id) => (await client.query('SELECT * FROM support_ticket_items WHERE id = $1', [id])).rows[0];
  const vsn = async (sid) => (await client.query(
    `SELECT serial_id, inventory_asset_code, inventory_status, qc_status,
            current_customer_id, current_dc_number, rent_end_date, returned_at, rent_billed_until
       FROM vendor_serial_numbers WHERE serial_id = $1`,
    [sid]
  )).rows[0];
  const rdc = async (num) => (await client.query(
    `SELECT dc_number, status, delivered_at, warehouse_received_at
       FROM delivery_challan_lines WHERE dc_number = $1 AND movement_type = 'return'`,
    [num]
  )).rows[0];
  const ticket = async (id) => (await client.query(
    'SELECT ticket_id, status, ticket_type FROM tickets WHERE ticket_id = $1',
    [id]
  )).rows[0] || null;

  return {
    wrong_pickup: await pick(WRONG.pickupId),
    correct_pickup: await pick(CORRECT.pickupId),
    wrong_vsn: await vsn(WRONG.serialId),
    correct_vsn: await vsn(CORRECT.serialId),
    wrong_rdc: await rdc(WRONG.rdc),
    correct_rdc: await rdc(CORRECT.rdc),
    wrong_floor: await ticket(WRONG.floorTicketId),
    credit_preview: calcReturnCreditNoteAmount({
      rentMonthlyRate: (await vsn(CORRECT.serialId))?.rent_billed_until && (await client.query(
        'SELECT rent_monthly_rate FROM vendor_serial_numbers WHERE serial_id = $1',
        [CORRECT.serialId]
      )).rows[0]?.rent_monthly_rate,
      returnDate: RETURN_AT,
      rentBilledUntil: (await vsn(CORRECT.serialId))?.rent_billed_until,
    }),
  };
}

async function main() {
  const before = await snapshot(pool);
  console.log(JSON.stringify({ dry_run: !COMMIT, return_date: toLocalYmd(RETURN_AT), before }, null, 2));

  if (!COMMIT) {
    console.log('Pass --commit to apply.');
    await pool.end();
    return;
  }

  if (!before.correct_pickup) throw new Error('TTSPL6170 pickup item not found');
  if (before.correct_pickup.warehouse_received_at) {
    throw new Error('TTSPL6170 is already warehouse-received');
  }
  if (before.correct_vsn?.inventory_status !== 'rented') {
    throw new Error(`TTSPL6170 expected rented, got ${before.correct_vsn?.inventory_status}`);
  }

  const calc = calcReturnCreditNoteAmount({
    rentMonthlyRate: before.correct_vsn.rent_monthly_rate
      || (await pool.query('SELECT rent_monthly_rate FROM vendor_serial_numbers WHERE serial_id = $1', [CORRECT.serialId])).rows[0]?.rent_monthly_rate,
    returnDate: RETURN_AT,
    rentBilledUntil: before.correct_vsn.rent_billed_until,
  });
  if (!calc) throw new Error('Could not calculate return credit note for TTSPL6170');

  const client = await pool.connect();
  let floorTicketId = null;
  let creditNote = null;

  try {
    await client.query('BEGIN');

    // --- 1. Revert erroneous TTSPL6107 warehouse receipt ---
    await client.query(
      `UPDATE tickets SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE ticket_id = $1 AND serial_number = 'PF31SJN6'`,
      [WRONG.floorTicketId]
    );
    await client.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes)
       VALUES ($1, $2, 'cancelled', $3)`,
      [WRONG.floorTicketId, ACTOR_USER_ID, REMARK]
    );

    await client.query(
      `UPDATE support_ticket_items SET
          status = 'picked_up',
          warehouse_received_at = NULL,
          warehouse_esign_url = NULL,
          warehouse_esign_at = NULL,
          warehouse_esign_by = NULL,
          warehouse_esign_name = NULL,
          reached_warehouse_at = NULL,
          warehouse_received_by = NULL,
          floor_ticket_id = NULL,
          updated_at = NOW()
        WHERE id = $1`,
      [WRONG.pickupId]
    );

    await client.query(
      `UPDATE delivery_challan_lines SET
          status = 'in_transit',
          delivered_at = NULL,
          warehouse_received_at = NULL,
          warehouse_received_by = NULL,
          warehouse_receiver_name = NULL,
          warehouse_receive_remarks = CASE
            WHEN warehouse_receive_remarks IS NULL OR BTRIM(warehouse_receive_remarks) = '' THEN $2
            ELSE warehouse_receive_remarks || E'\\n' || $2
          END,
          updated_at = NOW()
        WHERE dc_number = $1 AND movement_type = 'return'`,
      [WRONG.rdc, REMARK]
    );

    await inventorySM.transitionAsset(client, {
      serialId: WRONG.serialId,
      toStatus: 'returned',
      reason: REMARK,
      actorUserId: ACTOR_USER_ID,
      actorName: ACTOR_NAME,
      allowOverride: true,
    });
    await client.query(
      `UPDATE vendor_serial_numbers SET
          qc_status = 'passed',
          extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb,
          updated_at = NOW()
        WHERE serial_id = $1`,
      [
        WRONG.serialId,
        JSON.stringify({
          action_status: 'repair_pickup_in_transit',
          action_remark: 'Repair pickup in transit — erroneous warehouse receipt reverted',
        }),
      ]
    );

    await client.query(
      `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        WRONG.pickupId,
        WRONG.ticketId,
        ACTOR_USER_ID,
        'warehouse_receipt_reverted',
        JSON.stringify({ reason: REMARK, wrong_wh_at: WRONG.wrongWhAt.toISOString() }),
      ]
    );

    // --- 2. Warehouse-receive TTSPL6170 on RDC002163 ---
    creditNote = await billing.createReturnCreditNote(client, {
      serialId: CORRECT.serialId,
      returnDate: RETURN_AT,
      returnTicketId: CORRECT.ticketId,
      actorUserId: ACTOR_USER_ID,
      supportTicketId: CORRECT.ticketId,
      returnDcNumber: CORRECT.rdc,
    });
    if (!creditNote) throw new Error('createReturnCreditNote returned null for TTSPL6170');

    await client.query(
      `UPDATE support_ticket_items SET
          gate_inward_at = COALESCE(gate_inward_at, $2),
          updated_at = NOW()
        WHERE id = $1`,
      [CORRECT.pickupId, RETURN_AT]
    );

    const pickup = (await client.query('SELECT * FROM support_ticket_items WHERE id = $1', [CORRECT.pickupId])).rows[0];
    const ft = await createFloorTicketFromSupportPickup(client, pickup, ACTOR_USER_ID);
    floorTicketId = ft.ticket_id || null;
    if (!floorTicketId) throw new Error(`Floor ticket not created: ${ft.reason || 'unknown'}`);

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
        CORRECT.pickupId,
        RETURN_AT,
        ACTOR_USER_ID,
        'system:fix-ttspl6170-rdc002163',
        `${ACTOR_NAME} — warehouse received 31 Aug 2026`,
        floorTicketId,
      ]
    );

    await inventorySM.markReturned(client, CORRECT.serialId, {
      reason: `Warehouse received via ${CORRECT.rdc} (data fix — physical unit TTSPL6170)`,
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
        CORRECT.serialId,
        RETURN_AT,
        toLocalYmd(RETURN_AT),
        JSON.stringify({
          action_status: 'return',
          action_remark: `Returned from Easy Fix on ${CORRECT.rdc} (warehouse received 31 Aug 2026)`,
          returned_at: RETURN_AT.toISOString(),
        }),
      ]
    );
    await resetVendorSerialForQcReentry(client, CORRECT.serialId);

    await client.query(
      `UPDATE inventory SET status = 'Floor', stage = 'Floor Manager', updated_at = NOW()
        WHERE machine_number = $1 OR serial_number = $2`,
      [CORRECT.ttspl, CORRECT.serialNumber]
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
        CORRECT.rdc,
        RETURN_AT,
        ACTOR_USER_ID,
        `${ACTOR_NAME} — warehouse received 31 Aug 2026`,
        REMARK,
      ]
    );

    await client.query(
      `UPDATE support_tickets
          SET status = 'closed',
              last_activity_at = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [CORRECT.ticketId, RETURN_AT]
    );

    await client.query(
      `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        CORRECT.pickupId,
        CORRECT.ticketId,
        ACTOR_USER_ID,
        'warehouse_receipt_confirmed',
        JSON.stringify({
          pickup_type: 'return',
          floor_ticket_id: floorTicketId,
          credit_note_number: creditNote.credit_note_number,
          return_date: toLocalYmd(RETURN_AT),
          data_fix: true,
          reason: REMARK,
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
    await regenerateReturnDcPdfByRdc(pool, CORRECT.rdc);
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
