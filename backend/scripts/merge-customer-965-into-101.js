#!/usr/bin/env node
/**
 * Merge duplicate customer Kinolve (965) into ASCENT / customer 101.
 * Moves live + returned asset ownership and re-links return DCs, support tickets, SO lines.
 *
 * Usage:
 *   node scripts/merge-customer-965-into-101.js           # dry-run
 *   node scripts/merge-customer-965-into-101.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');

const FROM_ID = 965;
const TO_ID = 101;
const COMMIT = process.argv.includes('--commit');

/** Units incorrectly still "rented" on 965 but already returned on customer 101 RDCs. */
const RETURNED_NOT_ACTIVE = new Set(['TTSPL5695']);

async function countState(client, label) {
  const activeFrom = await client.query(
    `SELECT COUNT(*)::int AS c FROM vendor_serial_numbers
      WHERE current_customer_id = $1 AND deleted_at IS NULL`,
    [FROM_ID]
  );
  const activeTo = await client.query(
    `SELECT COUNT(*)::int AS c FROM vendor_serial_numbers
      WHERE current_customer_id = $1 AND deleted_at IS NULL`,
    [TO_ID]
  );
  const retFrom = await client.query(
    `SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines
      WHERE movement_type = 'return' AND customer_id = $1`,
    [FROM_ID]
  );
  const retTo = await client.query(
    `SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines
      WHERE movement_type = 'return' AND customer_id = $1`,
    [TO_ID]
  );
  console.log(`[${label}] active ${FROM_ID}=${activeFrom.rows[0].c} ${TO_ID}=${activeTo.rows[0].c} | return DCs ${FROM_ID}=${retFrom.rows[0].c} ${TO_ID}=${retTo.rows[0].c}`);
  return {
    activeFrom: activeFrom.rows[0].c,
    activeTo: activeTo.rows[0].c,
    retFrom: retFrom.rows[0].c,
    retTo: retTo.rows[0].c,
  };
}

async function main() {
  const target = await pool.query(
    `SELECT customer_id, name, company_name, email, phone
       FROM customers WHERE customer_id = $1`,
    [TO_ID]
  );
  if (!target.rows.length) throw new Error(`Target customer ${TO_ID} not found`);
  const src = await pool.query(
    `SELECT customer_id, name, company_name FROM customers WHERE customer_id = $1`,
    [FROM_ID]
  );
  if (!src.rows.length) throw new Error(`Source customer ${FROM_ID} not found`);

  const t = target.rows[0];
  const customerLabel = (t.company_name || t.name || '').trim();
  const customerEmail = t.email || null;
  const customerPhone = t.phone || null;

  console.log(`Merge customer ${FROM_ID} (${src.rows[0].company_name}) -> ${TO_ID} (${customerLabel})`);
  console.log(COMMIT ? 'MODE: COMMIT' : 'MODE: dry-run');

  const before = await countState(pool, 'before');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fix units that should not stay in "live" list on source customer.
    for (const ttspl of RETURNED_NOT_ACTIVE) {
      const r = await client.query(
        `SELECT serial_id, inventory_status, current_customer_id FROM vendor_serial_numbers
          WHERE inventory_asset_code = $1 AND deleted_at IS NULL`,
        [ttspl]
      );
      const row = r.rows[0];
      if (!row) continue;
      if (row.current_customer_id === FROM_ID && row.inventory_status === 'rented') {
        console.log(`Fix returned-not-active: ${ttspl}`);
        if (COMMIT) {
          await client.query(
            `UPDATE vendor_serial_numbers SET
                inventory_status = 'returned',
                current_customer_id = NULL,
                current_dc_number = NULL,
                rent_end_date = COALESCE(rent_end_date, '2026-05-29'),
                returned_at = COALESCE(returned_at, '2026-05-29T12:00:00.000Z'),
                updated_at = NOW()
             WHERE serial_id = $1`,
            [row.serial_id]
          );
        }
      }
    }

    const moveActive = await client.query(
      `SELECT serial_id, inventory_asset_code FROM vendor_serial_numbers
        WHERE current_customer_id = $1 AND deleted_at IS NULL
          AND inventory_asset_code <> ALL($2::text[])`,
      [FROM_ID, [...RETURNED_NOT_ACTIVE]]
    );
    console.log(`Move live assets: ${moveActive.rows.length}`);

    if (COMMIT && moveActive.rows.length) {
      await client.query(
        `UPDATE vendor_serial_numbers SET
            current_customer_id = $2,
            updated_at = NOW()
         WHERE current_customer_id = $1
           AND deleted_at IS NULL
           AND inventory_asset_code <> ALL($3::text[])`,
        [FROM_ID, TO_ID, [...RETURNED_NOT_ACTIVE]]
      );
    }

    const dcl = await client.query(
      `SELECT COUNT(*)::int AS c FROM delivery_challan_lines WHERE customer_id = $1`,
      [FROM_ID]
    );
    console.log(`Re-link delivery_challan_lines: ${dcl.rows[0].c}`);
    if (COMMIT && dcl.rows[0].c) {
      await client.query(
        `UPDATE delivery_challan_lines SET
            customer_id = $2,
            customer_name = $3,
            email = COALESCE(NULLIF(email, ''), $4),
            updated_at = NOW()
         WHERE customer_id = $1`,
        [FROM_ID, TO_ID, customerLabel, customerEmail]
      );
    }

    const st = await client.query(
      `SELECT COUNT(*)::int AS c FROM support_tickets WHERE customer_id = $1`,
      [FROM_ID]
    );
    console.log(`Re-link support_tickets: ${st.rows[0].c}`);
    if (COMMIT && st.rows[0].c) {
      await client.query(
        `UPDATE support_tickets SET
            customer_id = $2,
            customer_name = $3,
            customer_phone = COALESCE(NULLIF(customer_phone, ''), $4),
            updated_at = NOW()
         WHERE customer_id = $1`,
        [FROM_ID, TO_ID, customerLabel, customerPhone]
      );
    }

    const sol = await client.query(
      `SELECT COUNT(*)::int AS c FROM sales_order_lines WHERE customer_id = $1`,
      [FROM_ID]
    );
    console.log(`Re-link sales_order_lines: ${sol.rows[0].c}`);
    if (COMMIT && sol.rows[0].c) {
      await client.query(
        `UPDATE sales_order_lines SET
            customer_id = $2,
            customer_name = $3,
            updated_at = NOW()
         WHERE customer_id = $1`,
        [FROM_ID, TO_ID, customerLabel]
      );
    }

    const ist = await client.query(
      `SELECT COUNT(*)::int AS c FROM inventory_status_transitions WHERE customer_id = $1`,
      [FROM_ID]
    );
    console.log(`Re-link inventory_status_transitions: ${ist.rows[0].c}`);
    if (COMMIT && ist.rows[0].c) {
      await client.query(
        `UPDATE inventory_status_transitions SET customer_id = $2 WHERE customer_id = $1`,
        [FROM_ID, TO_ID]
      );
    }

    if (COMMIT) {
      await client.query(
        `UPDATE customers SET
            details = COALESCE(details, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
         WHERE customer_id = $1`,
        [
          FROM_ID,
          JSON.stringify({
            merged_into_customer_id: TO_ID,
            merged_at: new Date().toISOString(),
            merge_note: `Assets and return DCs moved to customer ${TO_ID} (${customerLabel})`,
          }),
        ]
      );
    }

    if (!COMMIT) {
      await client.query('ROLLBACK');
      console.log('\nDry-run complete — no changes written. Re-run with --commit to apply.');
    } else {
      await client.query('COMMIT');
      console.log('\nMerge committed.');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const after = await countState(pool, 'after');

  if (COMMIT) {
    const mismatch = await pool.query(
      `SELECT COUNT(*)::int AS c FROM vendor_serial_numbers vsn
        JOIN delivery_challan_lines dcl ON dcl.dc_number = vsn.current_dc_number
       WHERE vsn.current_customer_id = $1 AND vsn.deleted_at IS NULL
         AND dcl.customer_id IS DISTINCT FROM $1`,
      [TO_ID]
    );
    console.log(`Post-check: active assets on ${TO_ID} with DC on different customer: ${mismatch.rows[0].c}`);

    const leftOn965 = await pool.query(
      `SELECT COUNT(*)::int AS c FROM vendor_serial_numbers
        WHERE current_customer_id = $1 AND deleted_at IS NULL`,
      [FROM_ID]
    );
    console.log(`Remaining active on ${FROM_ID}: ${leftOn965.rows[0].c}`);

    const expectedActive = before.activeFrom - RETURNED_NOT_ACTIVE.size + before.activeTo;
    console.log(`Expected active on ${TO_ID}: ~${expectedActive}, actual: ${after.activeTo}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
