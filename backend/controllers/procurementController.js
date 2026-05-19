const pool = require('../config/db');

const logOrderStatusHistory = async (db, { orderId, fromStatus = null, toStatus, changedBy = null, notes = null }) => {
    if (!toStatus) return;
    await db.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, fromStatus, toStatus, changedBy, notes]
    );
};

exports.getRequests = async (req, res) => {
    try {
        const includeReceived = req.query.include_received === 'true';
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        const search = (req.query.search || '').trim();
        const term = search ? `%${search}%` : null;

        const baseJoin = `
            FROM procurement_requests pr
            JOIN order_items oi ON pr.order_item_id = oi.item_id
            JOIN orders o ON oi.order_id = o.order_id
            JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN inventory inv ON oi.inventory_id = inv.inventory_id
            WHERE ($1::boolean = true OR pr.status != 'Received')
              AND o.status != 'Cancelled'
        `;
        const params = [includeReceived];
        let p = 2;
        let searchClause = '';
        if (term) {
            searchClause = ` AND (
                c.company_name ILIKE $${p} OR c.name ILIKE $${p}
                OR CAST(o.order_id AS TEXT) ILIKE $${p}
                OR inv.machine_number ILIKE $${p} OR inv.serial_number ILIKE $${p}
            )`;
            params.push(term);
            p++;
        }

        const statsSql = `
            SELECT
                COUNT(*) FILTER (WHERE pr.status = 'New')::int AS new_count,
                COUNT(*) FILTER (WHERE pr.status = 'Ordered')::int AS ordered_count,
                COUNT(*)::int AS total_count
            ${baseJoin}
        `;
        const countSql = `SELECT COUNT(*)::int AS c ${baseJoin} ${searchClause}`;
        const listSql = `
            SELECT pr.*, oi.order_id, oi.brand, oi.processor, oi.generation, oi.ram, oi.storage, oi.preferred_model,
                   o.customer_id, o.created_at AS order_date,
                   COALESCE(NULLIF(TRIM(o.order_type), ''), 'Sales') AS order_type,
                   c.name AS customer_name, c.company_name
            ${baseJoin} ${searchClause}
            ORDER BY pr.created_at ASC
            LIMIT $${p} OFFSET $${p + 1}
        `;

        const statsParams = [includeReceived];
        const [statsRes, countRes, listRes] = await Promise.all([
            pool.query(statsSql, statsParams),
            pool.query(countSql, [...params]),
            pool.query(listSql, [...params, limit, offset])
        ]);

        const st = statsRes.rows[0] || {};
        res.json({
            requests: listRes.rows,
            total: countRes.rows[0]?.c ?? 0,
            stats: {
                new: parseInt(st.new_count, 10) || 0,
                ordered: parseInt(st.ordered_count, 10) || 0,
                total: parseInt(st.total_count, 10) || 0
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch requests' });
    }
};

exports.updateRequestStatus = async (req, res) => {
    const { request_id } = req.params;
    const { status, vendor, estimated_cost, expected_date } = req.body;

    try {
        await pool.query(
            `UPDATE procurement_requests 
             SET status = $1, vendor = COALESCE($2, vendor), estimated_cost = COALESCE($3, estimated_cost), expected_date = COALESCE($4, expected_date)
             WHERE request_id = $5`,
            [status, vendor, estimated_cost, expected_date, request_id]
        );
        res.json({ success: true, message: 'Updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update request' });
    }
};

exports.receiveItem = async (req, res) => {
    const { request_id, serial_number, machine_number, cost } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get Request Details
        const reqResult = await client.query(`
            SELECT pr.*, oi.brand, oi.processor, oi.generation, oi.ram, oi.storage, oi.preferred_model as model, oi.order_id
            FROM procurement_requests pr
            JOIN order_items oi ON pr.order_item_id = oi.item_id
            WHERE pr.request_id = $1
        `, [request_id]);

        if (reqResult.rows.length === 0) throw new Error('Request not found');
        const request = reqResult.rows[0];

        // 2. Create Inventory Item
        const invRes = await client.query(`
            INSERT INTO inventory (machine_number, serial_number, brand, model, processor, ram, storage, status, stock_type, device_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'Reserved', 'Procured', 'Laptop')
            RETURNING inventory_id
        `, [machine_number || `TTSPL-${Date.now().toString().slice(-6)}`, serial_number, request.brand, request.model || 'Generic', request.processor, request.ram, request.storage]);

        const newInventoryId = invRes.rows[0].inventory_id;

        // 3. Update Procurement Request
        await client.query(`UPDATE procurement_requests SET status = 'Received' WHERE request_id = $1`, [request_id]);

        // 4. Assign machine — same warehouse gate as sales orders (confirm / replace before QC)
        await client.query(
            `UPDATE order_items SET status = 'Warehouse', inventory_id = $1 WHERE item_id = $2`,
            [newInventoryId, request.order_item_id]
        );

        // 5. When no procurement lines left: send to warehouse queue first (not straight to QC)
        const pendingProcurement = await client.query(
            `SELECT COUNT(*)::int AS c FROM order_items WHERE order_id = $1 AND status = 'Procurement'`,
            [request.order_id]
        );
        const pendingWarehouse = await client.query(
            `SELECT COUNT(*)::int AS c FROM order_items WHERE order_id = $1 AND status = 'Warehouse'`,
            [request.order_id]
        );

        if (parseInt(pendingProcurement.rows[0].c, 10) === 0) {
            const currentOrder = await client.query(`SELECT status FROM orders WHERE order_id = $1`, [request.order_id]);
            const fromStatus = currentOrder.rows[0]?.status || null;
            const wh = parseInt(pendingWarehouse.rows[0].c, 10);

            if (wh > 0) {
                await client.query(
                    `UPDATE orders SET status = 'Warehouse Pending', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`,
                    [request.order_id]
                );
                if (fromStatus && fromStatus !== 'Warehouse Pending') {
                    await logOrderStatusHistory(client, {
                        orderId: request.order_id,
                        fromStatus,
                        toStatus: 'Warehouse Pending',
                        changedBy: req.user?.user_id || null,
                        notes: 'Procurement fulfilled — awaiting warehouse confirmation'
                    });
                }
            } else {
                const nonAssigned = await client.query(
                    `SELECT COUNT(*)::int AS c FROM order_items WHERE order_id = $1 AND status != 'Assigned'`,
                    [request.order_id]
                );
                if (parseInt(nonAssigned.rows[0].c, 10) === 0) {
                    await client.query(
                        `UPDATE orders SET status = 'QC Pending',
                            qc_received_at = COALESCE(qc_received_at, CURRENT_TIMESTAMP),
                            updated_at = CURRENT_TIMESTAMP
                         WHERE order_id = $1`,
                        [request.order_id]
                    );
                    await logOrderStatusHistory(client, {
                        orderId: request.order_id,
                        fromStatus,
                        toStatus: 'QC Pending',
                        changedBy: req.user?.user_id || null,
                        notes: 'Auto moved to QC after procurement assignment'
                    });
                }
            }
        }

        await client.query('COMMIT');
        const statusRes = await pool.query(`SELECT status FROM orders WHERE order_id = $1`, [request.order_id]);
        res.json({
            success: true,
            message: 'Item received and assigned',
            order_id: request.order_id,
            status: statusRes.rows[0]?.status || null
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ message: 'Failed to receive item', error: error.message });
    } finally {
        client.release();
    }
};

// Assign existing inventory to order item by scanning machine number
exports.assignExistingInventory = async (req, res) => {
    const { request_id, machine_number } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get Request Details
        const reqResult = await client.query(`
            SELECT pr.*, oi.brand, oi.processor, oi.ram, oi.storage, oi.order_id
            FROM procurement_requests pr
            JOIN order_items oi ON pr.order_item_id = oi.item_id
            WHERE pr.request_id = $1
        `, [request_id]);

        if (reqResult.rows.length === 0) throw new Error('Request not found');
        const request = reqResult.rows[0];

        // 2. Find inventory by machine_number
        const invResult = await client.query(`
            SELECT inventory_id, brand, processor, ram, storage, status 
            FROM inventory 
            WHERE machine_number = $1
        `, [machine_number]);

        if (invResult.rows.length === 0) {
            throw new Error('Laptop not found. Please check machine number.');
        }

        const inventory = invResult.rows[0];

        // Validate status - must be available (not on Floor or Reserved)
        if (!['Inward', 'Ready', 'In Stock'].includes(inventory.status)) {
            throw new Error(`Laptop is in "${inventory.status}" status and cannot be assigned.`);
        }

        // 3. Update Inventory to Reserved
        await client.query(`UPDATE inventory SET status = 'Reserved' WHERE inventory_id = $1`, [inventory.inventory_id]);

        // 4. Update Procurement Request
        await client.query(`UPDATE procurement_requests SET status = 'Received' WHERE request_id = $1`, [request_id]);

        // 5. Assign machine — warehouse gate before QC
        await client.query(
            `UPDATE order_items SET status = 'Warehouse', inventory_id = $1 WHERE item_id = $2`,
            [inventory.inventory_id, request.order_item_id]
        );

        const pendingProcurement = await client.query(
            `SELECT COUNT(*)::int AS c FROM order_items WHERE order_id = $1 AND status = 'Procurement'`,
            [request.order_id]
        );
        const pendingWarehouse = await client.query(
            `SELECT COUNT(*)::int AS c FROM order_items WHERE order_id = $1 AND status = 'Warehouse'`,
            [request.order_id]
        );

        if (parseInt(pendingProcurement.rows[0].c, 10) === 0) {
            const currentOrder = await client.query(`SELECT status FROM orders WHERE order_id = $1`, [request.order_id]);
            const fromStatus = currentOrder.rows[0]?.status || null;
            const wh = parseInt(pendingWarehouse.rows[0].c, 10);

            if (wh > 0) {
                await client.query(
                    `UPDATE orders SET status = 'Warehouse Pending', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`,
                    [request.order_id]
                );
                if (fromStatus && fromStatus !== 'Warehouse Pending') {
                    await logOrderStatusHistory(client, {
                        orderId: request.order_id,
                        fromStatus,
                        toStatus: 'Warehouse Pending',
                        changedBy: req.user?.user_id || null,
                        notes: 'Procurement fulfilled — awaiting warehouse confirmation'
                    });
                }
            } else {
                const nonAssigned = await client.query(
                    `SELECT COUNT(*)::int AS c FROM order_items WHERE order_id = $1 AND status != 'Assigned'`,
                    [request.order_id]
                );
                if (parseInt(nonAssigned.rows[0].c, 10) === 0) {
                    await client.query(
                        `UPDATE orders SET status = 'QC Pending',
                            qc_received_at = COALESCE(qc_received_at, CURRENT_TIMESTAMP),
                            updated_at = CURRENT_TIMESTAMP
                         WHERE order_id = $1`,
                        [request.order_id]
                    );
                    await logOrderStatusHistory(client, {
                        orderId: request.order_id,
                        fromStatus,
                        toStatus: 'QC Pending',
                        changedBy: req.user?.user_id || null,
                        notes: 'Auto moved to QC after inventory scan assignment'
                    });
                }
            }
        }

        await client.query('COMMIT');
        const statusRes = await pool.query(`SELECT status FROM orders WHERE order_id = $1`, [request.order_id]);
        res.json({
            success: true,
            message: 'Laptop assigned to order successfully',
            order_id: request.order_id,
            status: statusRes.rows[0]?.status || null,
            machine_number: machine_number
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ message: error.message || 'Failed to assign inventory' });
    } finally {
        client.release();
    }
};
