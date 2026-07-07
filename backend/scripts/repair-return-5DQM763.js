#!/usr/bin/env node
/**
 * One-off repair: customer return for 5DQM763 (TTSPL6656) hit duplicate TTSPL row 3467
 * instead of the deployed unit 3642. Re-runs return completion on the correct serial.
 */
const pool = require('../config/db');
const { processReturnedSerials } = require('../services/returnCompletionService');

const CORRECT_SERIAL_ID = 3642;
const WRONG_SERIAL_ID = 3467;
const WRONG_TICKET_ID = 1427;
const SUPPORT_ITEM_ID = 1662;
const RETURN_DC = 'RDC001217';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE tickets SET
          status = 'completed',
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW()
       WHERE ticket_id = $1 AND status IN ('in_progress', 'on_hold')`,
      [WRONG_TICKET_ID]
    );

    await client.query(
      `UPDATE vendor_serial_numbers SET
          inventory_asset_code = NULL,
          inventory_status = 'in_stock',
          qc_status = 'passed',
          current_customer_id = NULL,
          extra = COALESCE(extra, '{}'::jsonb) || '{"status":"passed"}'::jsonb,
          updated_at = NOW()
       WHERE serial_id = $1`,
      [WRONG_SERIAL_ID]
    );

    const [out] = await processReturnedSerials(client, {
      serialIds: [CORRECT_SERIAL_ID],
      dcNumber: RETURN_DC,
      supportTicketId: null,
      actorUserId: null,
      actorName: 'repair-return-5DQM763',
    });

    await client.query(
      `UPDATE vendor_serial_numbers SET
          inventory_asset_code = COALESCE(inventory_asset_code, extra->>'unique_product_serial', 'TTSPL6656'),
          updated_at = NOW()
       WHERE serial_id = $1`,
      [CORRECT_SERIAL_ID]
    );

    if (out?.returnTicketId) {
      await client.query(
        `UPDATE support_ticket_items SET floor_ticket_id = $1, updated_at = NOW() WHERE id = $2`,
        [out.returnTicketId, SUPPORT_ITEM_ID]
      );
    }

    await client.query(
      `UPDATE delivery_challan_lines SET
          serial_number = $2::jsonb,
          updated_at = NOW()
       WHERE dc_number = $1 AND movement_type = 'return'`,
      [RETURN_DC, JSON.stringify([`${CORRECT_SERIAL_ID}|5DQM763|TTSPL6656`])]
    );

    await client.query('COMMIT');

    const verify = await pool.query(
      `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, qc_status,
              current_customer_id, extra->>'status' AS ex_status
         FROM vendor_serial_numbers
        WHERE serial_id IN ($1, $2)`,
      [CORRECT_SERIAL_ID, WRONG_SERIAL_ID]
    );
    console.log('Repair complete:', { returnTicketId: out?.returnTicketId, creditNote: out?.creditNote });
    console.log('Serial states:', verify.rows);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Repair failed:', e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
