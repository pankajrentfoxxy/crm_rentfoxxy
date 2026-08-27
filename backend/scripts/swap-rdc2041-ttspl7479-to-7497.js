#!/usr/bin/env node
/**
 * Clanify Media (customer 138) / ticket 2874 / RDC002041
 * Pickup was created for TTSPL7479; customer sent TTSPL7497.
 * Swap the Return DC + pickup line to 7497 (keep dates) and leave 7479
 * as a normal rented customer laptop with no pickup.
 *
 *   node scripts/swap-rdc2041-ttspl7479-to-7497.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');

const TICKET_ID = 2874;
const RDC = 'RDC002041';
const PICKUP_ITEM_ID = 3116;
const FROM_TTSPL = 'TTSPL7479';
const TO_TTSPL = 'TTSPL7497';
const COMMIT = process.argv.includes('--commit');

async function main() {
  const from = (await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, current_customer_id, extra
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL AND inventory_asset_code = $1`,
    [FROM_TTSPL]
  )).rows[0];
  const to = (await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, current_customer_id, extra
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL AND inventory_asset_code = $1`,
    [TO_TTSPL]
  )).rows[0];
  if (!from || !to) throw new Error('Both TTSPLs must exist');
  if (Number(to.current_customer_id) !== 138) {
    throw new Error(`${TO_TTSPL} is not with customer 138`);
  }

  const extra = to.extra || {};
  const serialToken = `${to.serial_id}|${to.serial_number}|${to.inventory_asset_code}`;
  const remarks = `Replacement against:\n\nTTSPL: ${TO_TTSPL}\nSerial No: ${to.serial_number}\n\nCorrected: customer sent ${TO_TTSPL} instead of ${FROM_TTSPL}.`;

  console.log(JSON.stringify({
    dry_run: !COMMIT,
    from: { ttspl: from.inventory_asset_code, serial_id: from.serial_id, sn: from.serial_number, status: from.inventory_status },
    to: { ttspl: to.inventory_asset_code, serial_id: to.serial_id, sn: to.serial_number, status: to.inventory_status },
    rdc: RDC,
    ticket_id: TICKET_ID,
  }, null, 2));

  if (!COMMIT) {
    console.log('Pass --commit to apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE support_ticket_items
          SET ttspl_id = $2,
              unique_serial_number = $2,
              serial_number = $3,
              brand = COALESCE($4, brand),
              model = COALESCE($5, model),
              ram = COALESCE($6, ram),
              storage = COALESCE($7, storage),
              generation = COALESCE($8, generation),
              processor = COALESCE($9, processor),
              remarks = $10,
              updated_at = NOW()
        WHERE id = $1`,
      [
        PICKUP_ITEM_ID,
        TO_TTSPL,
        to.serial_number,
        extra.brand || 'HP',
        extra.model || extra.model_name || 'HP ProBook 640 G5',
        extra.ram || '8',
        extra.storage || '256',
        extra.generation || null,
        extra.processor || null,
        `Customer sent ${TO_TTSPL} instead of ${FROM_TTSPL}`,
      ]
    );

    await client.query(
      `UPDATE support_tickets
          SET ttspl_id = $2,
              serial_number = $3,
              dc_number = 'DC/26-27/0936',
              updated_at = NOW()
        WHERE id = $1`,
      [TICKET_ID, TO_TTSPL, to.serial_number]
    );

    await client.query(
      `UPDATE delivery_challan_lines
          SET serial_number = $2::jsonb,
              original_dc_number = 'DC/26-27/0936',
              remarks = $3,
              updated_at = NOW()
        WHERE dc_number = $1 AND movement_type = 'return'`,
      [RDC, JSON.stringify([serialToken]), remarks]
    );

    await client.query(
      `UPDATE support_replacement_orders
          SET old_machine_serial = $2,
              old_serial_id = $3
        WHERE ticket_id = $1 AND pickup_item_id = $4`,
      [TICKET_ID, TO_TTSPL, to.serial_id, PICKUP_ITEM_ID]
    );

    await client.query(
      `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
       VALUES ($1, $2, NULL, 'pickup_serial_corrected', $3::jsonb)`,
      [PICKUP_ITEM_ID, TICKET_ID, JSON.stringify({
        reason: 'customer_sent_different_laptop',
        from_ttspl: FROM_TTSPL,
        from_serial: from.serial_number,
        to_ttspl: TO_TTSPL,
        to_serial: to.serial_number,
        return_dc_number: RDC,
        dates_preserved: true,
      })]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  try {
    await regenerateReturnDcPdfByRdc(pool, RDC);
    console.log('Return DC PDF regenerated');
  } catch (pdfErr) {
    console.error('PDF regenerate failed:', pdfErr.message);
  }

  const check = await pool.query(
    `SELECT sti.ttspl_id, sti.serial_number, sti.status, sti.picked_up_at, sti.warehouse_received_at,
            sti.return_dc_number, t.ttspl_id AS ticket_ttspl,
            dcl.serial_number AS rdc_serials, dcl.created_at, dcl.dispatched_at
       FROM support_ticket_items sti
       JOIN support_tickets t ON t.id = sti.ticket_id
       JOIN delivery_challan_lines dcl ON dcl.dc_number = sti.return_dc_number AND dcl.movement_type = 'return'
      WHERE sti.id = $1`,
    [PICKUP_ITEM_ID]
  );
  console.log('Updated pickup:', JSON.stringify(check.rows[0], null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
