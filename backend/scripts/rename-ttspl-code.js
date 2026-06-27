/**
 * Rename a TTSPL asset code across vendor_serial_numbers and common references.
 * Usage: node scripts/rename-ttspl-code.js TTSPL378 TTSPL7378
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../config/db');

const FROM = (process.argv[2] || '').trim().toUpperCase();
const TO = (process.argv[3] || '').trim().toUpperCase();

if (!FROM || !TO || FROM === TO) {
  console.error('Usage: node scripts/rename-ttspl-code.js <from_ttspl> <to_ttspl>');
  process.exit(1);
}

async function main() {
  const client = await pool.connect();
  try {
    const src = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code, deleted_at
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (UPPER(inventory_asset_code) = $1
               OR UPPER(extra->>'unique_product_serial') = $1
               OR UPPER(extra->>'ttspl_id') = $1)
        ORDER BY serial_id`,
      [FROM]
    );

    if (!src.rows.length) {
      console.log(`No active laptop found with TTSPL ${FROM}.`);
      return;
    }

    const clash = await client.query(
      `SELECT serial_id, serial_number FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND UPPER(inventory_asset_code) = $1`,
      [TO]
    );
    if (clash.rows.length) {
      console.error(`Cannot rename: ${TO} is already active on serial ${clash.rows[0].serial_number} (#${clash.rows[0].serial_id})`);
      process.exit(1);
    }

    console.log(`Renaming ${FROM} → ${TO} for ${src.rows.length} active serial(s):`);
    for (const row of src.rows) {
      console.log(`  #${row.serial_id} ${row.serial_number}`);
    }

    await client.query('BEGIN');

    for (const row of src.rows) {
      await client.query(
        `UPDATE vendor_serial_numbers
            SET inventory_asset_code = $1::varchar,
                extra = COALESCE(extra, '{}'::jsonb)
                  || jsonb_build_object('unique_product_serial', $1::text, 'ttspl_id', $1::text),
                updated_at = NOW()
          WHERE serial_id = $2`,
        [TO, row.serial_id]
      );

      const ticketUp = await client.query(
        `UPDATE tickets SET ttspl_id = $1, machine_number = $1, updated_at = NOW()
          WHERE vendor_serial_id = $2 AND (ttspl_id = $3 OR machine_number = $3)`,
        [TO, row.serial_id, FROM]
      );
      if (ticketUp.rowCount) console.log(`  updated ${ticketUp.rowCount} ticket(s) for serial #${row.serial_id}`);

      if (await tableExists(client, 'ttspl_audit_log')) {
        const a = await client.query(
          `UPDATE ttspl_audit_log SET ttspl_id = $1 WHERE vendor_serial_id = $2 OR ttspl_id = $3`,
          [TO, row.serial_id, FROM]
        );
        if (a.rowCount) console.log(`  updated ${a.rowCount} audit log row(s)`);
      }

      if (await tableExists(client, 'inventory')) {
        const inv = await client.query(
          `UPDATE inventory SET machine_number = $1
            WHERE serial_number = $2 OR machine_number = $3`,
          [TO, row.serial_number, FROM]
        );
        if (inv.rowCount) console.log(`  updated ${inv.rowCount} inventory row(s)`);
      }

      if (await tableExists(client, 'sales_order_serials')) {
        const so = await client.query(
          `UPDATE sales_order_serials SET ttspl_id = $1 WHERE serial_id = $2 OR ttspl_id = $3`,
          [TO, row.serial_id, FROM]
        );
        if (so.rowCount) console.log(`  updated ${so.rowCount} sales_order_serials row(s)`);
      }
    }

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

async function tableExists(client, name) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return r.rows.length > 0;
}

main().catch((err) => {
  console.error('Rename failed:', err.message || err.code || String(err));
  process.exit(1);
});
