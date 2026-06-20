const pool = require('../config/db');

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

// Available replacement machines come from the authoritative inventory
// (vendor_serial_numbers): QC-passed, in stock, not currently held by a customer.
// Spare stock is a global pool, so it is NOT scoped to the ticket's customer.
const getAvailableAssets = async (/* customerId */ _customerId, _excludeItemIds = []) => {
    const { rows } = await pool.query(
        `SELECT vsn.serial_id AS id,
                vsn.serial_number,
                COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS unique_serial_number,
                NULLIF(TRIM(CONCAT(COALESCE(vsn.extra->>'brand', ''), ' ',
                                   COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', ''))), '') AS model_name,
                vsn.extra->>'processor' AS processor,
                vsn.extra->>'generation' AS generation,
                vsn.extra->>'ram' AS ram,
                vsn.extra->>'storage' AS storage,
                vsn.inventory_status AS asset_bucket
         FROM vendor_serial_numbers vsn
         WHERE vsn.deleted_at IS NULL
           AND vsn.inventory_status = 'in_stock'
           AND vsn.qc_status IN ('passed', 'qc_passed')
           AND vsn.current_customer_id IS NULL
         ORDER BY COALESCE(vsn.inventory_asset_code, vsn.serial_number)
         LIMIT 300`
    );
    return rows;
};

module.exports = {
    passivateAsset,
    activateAsset,
    cloneAssetAsActive,
    getAvailableAssets
};
