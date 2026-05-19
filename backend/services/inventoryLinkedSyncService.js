/**
 * After admin/manager edits inventory specs, push the same machine details to
 * open repair tickets, sales order lines (+ order touch), QC draft rows, and lead snapshots.
 */

/**
 * @param {import('pg').PoolClient} client
 * @param {Record<string, unknown>} inv — full inventory row (snake_case from PG)
 * @returns {Promise<{ tickets: number; orderItems: number; orders: number; qcResults: number; leads: number }>}
 */
async function syncInventoryEditToLinkedPlaces(client, inv) {
    const serial = inv.serial_number;
    const invId = inv.inventory_id;
    if (!serial || invId == null) {
        return { tickets: 0, orderItems: 0, orders: 0, qcResults: 0, leads: 0 };
    }

    const tRes = await client.query(
        `UPDATE tickets SET
            brand = $1,
            model = $2,
            processor = $3,
            ram = $4,
            storage = $5,
            updated_at = CURRENT_TIMESTAMP
         WHERE serial_number = $6 AND status IN ('in_progress', 'on_hold')`,
        [inv.brand, inv.model, inv.processor, inv.ram, inv.storage, serial]
    );

    const oiRes = await client.query(
        `UPDATE order_items SET
            brand = $1,
            processor = $2,
            generation = $3,
            ram = $4,
            storage = $5,
            preferred_model = $6
         WHERE inventory_id = $7
         RETURNING order_id`,
        [
            inv.brand,
            inv.processor,
            inv.generation ?? null,
            inv.ram,
            inv.storage,
            inv.model,
            invId
        ]
    );

    const orderIds = [...new Set(oiRes.rows.map((r) => r.order_id).filter((id) => id != null))];
    let ordersTouched = 0;
    if (orderIds.length > 0) {
        const oUp = await client.query(
            `UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE order_id = ANY($1::int[])`,
            [orderIds]
        );
        ordersTouched = oUp.rowCount;
    }

    const qcRes = await client.query(
        `UPDATE qc_results qr SET
            processor = $1,
            generation = $2,
            storage_type = $3,
            ram_size = $4
         FROM tickets t
         WHERE qr.ticket_id = t.ticket_id
           AND t.serial_number = $5
           AND COALESCE(qr.is_locked, false) = false`,
        [inv.processor ?? null, inv.generation ?? null, inv.storage ?? null, inv.ram ?? null, serial]
    );

    const leadsRes = await client.query(
        `SELECT DISTINCT c.source_lead_id AS lead_id
         FROM order_items oi
         JOIN orders o ON o.order_id = oi.order_id
         JOIN customers c ON c.customer_id = o.customer_id
         WHERE oi.inventory_id = $1 AND c.source_lead_id IS NOT NULL`,
        [invId]
    );

    const merge = JSON.stringify({
        machine_number: inv.machine_number,
        serial_number: inv.serial_number,
        brand: inv.brand,
        processor: inv.processor,
        generation: inv.generation ?? null,
        ram: inv.ram,
        storage: inv.storage,
        preferred_model: inv.model
    });

    let leadsTouched = 0;
    for (const row of leadsRes.rows) {
        const leadId = row.lead_id;
        if (!leadId) continue;
        await client.query(
            `
            UPDATE lead_orders
            SET details = COALESCE(details, '{}'::jsonb) || $1::jsonb
            WHERE lead_order_id = (
                SELECT lead_order_id
                FROM lead_orders
                WHERE lead_id = $2
                ORDER BY created_at DESC
                LIMIT 1
            )
            `,
            [merge, leadId]
        );

        await client.query(
            `
            UPDATE leads
            SET brand = COALESCE($1, brand),
                processor = COALESCE($2, processor),
                ram = COALESCE($3, ram),
                storage = COALESCE($4, storage),
                updated_at = CURRENT_TIMESTAMP
            WHERE lead_id = $5
            `,
            [inv.brand, inv.processor, inv.ram, inv.storage, leadId]
        );
        leadsTouched++;
    }

    return {
        tickets: tRes.rowCount,
        orderItems: oiRes.rowCount,
        orders: ordersTouched,
        qcResults: qcRes.rowCount,
        leads: leadsTouched
    };
}

module.exports = {
    syncInventoryEditToLinkedPlaces
};
