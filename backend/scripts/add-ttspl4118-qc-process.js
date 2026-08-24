#!/usr/bin/env node
/**
 * TTSPL4118 — put the returned Fleet Labs unit onto a QC Process floor ticket.
 *
 * Already inventory_status=returned (17 Jul) but qc_status is still ERP out_stock,
 * so it does not appear in QC Process and has no floor ticket.
 *
 *   node scripts/add-ttspl4118-qc-process.js           (dry-run)
 *   node scripts/add-ttspl4118-qc-process.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const {
  resetVendorSerialForQcReentry,
  createTicketFromReturn,
} = require('../services/grnTicketService');
const { invalidateInventoryListCachesFireAndForget } = require('../services/inventoryListCache');

const COMMIT = process.argv.includes('--commit');
const SERIAL_ID = 1346;
const TTSPL_ID = 'TTSPL4118';
const SERIAL_NUMBER = 'JL6S303';
const CUSTOMER_ID = 94;
const SUPPORT_ITEM_ID = 1839;
const SUPPORT_TICKET_ID = 1839;

async function main() {
  const vsnRes = await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, qc_status,
            current_customer_id, current_dc_number, extra, po_id
       FROM vendor_serial_numbers
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [SERIAL_ID]
  );
  if (!vsnRes.rows.length) throw new Error(`${TTSPL_ID} not found`);
  const vsn = vsnRes.rows[0];
  const extra = vsn.extra || {};

  const openFloor = await pool.query(
    `SELECT ticket_id, ticket_type, status
       FROM tickets
      WHERE (vendor_serial_id = $1 OR serial_number = $2 OR ttspl_id = $3)
        AND status IN ('in_progress', 'on_hold')
      ORDER BY ticket_id DESC LIMIT 1`,
    [SERIAL_ID, SERIAL_NUMBER, TTSPL_ID]
  );

  console.log('Asset:', vsn.inventory_asset_code, '/', vsn.serial_number);
  console.log('Status:', vsn.inventory_status, 'qc:', vsn.qc_status, 'customer:', vsn.current_customer_id);
  console.log('Open floor ticket:', openFloor.rows[0] || 'none');
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

  if (openFloor.rows.length) {
    console.log(`Already on floor ticket #${openFloor.rows[0].ticket_id}. Nothing to create.`);
    await pool.end();
    return;
  }

  if (!COMMIT) {
    console.log('Would: reset qc_status=pending, create return_qc floor ticket, link/close support pickup #1839.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await resetVendorSerialForQcReentry(client, SERIAL_ID);

    await client.query(
      `UPDATE vendor_serial_numbers SET
          current_customer_id = NULL,
          current_dc_number = NULL,
          extra = COALESCE(extra, '{}'::jsonb)
                  || jsonb_build_object('status', 'pending', 'action_status', 'pending'),
          updated_at = NOW()
        WHERE serial_id = $1`,
      [SERIAL_ID]
    );

    const tk = await createTicketFromReturn(client, {
      serialId: SERIAL_ID,
      serialNumber: SERIAL_NUMBER,
      inventoryAssetCode: TTSPL_ID,
      customerLabel: 'FLEET LABS TECHNOLOGIES PRIVATE LIMITED',
      dcNumber: vsn.current_dc_number || null,
      reason: 'Customer return — add to QC Process',
      specs: {
        brand: extra.brand,
        model: extra.model || extra.model_name,
        processor: extra.processor,
        ram: extra.ram,
        storage: extra.storage,
      },
      actorUserId: null,
    });

    if (!tk.ok) {
      throw new Error(`createTicketFromReturn failed: ${tk.reason || tk.message || JSON.stringify(tk)}`);
    }

    await client.query(
      `UPDATE support_ticket_items SET
          floor_ticket_id = $1,
          warehouse_received_at = COALESCE(warehouse_received_at, NOW()),
          reached_warehouse_at = COALESCE(reached_warehouse_at, NOW()),
          status = 'inventory_updated',
          resolved_at = COALESCE(resolved_at, NOW()),
          updated_at = NOW()
        WHERE id = $2`,
      [tk.ticket_id, SUPPORT_ITEM_ID]
    );

    await client.query(
      `UPDATE support_tickets SET
          status = CASE WHEN NOT EXISTS (
            SELECT 1 FROM support_ticket_items
             WHERE ticket_id = $1
               AND status NOT IN ('resolved', 'closed', 'inventory_updated', 'awaiting_service_return')
          ) THEN 'closed' ELSE status END,
          last_activity_at = NOW(),
          updated_at = NOW()
        WHERE id = $1`,
      [SUPPORT_TICKET_ID]
    );

    await client.query('COMMIT');
    invalidateInventoryListCachesFireAndForget();

    const after = await pool.query(
      `SELECT inventory_status, qc_status, current_customer_id
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [SERIAL_ID]
    );
    const floor = await pool.query(
      `SELECT t.ticket_id, t.ticket_type, t.status, s.stage_name
         FROM tickets t
         LEFT JOIN stages s ON s.stage_id = t.current_stage_id
        WHERE t.ticket_id = $1`,
      [tk.ticket_id]
    );

    console.log('After serial:', after.rows[0]);
    console.log('Floor ticket:', floor.rows[0]);
    console.log(`QC Process ticket #${tk.ticket_id} created for ${TTSPL_ID}.`);
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
