const pool = require('../config/db');

/**
 * GET /api/inventory/summary
 * - total row count
 * - byStockType: exact TRIM(stock_type) buckets from DB (empty → "(none)")
 * - byStatus: exact TRIM(status) buckets from DB (empty → "(none)")
 */
exports.getInventoryStockSummary = async (req, res) => {
    try {
        const totalRes = await pool.query(`SELECT COUNT(*)::int AS total FROM inventory`);
        const total = parseInt(totalRes.rows[0]?.total, 10) || 0;

        const stockRes = await pool.query(`
            SELECT NULLIF(TRIM(COALESCE(stock_type, '')), '') AS stock_type,
                   COUNT(*)::int AS count
            FROM inventory
            GROUP BY 1
            ORDER BY count DESC, stock_type NULLS LAST
        `);

        const statusRes = await pool.query(`
            SELECT NULLIF(TRIM(COALESCE(status, '')), '') AS status,
                   COUNT(*)::int AS count
            FROM inventory
            GROUP BY 1
            ORDER BY count DESC, status NULLS LAST
        `);

        const byStockType = (stockRes.rows || []).map((r) => ({
            label: r.stock_type || '(none)',
            count: parseInt(r.count, 10) || 0
        }));

        const byStatus = (statusRes.rows || []).map((r) => ({
            label: r.status || '(none)',
            count: parseInt(r.count, 10) || 0
        }));

        res.json({
            success: true,
            total,
            byStockType,
            byStatus
        });
    } catch (error) {
        console.error('getInventoryStockSummary', error);
        res.status(500).json({ success: false, message: 'Failed to load inventory summary' });
    }
};
