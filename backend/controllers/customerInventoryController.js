const pool = require('../config/db');
const {
    syncOneCustomerFromErp,
    syncAllCustomersFromErp,
    ensureCustomerTables
} = require('../services/customerInventoryErpSyncService');

exports.listCustomers = async (req, res) => {
    try {
        await ensureCustomerTables();
        const search = (req.query.search || '').trim();
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        const term = search ? `%${search}%` : null;
        let where = 'WHERE 1=1';
        const whereParams = [];

        if (term) {
            whereParams.push(term);
            where += ` AND (
                ec.customer_name ILIKE $1
                OR CAST(ec.customer_id AS TEXT) LIKE $1
                OR ec.contact_person_number ILIKE $1
                OR ec.customer_number ILIKE $1
                OR ec.email ILIKE $1
                OR EXISTS (
                    SELECT 1 FROM customer_inventory ci
                    WHERE ci.customer_id = ec.customer_id
                    AND (
                        ci.unique_serial_number ILIKE $1
                        OR ci.serial_number ILIKE $1
                    )
                )
            )`;
        }

        const countSql = `
            SELECT COUNT(*)::int AS total
            FROM existing_customer ec
            ${where}
        `;
        const listSql = `
            SELECT ec.*,
                (SELECT COUNT(*)::int FROM customer_inventory ci WHERE ci.customer_id = ec.customer_id) AS asset_count
            FROM existing_customer ec
            ${where}
            ORDER BY ec.customer_name ASC NULLS LAST, ec.customer_id ASC
            LIMIT $${term ? 2 : 1} OFFSET $${term ? 3 : 2}
        `;

        const listParams = term ? [term, limit, offset] : [limit, offset];

        const [countResult, listResult] = await Promise.all([
            pool.query(countSql, term ? whereParams : []),
            pool.query(listSql, listParams)
        ]);

        const total = countResult.rows[0]?.total || 0;

        res.json({
            success: true,
            total,
            limit,
            offset,
            items: listResult.rows
        });
    } catch (error) {
        console.error('customerInventory listCustomers:', error);
        res.status(500).json({ success: false, message: 'Failed to load customers' });
    }
};

exports.getCustomerDetail = async (req, res) => {
    try {
        await ensureCustomerTables();
        const customerId = parseInt(req.params.customerId, 10);
        if (!Number.isFinite(customerId)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }

        const cust = await pool.query('SELECT * FROM existing_customer WHERE customer_id = $1', [customerId]);
        if (cust.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const assets = await pool.query(
            `SELECT * FROM customer_inventory WHERE customer_id = $1 ORDER BY asset_kind, asset_bucket, delivery_date DESC NULLS LAST, id ASC`,
            [customerId]
        );

        res.json({
            success: true,
            customer: cust.rows[0],
            assets: assets.rows
        });
    } catch (error) {
        console.error('customerInventory getCustomerDetail:', error);
        res.status(500).json({ success: false, message: 'Failed to load customer' });
    }
};

exports.triggerFullSync = async (req, res) => {
    const runAsync = req.query.async === '1' || req.query.async === 'true';

    if (runAsync) {
        syncAllCustomersFromErp()
            .then((result) => console.log('Customer inventory ERP sync completed:', result))
            .catch((err) => console.error('Customer inventory ERP sync failed:', err));
        return res.json({
            success: true,
            message: 'Customer inventory sync started in background. Check server logs for progress.'
        });
    }

    try {
        const result = await syncAllCustomersFromErp();
        res.json({
            success: true,
            message: 'Customer inventory sync completed',
            ...result
        });
    } catch (error) {
        console.error('triggerFullSync:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Sync failed'
        });
    }
};

exports.triggerCustomerSync = async (req, res) => {
    try {
        const customerId = parseInt(req.params.customerId, 10);
        if (!Number.isFinite(customerId)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const result = await syncOneCustomerFromErp(customerId);
        res.json({
            success: true,
            message: 'Customer sync finished',
            ...result
        });
    } catch (error) {
        console.error('triggerCustomerSync:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Sync failed'
        });
    }
};
