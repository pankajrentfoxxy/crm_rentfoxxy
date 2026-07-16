/**
 * Reset TTSPL7494: remove from SO + ready inventory, keep PO/GRN serial row,
 * purge floor/QC history, create fresh Floor Manager ticket.
 *
 * Usage: node backend/scripts/reset-ttspl7494-to-floor.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { createTicketFromGrnReceive } = require('../services/grnTicketService');

const TTSPL = 'TTSPL7494';
const ACTOR_USER_ID = 2;

async function tableExists(client, name) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return r.rows.length > 0;
}

async function deleteByTicketIds(client, ticketIds) {
  if (!ticketIds.length) return;

  await client.query(
    `UPDATE delivery_challan_lines SET pre_dispatch_qc_ticket_id = NULL WHERE pre_dispatch_qc_ticket_id = ANY($1::int[])`,
    [ticketIds]
  );
  await client.query(
    `UPDATE support_ticket_items SET floor_ticket_id = NULL WHERE floor_ticket_id = ANY($1::int[])`,
    [ticketIds]
  );
  await client.query(
    `UPDATE part_instances SET installed_ticket_id = NULL, installed_at = NULL WHERE installed_ticket_id = ANY($1::int[])`,
    [ticketIds]
  );
  await client.query(
    `UPDATE sales_order_serials SET qc_ticket_id = NULL WHERE qc_ticket_id = ANY($1::int[])`,
    [ticketIds]
  );
  await client.query(
    `UPDATE customer_credit_notes SET return_ticket_id = NULL WHERE return_ticket_id = ANY($1::int[])`,
    [ticketIds]
  );
  await client.query(
    `UPDATE vendor_debit_notes SET return_ticket_id = NULL WHERE return_ticket_id = ANY($1::int[])`,
    [ticketIds]
  );

  const ticketTables = [
    'qc_photos', 'diagnosis_images', 'diagnosis_parts_required', 'ticket_part_blocks',
    'activities', 'work_logs', 'ticket_parts', 'photos', 'ticket_services',
    'ticket_checklist_progress', 'chip_level_repairs', 'qc_results', 'diagnosis_results',
    'part_requests', 'ttspl_config_history', 'dc_qc_tickets',
  ];

  for (const tbl of ticketTables) {
    if (!(await tableExists(client, tbl))) continue;
    const col = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'ticket_id'`,
      [tbl]
    );
    if (!col.rows.length) continue;
    await client.query(`DELETE FROM ${tbl} WHERE ticket_id = ANY($1::int[])`, [ticketIds]);
  }

  await client.query(`DELETE FROM tickets WHERE ticket_id = ANY($1::int[])`, [ticketIds]);
}

async function main() {
  const client = await pool.connect();
  try {
    const serialRes = await client.query(
      `SELECT vsn.*, p.purchase_order_number
         FROM vendor_serial_numbers vsn
         LEFT JOIN vendor_purchase_orders p ON p.po_id = vsn.po_id
        WHERE vsn.deleted_at IS NULL
          AND (vsn.inventory_asset_code ILIKE $1 OR vsn.serial_number ILIKE $1)
        ORDER BY vsn.serial_id DESC
        LIMIT 1`,
      [TTSPL]
    );
    if (!serialRes.rows.length) {
      console.log(`No active serial found for ${TTSPL}`);
      return;
    }
    const serial = serialRes.rows[0];
    console.log('Serial:', {
      serial_id: serial.serial_id,
      serial_number: serial.serial_number,
      inventory_asset_code: serial.inventory_asset_code,
      po_id: serial.po_id,
      grn_id: serial.grn_id,
      inventory_status: serial.inventory_status,
      qc_status: serial.qc_status,
    });

    const ticketRes = await client.query(
      `SELECT ticket_id FROM tickets
        WHERE vendor_serial_id = $1
           OR ttspl_id = $2
           OR serial_number ILIKE $3`,
      [serial.serial_id, serial.inventory_asset_code, serial.serial_number]
    );
    const ticketIds = ticketRes.rows.map((r) => r.ticket_id);
    console.log('Tickets to purge:', ticketIds);

    await client.query('BEGIN');

    // Detach from any sales order
    const detach = await client.query(
      `UPDATE sales_order_serials
          SET status = 'removed', qc_status = 'failed', updated_at = NOW()
        WHERE serial_id = $1 AND status = 'attached'
        RETURNING allocation_id, sales_order_number`,
      [serial.serial_id]
    );
    if (detach.rows.length) {
      console.log('Detached from SO:', detach.rows);
    }

    // Release reservation / move off ready shelf
    const status = String(serial.inventory_status || '').toLowerCase();
    if (status === 'reserved') {
      await inventorySM.backToStock(client, serial.serial_id, {
        reason: `Reset ${TTSPL} from SO — back to floor`,
        actorUserId: ACTOR_USER_ID,
        actorName: 'Reset script',
      });
    }
    await inventorySM.transitionAsset(client, {
      serialId: serial.serial_id,
      toStatus: inventorySM.STATUS.IN_REPAIR,
      reason: `Reset ${TTSPL} to floor pipeline`,
      actorUserId: ACTOR_USER_ID,
      actorName: 'Reset script',
      allowOverride: true,
    });

    await client.query(
      `UPDATE vendor_serial_numbers
          SET qc_status = 'pending',
              current_customer_id = NULL,
              current_dc_number = NULL,
              updated_at = NOW()
        WHERE serial_id = $1`,
      [serial.serial_id]
    );

    if (await tableExists(client, 'production_assets')) {
      await client.query(
        `DELETE FROM production_asset_changes
          WHERE production_asset_id IN (
            SELECT production_asset_id FROM production_assets
             WHERE vendor_serial_id = $1 OR serial_number = $2 OR ttspl_id = $3
          )`,
        [serial.serial_id, serial.serial_number, serial.inventory_asset_code]
      );
      const pa = await client.query(
        `DELETE FROM production_assets
          WHERE vendor_serial_id = $1 OR serial_number = $2 OR ttspl_id = $3`,
        [serial.serial_id, serial.serial_number, serial.inventory_asset_code]
      );
      if (pa.rowCount) console.log(`Deleted ${pa.rowCount} production_assets row(s)`);
    }

    if (await tableExists(client, 'dispatch_qc_capture_tokens')) {
      await client.query(
        `DELETE FROM dispatch_qc_capture_tokens
          WHERE serial_id = $1 OR ticket_id = ANY($2::int[])`,
        [serial.serial_id, ticketIds.length ? ticketIds : [-1]]
      );
    }
    if (await tableExists(client, 'qc2_capture_tokens')) {
      await client.query(
        `DELETE FROM qc2_capture_tokens
          WHERE production_asset_id IN (
            SELECT production_asset_id FROM production_assets WHERE vendor_serial_id = $1
          ) OR ticket_id = ANY($2::int[])`,
        [serial.serial_id, ticketIds.length ? ticketIds : [-1]]
      );
    }

    if (await tableExists(client, 'inventory')) {
      await client.query(
        `DELETE FROM inventory WHERE serial_number = $1 OR machine_number = $2`,
        [serial.serial_number, serial.inventory_asset_code]
      );
    }

    await deleteByTicketIds(client, ticketIds);

    const extra = serial.extra || {};
    const frozen = serial.grn_received_config || {};
    const line = {
      brand: frozen.brand || extra.brand,
      model: frozen.model || extra.model || extra.model_name,
      processor: frozen.processor || extra.processor,
      generation: frozen.generation || extra.generation,
      ram: frozen.ram || extra.ram,
      storage: frozen.storage || extra.storage || extra.ssd,
      ssd: frozen.storage || extra.ssd || extra.storage,
      product_detail_id: extra.product_detail_id,
      grn_id: serial.grn_id,
    };
    const po = {
      po_id: serial.po_id,
      purchase_order_number: serial.purchase_order_number,
      grn_id: serial.grn_id,
    };

    const ticket = await createTicketFromGrnReceive(client, {
      serialId: serial.serial_id,
      serialNumber: serial.serial_number,
      inventoryAssetCode: serial.inventory_asset_code,
      po,
      line,
      actorUserId: ACTOR_USER_ID,
      initialConditionOverride: `Re-opened from PO/GRN — ${po.purchase_order_number || po.po_id}`,
      grnId: serial.grn_id,
    });

    if (!ticket.ok) {
      throw new Error(ticket.message || ticket.reason || 'Failed to create floor ticket');
    }

    await client.query('COMMIT');

    const verify = await pool.query(
      `SELECT serial_id, inventory_asset_code, qc_status, inventory_status, deleted_at
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [serial.serial_id]
    );
    console.log('Done.');
    console.log('Serial state:', verify.rows[0]);
    console.log('New floor ticket:', ticket.ticket_id);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Reset failed:', e.message || e);
  process.exit(1);
});
