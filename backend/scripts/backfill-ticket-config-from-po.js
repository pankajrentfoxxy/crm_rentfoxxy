/**
 * Backfill ticket + serial hardware config from PO line_items.
 * Usage: node backend/scripts/backfill-ticket-config-from-po.js <ticket_id|ttspl>
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../config/db');
const {
  parseExtra,
  resolveItemDescription,
  buildSerialSpecContext
} = require('../services/qcManagementService');
const { syncTicketHardwareConfig } = require('../services/qcProcessIntakeService');

const LOOKUP = (process.argv[2] || '').trim();
if (!LOOKUP) {
  console.error('Usage: node backend/scripts/backfill-ticket-config-from-po.js <ticket_id|ttspl>');
  process.exit(1);
}

async function main() {
  const isTicketId = /^\d+$/.test(LOOKUP);
  const r = await pool.query(
    `SELECT t.ticket_id, t.brand, t.model, t.processor, t.ram, t.storage,
            t.vendor_serial_id, t.serial_number, t.ttspl_id,
            s.extra AS serial_extra, s.po_id,
            p.line_items, p.product_details_legacy_ids
       FROM tickets t
       LEFT JOIN vendor_serial_numbers s ON s.serial_id = t.vendor_serial_id
       LEFT JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
      WHERE ${isTicketId ? 't.ticket_id = $1' : '(t.ttspl_id = $1 OR s.inventory_asset_code = $1)'}
      ORDER BY t.created_at DESC
      LIMIT 1`,
    [isTicketId ? Number(LOOKUP) : LOOKUP]
  );

  if (!r.rows.length) {
    console.error('Ticket not found for lookup:', LOOKUP);
    process.exit(1);
  }

  const row = r.rows[0];
  if (!row.po_id || !row.line_items) {
    console.error('Ticket has no linked PO line_items:', row.ticket_id);
    process.exit(1);
  }

  const specCtx = await buildSerialSpecContext(pool, [
    {
      extra: row.serial_extra,
      line_items: row.line_items,
      product_details_legacy_ids: row.product_details_legacy_ids,
      serial_number: row.serial_number
    }
  ]);
  const itemDesc = resolveItemDescription(
    {
      extra: row.serial_extra,
      line_items: row.line_items,
      product_details_legacy_ids: row.product_details_legacy_ids
    },
    specCtx
  );

  console.log('Before ticket #', row.ticket_id, {
    brand: row.brand,
    model: row.model,
    processor: row.processor,
    ram: row.ram,
    storage: row.storage
  });
  console.log('Resolved config:', itemDesc);

  await syncTicketHardwareConfig(pool, {
    ticketId: row.ticket_id,
    serialId: row.vendor_serial_id,
    itemDesc
  });

  const after = await pool.query(
    `SELECT t.brand, t.model, t.processor, t.ram, t.storage, s.extra
       FROM tickets t
       LEFT JOIN vendor_serial_numbers s ON s.serial_id = t.vendor_serial_id
      WHERE t.ticket_id = $1`,
    [row.ticket_id]
  );
  const updated = after.rows[0];
  console.log('After ticket #', row.ticket_id, {
    brand: updated.brand,
    model: updated.model,
    processor: updated.processor,
    ram: updated.ram,
    storage: updated.storage,
    serial_extra: parseExtra(updated.extra)
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
