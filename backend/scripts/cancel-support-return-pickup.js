/**
 * Cancel a support Return DC before pickup is completed.
 *
 * Usage:
 *   node scripts/cancel-support-return-pickup.js --ticket=1956 --rdc=RDC001461 --reason="Migrated data reset"
 */
const pool = require('../config/db');

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    })
  );
  const ticketId = Number(args.ticket);
  const rdc = String(args.rdc || '').trim();
  const reason = String(args.reason || 'Return pickup cancelled via script').trim();
  const cancelReplacement = args['keep-replacement'] !== 'true';

  if (!ticketId || !rdc) {
    console.error('Usage: node scripts/cancel-support-return-pickup.js --ticket=1956 --rdc=RDC001461 --reason="..."');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ticketRes = await client.query('SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    if (!ticketRes.rows.length) throw new Error('Ticket not found');
    const ticket = ticketRes.rows[0];

    const dcRes = await client.query(
      `SELECT status FROM delivery_challan_lines WHERE dc_number = $1 AND movement_type = 'return'`,
      [rdc]
    );
    if (!dcRes.rows.length) throw new Error(`Return DC ${rdc} not found`);
    if (String(dcRes.rows[0].status).toLowerCase() === 'delivered') {
      throw new Error('Return DC already delivered');
    }

    const pickupRes = await client.query(
      `SELECT id, picked_up_at, warehouse_received_at FROM support_ticket_items
        WHERE ticket_id = $1 AND item_type = 'pickup' AND return_dc_number = $2`,
      [ticketId, rdc]
    );
    for (const p of pickupRes.rows) {
      if (p.picked_up_at || p.warehouse_received_at) {
        throw new Error(`Pickup item ${p.id} already started`);
      }
    }

    await client.query(
      `UPDATE delivery_challan_lines SET status = 'cancelled', updated_at = NOW()
        WHERE dc_number = $1 AND movement_type = 'return'`,
      [rdc]
    );
    await client.query(
      `UPDATE support_ticket_items
          SET status = 'cancelled', return_dc_number = NULL, updated_at = NOW()
        WHERE ticket_id = $1 AND item_type = 'pickup' AND return_dc_number = $2`,
      [ticketId, rdc]
    );
    await client.query(
      `UPDATE support_ticket_items SET return_dc_number = NULL, updated_at = NOW()
        WHERE ticket_id = $1 AND return_dc_number = $2`,
      [ticketId, rdc]
    );

    if (cancelReplacement) {
      try {
        await client.query(
          `UPDATE support_replacement_orders SET status = 'cancelled'
            WHERE ticket_id = $1 AND status NOT IN ('completed','cancelled')`,
          [ticketId]
        );
      } catch (e) {
        if (e.code !== '42P01') throw e;
      }
      await client.query(
        `UPDATE support_ticket_items SET status = 'cancelled', updated_at = NOW()
          WHERE ticket_id = $1 AND item_type = 'replacement'
            AND status NOT IN ('resolved','closed','inventory_updated','cancelled')`,
        [ticketId]
      );
      if (ticket.sales_order_number) {
        await client.query(
          `UPDATE sales_order_lines SET status = 'cancelled' WHERE sales_order_number = $1`,
          [ticket.sales_order_number]
        );
      }
      await client.query(
        `UPDATE support_tickets
            SET return_dc_number = NULL, sales_order_number = NULL, updated_at = NOW()
          WHERE id = $1`,
        [ticketId]
      );
    } else {
      await client.query(
        `UPDATE support_tickets SET return_dc_number = NULL, updated_at = NOW() WHERE id = $1`,
        [ticketId]
      );
    }

    await client.query('COMMIT');
    console.log(`OK: Cancelled ${rdc} on ticket #${ticketId}. Replacement reset: ${cancelReplacement}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Failed:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
