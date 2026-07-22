const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../config/db');
const LOOKUP = (process.argv[2] || '').trim();
if (!LOOKUP) {
  console.error('Usage: node scripts/delete-laptop-by-serial.js <serial_or_ttspl>');
  process.exit(1);
}

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
    'qc_photos',
    'diagnosis_images',
    'diagnosis_parts_required',
    'ticket_part_blocks',
    'activities',
    'work_logs',
    'ticket_parts',
    'photos',
    'ticket_services',
    'ticket_checklist_progress',
    'chip_level_repairs',
    'qc_results',
    'diagnosis_results',
    'part_requests',
    'ttspl_config_history',
    'dc_qc_tickets',
  ];

  for (const tbl of ticketTables) {
    if (!(await tableExists(client, tbl))) continue;
    const col = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'ticket_id'`,
      [tbl]
    );
    if (!col.rows.length) continue;
    const r = await client.query(`DELETE FROM ${tbl} WHERE ticket_id = ANY($1::int[])`, [ticketIds]);
    if (r.rowCount) console.log(`  deleted ${r.rowCount} from ${tbl}`);
  }

  const delTickets = await client.query(`DELETE FROM tickets WHERE ticket_id = ANY($1::int[])`, [ticketIds]);
  console.log(`  deleted ${delTickets.rowCount} ticket(s)`);
}

async function deleteSerial(client, serialId, ttsplId, serialNumber) {
  if (await tableExists(client, 'sales_order_serials')) {
    const r = await client.query(`DELETE FROM sales_order_serials WHERE serial_id = $1`, [serialId]);
    if (r.rowCount) console.log(`  deleted ${r.rowCount} sales_order_serials row(s)`);
  }
  if (await tableExists(client, 'ttspl_audit_log')) {
    const r = await client.query(
      `DELETE FROM ttspl_audit_log WHERE vendor_serial_id = $1 OR ttspl_id = $2`,
      [serialId, ttsplId]
    );
    if (r.rowCount) console.log(`  deleted ${r.rowCount} ttspl_audit_log row(s)`);
  }
  if (await tableExists(client, 'inventory_status_transitions')) {
    const r = await client.query(`DELETE FROM inventory_status_transitions WHERE serial_id = $1`, [serialId]);
    if (r.rowCount) console.log(`  deleted ${r.rowCount} inventory_status_transitions row(s)`);
  }
  if (await tableExists(client, 'inventory')) {
    const r = await client.query(
      `DELETE FROM inventory WHERE serial_number = $1 OR machine_number = $2 OR machine_number = $3`,
      [serialNumber, ttsplId, serialNumber]
    );
    if (r.rowCount) console.log(`  deleted ${r.rowCount} legacy inventory row(s)`);
  }

  const soft = await client.query(
    `UPDATE vendor_serial_numbers
        SET deleted_at = NOW(), updated_at = NOW(),
            inventory_status = 'deleted',
            extra = COALESCE(extra, '{}'::jsonb) || '{"deleted_reason":"manual_cleanup"}'::jsonb
      WHERE serial_id = $1 AND deleted_at IS NULL
      RETURNING serial_id, serial_number, inventory_asset_code`,
    [serialId]
  );
  if (soft.rowCount) {
    console.log(`  soft-deleted serial ${soft.rows[0].serial_number} (${soft.rows[0].inventory_asset_code})`);
  }
}

async function main() {
  const client = await pool.connect();
  try {
    const serialRes = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (serial_number ILIKE $1 OR inventory_asset_code ILIKE $1
               OR extra->>'ttspl_id' ILIKE $1)
        ORDER BY serial_id DESC`,
      [LOOKUP]
    );

    if (!serialRes.rows.length) {
      console.log(`No active laptop found for "${LOOKUP}".`);
      return;
    }

    const { serial_id, serial_number, inventory_asset_code } = serialRes.rows[0];
    console.log('Found laptop:', { serial_id, serial_number, inventory_asset_code: inventory_asset_code });

    const ticketRes = await client.query(
      `SELECT ticket_id FROM tickets
        WHERE vendor_serial_id = $1
           OR ttspl_id = $2
           OR serial_number ILIKE $3
           OR machine_number ILIKE $2`,
      [serial_id, inventory_asset_code, serial_number]
    );
    const ticketIds = ticketRes.rows.map((r) => r.ticket_id);
    console.log('Tickets to delete:', ticketIds.length ? ticketIds.join(', ') : '(none)');

    await client.query('BEGIN');
    await deleteByTicketIds(client, ticketIds);
    await deleteSerial(client, serial_id, inventory_asset_code, serial_number);
    await client.query('COMMIT');

    console.log('Done.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Delete failed:', err.message || err.code || String(err));
  if (err.stack && !err.message) console.error(err.stack);
  process.exit(1);
});
