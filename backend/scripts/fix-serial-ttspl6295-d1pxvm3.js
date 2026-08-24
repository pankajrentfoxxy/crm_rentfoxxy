#!/usr/bin/env node
/**
 * Correct OEM serial DIPXVM3 → D1PXVM3 for TTSPL6295 (vendor_serial_id 2518).
 * Usage: node scripts/fix-serial-ttspl6295-d1pxvm3.js [--commit]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');

const TTSPL = 'TTSPL6295';
const OLD_SERIAL = 'DIPXVM3';
const NEW_SERIAL = 'D1PXVM3';
const SERIAL_ID = 2518;
const PO_ID = 9;
const GRN_ID = 9;
const commit = process.argv.includes('--commit');

function replaceDcSerialEntry(entry) {
  const parts = String(entry).split('|');
  if (parts[0] === String(SERIAL_ID) && parts[2] === TTSPL) {
    return `${parts[0]}|${NEW_SERIAL}|${parts[2]}`;
  }
  return String(entry).replaceAll(OLD_SERIAL, NEW_SERIAL);
}

function patchLineItems(items) {
  if (!Array.isArray(items)) return items;
  let changed = false;
  const next = items.map((line) => {
    if (Number(line.serial_id) === SERIAL_ID || line.ttspl_id === TTSPL) {
      if (line.serial_number === OLD_SERIAL) {
        changed = true;
        return { ...line, serial_number: NEW_SERIAL };
      }
    }
    return line;
  });
  return changed ? next : null;
}

async function main() {
  const client = await pool.connect();
  const plan = [];

  try {
    const dup = await client.query(
      `SELECT serial_id FROM vendor_serial_numbers
        WHERE LOWER(serial_number) = LOWER($1) AND serial_id <> $2 AND deleted_at IS NULL`,
      [NEW_SERIAL, SERIAL_ID]
    );
    if (dup.rows.length) {
      throw new Error(`Target serial ${NEW_SERIAL} already used by serial_id=${dup.rows[0].serial_id}`);
    }

    const vsn = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code FROM vendor_serial_numbers WHERE serial_id = $1`,
      [SERIAL_ID]
    );
    if (!vsn.rows.length || vsn.rows[0].serial_number !== OLD_SERIAL) {
      throw new Error(`Expected ${OLD_SERIAL} on serial_id=${SERIAL_ID}, found ${vsn.rows[0]?.serial_number || 'missing'}`);
    }

    plan.push('vendor_serial_numbers');
    plan.push('serial_numbers (ERP mirror)');
    plan.push('inventory');
    plan.push('tickets #2740');
    plan.push('production_assets');
    plan.push('sales_order_serials');
    plan.push('delivery_challan_lines (DC-002069, RDC001814)');
    plan.push('inward_outward');
    plan.push('allocation_logs');
    plan.push('customer_asset_activity');
    plan.push('customer_invoices INV-0766, INV-0023');
    plan.push('support_tickets #2545 + items');
    plan.push('production history remarks');
    plan.push('activities notes');
    plan.push('vendor_serial_number_audit');

    console.log(`\n=== Fix serial ${TTSPL}: ${OLD_SERIAL} → ${NEW_SERIAL} (serial_id=${SERIAL_ID}) ===\n`);
    for (const step of plan) console.log(`- ${step}`);

    if (!commit) {
      console.log('\nDry run. Re-run with --commit to apply.\n');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE vendor_serial_numbers SET serial_number = $1, updated_at = NOW() WHERE serial_id = $2`,
      [NEW_SERIAL, SERIAL_ID]
    );

    await client.query(
      `UPDATE serial_numbers SET serial_number = $1, updated_at = NOW() WHERE id = $2`,
      [NEW_SERIAL, SERIAL_ID]
    );

    await client.query(
      `UPDATE inventory SET serial_number = $1, updated_at = NOW() WHERE inventory_id = (
         SELECT (extra->>'inventory_id')::int FROM vendor_serial_numbers WHERE serial_id = $2
       ) OR (machine_number = $3 AND serial_number = $4)`,
      [NEW_SERIAL, SERIAL_ID, TTSPL, OLD_SERIAL]
    );

    await client.query(
      `UPDATE tickets SET serial_number = $1, updated_at = NOW()
        WHERE vendor_serial_id = $2 OR (ttspl_id = $3 AND serial_number = $4)`,
      [NEW_SERIAL, SERIAL_ID, TTSPL, OLD_SERIAL]
    );

    await client.query(
      `UPDATE production_assets SET serial_number = $1, updated_at = NOW()
        WHERE vendor_serial_id = $2 OR (ttspl_id = $3 AND serial_number = $4)`,
      [NEW_SERIAL, SERIAL_ID, TTSPL, OLD_SERIAL]
    );

    await client.query(
      `UPDATE sales_order_serials SET serial_number = $1, updated_at = NOW() WHERE serial_id = $2`,
      [NEW_SERIAL, SERIAL_ID]
    );

    const dclRows = await client.query(
      `SELECT id, dc_number, serial_number, delivered_serial_numbers, remarks
         FROM delivery_challan_lines
        WHERE serial_number::text ILIKE $1
           OR delivered_serial_numbers::text ILIKE $1
           OR remarks ILIKE $1`,
      [`%${OLD_SERIAL}%`]
    );
    for (const row of dclRows.rows) {
      const serialNumber = (row.serial_number || []).map(replaceDcSerialEntry);
      const delivered = row.delivered_serial_numbers
        ? row.delivered_serial_numbers.map(replaceDcSerialEntry)
        : row.delivered_serial_numbers;
      const remarks = row.remarks
        ? String(row.remarks).replaceAll(OLD_SERIAL, NEW_SERIAL)
        : row.remarks;
      await client.query(
        `UPDATE delivery_challan_lines
            SET serial_number = $2::jsonb,
                delivered_serial_numbers = $3::jsonb,
                remarks = $4,
                updated_at = NOW()
          WHERE id = $1`,
        [
          row.id,
          JSON.stringify(serialNumber),
          delivered ? JSON.stringify(delivered) : null,
          remarks,
        ]
      );
      console.log(`  updated ${row.dc_number}`);
    }

    await client.query(
      `UPDATE inward_outward SET serial_number = $1, updated_at = NOW()
        WHERE vendor_serial_id = $2 OR (unique_number = $3 AND serial_number = $4)`,
      [NEW_SERIAL, SERIAL_ID, TTSPL, OLD_SERIAL]
    );

    await client.query(
      `UPDATE allocation_logs SET serial_number = $1 WHERE serial_number = $2 AND id IN (
         SELECT id FROM allocation_logs WHERE serial_number = $2
       )`,
      [NEW_SERIAL, OLD_SERIAL]
    );

    await client.query(
      `UPDATE customer_asset_activity SET serial_number = $1 WHERE serial_number = $2`,
      [NEW_SERIAL, OLD_SERIAL]
    );

    const invoices = await client.query(
      `SELECT invoice_id, invoice_number, line_items FROM customer_invoices
        WHERE invoice_id IN (1149, 406) OR line_items::text LIKE $1`,
      [`%"serial_id": ${SERIAL_ID}%`]
    );
    for (const inv of invoices.rows) {
      const patched = patchLineItems(inv.line_items);
      if (patched) {
        await client.query(
          `UPDATE customer_invoices SET line_items = $1::jsonb, updated_at = NOW() WHERE invoice_id = $2`,
          [JSON.stringify(patched), inv.invoice_id]
        );
        console.log(`  updated invoice ${inv.invoice_number}`);
      }
    }

    await client.query(
      `UPDATE support_tickets SET serial_number = $1, updated_at = NOW()
        WHERE serial_number = $2 AND ttspl_id = $3`,
      [NEW_SERIAL, OLD_SERIAL, TTSPL]
    );

    await client.query(
      `UPDATE support_ticket_items SET serial_number = $1, updated_at = NOW()
        WHERE serial_number = $2 AND ttspl_id = $3`,
      [NEW_SERIAL, OLD_SERIAL, TTSPL]
    );

    await client.query(
      `UPDATE production_assignment_history SET remarks = REPLACE(remarks, $1, $2)
        WHERE remarks ILIKE $3`,
      [OLD_SERIAL, NEW_SERIAL, `%${OLD_SERIAL}%`]
    );

    await client.query(
      `UPDATE production_ticket_history SET remarks = REPLACE(remarks, $1, $2)
        WHERE remarks ILIKE $3`,
      [OLD_SERIAL, NEW_SERIAL, `%${OLD_SERIAL}%`]
    );

    await client.query(
      `UPDATE activities SET notes = REPLACE(notes, $1, $2)
        WHERE notes ILIKE $3`,
      [OLD_SERIAL, NEW_SERIAL, `%${OLD_SERIAL}%`]
    );

    await client.query(
      `INSERT INTO vendor_serial_number_audit (po_id, grn_id, old_serial, new_serial, changed_by_user_id)
       VALUES ($1, $2, $3, $4, 1)`,
      [PO_ID, GRN_ID, OLD_SERIAL, NEW_SERIAL]
    );

    await client.query('COMMIT');

    const verify = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code FROM vendor_serial_numbers WHERE serial_id = $1`,
      [SERIAL_ID]
    );
    console.log('\nDone:', verify.rows[0]);
    console.log(`Ticket #2740 serial:`, (await client.query(
      'SELECT ticket_id, serial_number, ttspl_id, status FROM tickets WHERE ticket_id = 2740'
    )).rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('FAILED:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
