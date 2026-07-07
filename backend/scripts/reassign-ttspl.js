#!/usr/bin/env node
/**
 * Reassign TTSPL code for a laptop serial across all CRM tables.
 * Usage: node scripts/reassign-ttspl.js PF31SJBW TTSPL7117 TTSPL6170 [--apply]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');

const serialNumber = process.argv[2];
const oldTtspl = process.argv[3];
const newTtspl = process.argv[4];
const apply = process.argv.includes('--apply');

if (!serialNumber || !oldTtspl || !newTtspl) {
  console.error('Usage: node scripts/reassign-ttspl.js <serial_number> <old_ttspl> <new_ttspl> [--apply]');
  process.exit(1);
}

async function countRows(client, sql, params) {
  try {
    const r = await client.query(sql, params);
    return r.rows[0]?.c || 0;
  } catch {
    return 0;
  }
}

async function main() {
  const client = await pool.connect();
  const plan = [];

  try {
    const vsn = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code
         FROM vendor_serial_numbers
        WHERE serial_number ILIKE $1 AND deleted_at IS NULL`,
      [serialNumber]
    );
    if (!vsn.rows.length) throw new Error(`Serial ${serialNumber} not found`);
    const serialId = vsn.rows[0].serial_id;

    const conflict = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code
         FROM vendor_serial_numbers
        WHERE (inventory_asset_code ILIKE $1
               OR extra->>'ttspl_id' ILIKE $1
               OR extra->>'unique_product_serial' ILIKE $1)
          AND serial_id <> $2
          AND deleted_at IS NULL`,
      [newTtspl, serialId]
    );
    if (conflict.rows.length) {
      plan.push({
        step: 'clear_conflict',
        detail: `Clear ${newTtspl} from spare serial_id=${conflict.rows[0].serial_id} (${conflict.rows[0].serial_number})`,
      });
    }

    const tableUpdates = [
      {
        step: 'vendor_serial_numbers',
        countSql: 'SELECT COUNT(*)::int AS c FROM vendor_serial_numbers WHERE serial_id = $1',
        countParams: [serialId],
        sql: `UPDATE vendor_serial_numbers
                 SET inventory_asset_code = $3,
                     extra = jsonb_set(
                       jsonb_set(
                         jsonb_set(COALESCE(extra, '{}'::jsonb), '{ttspl_id}', to_jsonb($3::text)),
                         '{unique_product_serial}', to_jsonb($3::text)
                       ),
                       '{status}', to_jsonb('passed'::text)
                     ),
                     updated_at = NOW()
               WHERE serial_id = $1`,
        params: [serialId, oldTtspl, newTtspl],
      },
      {
        step: 'sales_order_serials',
        countSql: 'SELECT COUNT(*)::int AS c FROM sales_order_serials WHERE serial_id = $1 AND ttspl_id ILIKE $2',
        sql: 'UPDATE sales_order_serials SET ttspl_id = $3, updated_at = NOW() WHERE serial_id = $1 AND ttspl_id ILIKE $2',
        params: [serialId, oldTtspl, newTtspl],
      },
      {
        step: 'customer_invoice_lines',
        countSql: 'SELECT COUNT(*)::int AS c FROM customer_invoice_lines WHERE serial_id = $1 AND ttspl_id ILIKE $2',
        sql: 'UPDATE customer_invoice_lines SET ttspl_id = $3 WHERE serial_id = $1 AND ttspl_id ILIKE $2',
        params: [serialId, oldTtspl, newTtspl],
      },
      {
        step: 'inventory_status_transitions',
        countSql: 'SELECT COUNT(*)::int AS c FROM inventory_status_transitions WHERE serial_id = $1 AND ttspl_id ILIKE $2',
        sql: 'UPDATE inventory_status_transitions SET ttspl_id = $3 WHERE serial_id = $1 AND ttspl_id ILIKE $2',
        params: [serialId, oldTtspl, newTtspl],
      },
      {
        step: 'ttspl_audit_log',
        countSql: 'SELECT COUNT(*)::int AS c FROM ttspl_audit_log WHERE vendor_serial_id = $1 AND ttspl_id ILIKE $2',
        sql: 'UPDATE ttspl_audit_log SET ttspl_id = $3 WHERE vendor_serial_id = $1 AND ttspl_id ILIKE $2',
        params: [serialId, oldTtspl, newTtspl],
      },
      {
        step: 'tickets.ttspl_id',
        countSql: 'SELECT COUNT(*)::int AS c FROM tickets WHERE vendor_serial_id = $1 AND ttspl_id ILIKE $2',
        sql: 'UPDATE tickets SET ttspl_id = $3, updated_at = NOW() WHERE vendor_serial_id = $1 AND ttspl_id ILIKE $2',
        params: [serialId, oldTtspl, newTtspl],
      },
      {
        step: 'tickets.machine_number',
        countSql: 'SELECT COUNT(*)::int AS c FROM tickets WHERE vendor_serial_id = $1 AND machine_number ILIKE $2',
        sql: 'UPDATE tickets SET machine_number = $3, updated_at = NOW() WHERE vendor_serial_id = $1 AND machine_number ILIKE $2',
        params: [serialId, oldTtspl, newTtspl],
      },
      {
        step: 'support_ticket_items.unique_serial_number',
        countSql: 'SELECT COUNT(*)::int AS c FROM support_ticket_items WHERE serial_number ILIKE $3 AND unique_serial_number ILIKE $1',
        sql: 'UPDATE support_ticket_items SET unique_serial_number = $2 WHERE serial_number ILIKE $3 AND unique_serial_number ILIKE $1',
        params: [oldTtspl, newTtspl, serialNumber],
      },
      {
        step: 'support_ticket_items.ttspl_id',
        countSql: 'SELECT COUNT(*)::int AS c FROM support_ticket_items WHERE serial_number ILIKE $3 AND ttspl_id ILIKE $1',
        sql: 'UPDATE support_ticket_items SET ttspl_id = $2 WHERE serial_number ILIKE $3 AND ttspl_id ILIKE $1',
        params: [oldTtspl, newTtspl, serialNumber],
      },
      {
        step: 'support_tickets',
        countSql: `SELECT COUNT(*)::int AS c FROM support_tickets st
                    JOIN support_ticket_items sti ON sti.ticket_id = st.id
                   WHERE sti.serial_number ILIKE $4 AND st.ttspl_id ILIKE $2`,
        sql: `UPDATE support_tickets st
                 SET ttspl_id = $3, updated_at = NOW()
                FROM support_ticket_items sti
               WHERE sti.ticket_id = st.id
                 AND sti.serial_number ILIKE $4
                 AND st.ttspl_id ILIKE $2`,
        params: [serialId, oldTtspl, newTtspl, serialNumber],
      },
    ];

    for (const item of tableUpdates) {
      const rows = await countRows(client, item.countSql, item.params || item.countParams);
      if (rows > 0 || item.step === 'vendor_serial_numbers') {
        plan.push({ ...item, rows: item.step === 'vendor_serial_numbers' ? 1 : rows });
      }
    }

    const dcl = await client.query(
      `SELECT id, dc_number, serial_number FROM delivery_challan_lines
        WHERE serial_number::text ILIKE $1`,
      [`%${serialId}|${serialNumber}|${oldTtspl}%`]
    );
    for (const row of dcl.rows) {
      const updated = (row.serial_number || []).map((entry) => {
        const parts = String(entry).split('|');
        if (parts[0] === String(serialId) || parts[1] === serialNumber) {
          return `${parts[0]}|${parts[1]}|${newTtspl}`;
        }
        return entry;
      });
      plan.push({
        step: `delivery_challan_lines.${row.dc_number}`,
        sql: 'UPDATE delivery_challan_lines SET serial_number = $2::jsonb, updated_at = NOW() WHERE id = $1',
        params: [row.id, JSON.stringify(updated)],
        rows: 1,
      });
    }

    console.log(`\n=== TTSPL reassignment: ${serialNumber} ${oldTtspl} -> ${newTtspl} (serial_id=${serialId}) ===\n`);
    for (const p of plan) {
      console.log(`- ${p.step} (${p.rows} row(s))`);
      if (p.detail) console.log(`  ${p.detail}`);
    }

    if (!apply) {
      console.log('\nDry run only. Re-run with --apply to execute.\n');
      return;
    }

    await client.query('BEGIN');

    if (conflict.rows.length) {
      await client.query(
        `UPDATE vendor_serial_numbers
            SET inventory_asset_code = NULL,
                extra = extra - 'ttspl_id' - 'unique_product_serial',
                updated_at = NOW()
          WHERE serial_id = $1`,
        [conflict.rows[0].serial_id]
      );
      console.log(`Cleared conflicting ${newTtspl} from serial_id=${conflict.rows[0].serial_id}`);
    }

    for (const p of plan) {
      if (p.step === 'clear_conflict' || !p.sql) continue;
      const r = await client.query(p.sql, p.params);
      console.log(`Updated ${p.step}: ${r.rowCount} row(s)`);
    }

    await client.query('COMMIT');
    console.log('\nDone.\n');

    const verify = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code,
              extra->>'unique_product_serial' AS unique_product_serial
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [serialId]
    );
    console.log('Final vendor_serial_numbers:', verify.rows[0]);

    const oldLeft = await client.query(
      `SELECT COUNT(*)::int AS c FROM (
         SELECT ttspl_id FROM sales_order_serials WHERE serial_id=$1 AND ttspl_id ILIKE $2
         UNION ALL SELECT ttspl_id FROM customer_invoice_lines WHERE serial_id=$1 AND ttspl_id ILIKE $2
         UNION ALL SELECT ttspl_id FROM tickets WHERE vendor_serial_id=$1 AND ttspl_id ILIKE $2
         UNION ALL SELECT ttspl_id FROM ttspl_audit_log WHERE vendor_serial_id=$1 AND ttspl_id ILIKE $2
       ) x`,
      [serialId, oldTtspl]
    );
    console.log(`Remaining ${oldTtspl} refs for serial_id=${serialId}:`, oldLeft.rows[0].c);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
