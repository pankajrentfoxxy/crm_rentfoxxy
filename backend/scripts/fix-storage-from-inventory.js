#!/usr/bin/env node
/**
 * Set inventory storage (source of truth) and propagate to linked records.
 * Usage: node scripts/fix-storage-from-inventory.js <machine_number> <storage>
 * Example: node scripts/fix-storage-from-inventory.js TTSPLGR0054 "256GB SSD"
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');

const machineNumber = (process.argv[2] || '').trim().toUpperCase();
const storage = (process.argv[3] || '').trim();

if (!machineNumber || !storage) {
    console.error('Usage: node scripts/fix-storage-from-inventory.js <machine_number> <storage>');
    process.exit(1);
}

async function updatePoLineItems(client, poId, modelHint, storageValue) {
    if (!poId) return 0;
    const poRes = await client.query(
        'SELECT line_items FROM vendor_purchase_orders WHERE po_id = $1',
        [poId]
    );
    if (!poRes.rows.length || !Array.isArray(poRes.rows[0].line_items)) return 0;

    const lines = poRes.rows[0].line_items.map((line) => {
        const model = String(line.model || line.product_name || '').trim();
        if (modelHint && model && !model.toLowerCase().includes(modelHint.toLowerCase())) {
            return line;
        }
        if (line.storage === storageValue) return line;
        return { ...line, storage: storageValue };
    });

    if (JSON.stringify(lines) === JSON.stringify(poRes.rows[0].line_items)) return 0;

    await client.query(
        'UPDATE vendor_purchase_orders SET line_items = $1::jsonb, updated_at = NOW() WHERE po_id = $2',
        [JSON.stringify(lines), poId]
    );
    return 1;
}

async function main() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const invRes = await client.query(
            `UPDATE inventory
                SET storage = $2, updated_at = NOW()
              WHERE machine_number = $1
              RETURNING *`,
            [machineNumber, storage]
        );
        if (!invRes.rows.length) {
            throw new Error(`Inventory record not found for ${machineNumber}`);
        }
        const inv = invRes.rows[0];

        const vsnRes = await client.query(
            `UPDATE vendor_serial_numbers SET
                extra = jsonb_set(COALESCE(extra, '{}'::jsonb), '{storage}', to_jsonb($2::text), true),
                updated_at = NOW()
             WHERE inventory_asset_code = $1 AND deleted_at IS NULL
             RETURNING po_id, extra->>'model' AS model`,
            [machineNumber, storage]
        );

        const ticketRes = await client.query(
            `UPDATE tickets SET storage = $2, updated_at = NOW()
              WHERE ttspl_id = $1 OR machine_number = $1 OR serial_number = $3`,
            [machineNumber, storage, inv.serial_number]
        );

        const qcRes = await client.query(
            `UPDATE qc_results qr SET storage_type = $2
              FROM tickets t
             WHERE qr.ticket_id = t.ticket_id
               AND (t.ttspl_id = $1 OR t.machine_number = $1 OR t.serial_number = $3)`,
            [machineNumber, storage, inv.serial_number]
        );

        const poUpdates = await updatePoLineItems(
            client,
            vsnRes.rows[0]?.po_id,
            vsnRes.rows[0]?.model || inv.model,
            storage
        );

        await client.query('COMMIT');

        console.log(JSON.stringify({
            machine_number: machineNumber,
            storage,
            inventory_id: inv.inventory_id,
            vendor_serials: vsnRes.rowCount,
            tickets: ticketRes.rowCount,
            qc_results: qcRes.rowCount,
            purchase_orders: poUpdates,
        }, null, 2));
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e.message || e);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
