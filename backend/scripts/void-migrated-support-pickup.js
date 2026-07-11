/**
 * Void migrated support pickup ticket #1956 / RDC001461 / TTSPL4280.
 * Run on VPS after deploying force-reset changes, or use API instead.
 *
 *   node scripts/void-migrated-support-pickup.js --ticket=1956 --rdc=RDC001461
 */
const pool = require('../config/db');
const { forceRestoreCustomerAssetsOnCancel } = require('../services/supportCancelInventoryService');

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    })
  );
  const ticketId = Number(args.ticket || 1956);
  const rdc = String(args.rdc || 'RDC001461').trim();
  const reason = String(args.reason || 'Migrated ERP data — pickup never happened physically').trim();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ticketRes = await client.query('SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    if (!ticketRes.rows.length) throw new Error(`Ticket ${ticketId} not found`);
    const ticket = ticketRes.rows[0];

    const itemsRes = await client.query(
      `SELECT * FROM support_ticket_items WHERE ticket_id = $1`,
      [ticketId]
    );

    const pickupItems = itemsRes.rows.filter((i) => i.item_type === 'pickup');
    const restored = await forceRestoreCustomerAssetsOnCancel(client, {
      ticketId,
      customerId: ticket.customer_id,
      items: pickupItems,
      actorUserId: null,
      actorName: 'void-migrated-support-pickup script',
    });

    await client.query(
      `UPDATE delivery_challan_lines SET status = 'cancelled', updated_at = NOW()
        WHERE dc_number = $1 AND movement_type = 'return'`,
      [rdc]
    );

    await client.query(
      `UPDATE support_ticket_items
          SET status = 'cancelled', return_dc_number = NULL, updated_at = NOW()
        WHERE ticket_id = $1`,
      [ticketId]
    );

    await client.query(
      `UPDATE support_tickets
          SET status = 'cancelled', cancelled_at = NOW(), cancellation_remark = $2,
              return_dc_number = NULL, updated_at = NOW()
        WHERE id = $1`,
      [ticketId, reason]
    );

    await client.query('COMMIT');
    console.log(`OK: Voided ticket #${ticketId}, cancelled ${rdc}`);
    console.log('Inventory restored:', JSON.stringify(restored, null, 2));
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
