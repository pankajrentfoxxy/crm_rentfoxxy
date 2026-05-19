const pool = require('../config/db');
const { ensureCustomerTables } = require('./customerInventoryErpSyncService');

const passivateAsset = async (client, { inventoryId, reason }) => {
    await client.query(
        `UPDATE customer_inventory
         SET asset_bucket = 'passive', passivated_at = CURRENT_TIMESTAMP,
             passivated_reason = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [inventoryId, reason]
    );
};

const activateAsset = async (client, inventoryId) => {
    await client.query(
        `UPDATE customer_inventory
         SET asset_bucket = 'live', passivated_at = NULL, passivated_reason = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [inventoryId]
    );
};

const cloneAssetAsActive = async (client, sourceId, customerId) => {
    const { rows } = await client.query('SELECT * FROM customer_inventory WHERE id = $1', [sourceId]);
    if (!rows.length) return null;
    const src = rows[0];
    const ins = await client.query(
        `INSERT INTO customer_inventory (
            customer_id, asset_kind, asset_bucket, serial_number, unique_serial_number,
            model_name, generation, screen_size, ram, storage, gpu, processor,
            delivery_status, sales_status, synced_at, updated_at
        ) VALUES ($1,$2,'live',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        RETURNING id`,
        [
            customerId,
            src.asset_kind || 'rental',
            src.serial_number,
            src.unique_serial_number,
            src.model_name,
            src.generation,
            src.screen_size,
            src.ram,
            src.storage,
            src.gpu,
            src.processor,
            src.delivery_status,
            src.sales_status
        ]
    );
    return ins.rows[0];
};

const getAvailableAssets = async (customerId, excludeItemIds = []) => {
    await ensureCustomerTables();
    const params = [customerId];
    let excludeSql = '';
    if (excludeItemIds.length) {
        params.push(excludeItemIds);
        excludeSql = ` AND ci.id NOT IN (
            SELECT COALESCE(customer_inventory_id, 0) FROM support_ticket_items
            WHERE customer_inventory_id IS NOT NULL AND status NOT IN ('resolved','closed')
        )`;
    }
    const { rows } = await pool.query(
        `SELECT ci.id, ci.serial_number, ci.unique_serial_number, ci.model_name, ci.generation,
                ci.ram, ci.storage, ci.asset_bucket, ci.asset_kind
         FROM customer_inventory ci
         WHERE ci.customer_id = $1 AND ci.asset_bucket = 'live' ${excludeSql}
         ORDER BY ci.model_name, ci.unique_serial_number`,
        params
    );
    return rows;
};

module.exports = {
    passivateAsset,
    activateAsset,
    cloneAssetAsActive,
    getAvailableAssets
};
