/**
 * Restore customer assignment for laptops on cancelled support pickup tickets
 * where warehouse receipt never completed.
 *
 * Usage: node scripts/fix-cancelled-support-inventory.js
 */
require('dotenv').config();
const pool = require('../config/db');
const { preserveCustomerAssetsOnCancel } = require('../services/supportCancelInventoryService');

async function main() {
    const tickets = await pool.query(
        `SELECT t.id, t.customer_id, t.cancelled_by
           FROM support_tickets t
          WHERE t.status = 'cancelled'
          ORDER BY t.id`
    );

    let fixed = 0;
    for (const ticket of tickets.rows) {
        const itemsRes = await pool.query(
            `SELECT id, item_type, status, unique_serial_number, serial_number, ttspl_id,
                    customer_inventory_id, warehouse_received_at, picked_up_at, customer_otp_verified_at
               FROM support_ticket_items
              WHERE ticket_id = $1`,
            [ticket.id]
        );
        if (!itemsRes.rows.some((i) => i.item_type === 'pickup')) continue;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const preserved = await preserveCustomerAssetsOnCancel(client, {
                ticketId: ticket.id,
                customerId: ticket.customer_id,
                items: itemsRes.rows,
                actorUserId: ticket.cancelled_by || null,
                actorName: 'Support cancel inventory fix',
            });
            if (preserved.length) {
                await client.query(
                    `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
                     VALUES (NULL, $1, $2, 'cancel_inventory_restored', $3::jsonb)`,
                    [
                        ticket.id,
                        ticket.cancelled_by || null,
                        JSON.stringify({ preserved }),
                    ]
                );
                fixed += preserved.length;
                console.log(`Ticket #${ticket.id}: restored ${preserved.map((p) => p.code).join(', ')}`);
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error(`Ticket #${ticket.id} failed:`, e.message);
        } finally {
            client.release();
        }
    }

    console.log(`Done. ${fixed} asset(s) restored to customer assignment.`);
    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
