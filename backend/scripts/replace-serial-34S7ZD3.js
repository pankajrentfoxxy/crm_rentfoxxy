#!/usr/bin/env node
/** Replace serial 34S7ZD3 → 3457ZD3 (TTSPL3718) across CRM tables. */
const pool = require('../config/db');

const OLD = '34S7ZD3';
const NEW = '3457ZD3';

async function run(client, label, sql, params = []) {
  const r = await client.query(sql, params);
  const n = r.rowCount || 0;
  if (n) console.log(`  ${label}: ${n} row(s)`);
  return n;
}

async function main() {
  const client = await pool.connect();
  let total = 0;
  try {
    await client.query('BEGIN');
    console.log(`Replacing ${OLD} → ${NEW}…`);

    total += await run(client, 'vendor_serial_numbers.serial_number',
      `UPDATE vendor_serial_numbers SET serial_number = $2, updated_at = CURRENT_TIMESTAMP
       WHERE UPPER(TRIM(serial_number)) = $1`, [OLD, NEW]);

    total += await run(client, 'inventory.serial_number',
      `UPDATE inventory SET serial_number = $2, updated_at = CURRENT_TIMESTAMP
       WHERE UPPER(TRIM(serial_number)) = $1`, [OLD, NEW]);

    total += await run(client, 'tickets.serial_number',
      `UPDATE tickets SET serial_number = $2, updated_at = CURRENT_TIMESTAMP
       WHERE UPPER(TRIM(serial_number)) = $1`, [OLD, NEW]);

    total += await run(client, 'support_ticket_items.serial_number',
      `UPDATE support_ticket_items SET serial_number = $2, updated_at = CURRENT_TIMESTAMP
       WHERE UPPER(TRIM(serial_number)) = $1`, [OLD, NEW]);

    total += await run(client, 'production_assets.serial_number',
      `UPDATE production_assets SET serial_number = $2, updated_at = CURRENT_TIMESTAMP
       WHERE UPPER(TRIM(serial_number)) = $1`, [OLD, NEW]);

    total += await run(client, 'customer_asset_activity.serial_number',
      `UPDATE customer_asset_activity SET serial_number = $2
       WHERE UPPER(TRIM(serial_number)) = $1`, [OLD, NEW]);

    total += await run(client, 'inward_outward.serial_number',
      `UPDATE inward_outward SET serial_number = $2, updated_at = CURRENT_TIMESTAMP
       WHERE UPPER(TRIM(serial_number)) = $1`, [OLD, NEW]);

    total += await run(client, 'activities.notes',
      `UPDATE activities SET notes = REPLACE(notes, $1, $2)
       WHERE notes ILIKE $3`, [OLD, NEW, `%${OLD}%`]);

    total += await run(client, 'customer_invoices.line_items',
      `UPDATE customer_invoices SET line_items = REPLACE(line_items::text, $1, $2)::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE line_items::text ILIKE $3`, [OLD, NEW, `%${OLD}%`]);

    total += await run(client, 'support_requests.extra',
      `UPDATE support_requests SET extra = REPLACE(extra::text, $1, $2)::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE extra::text ILIKE $3`, [OLD, NEW, `%${OLD}%`]);

    for (const col of [
      'serial_number', 'delivered_serial_numbers', 'pickuped_serial_numbers',
      'returned_serial_numbers', 'rejected_serial_numbers', 'old_rejected_serial_numbers',
    ]) {
      total += await run(client, `delivery_challan_lines.${col}`,
        `UPDATE delivery_challan_lines SET ${col} = REPLACE(${col}::text, $1, $2)::jsonb
         WHERE ${col}::text ILIKE $3`, [OLD, NEW, `%${OLD}%`]);
    }

    await client.query('COMMIT');
    console.log(`Done. ${total} row update(s) across tables.`);

    const left = await pool.query(`
      SELECT 'vendor_serial_numbers' src, serial_id id, serial_number val FROM vendor_serial_numbers WHERE serial_number ILIKE $1
      UNION ALL SELECT 'inventory', inventory_id, serial_number FROM inventory WHERE serial_number ILIKE $1
      UNION ALL SELECT 'tickets', ticket_id, serial_number FROM tickets WHERE serial_number ILIKE $1
    `, [`%${OLD}%`]);
    if (left.rows.length) {
      console.warn('WARNING: old serial still found:', left.rows);
    } else {
      console.log('Verified: no remaining', OLD, 'in core serial columns.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
