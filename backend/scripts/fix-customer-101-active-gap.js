#!/usr/bin/env node
/**
 * Close the 89 vs 83 active-asset gap on customer 101:
 *   - 4 units: return DC delivered but inventory still "rented" -> mark returned + warehouse receive
 *   - RDC001757: remove stale TTSPL6220 pickup (already returned via RDC001812)
 *
 * Usage:
 *   node scripts/fix-customer-101-active-gap.js
 *   node scripts/fix-customer-101-active-gap.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { resetVendorSerialForQcReentry, createFloorTicketFromSupportPickup } = require('../services/grnTicketService');

const COMMIT = process.argv.includes('--commit');
const CUSTOMER_ID = 101;

const DELIVERED_RETURNS = [
  { ttspl: 'TTSPL4029', itemId: 1931, rdc: 'RDC001407' },
  { ttspl: 'TTSPL4030', itemId: 1627, rdc: 'RDC001204' },
  { ttspl: 'TTSPL4277', itemId: 1628, rdc: 'RDC001205' },
  { ttspl: 'TTSPL4607', itemId: 1055, rdc: 'RDC000817' },
];

async function countUiActive(client) {
  const DEPLOYED = ['rented', 'on_demo', 'in_transit', 'sold', 'out_stock'];
  const r = await client.query(
    `SELECT COUNT(*)::int AS c
       FROM vendor_serial_numbers vsn
      WHERE vsn.current_customer_id = $1
        AND vsn.deleted_at IS NULL
        AND vsn.inventory_status = ANY($2::text[])
        AND NOT EXISTS (
          SELECT 1 FROM delivery_challan_lines rl
            LEFT JOIN LATERAL (
              SELECT COUNT(*)::int AS cnt,
                     BOOL_AND(sti.warehouse_received_at IS NOT NULL) AS all_received
                FROM support_ticket_items sti
               WHERE sti.return_dc_number = rl.dc_number AND sti.item_type = 'pickup'
            ) wh ON TRUE
           WHERE rl.movement_type = 'return'
             AND rl.customer_id = $1
             AND COALESCE(rl.status, '') NOT IN ('cancelled')
             AND (wh.cnt IS NULL OR wh.cnt = 0 OR wh.all_received IS NOT TRUE)
             AND (
               rl.delivered_at IS NOT NULL
               OR EXISTS (
                 SELECT 1 FROM support_ticket_items sti_pick
                  WHERE sti_pick.return_dc_number = rl.dc_number
                    AND sti_pick.item_type = 'pickup'
                    AND sti_pick.picked_up_at IS NOT NULL
                    AND (
                      sti_pick.ttspl_id = vsn.inventory_asset_code
                      OR sti_pick.serial_number = vsn.serial_number
                    )
               )
             )
             AND EXISTS (
               SELECT 1 FROM support_ticket_items sti2
                WHERE sti2.return_dc_number = rl.dc_number
                  AND sti2.item_type = 'pickup'
                  AND (
                    sti2.ttspl_id = vsn.inventory_asset_code
                    OR sti2.serial_number = vsn.serial_number
                  )
             )
        )`,
    [CUSTOMER_ID, DEPLOYED]
  );
  return r.rows[0].c;
}

async function main() {
  const client = await pool.connect();
  try {
    const rawBefore = await client.query(
      `SELECT COUNT(*)::int AS c FROM vendor_serial_numbers
        WHERE current_customer_id = $1 AND deleted_at IS NULL AND inventory_status = 'rented'`,
      [CUSTOMER_ID]
    );
    console.log(`Customer ${CUSTOMER_ID} rented (raw): ${rawBefore.rows[0].c}`);

    await client.query('BEGIN');

    for (const row of DELIVERED_RETURNS) {
      const vsnRes = await client.query(
        `SELECT serial_id, inventory_status, current_customer_id
           FROM vendor_serial_numbers
          WHERE inventory_asset_code = $1 AND deleted_at IS NULL`,
        [row.ttspl]
      );
      const vsn = vsnRes.rows[0];
      if (!vsn) {
        console.log(`Skip ${row.ttspl}: not found`);
        continue;
      }

      const rdcRes = await client.query(
        `SELECT delivered_at FROM delivery_challan_lines
          WHERE dc_number = $1 AND movement_type = 'return' LIMIT 1`,
        [row.rdc]
      );
      const whAt = rdcRes.rows[0]?.delivered_at || new Date();
      const rentEnd = whAt.toISOString().slice(0, 10);

      console.log(`Return ${row.ttspl} via ${row.rdc} (rent end ${rentEnd})`);

      if (COMMIT && vsn.current_customer_id === CUSTOMER_ID && vsn.inventory_status === 'rented') {
        await inventorySM.markReturned(client, vsn.serial_id, {
          reason: `Return via ${row.rdc} — data repair (customer 101 active gap)`,
          rentEndDate: rentEnd,
          actorName: 'fix-customer-101-active-gap',
        });
        await client.query(
          `UPDATE vendor_serial_numbers SET
              current_customer_id = NULL,
              current_dc_number = NULL,
              returned_at = $2,
              updated_at = NOW()
           WHERE serial_id = $1`,
          [vsn.serial_id, whAt]
        );
        await resetVendorSerialForQcReentry(client, vsn.serial_id);
      }

      if (COMMIT) {
        const itemRes = await client.query(
          `SELECT * FROM support_ticket_items WHERE id = $1`,
          [row.itemId]
        );
        const item = itemRes.rows[0];
        if (item && !item.warehouse_received_at) {
          await client.query(
            `UPDATE support_ticket_items SET
                picked_up_at = COALESCE(picked_up_at, $2),
                warehouse_received_at = $2,
                reached_warehouse_at = COALESCE(reached_warehouse_at, $2),
                status = 'inventory_updated',
                resolved_at = COALESCE(resolved_at, $2),
                updated_at = NOW()
             WHERE id = $1`,
            [row.itemId, whAt]
          );
          if (!item.floor_ticket_id) {
            const ft = await createFloorTicketFromSupportPickup(client, item, null);
            if (ft.ticket_id) {
              await client.query(
                `UPDATE support_ticket_items SET floor_ticket_id = $1 WHERE id = $2`,
                [ft.ticket_id, row.itemId]
              );
            }
          }
        }
      }
    }

    // Stale RDC001757 line for TTSPL6220 (already returned on RDC001812)
    console.log('Cancel stale RDC001757 pickup for TTSPL6220');
    if (COMMIT) {
      await client.query(
        `UPDATE support_ticket_items SET
            status = 'cancelled',
            updated_at = NOW()
         WHERE id = 2589 AND return_dc_number = 'RDC001757' AND ttspl_id = 'TTSPL6220'`
      );
      await client.query(
        `UPDATE delivery_challan_lines SET
            serial_number = (
              SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
                FROM jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(serial_number) = 'array' THEN serial_number ELSE '[]'::jsonb END
                ) AS elem
               WHERE elem NOT LIKE '%TTSPL6220%'
            ),
            updated_at = NOW()
         WHERE dc_number = 'RDC001757' AND movement_type = 'return'`
      );
    }

    if (!COMMIT) {
      await client.query('ROLLBACK');
      console.log('\nDry-run — re-run with --commit');
    } else {
      await client.query('COMMIT');
      console.log('\nCommitted.');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const rawAfter = await pool.query(
    `SELECT COUNT(*)::int AS c FROM vendor_serial_numbers
      WHERE current_customer_id = $1 AND deleted_at IS NULL AND inventory_status = 'rented'`,
    [CUSTOMER_ID]
  );
  console.log(`Rented on customer ${CUSTOMER_ID} after: ${rawAfter.rows[0].c}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
