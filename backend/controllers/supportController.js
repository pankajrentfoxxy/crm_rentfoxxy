const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { isSupportLead, isSupportTechnician } = require('../middleware/supportAccess');
const { deriveItemCurrentStep } = require('../services/supportTicketFlow');
const { ensureCustomerTables } = require('../services/customerInventoryErpSyncService');
const supportQuery = require('../services/supportQuery');
const supportInventoryService = require('../services/supportInventoryService');

const ITEM_OPEN_STATUSES = new Set(['open', 'work_done', 'awaiting_otp']);
const TICKET_OPEN = 'open';
const TICKET_IN_PROGRESS = 'in_progress';
const TICKET_CLOSED = 'closed';

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const VALID_ITEM_TYPES = new Set(['complaint', 'pickup', 'replacement']);
const TERMINAL_ITEM_STATUSES = ['resolved', 'closed', 'inventory_updated'];

const machineKey = (item) => {
    if (item.customer_inventory_id) return `inv:${item.customer_inventory_id}`;
    const serial = (item.unique_serial_number || item.serial_number || '').trim();
    return serial ? `serial:${serial}` : null;
};

/** Open item on any non-closed ticket for this customer/machine. */
const findOpenTicketForMachine = async (client, customerId, item, excludeTicketId = null) => {
    const serial = (item.unique_serial_number || item.serial_number || '').trim();
    const invId = item.customer_inventory_id ? parseInt(item.customer_inventory_id, 10) : null;
    if (!invId && !serial) return null;

    const params = [customerId];
    let sql = `
        SELECT t.id, t.status, i.item_type, i.unique_serial_number, i.serial_number
        FROM support_tickets t
        JOIN support_ticket_items i ON i.ticket_id = t.id
        WHERE t.customer_id = $1 AND t.status <> 'closed'
          AND i.status NOT IN ('resolved', 'closed', 'inventory_updated')
    `;
    if (excludeTicketId) {
        params.push(excludeTicketId);
        sql += ` AND t.id <> $${params.length}`;
    }
    if (invId) {
        params.push(invId);
        sql += ` AND i.customer_inventory_id = $${params.length}`;
    } else {
        params.push(serial);
        sql += ` AND (i.serial_number = $${params.length} OR i.unique_serial_number = $${params.length})`;
    }
    sql += ' LIMIT 1';
    const { rows } = await client.query(sql, params);
    return rows[0] || null;
};

const assertMachinesAvailable = async (client, customerId, items, excludeTicketId = null) => {
    const seen = new Set();
    for (const item of items) {
        const key = machineKey(item);
        if (key && seen.has(key)) {
            const err = new Error('Duplicate machine in the same request');
            err.status = 400;
            throw err;
        }
        if (key) seen.add(key);
        const dup = await findOpenTicketForMachine(client, customerId, item, excludeTicketId);
        if (dup) {
            const label = item.unique_serial_number || item.serial_number || `inventory #${item.customer_inventory_id}`;
            const err = new Error(`Machine ${label} already has an open ticket (#${dup.id})`);
            err.status = 409;
            err.duplicate = { id: dup.id, status: dup.status };
            throw err;
        }
    }
};

const insertTicketItem = async (client, ticketId, item, userId, extra = {}) => {
    const otp = generateOtp();
    const ins = await client.query(
        `INSERT INTO support_ticket_items (
            ticket_id, customer_inventory_id, serial_number, unique_serial_number,
            brand, model, ram, storage, generation, item_type,
            issue_category_id, issue_category_label, remarks, assigned_to, status, otp_code, source_item_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'open',$15,$16)
        RETURNING id`,
        [
            ticketId,
            item.customer_inventory_id || null,
            item.serial_number || null,
            item.unique_serial_number || null,
            item.brand || null,
            item.model || null,
            item.ram || null,
            item.storage || null,
            item.generation || null,
            item.item_type,
            item.issue_category_id || null,
            item.issue_category_label || null,
            item.remarks || null,
            item.assigned_to || null,
            otp,
            extra.source_item_id || item.source_item_id || null
        ]
    );
    await logAudit(client, {
        itemId: ins.rows[0].id,
        ticketId,
        userId,
        action: 'item_created',
        detail: { item_type: item.item_type, source_item_id: extra.source_item_id || item.source_item_id || null }
    });
    return ins.rows[0];
};

/** Idempotent DDL so set-outcome works even if migration 029 did not run yet on this DB. */
const ensureSupportTicketItemV3Columns = async (client) => {
    await client.query(`
        ALTER TABLE support_ticket_items
            ADD COLUMN IF NOT EXISTS current_step VARCHAR(50),
            ADD COLUMN IF NOT EXISTS outcome VARCHAR(30),
            ADD COLUMN IF NOT EXISTS outcome_set_by INTEGER REFERENCES users (user_id),
            ADD COLUMN IF NOT EXISTS outcome_set_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS pod_uploaded_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS warehouse_otp_code VARCHAR(6),
            ADD COLUMN IF NOT EXISTS warehouse_otp_verified_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS pickup_method VARCHAR(20),
            ADD COLUMN IF NOT EXISTS pickup_assigned_to INTEGER REFERENCES users (user_id),
            ADD COLUMN IF NOT EXISTS pickup_courier_name VARCHAR(200),
            ADD COLUMN IF NOT EXISTS pickup_awb VARCHAR(120),
            ADD COLUMN IF NOT EXISTS pickup_completed_at TIMESTAMP WITH TIME ZONE
    `);
};

const logAudit = async (client, { itemId, ticketId, userId, action, detail }) => {
    await client.query(
        `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [itemId ?? null, ticketId, userId, action, detail ? JSON.stringify(detail) : null]
    );
};

const bumpTicketActivity = async (client, ticketId) => {
    await client.query(
        `UPDATE support_tickets
         SET last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [ticketId]
    );
};

const recomputeTicketStatus = async (client, ticketId, manualCloseUserId = null) => {
    const itemsRes = await client.query(
        'SELECT status FROM support_ticket_items WHERE ticket_id = $1',
        [ticketId]
    );
    const statuses = itemsRes.rows.map((r) => r.status);
    if (statuses.length === 0) return;

    const allResolved = statuses.every((s) => s === 'resolved' || s === 'closed' || s === 'inventory_updated');
    if (allResolved) {
        await client.query(
            `UPDATE support_tickets
             SET status = $2, closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP),
                 closed_by = COALESCE(closed_by, $3), updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [ticketId, TICKET_CLOSED, manualCloseUserId]
        );
        return;
    }

    const anyActive = statuses.some((s) => ITEM_OPEN_STATUSES.has(s) || s === 'open');
    const next = anyActive ? TICKET_IN_PROGRESS : TICKET_IN_PROGRESS;
    await client.query(
        `UPDATE support_tickets SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [ticketId, next]
    );
};

const mapItemRow = (row, { showOtp, showWarehouseOtp }) => {
    const base = { ...row };
    if (!showOtp) {
        delete base.otp_code;
    }
    if (!showWarehouseOtp) {
        delete base.warehouse_otp_code;
    }
    return base;
};

const getTicketWithItems = async (ticketId, user) => {
    const leadView = isSupportLead(user);
    const techView = isSupportTechnician(user);

    const ticketRes = await pool.query(
        `SELECT t.*, cb.name AS created_by_name
         FROM support_tickets t
         LEFT JOIN users cb ON cb.user_id = t.created_by
         WHERE t.id = $1`,
        [ticketId]
    );
    if (ticketRes.rows.length === 0) return null;
    const ticket = ticketRes.rows[0];

    let itemsSql = `
        SELECT i.*, u.name AS assigned_to_name, c.name AS issue_category_name,
               ci.processor AS inv_processor, ci.model_name AS inv_model_name,
               ci.ram AS inv_ram, ci.storage AS inv_storage, ci.generation AS inv_generation,
               ci.gpu AS inv_gpu, ci.screen_size AS inv_screen_size,
               ci.asset_bucket AS inv_asset_bucket, ci.customer_id AS inv_customer_id
        FROM support_ticket_items i
        LEFT JOIN users u ON u.user_id = i.assigned_to
        LEFT JOIN support_issue_categories c ON c.id = i.issue_category_id
        LEFT JOIN customer_inventory ci ON ci.id = i.customer_inventory_id
        WHERE i.ticket_id = $1
    `;
    const params = [ticketId];
    if (techView && !leadView) {
        itemsSql += ' AND i.assigned_to = $2';
        params.push(user.user_id);
    }
    itemsSql += ' ORDER BY i.id ASC';

    const itemsRes = await pool.query(itemsSql, params);
    if (techView && !leadView && itemsRes.rows.length === 0) {
        return null;
    }

    let replacementRows = [];
    try {
        const replacementRes = await pool.query(
            `SELECT ro.*, ni.model_name AS new_model, oi.model_name AS old_model
             FROM support_replacement_orders ro
             LEFT JOIN customer_inventory ni ON ni.id = ro.new_customer_inventory_id
             LEFT JOIN customer_inventory oi ON oi.id = ro.old_customer_inventory_id
             WHERE ro.ticket_id = $1
             ORDER BY ro.id ASC`,
            [ticketId]
        );
        replacementRows = replacementRes.rows;
    } catch (replacementErr) {
        if (replacementErr.code !== '42P01') {
            throw replacementErr;
        }
    }

    const orderByItemId = {};
    for (const ro of replacementRows) {
        if (ro.item_id) orderByItemId[ro.item_id] = ro;
    }

    const items = itemsRes.rows.map((row) => {
        const ro = orderByItemId[row.id];
        const merged = {
            ...row,
            processor: row.inv_processor || row.processor || null,
            model: row.inv_model_name || row.model,
            ram: row.inv_ram || row.ram,
            storage: row.inv_storage || row.storage,
            generation: row.inv_generation || row.generation,
            gpu: row.inv_gpu || row.gpu,
            screen_size: row.inv_screen_size || row.screen_size,
            inv_asset_bucket: row.inv_asset_bucket,
            effective_current_step: deriveItemCurrentStep(row, ro)
        };
        delete merged.inv_processor;
        delete merged.inv_model_name;
        delete merged.inv_ram;
        delete merged.inv_storage;
        delete merged.inv_generation;
        delete merged.inv_gpu;
        delete merged.inv_screen_size;
        delete merged.inv_asset_bucket;
        delete merged.inv_customer_id;
        return mapItemRow(merged, { showOtp: leadView, showWarehouseOtp: leadView });
    });

    const commentsByItem = {};
    if (items.length > 0) {
        const commentsRes = await pool.query(
            `SELECT c.*, u.name AS author_name
             FROM support_ticket_item_comments c
             JOIN users u ON u.user_id = c.user_id
             WHERE c.item_id = ANY($1::int[])
             ORDER BY c.created_at ASC`,
            [items.map((i) => i.id)]
        );
        for (const c of commentsRes.rows) {
            if (!commentsByItem[c.item_id]) commentsByItem[c.item_id] = [];
            commentsByItem[c.item_id].push(c);
        }
    }

    const auditRes = await pool.query(
        `SELECT a.*, u.name AS user_name
         FROM support_ticket_item_audit a
         LEFT JOIN users u ON u.user_id = a.user_id
         WHERE a.ticket_id = $1
         ORDER BY a.created_at ASC`,
        [ticketId]
    );

    let customerAddresses = [];
    if (leadView) {
        const custRes = await pool.query(
            'SELECT billing_address, shipping_address FROM existing_customer WHERE customer_id = $1',
            [ticket.customer_id]
        );
        if (custRes.rows[0]) {
            const row = custRes.rows[0];
            customerAddresses = [row.billing_address, row.shipping_address].filter(Boolean);
        }
    }

    return {
        ticket: {
            ...ticket,
            display_phone: ticket.ticket_phone_override || ticket.customer_phone
        },
        items: items.map((i) => ({ ...i, comments: commentsByItem[i.id] || [] })),
        audit: auditRes.rows,
        replacement_orders: replacementRows,
        customer_addresses: customerAddresses,
        otp_phase_note:
            'MSR91 SMS integration to be enabled in Phase 2 — OTP will be automatically sent to customer phone.'
    };
};

exports.listCategories = async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, name, sort_order FROM support_issue_categories WHERE active = true ORDER BY sort_order, name'
        );
        res.json({ success: true, categories: rows });
    } catch (e) {
        console.error('support listCategories', e);
        res.status(500).json({ success: false, message: 'Failed to load categories' });
    }
};

exports.listTechnicians = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT u.user_id, u.name, u.email, u.mobile_no, u.role, u.active,
                (SELECT COUNT(DISTINCT i.ticket_id)::int FROM support_ticket_items i
                    WHERE i.assigned_to = u.user_id AND i.status NOT IN ('resolved','closed')) AS open_ticket_count,
                (SELECT COUNT(*)::int FROM support_ticket_items i
                    WHERE i.assigned_to = u.user_id AND i.status NOT IN ('resolved','closed')) AS open_item_count
             FROM users u
             WHERE u.role IN ('support_tech', 'support_lead')
             ORDER BY u.active DESC, u.name`
        );
        res.json({ success: true, technicians: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to load technicians' });
    }
};

exports.searchCustomers = async (req, res) => {
    try {
        await ensureCustomerTables();
        const search = (req.query.search || '').trim();
        const limit = Math.min(parseInt(req.query.limit, 10) || 30, 50);
        const term = search ? `%${search}%` : null;
        let where = 'WHERE 1=1';
        const params = [];
        if (term) {
            params.push(term);
            where += ` AND (
                ec.customer_name ILIKE $1 OR CAST(ec.customer_id AS TEXT) LIKE $1
                OR ec.contact_person_number ILIKE $1 OR ec.customer_number ILIKE $1
            )`;
        }
        params.push(limit);
        const { rows } = await pool.query(
            `SELECT ec.customer_id, ec.customer_name, ec.contact_person_name,
                    ec.contact_person_number, ec.customer_number, ec.email
             FROM existing_customer ec ${where}
             ORDER BY ec.customer_name NULLS LAST LIMIT $${term ? 2 : 1}`,
            params
        );
        res.json({ success: true, items: rows });
    } catch (e) {
        console.error('support searchCustomers', e);
        res.status(500).json({ success: false, message: 'Failed to search customers' });
    }
};

exports.getCustomerDetail = async (req, res) => {
    try {
        await ensureCustomerTables();
        const customerId = parseInt(req.params.customerId, 10);
        const { rows } = await pool.query(
            `SELECT customer_id, customer_name, contact_person_name, contact_person_number, customer_number,
                    email, billing_address, shipping_address
             FROM existing_customer WHERE customer_id = $1`,
            [customerId]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        res.json({ success: true, customer: rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to load customer' });
    }
};

exports.getCustomerAssets = async (req, res) => {
    try {
        await ensureCustomerTables();
        const customerId = parseInt(req.params.customerId, 10);
        const { rows } = await pool.query(
            `SELECT id, serial_number, unique_serial_number, model_name, processor, generation,
                    ram, storage, gpu, screen_size, asset_kind, asset_bucket
             FROM customer_inventory WHERE customer_id = $1 ORDER BY id`,
            [customerId]
        );
        res.json({ success: true, assets: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to load assets' });
    }
};

exports.listTickets = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        const search = (req.query.search || '').trim();
        const view = (req.query.view || 'active').trim();
        const type = (req.query.type || '').trim();
        const closedDays = Math.min(parseInt(req.query.closed_days, 10) || 30, 365);
        const data = await supportQuery.listTicketsEnriched({
            user: req.user,
            view,
            search,
            type,
            limit,
            offset,
            closedDays
        });
        res.json({ success: true, ...data });
    } catch (e) {
        console.error('support listTickets', e);
        res.status(500).json({ success: false, message: 'Failed to load tickets' });
    }
};

exports.getDashboard = async (req, res) => {
    try {
        const summary = await supportQuery.dashboardSummary(req.user);
        res.json({ success: true, summary });
    } catch (e) {
        console.error('support getDashboard', e);
        res.status(500).json({ success: false, message: 'Failed to load dashboard' });
    }
};

exports.getNavBadges = async (req, res) => {
    try {
        const badges = await supportQuery.navBadges(req.user);
        res.json({ success: true, badges });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to load badges' });
    }
};

exports.createTicket = async (req, res) => {
    const {
        customer_id,
        customer_name,
        customer_phone,
        items,
        ticket_category: ticketCategoryRaw,
        priority,
        top_level_remarks,
        ticket_phone_override,
        ticket_alt_phone,
        ticket_email,
        ticket_address
    } = req.body;
    if (!customer_id || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'customer_id and items are required' });
    }

    const ticketCategory = VALID_ITEM_TYPES.has(ticketCategoryRaw)
        ? ticketCategoryRaw
        : (VALID_ITEM_TYPES.has(items[0]?.item_type) ? items[0].item_type : null);
    if (!ticketCategory) {
        return res.status(400).json({ success: false, message: 'ticket_category must be complaint, pickup, or replacement' });
    }
    const mismatched = items.find((item) => item.item_type !== ticketCategory);
    if (mismatched) {
        return res.status(400).json({
            success: false,
            message: `All machines must be type "${ticketCategory}". Mixed types belong in separate tickets or use "Add phase" on the ticket detail page.`
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await assertMachinesAvailable(client, customer_id, items);

        const hasUnassigned = items.some((item) => !item.assigned_to);
        const initialStatus = hasUnassigned ? TICKET_OPEN : TICKET_IN_PROGRESS;
        const ticketRes = await client.query(
            `INSERT INTO support_tickets (
                customer_id, customer_name, customer_phone, status, created_by, last_activity_at,
                priority, top_level_remarks, ticket_phone_override, ticket_alt_phone, ticket_email, ticket_address,
                ticket_category
            ) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [
                customer_id,
                customer_name || null,
                customer_phone || null,
                initialStatus,
                req.user.user_id,
                ['normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
                top_level_remarks || null,
                ticket_phone_override || customer_phone || null,
                ticket_alt_phone || null,
                ticket_email || null,
                ticket_address || null,
                ticketCategory
            ]
        );
        const ticket = ticketRes.rows[0];
        await logAudit(client, {
            itemId: null,
            ticketId: ticket.id,
            userId: req.user.user_id,
            action: 'ticket_created',
            detail: { customer_id, ticket_category: ticketCategory }
        });

        for (const item of items) {
            await insertTicketItem(client, ticket.id, { ...item, item_type: ticketCategory }, req.user.user_id);
        }

        await client.query('COMMIT');
        const full = await getTicketWithItems(ticket.id, req.user);
        res.status(201).json({ success: true, ...full });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('support createTicket', e);
        const status = e.status || 500;
        res.status(status).json({
            success: false,
            message: e.message || 'Failed to create ticket',
            duplicate: e.duplicate || undefined
        });
    } finally {
        client.release();
    }
};

exports.getTicket = async (req, res) => {
    try {
        const ticketId = parseInt(req.params.ticketId, 10);
        const data = await getTicketWithItems(ticketId, req.user);
        if (!data) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }
        res.json({ success: true, ...data });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to load ticket' });
    }
};

exports.closeTicket = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only support lead can manually close' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const force = !!(req.body && req.body.force);
    if (!force) {
        const itemsRes = await pool.query(
            `SELECT status FROM support_ticket_items WHERE ticket_id = $1`,
            [ticketId]
        );
        const allDone = itemsRes.rows.length > 0 && itemsRes.rows.every((r) =>
            ['resolved', 'closed', 'inventory_updated'].includes(r.status));
        if (!allDone) {
            return res.status(400).json({
                success: false,
                message: 'Close all items first, or use force close from the ticket screen'
            });
        }
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE support_tickets
             SET status = $2, closed_at = CURRENT_TIMESTAMP, closed_by = $3,
                 last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [ticketId, TICKET_CLOSED, req.user.user_id]
        );
        await logAudit(client, {
            itemId: null,
            ticketId,
            userId: req.user.user_id,
            action: 'ticket_closed',
            detail: { manual: true }
        });
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(500).json({ success: false, message: 'Failed to close ticket' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(ticketId, req.user);
    res.json({ success: true, ...data });
};

exports.addComment = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { body } = req.body;
    if (!body || !String(body).trim()) {
        return res.status(400).json({ success: false, message: 'Comment body required' });
    }

    const itemRes = await pool.query(
        'SELECT ticket_id, assigned_to FROM support_ticket_items WHERE id = $1',
        [itemId]
    );
    if (itemRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Item not found' });
    }
    const item = itemRes.rows[0];
    if (isSupportTechnician(req.user) && !isSupportLead(req.user) && item.assigned_to !== req.user.user_id) {
        return res.status(403).json({ success: false, message: 'Not assigned to this item' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const text = String(body).trim();
        const ins = await client.query(
            `INSERT INTO support_ticket_item_comments (item_id, user_id, author_role, body)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [itemId, req.user.user_id, req.user.role, text]
        );
        if (text.toLowerCase().startsWith('replacement needed')) {
            await client.query(
                `UPDATE support_ticket_items
                 SET replacement_flagged_by = $2, replacement_flag_reason = $3, status = 'repair_failed', updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [itemId, req.user.user_id, text]
            );
            await logAudit(client, {
                itemId,
                ticketId: item.ticket_id,
                userId: req.user.user_id,
                action: 'replacement_flagged',
                detail: { reason: text }
            });
        }
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'comment_added',
            detail: null
        });
        await bumpTicketActivity(client, item.ticket_id);
        await client.query('COMMIT');
        res.status(201).json({ success: true, comment: ins.rows[0] });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: 'Failed to add comment' });
    } finally {
        client.release();
    }
};

exports.markWorkDone = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const client = await pool.connect();
    try {
        const itemRes = await client.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
        if (itemRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Item not found' });
        }
        const item = itemRes.rows[0];
        if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user)) {
            return res.status(403).json({ success: false, message: 'Not assigned to this item' });
        }
        if (item.item_type === 'complaint' && item.outcome === 'fixed' && !item.pod_image_path) {
            return res.status(400).json({ success: false, message: 'Upload proof of delivery before marking work done' });
        }

        await client.query('BEGIN');
        await client.query(
            `UPDATE support_ticket_items SET status = 'awaiting_otp', work_done_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [itemId]
        );
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'work_done',
            detail: null
        });
        await bumpTicketActivity(client, item.ticket_id);
        await recomputeTicketStatus(client, item.ticket_id);
        await client.query('COMMIT');
        const data = await getTicketWithItems(item.ticket_id, req.user);
        res.json({ success: true, ...data });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: 'Failed to update item' });
    } finally {
        client.release();
    }
};

exports.uploadPod = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'POD image required' });
    }
    const relPath = path.join('support', path.basename(req.file.path)).replace(/\\/g, '/');
    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (itemRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Item not found' });
    }
    const item = itemRes.rows[0];
    if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Not assigned to this item' });
    }
    if (item.item_type === 'pickup' && !item.picked_up_at) {
        return res.status(400).json({ success: false, message: 'Mark pickup completed before uploading POD' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const podParams = item.item_type === 'pickup'
            ? [itemId, relPath, generateOtp()]
            : [itemId, relPath];
        await client.query(
            `UPDATE support_ticket_items SET pod_image_path = $2, updated_at = CURRENT_TIMESTAMP${item.item_type === 'pickup' ? ', pod_uploaded_at = CURRENT_TIMESTAMP, warehouse_otp_code = $3' : ', pod_uploaded_at = CURRENT_TIMESTAMP'} WHERE id = $1`,
            podParams
        );
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'pod_uploaded',
            detail: { path: relPath, warehouse_otp: item.item_type === 'pickup' }
        });
        await bumpTicketActivity(client, item.ticket_id);
        await client.query('COMMIT');
        const data = await getTicketWithItems(item.ticket_id, req.user);
        res.json({ success: true, ...data });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: 'Failed to upload POD' });
    } finally {
        client.release();
    }
};

exports.verifyOtp = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { otp } = req.body;
    if (!otp) {
        return res.status(400).json({ success: false, message: 'OTP required' });
    }

    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (itemRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Item not found' });
    }
    const item = itemRes.rows[0];
    if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Not assigned to this item' });
    }
    if (!item.pod_image_path) {
        return res.status(400).json({ success: false, message: 'Upload POD before closing with OTP' });
    }
    const trimmed = String(otp).trim();
    const useWarehouse = item.item_type === 'pickup' && item.warehouse_otp_code;
    if (useWarehouse) {
        if (String(item.warehouse_otp_code) !== trimmed) {
            return res.status(400).json({ success: false, message: 'Invalid warehouse OTP' });
        }
    } else if (String(item.otp_code) !== trimmed) {
        return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pickupWarehouse = useWarehouse
            ? `, warehouse_otp_verified_at = CURRENT_TIMESTAMP, warehouse_otp_code = NULL`
            : '';
        await client.query(
            `UPDATE support_ticket_items
             SET status = 'resolved', otp_verified_at = CURRENT_TIMESTAMP, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP${pickupWarehouse}
             WHERE id = $1`,
            [itemId]
        );
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'otp_verified',
            detail: null
        });
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'item_closed',
            detail: null
        });
        await bumpTicketActivity(client, item.ticket_id);
        await recomputeTicketStatus(client, item.ticket_id);
        await client.query('COMMIT');
        const data = await getTicketWithItems(item.ticket_id, req.user);
        res.json({ success: true, ...data });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: 'Failed to verify OTP' });
    } finally {
        client.release();
    }
};

exports.logLoanMachine = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { loan_machine_serial, loan_delivered_at } = req.body;
    if (!loan_machine_serial) {
        return res.status(400).json({ success: false, message: 'Loan machine serial required' });
    }
    const deliveredAt = loan_delivered_at ? new Date(loan_delivered_at) : new Date();
    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (itemRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Item not found' });
    }
    const item = itemRes.rows[0];
    if (item.item_type !== 'pickup') {
        return res.status(400).json({ success: false, message: 'Loan machine only for pickup items' });
    }
    if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Not assigned to this item' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE support_ticket_items
             SET loan_machine_serial = $2, loan_delivered_at = $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [itemId, loan_machine_serial, deliveredAt.toISOString()]
        );
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'loan_delivered',
            detail: { loan_machine_serial }
        });
        await bumpTicketActivity(client, item.ticket_id);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(500).json({ success: false, message: 'Failed to log loan machine' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({ success: true, ...data });
};

exports.schedulePickup = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { pickup_scheduled_at } = req.body;
    if (!pickup_scheduled_at) {
        return res.status(400).json({ success: false, message: 'pickup_scheduled_at required' });
    }
    const pickupAt = new Date(pickup_scheduled_at);
    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (itemRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Item not found' });
    }
    const item = itemRes.rows[0];
    if (item.item_type !== 'pickup') {
        return res.status(400).json({ success: false, message: 'Pickup schedule only for pickup items' });
    }
    if (item.loan_delivered_at) {
        const loanAt = new Date(item.loan_delivered_at);
        const minPickup = new Date(loanAt.getTime() + 72 * 60 * 60 * 1000);
        if (pickupAt < minPickup) {
            return res.status(400).json({
                success: false,
                message: 'Pickup cannot be scheduled within 72 hours of loan machine delivery'
            });
        }
    }
    if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Not assigned to this item' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE support_ticket_items SET pickup_scheduled_at = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [itemId, pickupAt.toISOString()]
        );
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'pickup_scheduled',
            detail: { pickup_scheduled_at: pickupAt.toISOString() }
        });
        await bumpTicketActivity(client, item.ticket_id);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(500).json({ success: false, message: 'Failed to schedule pickup' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({ success: true, ...data });
};

exports.assignItem = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only team lead can assign technicians' });
    }
    const itemId = parseInt(req.params.itemId, 10);
    const assignedTo = req.body.assigned_to ? parseInt(req.body.assigned_to, 10) : null;
    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) {
        return res.status(404).json({ success: false, message: 'Item not found' });
    }
    const item = itemRes.rows[0];
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE support_ticket_items SET assigned_to = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [itemId, assignedTo]
        );
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'technician_assigned',
            detail: { assigned_to: assignedTo }
        });
        await bumpTicketActivity(client, item.ticket_id);
        await recomputeTicketStatus(client, item.ticket_id);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(500).json({ success: false, message: 'Failed to assign technician' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({ success: true, ...data });
};

exports.removePod = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) {
        return res.status(404).json({ success: false, message: 'Item not found' });
    }
    const item = itemRes.rows[0];
    if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Not assigned to this item' });
    }
    await pool.query(
        `UPDATE support_ticket_items SET pod_image_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [itemId]
    );
    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({ success: true, ...data });
};

exports.getSettings = async (req, res) => {
    try {
        const settings = await supportQuery.getSettings();
        res.json({ success: true, settings });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to load settings' });
    }
};

exports.updateSettings = async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin only' });
    }
    const { auto_close_enabled, overdue_threshold_hours, msr91_enabled } = req.body || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (auto_close_enabled !== undefined) {
            await client.query(
                `INSERT INTO support_settings (key, value, updated_at) VALUES ('auto_close_enabled', $1::jsonb, CURRENT_TIMESTAMP)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
                [JSON.stringify(!!auto_close_enabled)]
            );
        }
        if (overdue_threshold_hours !== undefined) {
            const hours = Math.max(1, parseInt(overdue_threshold_hours, 10) || 48);
            await client.query(
                `INSERT INTO support_settings (key, value, updated_at) VALUES ('overdue_threshold_hours', $1::jsonb, CURRENT_TIMESTAMP)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
                [JSON.stringify(hours)]
            );
        }
        if (msr91_enabled !== undefined) {
            await client.query(
                `INSERT INTO support_settings (key, value, updated_at) VALUES ('msr91_enabled', $1::jsonb, CURRENT_TIMESTAMP)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
                [JSON.stringify(!!msr91_enabled)]
            );
        }
        await client.query('COMMIT');
        const settings = await supportQuery.getSettings();
        res.json({ success: true, settings });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: 'Failed to update settings' });
    } finally {
        client.release();
    }
};

exports.upsertCategory = async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin only' });
    }
    const { id, name, sort_order, active } = req.body || {};
    if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, message: 'Name required' });
    }
    if (id) {
        await pool.query(
            `UPDATE support_issue_categories
             SET name = $2, sort_order = COALESCE($3, sort_order), active = COALESCE($4, active)
             WHERE id = $1`,
            [id, String(name).trim(), sort_order ?? null, active ?? null]
        );
    } else {
        await pool.query(
            `INSERT INTO support_issue_categories (name, sort_order, active) VALUES ($1, COALESCE($2, 0), COALESCE($3, true))`,
            [String(name).trim(), sort_order ?? 0, active ?? true]
        );
    }
    const { rows } = await pool.query(
        'SELECT id, name, sort_order, active FROM support_issue_categories ORDER BY sort_order, name'
    );
    res.json({ success: true, categories: rows });
};

exports.deleteCategory = async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin only' });
    }
    const categoryId = parseInt(req.params.categoryId, 10);
    await pool.query('UPDATE support_issue_categories SET active = false WHERE id = $1', [categoryId]);
    const { rows } = await pool.query(
        'SELECT id, name, sort_order, active FROM support_issue_categories ORDER BY sort_order, name'
    );
    res.json({ success: true, categories: rows });
};

exports.checkDuplicateTicket = async (req, res) => {
    try {
        const customerId = parseInt(req.query.customer_id, 10);
        const serial = (req.query.serial || '').trim();
        const inventoryId = req.query.customer_inventory_id
            ? parseInt(req.query.customer_inventory_id, 10)
            : null;
        if (!customerId || (!serial && !inventoryId)) {
            return res.json({ success: true, duplicate: null });
        }
        const client = await pool.connect();
        try {
            const dup = await findOpenTicketForMachine(client, customerId, {
                customer_inventory_id: inventoryId,
                serial_number: serial,
                unique_serial_number: serial
            });
            res.json({ success: true, duplicate: dup ? { id: dup.id, status: dup.status } : null });
        } finally {
            client.release();
        }
    } catch (e) {
        res.status(500).json({ success: false, message: 'Duplicate check failed' });
    }
};

/** Add pickup / replacement phase items to an existing ticket (linked to complaint or replacement source). */
exports.addWorkflowPhaseItems = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only team lead can add workflow phases' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'items array is required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const ticketRes = await client.query('SELECT * FROM support_tickets WHERE id = $1', [ticketId]);
        if (!ticketRes.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }
        const ticket = ticketRes.rows[0];
        if (ticket.status === 'closed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Cannot add items to a closed ticket' });
        }

        const normalized = [];
        for (const raw of items) {
            const itemType = raw.item_type;
            if (!VALID_ITEM_TYPES.has(itemType) || itemType === 'complaint') {
                throw Object.assign(new Error('Phase items must be pickup or replacement'), { status: 400 });
            }
            const sourceId = raw.source_item_id ? parseInt(raw.source_item_id, 10) : null;
            if (sourceId) {
                const srcRes = await client.query(
                    'SELECT * FROM support_ticket_items WHERE id = $1 AND ticket_id = $2',
                    [sourceId, ticketId]
                );
                if (!srcRes.rows.length) {
                    throw Object.assign(new Error('Source item not found on this ticket'), { status: 400 });
                }
                const src = srcRes.rows[0];
                if (itemType === 'pickup' && src.item_type === 'complaint' && !['resolved', 'closed'].includes(src.status)) {
                    throw Object.assign(
                        new Error('Complaint must be resolved before scheduling pickup for that machine'),
                        { status: 400 }
                    );
                }
                if (itemType === 'pickup' && src.item_type === 'replacement' && src.status !== 'inventory_updated') {
                    throw Object.assign(
                        new Error('Replacement must be delivered before scheduling return pickup of the old machine'),
                        { status: 400 }
                    );
                }
            }
            normalized.push({
                ...raw,
                item_type: itemType,
                source_item_id: sourceId,
                customer_inventory_id: raw.customer_inventory_id || null
            });
        }

        await assertMachinesAvailable(client, ticket.customer_id, normalized, ticketId);

        for (const item of normalized) {
            await insertTicketItem(client, ticketId, item, req.user.user_id, { source_item_id: item.source_item_id });
        }

        await bumpTicketActivity(client, ticketId);
        await recomputeTicketStatus(client, ticketId);
        await client.query('COMMIT');
        const full = await getTicketWithItems(ticketId, req.user);
        res.json({ success: true, ...full });
    } catch (e) {
        await client.query('ROLLBACK');
        const status = e.status || 500;
        res.status(status).json({
            success: false,
            message: e.message || 'Failed to add workflow items',
            duplicate: e.duplicate || undefined
        });
    } finally {
        client.release();
    }
};

exports.assignTicketBulk = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only team lead can assign technicians' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const assignedTo = req.body.assigned_to ? parseInt(req.body.assigned_to, 10) : null;
    if (!assignedTo) {
        return res.status(400).json({ success: false, message: 'assigned_to required' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `UPDATE support_ticket_items SET assigned_to = $2, updated_at = CURRENT_TIMESTAMP
             WHERE ticket_id = $1 AND assigned_to IS NULL AND status NOT IN ('resolved','closed')
             RETURNING id`,
            [ticketId, assignedTo]
        );
        for (const row of rows) {
            await logAudit(client, {
                itemId: row.id,
                ticketId,
                userId: req.user.user_id,
                action: 'technician_assigned',
                detail: { assigned_to: assignedTo, bulk: true }
            });
        }
        await bumpTicketActivity(client, ticketId);
        await recomputeTicketStatus(client, ticketId);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(500).json({ success: false, message: 'Failed to assign technicians' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(ticketId, req.user);
    res.json({ success: true, ...data });
};

exports.updateTicket = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only team lead can edit tickets' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const {
        ticket_phone_override,
        ticket_alt_phone,
        ticket_email,
        ticket_address,
        priority,
        top_level_remarks,
        items,
        new_items: newItems,
        remove_item_ids: removeItemIds
    } = req.body || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE support_tickets SET
                ticket_phone_override = COALESCE($2, ticket_phone_override),
                ticket_alt_phone = COALESCE($3, ticket_alt_phone),
                ticket_email = COALESCE($4, ticket_email),
                ticket_address = COALESCE($5, ticket_address),
                priority = COALESCE($6, priority),
                top_level_remarks = COALESCE($7, top_level_remarks),
                updated_at = CURRENT_TIMESTAMP,
                last_activity_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [
                ticketId,
                ticket_phone_override ?? null,
                ticket_alt_phone ?? null,
                ticket_email ?? null,
                ticket_address ?? null,
                priority ?? null,
                top_level_remarks ?? null
            ]
        );
        if (Array.isArray(items)) {
            for (const item of items) {
                if (!item.id) continue;
                await client.query(
                    `UPDATE support_ticket_items
                     SET assigned_to = COALESCE($2, assigned_to),
                         remarks = COALESCE($3, remarks),
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $1 AND ticket_id = $4`,
                    [item.id, item.assigned_to ?? null, item.remarks ?? null, ticketId]
                );
            }
        }
        if (Array.isArray(removeItemIds)) {
            for (const rawId of removeItemIds) {
                const itemId = parseInt(rawId, 10);
                const itemRes = await client.query(
                    'SELECT * FROM support_ticket_items WHERE id = $1 AND ticket_id = $2',
                    [itemId, ticketId]
                );
                if (!itemRes.rows.length) continue;
                const row = itemRes.rows[0];
                if (row.assigned_to || row.status !== 'open') {
                    throw new Error('Only open unassigned items can be removed');
                }
                await client.query('DELETE FROM support_ticket_items WHERE id = $1', [itemId]);
                await logAudit(client, {
                    itemId,
                    ticketId,
                    userId: req.user.user_id,
                    action: 'item_removed',
                    detail: { serial: row.serial_number || row.unique_serial_number }
                });
            }
        }
        if (Array.isArray(newItems) && newItems.length) {
            const ticketRow = await client.query('SELECT customer_id FROM support_tickets WHERE id = $1', [ticketId]);
            await assertMachinesAvailable(client, ticketRow.rows[0].customer_id, newItems, ticketId);
            for (const item of newItems) {
                await insertTicketItem(client, ticketId, item, req.user.user_id);
            }
        }
        await logAudit(client, {
            itemId: null,
            ticketId,
            userId: req.user.user_id,
            action: 'ticket_updated',
            detail: null
        });
        await recomputeTicketStatus(client, ticketId);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(500).json({ success: false, message: e.message || 'Failed to update ticket' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(ticketId, req.user);
    res.json({ success: true, ...data });
};

exports.logVisit = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ success: false, message: 'Item not found' });
    const item = itemRes.rows[0];
    if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Not assigned to this item' });
    }
    await pool.query(
        `UPDATE support_ticket_items SET visited_at = CURRENT_TIMESTAMP, status = 'visited', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [itemId]
    );
    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({ success: true, ...data });
};

exports.markVisited = exports.logVisit;

exports.setOutcome = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { outcome, comment } = req.body || {};
    const allowed = new Set(['fixed', 'working', 'replacement_required']);
    if (!allowed.has(outcome)) {
        return res.status(400).json({ success: false, message: 'Invalid outcome' });
    }
    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ success: false, message: 'Item not found' });
    const item = itemRes.rows[0];
    if (item.item_type !== 'complaint') {
        return res.status(400).json({ success: false, message: 'Outcome only applies to complaint items' });
    }
    const userId = parseInt(req.user.user_id, 10);
    if (Number.isNaN(userId)) {
        return res.status(400).json({ success: false, message: 'Invalid user in token' });
    }
    if (!isSupportLead(req.user)) {
        const assignedId = item.assigned_to != null ? parseInt(item.assigned_to, 10) : NaN;
        if (assignedId !== userId) {
            return res.status(403).json({ success: false, message: 'Not assigned to this item' });
        }
    }
    if (!item.visited_at) {
        return res.status(400).json({ success: false, message: 'Mark visit first' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await ensureSupportTicketItemV3Columns(client);
        const reason = outcome === 'replacement_required' ? (String(comment || '').trim() || item.replacement_flag_reason || 'Replacement required') : null;
        await client.query(
            `UPDATE support_ticket_items SET
                outcome = $2::varchar(30),
                outcome_set_by = $3::int,
                outcome_set_at = CURRENT_TIMESTAMP,
                replacement_flagged_by = CASE WHEN ($2::text) = 'replacement_required' THEN $3::int ELSE replacement_flagged_by END,
                replacement_flag_reason = CASE WHEN ($2::text) = 'replacement_required' THEN $4::text ELSE replacement_flag_reason END,
                status = CASE
                    WHEN ($2::text) = 'replacement_required' THEN 'repair_failed'::varchar(40)
                    WHEN ($2::text) = 'fixed' THEN 'visited'::varchar(40)
                    WHEN ($2::text) = 'working' THEN 'visited'::varchar(40)
                    ELSE status
                END,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1::int`,
            [itemId, outcome, userId, reason]
        );
        const cmt = String(comment || '').trim();
        if (cmt) {
            await client.query(
                `INSERT INTO support_ticket_item_comments (item_id, user_id, author_role, body)
                 VALUES ($1, $2, $3, $4)`,
                [itemId, userId, req.user.role, cmt]
            );
        }
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId,
            action: 'outcome_set',
            detail: { outcome }
        });
        await bumpTicketActivity(client, item.ticket_id);
        await client.query('COMMIT');
    } catch (e) {
        try {
            await client.query('ROLLBACK');
        } catch (rbErr) {
            console.error('setOutcome rollback', rbErr);
        }
        console.error('setOutcome', e);
        return res.status(500).json({
            success: false,
            message: 'Failed to set outcome',
            detail: e.message,
            code: e.code
        });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({ success: true, ...data });
};

exports.markPickedUp = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ success: false, message: 'Item not found' });
    const item = itemRes.rows[0];
    if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Not assigned to this item' });
    }
    await pool.query(
        `UPDATE support_ticket_items SET picked_up_at = CURRENT_TIMESTAMP, status = 'picked_up', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [itemId]
    );
    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({ success: true, ...data });
};

exports.initiateReplacement = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only team lead can initiate replacement' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const { source_item_id, new_customer_inventory_id, reason } = req.body || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const srcRes = await client.query('SELECT * FROM support_ticket_items WHERE id = $1 AND ticket_id = $2', [source_item_id, ticketId]);
        if (!srcRes.rows.length) throw new Error('Source item not found');
        const src = srcRes.rows[0];
        const newAssetRes = await client.query('SELECT * FROM customer_inventory WHERE id = $1', [new_customer_inventory_id]);
        if (!newAssetRes.rows.length) throw new Error('Replacement asset not found');
        const asset = newAssetRes.rows[0];
        const otp = generateOtp();
        const itemIns = await client.query(
            `INSERT INTO support_ticket_items (
                ticket_id, customer_inventory_id, serial_number, unique_serial_number, brand, model,
                ram, storage, generation, item_type, remarks, status, otp_code, source_item_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'replacement',$10,'order_placed',$11,$12) RETURNING id`,
            [
                ticketId,
                asset.id,
                asset.serial_number,
                asset.unique_serial_number,
                asset.model_name?.split(' ')[0] || null,
                asset.model_name,
                asset.ram,
                asset.storage,
                asset.generation,
                reason || src.replacement_flag_reason || null,
                otp,
                source_item_id
            ]
        );
        const replacementItemId = itemIns.rows[0].id;
        await client.query(
            `INSERT INTO support_replacement_orders (
                ticket_id, item_id, source_item_id, old_customer_inventory_id, new_customer_inventory_id,
                old_machine_serial, new_machine_serial, status, created_by, notes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,'placed',$8,$9)`,
            [
                ticketId,
                replacementItemId,
                source_item_id,
                src.customer_inventory_id,
                asset.id,
                src.unique_serial_number || src.serial_number,
                asset.unique_serial_number || asset.serial_number,
                req.user.user_id,
                reason || src.replacement_flag_reason || null
            ]
        );
        await client.query(
            `UPDATE support_ticket_items SET replacement_approved_by = $2, replacement_approved_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [source_item_id, req.user.user_id]
        );
        await logAudit(client, {
            itemId: replacementItemId,
            ticketId,
            userId: req.user.user_id,
            action: 'replacement_initiated',
            detail: { source_item_id, new_customer_inventory_id }
        });
        await bumpTicketActivity(client, ticketId);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: e.message || 'Failed to initiate replacement' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(ticketId, req.user);
    res.json({ success: true, ...data });
};

exports.updateReplacementOrder = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only team lead can update replacement orders' });
    }
    const orderId = parseInt(req.params.orderId, 10);
    const { status } = req.body || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const stampCol = status === 'dispatched' ? 'dispatched_at' : null;
        let sql = `UPDATE support_replacement_orders SET status = $2`;
        const params = [orderId, status];
        if (stampCol) {
            sql += `, ${stampCol} = CURRENT_TIMESTAMP`;
        }
        sql += ' WHERE id = $1 RETURNING ticket_id, item_id';
        const { rows } = await client.query(sql, params);
        if (!rows.length) throw new Error('Order not found');
        await client.query('UPDATE support_ticket_items SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [rows[0].item_id, status]);
        await logAudit(client, {
            itemId: rows[0].item_id,
            ticketId: rows[0].ticket_id,
            userId: req.user.user_id,
            action: 'replacement_status_updated',
            detail: { status }
        });
        await bumpTicketActivity(client, rows[0].ticket_id);
        await client.query('COMMIT');
        const data = await getTicketWithItems(rows[0].ticket_id, req.user);
        res.json({ success: true, ...data });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ success: false, message: e.message || 'Failed to update replacement order' });
    } finally {
        client.release();
    }
};

exports.deliverReplacement = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only team lead can complete replacement delivery' });
    }
    const orderId = parseInt(req.params.orderId, 10);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orderRes = await client.query('SELECT * FROM support_replacement_orders WHERE id = $1', [orderId]);
        if (!orderRes.rows.length) throw new Error('Order not found');
        const order = orderRes.rows[0];
        const ticketRes = await client.query('SELECT customer_id FROM support_tickets WHERE id = $1', [order.ticket_id]);
        const customerId = ticketRes.rows[0]?.customer_id;
        if (order.old_customer_inventory_id) {
            await supportInventoryService.passivateAsset(client, {
                inventoryId: order.old_customer_inventory_id,
                reason: `Replaced — Ticket #TKT-${String(order.ticket_id).padStart(3, '0')}, ${new Date().toISOString().slice(0, 10)}`
            });
        }
        if (order.new_customer_inventory_id) {
            await supportInventoryService.activateAsset(client, order.new_customer_inventory_id);
        }
        await client.query(
            `UPDATE support_replacement_orders
             SET status = 'inventory_updated', delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP),
                 inventory_updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [orderId]
        );
        await client.query(
            `UPDATE support_ticket_items SET status = 'inventory_updated', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [order.item_id]
        );
        await logAudit(client, {
            itemId: order.item_id,
            ticketId: order.ticket_id,
            userId: req.user.user_id,
            action: 'inventory_updated',
            detail: { order_id: orderId }
        });
        await bumpTicketActivity(client, order.ticket_id);
        await recomputeTicketStatus(client, order.ticket_id);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: e.message || 'Failed to update inventory' });
    } finally {
        client.release();
    }
    const order = (await pool.query('SELECT ticket_id FROM support_replacement_orders WHERE id = $1', [orderId])).rows[0];
    const data = await getTicketWithItems(order.ticket_id, req.user);
    res.json({ success: true, ...data });
};

exports.exportTickets = async (req, res) => {
    try {
        const data = await supportQuery.listTicketsEnriched({
            user: req.user,
            view: req.query.view || 'all',
            search: (req.query.search || '').trim(),
            type: (req.query.type || '').trim(),
            limit: 500,
            offset: 0,
            closedDays: 365
        });
        const header = ['Ticket ID', 'Customer', 'Phone', 'Machines', 'Types', 'Status', 'Technicians', 'Created', 'Last updated', 'Resolved'];
        const lines = [header.join(',')];
        for (const t of data.tickets) {
            const techs = [...new Set((t.items || []).map((i) => i.assigned_to_name).filter(Boolean))].join('; ');
            const machines = (t.items || []).map((i) => i.unique_serial_number || i.serial_number).join('; ');
            const types = (t.items || []).map((i) => i.item_type).join('; ');
            lines.push([
                `TKT-${String(t.id).padStart(3, '0')}`,
                JSON.stringify(t.customer_name || ''),
                JSON.stringify(t.display_phone || t.customer_phone || ''),
                JSON.stringify(machines),
                JSON.stringify(types),
                t.status,
                JSON.stringify(techs),
                t.created_at,
                t.updated_at,
                t.closed_at || ''
            ].join(','));
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="support-tickets.csv"');
        res.send(lines.join('\n'));
    } catch (e) {
        res.status(500).json({ success: false, message: 'Export failed' });
    }
};

exports.getAvailableAssets = async (req, res) => {
    try {
        const customerId = parseInt(req.params.customerId, 10);
        const assets = await supportInventoryService.getAvailableAssets(customerId);
        res.json({ success: true, assets });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to load available assets' });
    }
};

exports.removeTicketItem = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only team lead can remove items' });
    }
    const itemId = parseInt(req.params.itemId, 10);
    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ success: false, message: 'Item not found' });
    const item = itemRes.rows[0];
    if (item.assigned_to || !['open'].includes(item.status)) {
        return res.status(400).json({ success: false, message: 'Only open unassigned items can be removed' });
    }
    await pool.query('DELETE FROM support_ticket_items WHERE id = $1', [itemId]);
    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({ success: true, ...data });
};

exports.ensureSupportSchema = async () => {
    for (const file of ['025_support_module.sql', '026_support_redesign.sql', '027_support_v2.sql', '029_support_v3.sql', '031_support_ticket_category.sql']) {
        const sqlPath = path.join(__dirname, '../migrations', file);
        if (fs.existsSync(sqlPath)) {
            const sql = fs.readFileSync(sqlPath, 'utf8');
            await pool.query(sql);
        }
    }
};
