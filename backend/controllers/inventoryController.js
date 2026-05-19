const pool = require('../config/db');
const csv = require('csv-parser');
const fs = require('fs');
const { syncInventoryFromErp, syncSingleInventoryFromErp } = require('../services/inventoryErpSyncService');
const { syncInventoryEditToLinkedPlaces } = require('../services/inventoryLinkedSyncService');

const ensureLaptopCatalogTable = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS laptop_catalog (
            catalog_id SERIAL PRIMARY KEY,
            brand VARCHAR(100) NOT NULL,
            model VARCHAR(120),
            processor VARCHAR(120),
            generation VARCHAR(80),
            ram VARCHAR(50),
            storage VARCHAR(50),
            device_type VARCHAR(50) DEFAULT 'Laptop',
            active BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_laptop_catalog UNIQUE (brand, model, processor, generation, ram, storage, device_type)
        );
    `);
};

const cleanCsvValue = (value) => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
};

// Sales can order from Cooling Period or Ready (exclude In Repair, Reserved, Floor, Outward)
const AVAILABLE_INVENTORY_CLAUSE = `(stock_type IN ('Cooling Period', 'Ready') AND status IN ('Ready', 'In Stock'))`;

const pickCsvField = (row, keys) => {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
            return cleanCsvValue(row[key]);
        }
    }
    return '';
};

exports.uploadBulk = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const results = [];
    const errors = [];

    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            // Delete file after processing
            fs.unlinkSync(req.file.path);

            let successCount = 0;

            for (const row of results) {
                try {
                    // Validate required fields
                    if (!row.serial_number || !row.machine_number) {
                        errors.push({ serial: row.serial_number, message: 'Missing serial or machine number' });
                        continue;
                    }

                    // Check duplicate
                    const check = await pool.query('SELECT inventory_id FROM inventory WHERE serial_number = $1', [row.serial_number]);
                    if (check.rows.length > 0) {
                        errors.push({ serial: row.serial_number, message: 'Duplicate Serial Number' });
                        continue;
                    }

                    // Insert
                    await pool.query(
                        `INSERT INTO inventory 
                (machine_number, serial_number, device_type, brand, model, processor, generation, ram, storage, gpu, screen_size, stock_type, status, grade)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                        [
                            row.machine_number,
                            row.serial_number,
                            row.device_type || 'Laptop',
                            row.brand || 'Unknown',
                            row.model || 'Unknown',
                            row.processor || '',
                            row.generation || '',
                            row.ram || '',
                            row.storage || '',
                            row.gpu || '',
                            row.screen_size || '',
                            row.stock_type || 'Cooling Period',
                            'In Stock',
                            row.grade || null
                        ]
                    );
                    successCount++;

                } catch (err) {
                    errors.push({ serial: row.serial_number, message: err.message });
                }
            }

            res.json({
                success: true,
                message: `Processed ${results.length} rows. Success: ${successCount}. Failed: ${errors.length}`,
                errors: errors.length > 0 ? errors : undefined
            });
        });
};

exports.uploadLaptopCatalogCsv = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    await ensureLaptopCatalogTable();

    const rows = [];
    const filePath = req.file.path;
    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => rows.push(data))
        .on('end', async () => {
            fs.unlinkSync(filePath);
            let inserted = 0;
            let updated = 0;
            const errors = [];

            for (const row of rows) {
                try {
                    const brand = pickCsvField(row, ['brand', 'Brand']);
                    const model = pickCsvField(row, ['model', 'Model', 'preferred_model']);
                    const processor = pickCsvField(row, ['processor', 'Processor']);
                    const generation = pickCsvField(row, ['generation', 'Generation', 'gen', 'Gen']);
                    const ram = pickCsvField(row, ['ram', 'RAM']);
                    const storage = pickCsvField(row, ['storage', 'Storage']);
                    const deviceType = pickCsvField(row, ['device_type', 'Device Type', 'device']) || 'Laptop';

                    if (!brand) {
                        errors.push({ row, message: 'Brand is required' });
                        continue;
                    }

                    const upsert = await pool.query(
                        `INSERT INTO laptop_catalog (brand, model, processor, generation, ram, storage, device_type, active)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
                         ON CONFLICT (brand, model, processor, generation, ram, storage, device_type)
                         DO UPDATE SET active = true, updated_at = CURRENT_TIMESTAMP
                         RETURNING (xmax = 0) AS inserted`,
                        [brand, model || null, processor || null, generation || null, ram || null, storage || null, deviceType]
                    );

                    if (upsert.rows[0]?.inserted) inserted++;
                    else updated++;
                } catch (err) {
                    errors.push({ row, message: err.message });
                }
            }

            return res.json({
                success: true,
                message: `Catalog processed. Inserted: ${inserted}, Updated: ${updated}, Failed: ${errors.length}`,
                inserted,
                updated,
                failed: errors.length,
                errors: errors.length ? errors.slice(0, 50) : undefined
            });
        })
        .on('error', (err) => {
            try { fs.unlinkSync(filePath); } catch (_) { }
            return res.status(500).json({ success: false, message: 'Failed to parse CSV', error: err.message });
        });
};

exports.getLaptopCatalogOptions = async (req, res) => {
    try {
        await ensureLaptopCatalogTable();
        const { brand, processor, generation, ram, storage, model } = req.query;
        const conditions = [`active = true`];
        const params = [];
        let idx = 1;
        const addEqFilter = (column, value) => {
            if (!value) return;
            conditions.push(`${column} = $${idx}`);
            params.push(value);
            idx++;
        };
        addEqFilter('brand', brand);
        addEqFilter('processor', processor);
        addEqFilter('generation', generation);
        addEqFilter('ram', ram);
        addEqFilter('storage', storage);
        addEqFilter('model', model);
        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        const [brands, processors, generations, rams, storages, models] = await Promise.all([
            pool.query(`SELECT DISTINCT brand FROM laptop_catalog ${whereClause} AND brand IS NOT NULL AND brand != '' ORDER BY brand`, params),
            pool.query(`SELECT DISTINCT processor FROM laptop_catalog ${whereClause} AND processor IS NOT NULL AND processor != '' ORDER BY processor`, params),
            pool.query(`SELECT DISTINCT generation FROM laptop_catalog ${whereClause} AND generation IS NOT NULL AND generation != '' ORDER BY generation`, params),
            pool.query(`SELECT DISTINCT ram FROM laptop_catalog ${whereClause} AND ram IS NOT NULL AND ram != '' ORDER BY ram`, params),
            pool.query(`SELECT DISTINCT storage FROM laptop_catalog ${whereClause} AND storage IS NOT NULL AND storage != '' ORDER BY storage`, params),
            pool.query(`SELECT DISTINCT model FROM laptop_catalog ${whereClause} AND model IS NOT NULL AND model != '' ORDER BY model`, params)
        ]);

        res.json({
            success: true,
            options: {
                brands: brands.rows.map((r) => r.brand),
                processors: processors.rows.map((r) => r.processor),
                generations: generations.rows.map((r) => r.generation),
                rams: rams.rows.map((r) => r.ram),
                storages: storages.rows.map((r) => r.storage),
                models: models.rows.map((r) => r.model)
            }
        });
    } catch (error) {
        console.error('Get laptop catalog options error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching catalog options' });
    }
};

// Update Inventory Item by machine_number or inventory_id.
// Machine number and serial number cannot be changed (identifiers).
// Admin/Manager only for spec/device fields; others may only adjust status/stock_type (e.g. return flow).
exports.updateInventory = async (req, res) => {
    const { identifier } = req.params;
    const {
        stock_type, device_type,
        brand, model, processor, generation, ram, storage, gpu, screen_size, grade, status, stage
    } = req.body;

    const canEditDetails =
        req.user &&
        ['admin', 'manager'].includes(req.user.role);

    // Adjusting stock_type / status is allowed for roles on this route (e.g. return workflow).
    // Admin/Manager-only: device specs, brand/model, grade, stage, stock_type splits for data correction modal.
    const specFieldsTouched =
        device_type !== undefined ||
        brand !== undefined ||
        model !== undefined ||
        processor !== undefined ||
        generation !== undefined ||
        ram !== undefined ||
        storage !== undefined ||
        gpu !== undefined ||
        screen_size !== undefined ||
        grade !== undefined ||
        stage !== undefined;

    const stockSplitTouched = stock_type !== undefined;

    const canChangeStockType =
        req.user && ['admin', 'manager', 'floor_manager'].includes(req.user.role);

    if (!canEditDetails && specFieldsTouched) {
        return res.status(403).json({
            success: false,
            message:
                'Only admin or manager can edit inventory specifications (brand, model, specs, grade, stage, device type). Others may update status/stock type (where allowed).'
        });
    }

    if (!canChangeStockType && stockSplitTouched) {
        return res.status(403).json({
            success: false,
            message: 'You are not allowed to change stock type (Cooling / Ready).'
        });
    }

    /** Cascade to tickets / order_items / qc / leads when admin or manager edits data (not status-only floor return). */
    const shouldSyncLinked =
        canEditDetails &&
        (specFieldsTouched || stockSplitTouched);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const isNumeric = /^\d+$/.test(identifier);
        const whereClause = isNumeric
            ? 'inventory_id = $1'
            : 'machine_number = $1 OR serial_number = $1';

        const existing = await client.query(
            `SELECT inventory_id FROM inventory WHERE ${whereClause}`,
            [identifier]
        );

        if (existing.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Inventory item not found' });
        }

        const invId = existing.rows[0].inventory_id;

        const updates = [];
        const values = [];
        let idx = 1;

        const setIf = (col, val) => {
            if (val !== undefined && val !== null) {
                updates.push(`${col} = $${idx}`);
                values.push(val);
                idx++;
            }
        };

        /** Include SQL NULL when body sends null (clear optional specs). Omit key to leave unchanged. */
        const setNullable = (col, val) => {
            if (val !== undefined) {
                updates.push(`${col} = $${idx}`);
                values.push(val);
                idx++;
            }
        };

        setIf('stock_type', stock_type);
        setIf('device_type', device_type);
        setIf('brand', brand);
        setIf('model', model);
        setNullable('processor', processor);
        setNullable('generation', generation);
        setNullable('ram', ram);
        setNullable('storage', storage);
        setNullable('gpu', gpu);
        setNullable('screen_size', screen_size);
        setNullable('grade', grade);
        setIf('status', status);
        setNullable('stage', stage);

        // machine_number and serial_number are immutable via this endpoint
        if (updates.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(invId);

        const result = await client.query(
            `UPDATE inventory SET ${updates.join(', ')} WHERE inventory_id = $${idx} RETURNING *`,
            values
        );

        let linkedSync = null;
        if (shouldSyncLinked) {
            linkedSync = await syncInventoryEditToLinkedPlaces(client, result.rows[0]);
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'Inventory item updated successfully',
            item: result.rows[0],
            linked_sync: linkedSync
        });
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rbErr) {
            console.error('Inventory update rollback error:', rbErr);
        }
        console.error('Update inventory error:', error);
        res.status(500).json({ success: false, message: 'Server error updating inventory' });
    } finally {
        client.release();
    }
};

// Trigger full ERP sync (Admin/Manager only)
// ?async=1 returns immediately and runs sync in background (avoids 504 timeout)
exports.triggerErpSync = async (req, res) => {
    const runAsync = req.query.async === '1' || req.query.async === 'true';

    if (runAsync) {
        syncInventoryFromErp()
            .then((result) => {
                console.log('ERP inventory sync completed:', result);
            })
            .catch((err) => {
                console.error('ERP sync failed:', err);
            });
        return res.json({
            success: true,
            message: 'ERP sync started in background. Check server logs for result.'
        });
    }

    try {
        const result = await syncInventoryFromErp();
        res.json({
            success: true,
            message: 'ERP inventory sync completed',
            ...result
        });
    } catch (error) {
        console.error('ERP sync trigger error:', error);
        res.status(500).json({
            success: false,
            message: 'ERP sync failed',
            error: error.message
        });
    }
};

// Trigger single-machine ERP sync by machine_number / serial_number / ERP record id (Admin/Manager only)
exports.triggerSingleErpSync = async (req, res) => {
    const identifier = req.params.identifier || req.body?.identifier;
    if (!identifier || !String(identifier).trim()) {
        return res.status(400).json({
            success: false,
            message: 'identifier is required (machine_number / serial_number / ERP id)'
        });
    }

    try {
        const result = await syncSingleInventoryFromErp(String(identifier).trim());
        if (!result.found) {
            return res.status(404).json({
                success: false,
                ...result
            });
        }
        return res.json({
            success: true,
            message: 'ERP single inventory sync completed',
            ...result
        });
    } catch (error) {
        console.error('ERP single sync trigger error:', error);
        return res.status(500).json({
            success: false,
            message: 'ERP single sync failed',
            error: error.message
        });
    }
};

// Add Inventory Item
exports.addInventory = async (req, res) => {
    const {
        stock_type, device_type, machine_number, serial_number,
        brand, model, processor, generation, ram, storage, gpu, screen_size, grade
    } = req.body;

    try {
        const result = await pool.query(
            `INSERT INTO inventory 
       (stock_type, device_type, machine_number, serial_number, brand, model, processor, generation, ram, storage, gpu, screen_size, grade)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
            [stock_type, device_type, machine_number, serial_number, brand, model, processor, generation || null, ram, storage, gpu || null, screen_size || null, grade || null]
        );

        res.status(201).json({
            success: true,
            message: 'Inventory item added successfully',
            item: result.rows[0]
        });
    } catch (error) {
        console.error('Add inventory error:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(400).json({
                success: false,
                message: 'Machine Number or Serial Number already exists'
            });
        }
        res.status(500).json({ success: false, message: 'Server error adding inventory' });
    }
};

// Get Inventory (paginated, 50 per page default)
exports.getInventory = async (req, res) => {
    const { search, stock_type, limit = 50, offset = 0 } = req.query;
    const pageLimit = Math.min(parseInt(limit, 10) || 50, 100);
    const pageOffset = Math.max(parseInt(offset, 10) || 0, 0);

    try {
        let whereClause = 'WHERE 1=1';
        const params = [];
        let paramCount = 1;

        if (search) {
            whereClause += ` AND (machine_number ILIKE $${paramCount} OR serial_number ILIKE $${paramCount} OR brand ILIKE $${paramCount} OR model ILIKE $${paramCount} OR processor ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }

        if (stock_type) {
            whereClause += ` AND stock_type = $${paramCount}`;
            params.push(stock_type);
            paramCount++;
        }

        const countResult = await pool.query(
            `SELECT COUNT(*)::int as total FROM inventory ${whereClause}`,
            params
        );
        const total = countResult.rows[0]?.total || 0;

        params.push(pageLimit, pageOffset);
        const result = await pool.query(
            `SELECT * FROM inventory ${whereClause} ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
            params
        );

        res.json({
            success: true,
            count: result.rows.length,
            total,
            limit: pageLimit,
            offset: pageOffset,
            items: result.rows
        });
    } catch (error) {
        console.error('Get inventory error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching inventory' });
    }
};

// Search/Scan Inventory (paginated, searches ALL items, 50 per page)
exports.searchByMachineOrSerial = async (req, res) => {
    const { term, limit = 50, offset = 0 } = req.query;

    if (!term) {
        return res.status(400).json({ success: false, message: 'Search term required' });
    }

    try {
        const likeTerm = `%${term}%`;
        const pageLimit = Math.min(parseInt(limit, 10) || 50, 100);
        const pageOffset = Math.max(parseInt(offset, 10) || 0, 0);

        const countResult = await pool.query(
            `SELECT COUNT(*)::int as total FROM inventory 
             WHERE machine_number ILIKE $1 OR serial_number ILIKE $1 OR brand ILIKE $1 OR model ILIKE $1 OR processor ILIKE $1`,
            [likeTerm]
        );
        const total = countResult.rows[0]?.total || 0;

        const result = await pool.query(
            `SELECT * FROM inventory 
             WHERE machine_number ILIKE $1 OR serial_number ILIKE $1 OR brand ILIKE $1 OR model ILIKE $1 OR processor ILIKE $1
             ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [likeTerm, pageLimit, pageOffset]
        );

        res.json({
            success: true,
            count: result.rows.length,
            total,
            limit: pageLimit,
            offset: pageOffset,
            items: result.rows
        });
    } catch (error) {
        console.error('Search inventory error:', error);
        res.status(500).json({ success: false, message: 'Server error searching inventory' });
    }
};

// Get unique specs for dropdowns (Processors, RAMs, Storages from available inventory)
exports.getSpecs = async (req, res) => {
    try {
        const processorsRes = await pool.query(
            `SELECT DISTINCT processor FROM inventory WHERE processor IS NOT NULL AND processor != '' AND ${AVAILABLE_INVENTORY_CLAUSE} ORDER BY processor`
        );
        const ramsRes = await pool.query(
            `SELECT DISTINCT ram FROM inventory WHERE ram IS NOT NULL AND ram != '' AND ${AVAILABLE_INVENTORY_CLAUSE} ORDER BY ram`
        );
        const storagesRes = await pool.query(
            `SELECT DISTINCT storage FROM inventory WHERE storage IS NOT NULL AND storage != '' AND ${AVAILABLE_INVENTORY_CLAUSE} ORDER BY storage`
        );
        const brandsRes = await pool.query(
            `SELECT DISTINCT brand FROM inventory WHERE brand IS NOT NULL AND brand != '' AND ${AVAILABLE_INVENTORY_CLAUSE} ORDER BY brand`
        );
        const generationsRes = await pool.query(
            `SELECT DISTINCT generation FROM inventory WHERE generation IS NOT NULL AND generation != '' AND ${AVAILABLE_INVENTORY_CLAUSE} ORDER BY generation`
        );
        const modelsRes = await pool.query(
            `SELECT DISTINCT model FROM inventory WHERE model IS NOT NULL AND model != '' AND ${AVAILABLE_INVENTORY_CLAUSE} ORDER BY model`
        );
        const gpusRes = await pool.query(
            `SELECT DISTINCT gpu FROM inventory WHERE gpu IS NOT NULL AND gpu != '' AND ${AVAILABLE_INVENTORY_CLAUSE} ORDER BY gpu`
        );
        const screenSizesRes = await pool.query(
            `SELECT DISTINCT screen_size FROM inventory WHERE screen_size IS NOT NULL AND screen_size != '' AND ${AVAILABLE_INVENTORY_CLAUSE} ORDER BY screen_size`
        );

        res.json({
            success: true,
            specs: {
                processors: processorsRes.rows.map(r => r.processor),
                rams: ramsRes.rows.map(r => r.ram),
                storages: storagesRes.rows.map(r => r.storage),
                brands: brandsRes.rows.map(r => r.brand),
                generations: generationsRes.rows.map(r => r.generation),
                models: modelsRes.rows.map(r => r.model),
                gpus: gpusRes.rows.map(r => r.gpu),
                screen_sizes: screenSizesRes.rows.map(r => r.screen_size)
            }
        });
    } catch (error) {
        console.error('Get specs error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching specs' });
    }
};

// Search available inventory with filters, grouped by model
exports.searchAvailableInventory = async (req, res) => {
    const { processor, ram, storage, brand, generation, model, gpu, screen_size } = req.query;

    try {
        let query = `
            SELECT brand, model, processor, generation, ram, storage, gpu, screen_size,
                   COUNT(*) as available_count,
                   ARRAY_AGG(inventory_id) as inventory_ids
            FROM inventory 
            WHERE ${AVAILABLE_INVENTORY_CLAUSE}
        `;
        const params = [];
        let paramCount = 1;

        if (processor) {
            query += ` AND processor ILIKE $${paramCount}`;
            params.push(`%${processor}%`);
            paramCount++;
        }
        if (ram) {
            query += ` AND ram ILIKE $${paramCount}`;
            params.push(`%${ram}%`);
            paramCount++;
        }
        if (storage) {
            query += ` AND storage ILIKE $${paramCount}`;
            params.push(`%${storage}%`);
            paramCount++;
        }
        if (brand) {
            query += ` AND brand ILIKE $${paramCount}`;
            params.push(`%${brand}%`);
            paramCount++;
        }
        if (generation) {
            query += ` AND generation ILIKE $${paramCount}`;
            params.push(`%${generation}%`);
            paramCount++;
        }
        if (model) {
            query += ` AND model ILIKE $${paramCount}`;
            params.push(`%${model}%`);
            paramCount++;
        }
        if (gpu) {
            query += ` AND gpu ILIKE $${paramCount}`;
            params.push(`%${gpu}%`);
            paramCount++;
        }
        if (screen_size) {
            query += ` AND screen_size ILIKE $${paramCount}`;
            params.push(`%${screen_size}%`);
            paramCount++;
        }

        query += ` GROUP BY brand, model, processor, generation, ram, storage, gpu, screen_size ORDER BY available_count DESC`;

        const result = await pool.query(query, params);
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Search inventory error:', error);
        res.status(500).json({ success: false, message: 'Server error searching inventory' });
    }
};

/**
 * Trace model/source for a machine number - ERP sync investigation
 * GET /api/inventory/trace/:machineNumber
 */
/**
 * Lifecycle timeline for one machine: inventory, repair tickets, sales orders (admin/manager).
 * GET /api/inventory/:identifier/history
 */
exports.getMachineLifecycleHistory = async (req, res) => {
    const { identifier } = req.params;
    if (!identifier || identifier === 'history') {
        return res.status(400).json({ success: false, message: 'Invalid identifier' });
    }

    try {
        const isNumeric = /^\d+$/.test(String(identifier).trim());
        const whereClause = isNumeric
            ? 'inventory_id = $1'
            : 'machine_number = $1 OR serial_number = $1';

        const invRes = await pool.query(
            `SELECT * FROM inventory WHERE ${whereClause}`,
            [String(identifier).trim()]
        );

        if (invRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Inventory item not found' });
        }

        const inv = invRes.rows[0];
        const events = [];

        events.push({
            type: 'inventory_added',
            at: inv.created_at,
            title: 'Recorded in inventory',
            detail: {
                stock_type: inv.stock_type,
                status: inv.status,
                grade: inv.grade,
                serial_number: inv.serial_number,
                machine_number: inv.machine_number
            }
        });

        const ticketsRes = await pool.query(
            `SELECT ticket_id, status, created_at, completed_at, serial_number, machine_number
             FROM tickets
             WHERE serial_number = $1 OR machine_number = $2
             ORDER BY created_at ASC`,
            [inv.serial_number, inv.machine_number]
        );

        for (const t of ticketsRes.rows) {
            events.push({
                type: 'ticket_created',
                at: t.created_at,
                title: `Repair ticket #${t.ticket_id} opened`,
                detail: { ticket_id: t.ticket_id, status: t.status }
            });
            if (t.completed_at) {
                events.push({
                    type: 'ticket_completed',
                    at: t.completed_at,
                    title: `Repair ticket #${t.ticket_id} completed`,
                    detail: { ticket_id: t.ticket_id, status: t.status }
                });
            }
        }

        const ordersRes = await pool.query(
            `SELECT o.order_id, o.status AS order_status, o.created_at AS order_created_at,
                    o.dispatch_date, o.dispatched_at, o.estimated_delivery,
                    oi.item_id, oi.status AS line_status, oi.tracking_status,
                    oi.created_at AS line_created_at, oi.updated_at AS line_updated_at,
                    c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email
             FROM order_items oi
             JOIN orders o ON o.order_id = oi.order_id
             LEFT JOIN customers c ON c.customer_id = o.customer_id
             WHERE oi.inventory_id = $1
             ORDER BY o.created_at ASC, oi.item_id ASC`,
            [inv.inventory_id]
        );

        for (const row of ordersRes.rows) {
            const cust = row.customer_name || 'Customer';
            events.push({
                type: 'order_line',
                at: row.line_created_at || row.order_created_at,
                title: `Order #${row.order_id} — line linked (${row.line_status || row.order_status || '—'})`,
                detail: {
                    order_id: row.order_id,
                    item_id: row.item_id,
                    customer_name: row.customer_name,
                    customer_phone: row.customer_phone,
                    customer_email: row.customer_email,
                    order_status: row.order_status,
                    line_status: row.line_status,
                    tracking_status: row.tracking_status
                }
            });

            if (row.dispatched_at || row.dispatch_date) {
                events.push({
                    type: 'dispatch',
                    at: row.dispatched_at || row.dispatch_date,
                    title: `Dispatched — order #${row.order_id} (${cust})`,
                    detail: { order_id: row.order_id, customer_name: row.customer_name }
                });
            }

            if (row.tracking_status === 'Delivered') {
                const at = row.line_updated_at || row.dispatched_at;
                if (at) {
                    events.push({
                        type: 'delivered',
                        at,
                        title: `Delivered — order #${row.order_id} (${cust})`,
                        detail: { order_id: row.order_id, customer_name: row.customer_name }
                    });
                }
            }
        }

        events.sort((a, b) => new Date(a.at) - new Date(b.at));

        res.json({
            success: true,
            inventory: inv,
            events
        });
    } catch (error) {
        console.error('Machine lifecycle history error:', error);
        res.status(500).json({ success: false, message: 'Server error loading history' });
    }
};

exports.traceMachineNumber = async (req, res) => {
    try {
        const { machineNumber } = req.params;
        if (!machineNumber) {
            return res.status(400).json({ success: false, message: 'machineNumber required' });
        }

        const { traceMachineNumberFromErp } = require('../services/inventoryErpSyncService');

        const invRes = await pool.query(
            `SELECT inventory_id, machine_number, serial_number, brand, model, processor, generation, ram, storage, gpu, screen_size, status, stock_type, created_at, updated_at
             FROM inventory
             WHERE machine_number = $1 OR serial_number = $1
             LIMIT 1`,
            [machineNumber.trim()]
        );

        const inventoryRecord = invRes.rows[0] || null;
        const erpTrace = await traceMachineNumberFromErp(machineNumber);

        res.json({
            success: true,
            machineNumber: machineNumber.trim(),
            inventory: inventoryRecord ? {
                model: inventoryRecord.model,
                brand: inventoryRecord.brand,
                processor: inventoryRecord.processor,
                ram: inventoryRecord.ram,
                storage: inventoryRecord.storage,
                serial_number: inventoryRecord.serial_number,
                status: inventoryRecord.status,
                updated_at: inventoryRecord.updated_at
            } : null,
            erpTrace
        });
    } catch (error) {
        console.error('Trace machine number error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
