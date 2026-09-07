#!/usr/bin/env node
/**
 * Return DCs that already have warehouse e-sign on the PDF but still show
 * "Receive pending" because inventory was never flipped off the return customer.
 *
 * Marks warehouse received using warehouse_esign_at (never CURRENT_TIMESTAMP).
 *
 * Usage:
 *   node scripts/backfill-rdc-warehouse-received-esign-date.js
 *   node scripts/backfill-rdc-warehouse-received-esign-date.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { resetVendorSerialForQcReentry } = require('../services/grnTicketService');
const { regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');

const COMMIT = process.argv.includes('--commit');

const TARGET_RDCS_SQL = `
  WITH pickup_by_rdc AS (
    SELECT DISTINCT ON (return_dc_number)
           return_dc_number, warehouse_received_at, warehouse_esign_at, warehouse_esign_url,
           floor_ticket_id, ttspl_id, serial_number
      FROM support_ticket_items
     WHERE item_type = 'pickup' AND return_dc_number IS NOT NULL
     ORDER BY return_dc_number, id DESC
  ),
  pending_esigned AS (
    SELECT rl.dc_number, rl.customer_id
      FROM delivery_challan_lines rl
      LEFT JOIN pickup_by_rdc sti ON sti.return_dc_number = rl.dc_number
     WHERE rl.movement_type = 'return'
       AND rl.status = 'delivered'
       AND sti.warehouse_esign_at IS NOT NULL
       AND (
         sti.warehouse_received_at IS NULL
         OR (sti.warehouse_esign_at IS NULL AND sti.warehouse_esign_url IS NULL)
         OR sti.floor_ticket_id IS NULL
         OR EXISTS (
           SELECT 1 FROM vendor_serial_numbers v
            WHERE v.deleted_at IS NULL
              AND (
                v.inventory_asset_code = COALESCE(sti.ttspl_id, NULLIF(split_part(rl.serial_number->>0, '|', 3), ''))
                OR v.serial_number = COALESCE(sti.serial_number, NULLIF(split_part(rl.serial_number->>0, '|', 2), ''))
              )
              AND v.current_customer_id = rl.customer_id
              AND COALESCE(v.inventory_status, '') IN ('rented', 'on_demo', 'in_transit', 'out_stock')
         )
       )
  )
  SELECT dc_number, customer_id FROM pending_esigned ORDER BY dc_number
`;

async function findSerial(client, code) {
  if (!code) return null;
  const r = await client.query(
    `SELECT serial_id, inventory_asset_code, inventory_status, current_customer_id, returned_at
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (
          inventory_asset_code = $1
          OR serial_number = $1
          OR extra->>'ttspl_id' = $1
        )
      ORDER BY
        CASE WHEN inventory_asset_code = $1 THEN 0 ELSE 1 END,
        serial_id ASC
      LIMIT 1`,
    [code]
  );
  return r.rows[0] || null;
}

async function hasActiveOutbound(client, code) {
  const r = await client.query(
    `SELECT dc_number FROM delivery_challan_lines
      WHERE movement_type = 'outbound'
        AND status IN ('in_transit', 'reached', 'shipped')
        AND serial_number::text ILIKE '%' || $1 || '%'
      LIMIT 1`,
    [code]
  );
  return r.rows[0]?.dc_number || null;
}

async function processRdc(client, rdcNumber, customerId) {
  const itemsRes = await client.query(
    `SELECT * FROM support_ticket_items
      WHERE return_dc_number = $1 AND item_type = 'pickup'
        AND COALESCE(status, '') NOT IN ('cancelled')
      ORDER BY id ASC`,
    [rdcNumber]
  );
  const items = itemsRes.rows.filter(
    (i) => i.warehouse_esign_at || (i.warehouse_esign_url && String(i.warehouse_esign_url).trim())
  );
  if (!items.length) {
    return { rdcNumber, skipped: true, reason: 'no_warehouse_esign' };
  }

  const actions = [];
  let earliestReceivedAt = null;

  for (const item of items) {
    const receivedAt = item.warehouse_esign_at || item.warehouse_received_at;
    if (!receivedAt) {
      actions.push({ itemId: item.id, action: 'skip_no_esign_date' });
      continue;
    }
    if (!earliestReceivedAt || new Date(receivedAt) < new Date(earliestReceivedAt)) {
      earliestReceivedAt = receivedAt;
    }

    if (
      !item.warehouse_received_at
      || new Date(item.warehouse_received_at).getTime() !== new Date(receivedAt).getTime()
    ) {
      if (COMMIT) {
        await client.query(
          `UPDATE support_ticket_items SET
              warehouse_received_at = $2,
              reached_warehouse_at = COALESCE(reached_warehouse_at, $2),
              updated_at = NOW()
           WHERE id = $1`,
          [item.id, receivedAt]
        );
      }
      actions.push({ itemId: item.id, action: 'set_sti_received_at', at: receivedAt });
    }

    const code = item.ttspl_id || item.unique_serial_number || item.serial_number;
    const vsn = await findSerial(client, code);
    if (!vsn) {
      actions.push({ itemId: item.id, code, action: 'serial_not_found' });
      continue;
    }

    const stillWithReturnCustomer = Number(vsn.current_customer_id) === Number(customerId)
      && ['rented', 'on_demo', 'in_transit', 'out_stock'].includes(String(vsn.inventory_status || '').toLowerCase());

    if (!stillWithReturnCustomer) {
      actions.push({
        itemId: item.id,
        code,
        action: 'inventory_already_off_customer',
        status: vsn.inventory_status,
        customerId: vsn.current_customer_id,
      });
      continue;
    }

    const blockingDc = await hasActiveOutbound(client, code);
    if (blockingDc) {
      actions.push({ itemId: item.id, code, action: 'blocked_active_outbound', dc: blockingDc });
      continue;
    }

    const rentEndDate = receivedAt.toISOString().slice(0, 10);
    if (COMMIT) {
      // Silent inventory fix — do not call markReturned/logTtsplEvent (adds today's timeline).
      await client.query(
        `UPDATE vendor_serial_numbers SET
            inventory_status = 'returned',
            current_customer_id = NULL,
            current_dc_number = NULL,
            returned_at = $2,
            status_changed_at = $2,
            rent_end_date = COALESCE(rent_end_date, $3::date),
            updated_at = NOW()
         WHERE serial_id = $1`,
        [vsn.serial_id, receivedAt, rentEndDate]
      );
      await resetVendorSerialForQcReentry(client, vsn.serial_id);
    }
    actions.push({ itemId: item.id, code, action: 'mark_returned', at: receivedAt });
  }

  if (earliestReceivedAt) {
    if (COMMIT) {
      await client.query(
        `UPDATE delivery_challan_lines SET
            warehouse_received_at = $2
         WHERE dc_number = $1 AND movement_type = 'return'`,
        [rdcNumber, earliestReceivedAt]
      );
    }
    actions.push({ action: 'set_dcl_received_at', at: earliestReceivedAt });
  }

  return { rdcNumber, actions };
}

async function main() {
  const targets = await pool.query(TARGET_RDCS_SQL);
  console.log(JSON.stringify({
    dry_run: !COMMIT,
    target_rdc_count: targets.rows.length,
    rdcs: targets.rows.map((r) => r.dc_number),
  }, null, 2));

  const client = await pool.connect();
  const results = [];
  try {
    await client.query('BEGIN');
    for (const row of targets.rows) {
      const result = await processRdc(client, row.dc_number, row.customer_id);
      results.push(result);
      console.log(JSON.stringify(result, null, 2));
    }

    if (!COMMIT) {
      await client.query('ROLLBACK');
      console.log('\nDry-run complete — re-run with --commit to apply.');
    } else {
      await client.query('COMMIT');
      console.log('\nCommitted.');
      for (const row of targets.rows) {
        try {
          await regenerateReturnDcPdfByRdc(pool, row.dc_number);
        } catch (e) {
          console.error(`PDF regen failed for ${row.dc_number}:`, e.message);
        }
      }
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const verify = await pool.query(`
    WITH pickup_by_rdc AS (
      SELECT DISTINCT ON (return_dc_number)
             return_dc_number, warehouse_esign_at, warehouse_received_at, floor_ticket_id, ttspl_id, serial_number
        FROM support_ticket_items
       WHERE item_type = 'pickup' AND return_dc_number IS NOT NULL
       ORDER BY return_dc_number, id DESC
    )
    SELECT COUNT(*)::int AS remaining
      FROM delivery_challan_lines rl
      LEFT JOIN pickup_by_rdc sti ON sti.return_dc_number = rl.dc_number
     WHERE rl.movement_type = 'return'
       AND rl.status = 'delivered'
       AND sti.warehouse_esign_at IS NOT NULL
       AND (
         sti.warehouse_received_at IS NULL
         OR sti.floor_ticket_id IS NULL
         OR EXISTS (
           SELECT 1 FROM vendor_serial_numbers v
            WHERE v.deleted_at IS NULL
              AND (
                v.inventory_asset_code = COALESCE(sti.ttspl_id, NULLIF(split_part(rl.serial_number->>0, '|', 3), ''))
                OR v.serial_number = COALESCE(sti.serial_number, NULLIF(split_part(rl.serial_number->>0, '|', 2), ''))
              )
              AND v.current_customer_id = rl.customer_id
              AND COALESCE(v.inventory_status, '') IN ('rented', 'on_demo', 'in_transit', 'out_stock')
         )
       )
  `);
  console.log('Remaining pending esigned RDCs:', verify.rows[0].remaining);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
