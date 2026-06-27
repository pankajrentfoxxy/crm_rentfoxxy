/**
 * Fix / restore a laptop TTSPL code and optional undelete.
 * Usage: node scripts/fix-laptop-ttspl.js <oem_serial> <target_ttspl>
 * Example: node scripts/fix-laptop-ttspl.js CN01P49R TTSPL7378
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../config/db');
const { ensureFloorTicketForQcSerial } = require('../services/qcProcessIntakeService');

const OEM_SERIAL = (process.argv[2] || '').trim().toUpperCase();
const TARGET_TTSPL = (process.argv[3] || 'TTSPL7378').trim().toUpperCase();

if (!OEM_SERIAL) {
  console.error('Usage: node scripts/fix-laptop-ttspl.js <oem_serial> [target_ttspl]');
  process.exit(1);
}

async function clearDeletedConflict(client, ttspl, keepSerialId) {
  const clash = await client.query(
    `SELECT serial_id, serial_number, deleted_at FROM vendor_serial_numbers
      WHERE UPPER(inventory_asset_code) = $1 AND serial_id <> $2`,
    [ttspl, keepSerialId]
  );
  for (const row of clash.rows) {
    const suffix = row.deleted_at ? '-DEL' : '-OLD';
    const newCode = `${ttspl}${suffix}-${row.serial_id}`;
    await client.query(
      `UPDATE vendor_serial_numbers
          SET inventory_asset_code = $1,
              extra = jsonb_set(COALESCE(extra, '{}'::jsonb), '{unique_product_serial}', to_jsonb($1::text), true),
              updated_at = NOW()
        WHERE serial_id = $2`,
      [newCode, row.serial_id]
    );
    console.log(`  cleared clash: serial ${row.serial_id} (${row.serial_number}) → ${newCode}`);
  }
}

async function main() {
  const client = await pool.connect();
  try {
    const found = await client.query(
      `SELECT s.*, p.purchase_order_number, p.purchase_order_type, p.vendor_id
         FROM vendor_serial_numbers s
         LEFT JOIN vendor_purchase_orders p ON p.po_id = s.po_id
        WHERE UPPER(s.serial_number) = $1
        ORDER BY s.serial_id DESC
        LIMIT 1`,
      [OEM_SERIAL]
    );

    if (!found.rows.length) {
      console.error(`No laptop found with serial ${OEM_SERIAL}`);
      process.exit(1);
    }

    const row = found.rows[0];
    console.log('Found:', {
      serial_id: row.serial_id,
      serial_number: row.serial_number,
      inventory_asset_code: row.inventory_asset_code,
      deleted_at: row.deleted_at,
    });

    await client.query('BEGIN');
    await clearDeletedConflict(client, TARGET_TTSPL, row.serial_id);

    const extra = { ...(row.extra || {}), unique_product_serial: TARGET_TTSPL };
    delete extra.deleted_reason;

    await client.query(
      `UPDATE vendor_serial_numbers
          SET deleted_at = NULL,
              inventory_asset_code = $1,
              inventory_status = COALESCE(NULLIF(inventory_status, 'deleted'), 'in_stock'),
              qc_status = COALESCE(NULLIF(qc_status, ''), 'pending'),
              extra = $2::jsonb,
              updated_at = NOW()
        WHERE serial_id = $3`,
      [TARGET_TTSPL, JSON.stringify(extra), row.serial_id]
    );
    console.log(`  updated ${OEM_SERIAL} → ${TARGET_TTSPL} (restored if was deleted)`);

    await client.query('COMMIT');

    const line = {
      brand: extra.brand || '',
      model: extra.model || '',
      processor: extra.processor || '',
      generation: extra.generation || '',
      ram: extra.ram || '',
      storage: extra.storage || '',
    };

    const ticketResult = await ensureFloorTicketForQcSerial(pool, {
      serialId: row.serial_id,
      serialNumber: row.serial_number,
      inventoryAssetCode: TARGET_TTSPL,
      po: {
        po_id: row.po_id,
        purchase_order_number: row.purchase_order_number,
        purchase_order_type: row.purchase_order_type,
        vendor_id: row.vendor_id,
      },
      line,
      actorUserId: null,
      sourceNote: `Restored — TTSPL set to ${TARGET_TTSPL}`,
    });

    console.log('Ticket:', ticketResult);
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
  console.error('Failed:', err.message || err.code || String(err));
  if (err.stack && !err.message) console.error(err.stack);
  process.exit(1);
});
