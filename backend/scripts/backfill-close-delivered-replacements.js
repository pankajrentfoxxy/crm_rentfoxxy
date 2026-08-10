/**
 * Close stuck support replacement tickets where outbound delivery is done
 * and the faulty-unit pickup leg is complete, but the ticket stayed open
 * (e.g. #2335 — onReplacementReturnPickedUp previously did not stamp
 * pickup_completed_at / call tryCloseReplacementTicket).
 *
 * Usage:
 *   node scripts/backfill-close-delivered-replacements.js --dry-run
 *   node scripts/backfill-close-delivered-replacements.js
 *   node scripts/backfill-close-delivered-replacements.js --ticket=2335
 */
const pool = require('../config/db');
const replacementFlow = require('../services/supportReplacementFlowService');

async function findCandidates(client, ticketId) {
  const params = [];
  let filter = '';
  if (ticketId) {
    params.push(ticketId);
    filter = `AND t.id = $${params.length}`;
  }
  const { rows } = await client.query(
    `
    SELECT DISTINCT t.id AS ticket_id, t.status AS ticket_status
      FROM support_tickets t
      JOIN support_replacement_orders o ON o.ticket_id = t.id
     WHERE t.status NOT IN ('closed', 'cancelled')
       AND o.status NOT IN ('completed', 'cancelled')
       ${filter}
       AND EXISTS (
         SELECT 1 FROM support_replacement_orders o2
          WHERE o2.ticket_id = t.id
            AND o2.status NOT IN ('completed', 'cancelled')
            AND o2.delivery_completed_at IS NOT NULL
       )
       AND (
         EXISTS (
           SELECT 1 FROM support_replacement_orders o3
            WHERE o3.ticket_id = t.id
              AND o3.status NOT IN ('completed', 'cancelled')
              AND o3.pickup_completed_at IS NOT NULL
         )
         OR EXISTS (
           SELECT 1 FROM support_ticket_items i
            WHERE i.ticket_id = t.id
              AND i.item_type = 'pickup'
              AND i.return_dc_number IS NOT NULL
              AND (
                i.picked_up_at IS NOT NULL
                OR i.warehouse_received_at IS NOT NULL
                OR i.status IN ('picked_up', 'resolved', 'closed', 'inventory_updated')
              )
         )
       )
     ORDER BY t.id ASC
    `,
    params
  );
  return rows;
}

async function ensurePickupStamp(client, ticketId) {
  await client.query(
    `
    UPDATE support_replacement_orders o
       SET pickup_completed_at = COALESCE(
             o.pickup_completed_at,
             (
               SELECT MAX(COALESCE(i.warehouse_received_at, i.picked_up_at, i.updated_at))
                 FROM support_ticket_items i
                WHERE i.ticket_id = o.ticket_id
                  AND i.item_type = 'pickup'
                  AND (o.return_dc_number IS NULL OR i.return_dc_number = o.return_dc_number)
                  AND (
                    i.picked_up_at IS NOT NULL
                    OR i.warehouse_received_at IS NOT NULL
                    OR i.status IN ('picked_up', 'resolved', 'closed', 'inventory_updated')
                  )
             ),
             CURRENT_TIMESTAMP
           )
     WHERE o.ticket_id = $1
       AND o.status NOT IN ('completed', 'cancelled')
       AND o.delivery_completed_at IS NOT NULL
       AND o.pickup_completed_at IS NULL
    `,
    [ticketId]
  );
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v === undefined ? true : v];
    })
  );
  const dryRun = !!args['dry-run'] || !!args.dryRun;
  const ticketId = args.ticket ? Number(args.ticket) : null;
  if (args.ticket && Number.isNaN(ticketId)) {
    console.error('Invalid --ticket');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const candidates = await findCandidates(client, ticketId);
    console.log(`Found ${candidates.length} candidate ticket(s)${dryRun ? ' (dry-run)' : ''}`);
    if (!candidates.length) return;

    for (const row of candidates) {
      const tid = row.ticket_id;
      const orders = (
        await client.query(
          `SELECT id, status, delivery_completed_at, pickup_completed_at, sales_order_number, return_dc_number
             FROM support_replacement_orders WHERE ticket_id = $1 ORDER BY id`,
          [tid]
        )
      ).rows;
      console.log(
        `#${tid} status=${row.ticket_status} orders=${orders
          .map(
            (o) =>
              `${o.id}:${o.status}:del=${!!o.delivery_completed_at}:pick=${!!o.pickup_completed_at}`
          )
          .join(', ')}`
      );

      if (dryRun) continue;

      await client.query('BEGIN');
      try {
        await ensurePickupStamp(client, tid);
        const closed = await replacementFlow.tryCloseReplacementTicket(client, tid);
        await client.query('COMMIT');
        console.log(`  → ${closed ? 'CLOSED' : 'not closed (completion rule not met)'}`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`  → FAILED #${tid}:`, e.message);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
