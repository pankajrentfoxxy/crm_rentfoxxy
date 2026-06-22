const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { isSupportLead, isSupportTechnician } = require('../middleware/supportAccess');
const { deriveItemCurrentStep } = require('../services/supportTicketFlow');
const { ensureCustomerTables } = require('../services/customerInventoryErpSyncService');
const supportQuery = require('../services/supportQuery');
const supportInventoryService = require('../services/supportInventoryService');
const inventorySM = require('../services/inventoryStateMachine');
const { processReturnedSerials } = require('../services/returnCompletionService');
const { createFloorTicketFromSupportPickup } = require('../services/grnTicketService');
const { nextDocumentNumber } = require('../services/salesManagementService');
const { regenerateReturnDcPdf } = require('../services/returnDcPdfService');

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
    const isPickup = item.item_type === 'pickup';
    const ins = await client.query(
        `INSERT INTO support_ticket_items (
            ticket_id, customer_inventory_id, serial_number, unique_serial_number,
            brand, model, ram, storage, generation, item_type,
            issue_category_id, issue_category_label, remarks, assigned_to, status, otp_code, source_item_id,
            pickup_type, customer_otp_code, customer_otp_sent_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'open',$15,$16,$17,$18,$19)
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
            extra.source_item_id || item.source_item_id || null,
            item.pickup_type || null,
            isPickup ? otp : null,
            isPickup ? new Date() : null,
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
            ADD COLUMN IF NOT EXISTS pickup_completed_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS visited_lat VARCHAR(30),
            ADD COLUMN IF NOT EXISTS visited_lng VARCHAR(30),
            ADD COLUMN IF NOT EXISTS ttspl_id VARCHAR(120),
            ADD COLUMN IF NOT EXISTS ttspl_verified BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS ttspl_verified_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS ttspl_verified_by INTEGER REFERENCES users (user_id),
            ADD COLUMN IF NOT EXISTS reached_warehouse_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS warehouse_received_by INTEGER REFERENCES users (user_id),
            ADD COLUMN IF NOT EXISTS floor_ticket_id INTEGER,
            ADD COLUMN IF NOT EXISTS proof_of_completion_path TEXT,
            ADD COLUMN IF NOT EXISTS pickup_type VARCHAR(20),
            ADD COLUMN IF NOT EXISTS customer_otp_code VARCHAR(6),
            ADD COLUMN IF NOT EXISTS customer_otp_sent_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS customer_otp_verified_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS warehouse_received_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS warehouse_esign_url TEXT,
            ADD COLUMN IF NOT EXISTS warehouse_esign_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS warehouse_esign_by INTEGER REFERENCES users (user_id),
            ADD COLUMN IF NOT EXISTS porter_tracking_id VARCHAR(200),
            ADD COLUMN IF NOT EXISTS porter_order_id VARCHAR(200),
            ADD COLUMN IF NOT EXISTS return_dc_number VARCHAR(50),
            ADD COLUMN IF NOT EXISTS technician_esign_url TEXT,
            ADD COLUMN IF NOT EXISTS technician_esign_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS technician_esign_by INTEGER REFERENCES users (user_id)
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
               ci.asset_bucket AS inv_asset_bucket, ci.customer_id AS inv_customer_id,
               rdc.pdf_path AS return_dc_pdf_path,
               rdc.sales_order_number AS return_so_number,
               rdc.original_dc_number AS original_dc_number
        FROM support_ticket_items i
        LEFT JOIN users u ON u.user_id = i.assigned_to
        LEFT JOIN support_issue_categories c ON c.id = i.issue_category_id
        LEFT JOIN customer_inventory ci ON ci.id = i.customer_inventory_id
        LEFT JOIN LATERAL (
            SELECT pdf_path, sales_order_number, original_dc_number
              FROM delivery_challan_lines
             WHERE dc_number = i.return_dc_number AND movement_type = 'return'
             LIMIT 1
        ) rdc ON i.return_dc_number IS NOT NULL
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
        if (merged.item_type === 'pickup' && !merged.customer_otp_code && merged.otp_code) {
            merged.customer_otp_code = merged.otp_code;
        }
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

// Support now reads the live CRM tables (customers + vendor_serial_numbers),
// not the deprecated ERP tables (existing_customer / customer_inventory).
exports.searchCustomers = async (req, res) => {
    try {
        const search = (req.query.search || '').trim();
        const limit = Math.min(parseInt(req.query.limit, 10) || 30, 50);
        const term = search ? `%${search}%` : null;
        const params = [];
        let where = 'WHERE 1=1';
        if (term) {
            params.push(term);
            where += ` AND (
                COALESCE(c.company_name, '') ILIKE $1 OR c.name ILIKE $1
                OR CAST(c.customer_id AS TEXT) LIKE $1
                OR COALESCE(c.phone, '') ILIKE $1 OR COALESCE(c.whatsapp_number, '') ILIKE $1
            )`;
        }
        params.push(limit);
        const { rows } = await pool.query(
            `SELECT c.customer_id,
                    COALESCE(c.company_name, c.name) AS customer_name,
                    c.name AS contact_person_name,
                    c.phone AS contact_person_number,
                    c.phone AS customer_number,
                    c.email
             FROM customers c ${where}
             ORDER BY COALESCE(c.company_name, c.name) NULLS LAST LIMIT $${term ? 2 : 1}`,
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
        const customerId = parseInt(req.params.customerId, 10);
        const { rows } = await pool.query(
            `SELECT c.customer_id,
                    COALESCE(c.company_name, c.name) AS customer_name,
                    c.name AS contact_person_name,
                    c.phone AS contact_person_number,
                    c.phone AS customer_number,
                    c.email,
                    COALESCE(c.billing_address, c.address) AS billing_address,
                    c.shipping_address
             FROM customers c WHERE c.customer_id = $1`,
            [customerId]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        res.json({ success: true, customer: rows[0] });
    } catch (e) {
        console.error('support getCustomerDetail', e);
        res.status(500).json({ success: false, message: 'Failed to load customer' });
    }
};

// A customer's deployed laptops, from the authoritative inventory.
exports.getCustomerAssets = async (req, res) => {
    try {
        const customerId = parseInt(req.params.customerId, 10);
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
                    vsn.extra->>'gpu' AS gpu,
                    vsn.extra->>'screen_size' AS screen_size,
                    vsn.inventory_status AS asset_bucket
             FROM vendor_serial_numbers vsn
             WHERE vsn.current_customer_id = $1 AND vsn.deleted_at IS NULL
               AND vsn.inventory_status IN ('rented', 'on_demo', 'sold')
             ORDER BY vsn.inventory_asset_code`,
            [customerId]
        );
        res.json({ success: true, assets: rows });
    } catch (e) {
        console.error('support getCustomerAssets', e);
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
        ticket_address,
        ttspl_id,
        dc_number,
        sales_order_number,
        customer_portal_ticket,
        portal_customer_id
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
                ticket_category, ttspl_id, dc_number, sales_order_number, customer_portal_ticket, portal_customer_id
            ) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
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
                ticketCategory,
                ttspl_id || null,
                dc_number || null,
                sales_order_number || null,
                customer_portal_ticket === true,
                portal_customer_id || (customer_portal_ticket === true ? customer_id : null)
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
    // Phase 20 pickup flow: POD photo is taken at the customer site, after the
    // technician marks "reached" but BEFORE the customer OTP / handover. Legacy
    // pickups (loan flow) still require the laptop to be picked up first.
    const isLegacyPickup = item.item_type === 'pickup'
        && !item.pickup_type
        && (item.pickup_method === 'self_carry' || item.loan_delivered_at);
    const isNewPickup = item.item_type === 'pickup' && !isLegacyPickup;
    if (isNewPickup && !item.visited_at) {
        return res.status(400).json({ success: false, message: 'Mark as reached before uploading the pickup photo' });
    }
    if (isLegacyPickup && !item.picked_up_at) {
        return res.status(400).json({ success: false, message: 'Mark pickup completed before uploading POD' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Self-heal: ensure pod_uploaded_at / warehouse_otp_code exist (envs that
        // never ran the support v3 migration, e.g. staging, otherwise 500 here).
        await ensureSupportTicketItemV3Columns(client);
        // Legacy pickups close via a warehouse OTP; the new flow uses customer OTP
        // + warehouse e-sign, so we do not mint a warehouse OTP for them.
        const podParams = isLegacyPickup
            ? [itemId, relPath, generateOtp()]
            : [itemId, relPath];
        await client.query(
            `UPDATE support_ticket_items SET pod_image_path = $2, proof_of_completion_path = $2, updated_at = CURRENT_TIMESTAMP${isLegacyPickup ? ', pod_uploaded_at = CURRENT_TIMESTAMP, warehouse_otp_code = $3' : ', pod_uploaded_at = CURRENT_TIMESTAMP'} WHERE id = $1`,
            podParams
        );
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'pod_uploaded',
            detail: { path: relPath, warehouse_otp: isLegacyPickup }
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

        // Pure pickup (return without replacement): stop billing on the unit by
        // marking it returned in the authoritative inventory. Replacement returns
        // are handled in deliverReplacement, so only act on standalone pickups.
        // Pure pickup completed by support OTP (legacy path, no Return DC): run the
        // shared return-completion flow for the single unit. (Return DCs run it via
        // the delivery POD path instead.) This item is resolved by verifyOtp itself,
        // so we pass supportTicketId=null.
        if (item.item_type === 'pickup') {
            try {
                const code = item.ttspl_id || item.unique_serial_number || item.serial_number;
                const serial = await inventorySM.findSerialByCode(client, code);
                if (serial && ['rented', 'on_demo', 'sold'].includes(serial.inventory_status)) {
                    const [out] = await processReturnedSerials(client, {
                        serialIds: [serial.serial_id],
                        supportTicketId: null,
                        actorUserId: req.user.user_id,
                        actorName: req.user.name,
                    });
                    if (out?.returnTicketId) {
                        await logAudit(client, {
                            itemId, ticketId: item.ticket_id, userId: req.user.user_id,
                            action: 'return_qc_ticket_created', detail: { ticket_id: out.returnTicketId },
                        });
                    }
                    if (out?.creditNote) {
                        await logAudit(client, {
                            itemId, ticketId: item.ticket_id, userId: req.user.user_id,
                            action: 'credit_note_raised', detail: { credit_note_number: out.creditNote },
                        });
                    }
                }
            } catch (bridgeErr) {
                console.error('[support] pickup return completion failed for item', itemId, bridgeErr.message);
            }
        }

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
    const { latitude, longitude, address } = req.body || {};
    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ success: false, message: 'Item not found' });
    const item = itemRes.rows[0];
    if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Not assigned to this item' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await ensureSupportTicketItemV3Columns(client);
        await client.query(
            `UPDATE support_ticket_items SET
                visited_at = CURRENT_TIMESTAMP,
                status = 'visited',
                visited_lat = $2,
                visited_lng = $3,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [itemId, latitude ? String(latitude) : null, longitude ? String(longitude) : null]
        );
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'tech_reached',
            detail: { latitude: latitude || null, longitude: longitude || null, address: address || null }
        });
        await bumpTicketActivity(client, item.ticket_id);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('support logVisit', e);
        return res.status(500).json({ success: false, message: 'Failed to mark reached' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({ success: true, ...data });
};

exports.verifyTtspl = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { ttspl_input: ttsplInput } = req.body || {};
    if (!ttsplInput || !String(ttsplInput).trim()) {
        return res.status(400).json({ success: false, message: 'Enter TTSPL ID or serial number' });
    }

    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ success: false, message: 'Item not found' });
    const item = itemRes.rows[0];
    if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Not assigned to this item' });
    }

    // Step order: mark "reached" (capture GPS) before verifying the TTSPL ID.
    if (!item.visited_at) {
        return res.status(400).json({ success: false, message: 'Mark as reached first, then verify the TTSPL ID' });
    }

    const expectedTtspl = String(item.ttspl_id || item.unique_serial_number || '').trim().toUpperCase();
    const expectedSerial = String(item.serial_number || '').trim().toUpperCase();
    const input = String(ttsplInput).trim().toUpperCase();
    if (!expectedTtspl && !expectedSerial) {
        return res.status(400).json({ success: false, message: 'This item has no TTSPL ID / serial on record to verify against' });
    }
    if (input !== expectedTtspl && input !== expectedSerial) {
        return res.status(400).json({
            success: false,
            message: `TTSPL ID does not match this ticket. Expected ${expectedTtspl || expectedSerial}.`
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await ensureSupportTicketItemV3Columns(client);
        await client.query(
            `UPDATE support_ticket_items SET
                ttspl_verified = TRUE,
                ttspl_verified_at = CURRENT_TIMESTAMP,
                ttspl_verified_by = $2,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [itemId, req.user.user_id]
        );
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'ttspl_verified',
            detail: { input }
        });
        await bumpTicketActivity(client, item.ticket_id);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('support verifyTtspl', e);
        return res.status(500).json({ success: false, message: 'Failed to verify TTSPL' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({ success: true, message: 'TTSPL verified', ...data });
};

// Phase 18: technician cannot fix at site -> picks up the laptop and carries it
// to the warehouse. Creates a linked "pickup" item that tracks the return journey.
exports.submitForPickup = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { pickup_reason: pickupReason } = req.body || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await ensureSupportTicketItemV3Columns(client);

        const itemRes = await client.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
        if (!itemRes.rows.length) throw Object.assign(new Error('Item not found'), { status: 404 });
        const item = itemRes.rows[0];
        if (item.item_type !== 'complaint') {
            throw Object.assign(new Error('Only complaint items can be picked up for warehouse repair'), { status: 400 });
        }
        if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user)) {
            throw Object.assign(new Error('Not assigned to this item'), { status: 403 });
        }

        await client.query(
            `UPDATE support_ticket_items SET
                status = 'picked_up',
                picked_up_at = CURRENT_TIMESTAMP,
                pickup_method = 'self_carry',
                outcome = 'repair_required',
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [itemId]
        );

        const reason = String(pickupReason || '').trim() || 'Laptop picked up for warehouse repair';
        const pickupIns = await client.query(
            `INSERT INTO support_ticket_items
                (ticket_id, customer_inventory_id, serial_number, unique_serial_number,
                 brand, model, ram, storage, generation, ttspl_id,
                 item_type, remarks, status, assigned_to, source_item_id, otp_code)
             SELECT ticket_id, customer_inventory_id, serial_number, unique_serial_number,
                    brand, model, ram, storage, generation, ttspl_id,
                    'pickup', $2, 'in_transit', assigned_to, $1, $3
             FROM support_ticket_items WHERE id = $1
             RETURNING id`,
            [itemId, reason, generateOtp()]
        );
        const pickupItemId = pickupIns.rows[0].id;

        await logAudit(client, {
            itemId: pickupItemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'laptop_picked_up',
            detail: { pickup_reason: reason, method: 'self_carry', source_item_id: itemId }
        });
        await bumpTicketActivity(client, item.ticket_id);
        await recomputeTicketStatus(client, item.ticket_id);
        await client.query('COMMIT');

        const data = await getTicketWithItems(item.ticket_id, req.user);
        res.json({ success: true, pickup_item_id: pickupItemId, ...data });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('support submitForPickup', e);
        res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to submit for pickup' });
    } finally {
        client.release();
    }
};

// Phase 18: warehouse confirms receipt of a picked-up laptop. Creates a floor QC
// ticket for repair and flips the authoritative inventory to "returned".
exports.warehouseReceivedPickup = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { notes } = req.body || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await ensureSupportTicketItemV3Columns(client);

        const itemRes = await client.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
        if (!itemRes.rows.length) throw Object.assign(new Error('Item not found'), { status: 404 });
        const item = itemRes.rows[0];
        if (item.item_type !== 'pickup') {
            throw Object.assign(new Error('Only pickup items can be received at warehouse'), { status: 400 });
        }

        const stageRes = await client.query(
            `SELECT stage_id FROM stages WHERE stage_name = 'Floor Manager' LIMIT 1`
        );
        const stageId = stageRes.rows[0]?.stage_id || null;

        let floorTicketId = null;
        if (stageId) {
            const code = item.ttspl_id || item.unique_serial_number || item.serial_number;
            const vsnRes = await client.query(
                `SELECT serial_id, inventory_asset_code FROM vendor_serial_numbers
                 WHERE (inventory_asset_code = $1 OR serial_number = $1)
                   AND deleted_at IS NULL LIMIT 1`,
                [code]
            );
            const vsn = vsnRes.rows[0];
            if (vsn) {
                const ftRes = await client.query(
                    `INSERT INTO tickets
                        (serial_number, ttspl_id, brand, model, processor, ram, storage,
                         status, priority, ticket_type, current_stage_id,
                         vendor_serial_id, initial_condition)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,'in_progress','normal','grn_qc',$8,$9,$10)
                     RETURNING ticket_id`,
                    [
                        item.serial_number,
                        item.ttspl_id || item.unique_serial_number,
                        item.brand, item.model,
                        null, item.ram, item.storage,
                        stageId, vsn.serial_id,
                        `Returned from customer via support ticket. Reason: ${item.remarks || 'repair'}`
                    ]
                );
                floorTicketId = ftRes.rows[0]?.ticket_id || null;
                await client.query(
                    `UPDATE vendor_serial_numbers SET
                        inventory_status = 'returned',
                        current_customer_id = NULL,
                        status_changed_at = NOW(),
                        updated_at = NOW()
                     WHERE serial_id = $1`,
                    [vsn.serial_id]
                );
            }
        }

        await client.query(
            `UPDATE support_ticket_items SET
                status = 'inventory_updated',
                reached_warehouse_at = CURRENT_TIMESTAMP,
                warehouse_received_by = $2,
                floor_ticket_id = $3,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [itemId, req.user.user_id, floorTicketId]
        );

        if (item.customer_inventory_id) {
            await client.query(
                `UPDATE customer_inventory SET
                    status = 'returned',
                    passivated_at = NOW(),
                    passivated_reason = 'Returned via support ticket for repair',
                    updated_at = NOW()
                 WHERE id = $1`,
                [item.customer_inventory_id]
            );
        }

        // The faulty laptop now lives in the floor repair pipeline, so the
        // originating complaint on this support ticket is considered resolved.
        if (item.source_item_id) {
            await client.query(
                `UPDATE support_ticket_items SET
                    status = 'resolved',
                    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND status NOT IN ('resolved','closed','inventory_updated')`,
                [item.source_item_id]
            );
        }

        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: 'warehouse_received',
            detail: { floor_ticket_id: floorTicketId, notes: notes || null }
        });
        await bumpTicketActivity(client, item.ticket_id);
        await recomputeTicketStatus(client, item.ticket_id);
        await client.query('COMMIT');

        const data = await getTicketWithItems(item.ticket_id, req.user);
        res.json({
            success: true,
            floor_ticket_id: floorTicketId,
            message: floorTicketId
                ? `Received. Floor repair ticket #${floorTicketId} created.`
                : 'Received at warehouse.',
            ...data
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('support warehouseReceivedPickup', e);
        res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to receive at warehouse' });
    } finally {
        client.release();
    }
};

exports.markVisited = exports.logVisit;

// ============================================================
// Phase 20 — Pickup flow redesign
// Type selection (repair/return) -> dispatch (technician/courier/porter)
// -> Return DC auto-created -> Reached -> POD -> Customer OTP ->
// Warehouse receipt (e-sign).
// ============================================================

// Support lead creates a pickup item, generates the Return DC and a customer
// OTP in one step. For a technician dispatch the item lands in their laptop
// bucket; for courier/porter it is tracked via the delivery register.
exports.createPickupWithReturnDc = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Support lead only' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const {
        source_item_id,
        pickup_type,
        pickup_address,
        dispatch_mode,
        technician_user_id,
        courier_name, awb_number,
        porter_tracking_id, porter_order_id,
    } = req.body || {};

    if (!['repair', 'return'].includes(pickup_type)) {
        return res.status(400).json({ success: false, message: 'pickup_type must be repair or return' });
    }
    if (!['technician', 'courier', 'porter'].includes(dispatch_mode)) {
        return res.status(400).json({ success: false, message: 'Invalid dispatch_mode' });
    }
    if (dispatch_mode === 'technician' && !technician_user_id) {
        return res.status(400).json({ success: false, message: 'Select a technician for this pickup' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await ensureSupportTicketItemV3Columns(client);

        const ticketRes = await client.query('SELECT * FROM support_tickets WHERE id = $1', [ticketId]);
        if (!ticketRes.rows.length) throw Object.assign(new Error('Ticket not found'), { status: 404 });
        const ticket = ticketRes.rows[0];
        if (ticket.return_dc_number) {
            throw Object.assign(new Error(`Return DC already exists for this ticket: ${ticket.return_dc_number}`), { status: 400 });
        }

        // Resolve laptop details from the linked complaint item, falling back to
        // the ticket-level serial/ttspl when no source item is linked.
        let serial = ticket.serial_number || null;
        let ttsplId = ticket.ttspl_id || ticket.unique_number || null;
        let brand = null, model = null, ram = null, storage = null, generation = null, custInvId = null;
        const srcId = source_item_id ? parseInt(source_item_id, 10) : null;
        if (srcId) {
            const srcRes = await client.query(
                'SELECT * FROM support_ticket_items WHERE id = $1 AND ticket_id = $2',
                [srcId, ticketId]
            );
            if (srcRes.rows.length) {
                const src = srcRes.rows[0];
                serial = src.serial_number || serial;
                ttsplId = src.ttspl_id || src.unique_serial_number || ttsplId;
                brand = src.brand; model = src.model;
                ram = src.ram; storage = src.storage; generation = src.generation;
                custInvId = src.customer_inventory_id;
            }
        }

        const customerOtp = generateOtp();

        const pickupMethod = dispatch_mode;
        const techId = dispatch_mode === 'technician' && technician_user_id
            ? parseInt(technician_user_id, 10) : null;
        const courierNameVal = dispatch_mode === 'courier' ? (courier_name || null) : null;
        const awbVal = dispatch_mode === 'courier' ? (awb_number || null) : null;
        const porterTrackingVal = dispatch_mode === 'porter' ? (porter_tracking_id || null) : null;
        const porterOrderVal = dispatch_mode === 'porter' ? (porter_order_id || null) : null;

        // Create the pickup item. For a technician dispatch we set both
        // assigned_to and pickup_assigned_to so the existing per-technician
        // guards (POD upload, reached, etc.) keep working.
        const insertRes = await client.query(
            `INSERT INTO support_ticket_items
                (ticket_id, customer_inventory_id, serial_number, unique_serial_number,
                 ttspl_id, brand, model, ram, storage, generation,
                 item_type, pickup_type, status, source_item_id,
                 assigned_to, pickup_method, pickup_assigned_to, pickup_courier_name, pickup_awb,
                 porter_tracking_id, porter_order_id,
                 otp_code, customer_otp_code, customer_otp_sent_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                     'pickup',$11,'assigned',$12,
                     $13,$14,$13,$15,$16,$17,$18,
                     $19,$19,NOW())
             RETURNING id`,
            [
                ticketId, custInvId, serial, ttsplId,
                ttsplId, brand, model, ram, storage, generation,
                pickup_type, srcId,
                techId, pickupMethod, courierNameVal, awbVal,
                porterTrackingVal, porterOrderVal,
                customerOtp,
            ]
        );
        const pickupItemId = insertRes.rows[0].id;

        if (pickup_address) {
            await client.query(
                'UPDATE support_tickets SET pickup_address = $1::jsonb, updated_at = NOW() WHERE id = $2',
                [JSON.stringify(pickup_address), ticketId]
            );
        }

        // Generate the Return DC (a delivery_challan_lines row, movement_type='return').
        const rdc = await nextDocumentNumber('return_dc');
        const pickupAddr = pickup_address
            || (typeof ticket.pickup_address === 'string' ? JSON.parse(ticket.pickup_address) : ticket.pickup_address)
            || {};
        const dcDispatchMode = dispatch_mode === 'technician' ? 'inhouse' : dispatch_mode;
        const deliveryPersonId = techId;

        const serialCode = ttsplId || serial;

        // Trace the originating outbound DC + Sales Order for this unit, so the
        // Return DC can record where the laptop was shipped from and on which SO.
        let originalDcNumber = null;
        let salesOrderNumber = null;
        if (serialCode || serial) {
            try {
                const outRes = await client.query(
                    `SELECT dc_number, sales_order_number
                       FROM delivery_challan_lines
                      WHERE movement_type = 'outbound'
                        AND (serial_number::text ILIKE '%' || $1 || '%'
                             OR ($2 <> '' AND serial_number::text ILIKE '%' || $2 || '%'))
                      ORDER BY created_at DESC NULLS LAST
                      LIMIT 1`,
                    [serialCode || serial, serial || '']
                );
                if (outRes.rows.length) {
                    originalDcNumber = outRes.rows[0].dc_number || null;
                    salesOrderNumber = outRes.rows[0].sales_order_number || null;
                }
            } catch (traceErr) {
                console.warn('[support] outbound DC trace failed:', traceErr.message);
            }
        }

        let entries = [];
        let firstSpec = {};
        if (serialCode) {
            const vsnRes = await client.query(
                `SELECT serial_id, serial_number, inventory_asset_code, extra
                   FROM vendor_serial_numbers
                  WHERE deleted_at IS NULL
                    AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
                  LIMIT 1`,
                [serialCode]
            );
            const vsn = vsnRes.rows[0];
            if (vsn) {
                entries = [`${vsn.serial_id}|${vsn.serial_number}|${vsn.inventory_asset_code || serialCode}`];
                firstSpec = vsn.extra || {};
            } else {
                entries = [`|${serialCode}|${serialCode}`];
            }
        }

        await client.query(
            `INSERT INTO delivery_challan_lines
                (dc_number, movement_type, support_ticket_id, customer_id, customer_name, email,
                 customer_shipping_address, brand, model_name, quantity, serial_number,
                 dispatch_mode, delivery_person_id, courier_name, awb_number,
                 porter_tracking_id, porter_order_id,
                 sales_order_number, original_dc_number,
                 status, dispatched_at, created_by, created_at, updated_at)
             VALUES ($1,'return',$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,
                     $18,$19,
                     'in_transit',NOW(),$17,NOW(),NOW())`,
            [
                rdc, ticketId, ticket.customer_id, ticket.customer_name, ticket.ticket_email || null,
                JSON.stringify(pickupAddr), brand || firstSpec.brand || null,
                model || firstSpec.model || firstSpec.model_name || null,
                Math.max(1, entries.length), JSON.stringify(entries),
                dcDispatchMode, deliveryPersonId, courierNameVal, awbVal,
                porterTrackingVal, porterOrderVal, req.user.user_id,
                salesOrderNumber, originalDcNumber,
            ]
        );

        await client.query(
            'UPDATE support_ticket_items SET return_dc_number = $1, updated_at = NOW() WHERE id = $2',
            [rdc, pickupItemId]
        );
        await client.query(
            `UPDATE support_tickets SET
                return_dc_number = $1,
                complaint_type = COALESCE(complaint_type, 'pickup'),
                status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
                updated_at = NOW()
             WHERE id = $2`,
            [rdc, ticketId]
        );

        await logAudit(client, {
            itemId: pickupItemId, ticketId, userId: req.user.user_id,
            action: 'pickup_created',
            detail: { pickup_type, dispatch_mode, return_dc_number: rdc, ttspl_id: ttsplId }
        });
        await bumpTicketActivity(client, ticketId);
        await client.query('COMMIT');

        // Generate the branded Return DC PDF (best-effort, after commit).
        try {
            const freshRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [pickupItemId]);
            if (freshRes.rows.length) await regenerateReturnDcPdf(pool, freshRes.rows[0]);
        } catch (pdfErr) {
            console.error('[support] return DC pdf (create):', pdfErr.message);
        }

        const data = await getTicketWithItems(ticketId, req.user);
        res.status(201).json({
            success: true,
            pickup_item_id: pickupItemId,
            return_dc_number: rdc,
            dispatch_mode,
            message: `Pickup created. Return DC: ${rdc}.`,
            customer_otp_visible: customerOtp,
            ...data,
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('createPickupWithReturnDc:', e);
        res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to create pickup' });
    } finally {
        client.release();
    }
};

// Technician signs the Return DC at the customer site BEFORE pickup. Captures the
// e-signature, then regenerates the Return DC PDF to embed it.
exports.technicianSignPickup = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { esign_data, signer_name } = req.body || {};

    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ success: false, message: 'Item not found' });
    const it = itemRes.rows[0];

    if (it.item_type !== 'pickup') {
        return res.status(400).json({ success: false, message: 'Only for pickup items' });
    }
    const isMine = it.pickup_assigned_to === req.user.user_id || it.assigned_to === req.user.user_id;
    if (!isMine && !isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Not assigned to this pickup' });
    }
    if (!it.visited_at) {
        return res.status(400).json({ success: false, message: 'Mark as reached before signing the Return DC' });
    }
    if (!esign_data || !String(esign_data).startsWith('data:image')) {
        return res.status(400).json({ success: false, message: 'Signature required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await ensureSupportTicketItemV3Columns(client);

        const dir = path.join(__dirname, '..', 'uploads', 'support-pickups');
        fs.mkdirSync(dir, { recursive: true });
        const fname = `tech_esign_${it.id}_${Date.now()}.png`;
        const b64 = String(esign_data).replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(path.join(dir, fname), Buffer.from(b64, 'base64'));
        const esignUrl = `uploads/support-pickups/${fname}`;

        await client.query(
            `UPDATE support_ticket_items SET
                technician_esign_url = $2,
                technician_esign_at = CURRENT_TIMESTAMP,
                technician_esign_by = $3,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [itemId, esignUrl, req.user.user_id]
        );
        await logAudit(client, {
            itemId, ticketId: it.ticket_id, userId: req.user.user_id,
            action: 'technician_esign', detail: { signer_name: signer_name || null }
        });
        await bumpTicketActivity(client, it.ticket_id);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('technicianSignPickup:', e);
        return res.status(500).json({ success: false, message: 'Failed to save signature' });
    } finally {
        client.release();
    }

    try {
        const fresh = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
        if (fresh.rows.length) await regenerateReturnDcPdf(pool, fresh.rows[0]);
    } catch (pdfErr) {
        console.error('[support] return DC pdf (tech esign):', pdfErr.message);
    }

    const data = await getTicketWithItems(it.ticket_id, req.user);
    res.json({ success: true, message: 'Return DC signed.', ...data });
};

// Technician confirms the laptop handover by entering the customer's OTP. POD
// photo must be uploaded first.
exports.verifyPickupCustomerOtp = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { otp } = req.body || {};

    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ success: false, message: 'Item not found' });
    const it = itemRes.rows[0];

    if (it.item_type !== 'pickup') {
        return res.status(400).json({ success: false, message: 'Only for pickup items' });
    }
    if (it.assigned_to !== req.user.user_id && it.pickup_assigned_to !== req.user.user_id && !isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Not assigned to this pickup' });
    }
    if (!it.pod_image_path && !it.proof_of_completion_path) {
        return res.status(400).json({ success: false, message: 'Upload the pickup photo before verifying the OTP' });
    }
    const stored = it.customer_otp_code || it.otp_code;
    if (!stored || String(otp || '').trim() !== String(stored)) {
        return res.status(400).json({ success: false, message: 'Invalid OTP. Ask the customer for the correct OTP.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE support_ticket_items SET
                customer_otp_verified_at = CURRENT_TIMESTAMP,
                status = 'picked_up',
                picked_up_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [itemId]
        );
        await logAudit(client, {
            itemId, ticketId: it.ticket_id, userId: req.user.user_id,
            action: 'pickup_otp_verified', detail: null
        });
        await bumpTicketActivity(client, it.ticket_id);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('verifyPickupCustomerOtp:', e);
        return res.status(500).json({ success: false, message: 'Failed to verify OTP' });
    } finally {
        client.release();
    }
    try {
        const fresh = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
        if (fresh.rows.length) await regenerateReturnDcPdf(pool, fresh.rows[0]);
    } catch (pdfErr) {
        console.error('[support] return DC pdf (otp verify):', pdfErr.message);
    }
    const data = await getTicketWithItems(it.ticket_id, req.user);
    res.json({ success: true, message: 'OTP verified. Laptop picked up successfully.', ...data });
};

// Warehouse confirms receipt of the laptop with an e-signature. For a repair
// pickup a floor QC ticket is auto-created; for a return pickup the unit is
// marked returned. The Return DC is closed as delivered.
exports.confirmWarehouseReceipt = async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { esign_data, signer_name } = req.body || {};

    if (!['warehouse', 'admin', 'support_lead', 'manager', 'floor_manager', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Warehouse access required' });
    }
    if (!esign_data || !String(esign_data).startsWith('data:image')) {
        return res.status(400).json({ success: false, message: 'Warehouse e-sign required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await ensureSupportTicketItemV3Columns(client);

        const itemRes = await client.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
        if (!itemRes.rows.length) throw Object.assign(new Error('Item not found'), { status: 404 });
        const it = itemRes.rows[0];

        if (it.item_type !== 'pickup') throw Object.assign(new Error('Only for pickup items'), { status: 400 });
        if (it.warehouse_received_at) throw Object.assign(new Error('Already confirmed at warehouse'), { status: 400 });

        // Default to an in-house (technician) pickup unless explicitly courier/porter,
        // so older items without a pickup_method still gate on the customer OTP.
        const isInhouse = it.pickup_method !== 'courier' && it.pickup_method !== 'porter';
        // Technician-carried pickups require the customer OTP handover first.
        // Courier/porter returns arrive without an on-site OTP step.
        if (isInhouse && !it.customer_otp_verified_at) {
            throw Object.assign(new Error('Customer OTP must be verified before warehouse can confirm receipt'), { status: 400 });
        }

        // Persist the e-sign PNG.
        const dir = path.join(__dirname, '..', 'uploads', 'support-pickups');
        fs.mkdirSync(dir, { recursive: true });
        const fname = `wh_esign_${it.id}_${Date.now()}.png`;
        const b64 = String(esign_data).replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(path.join(dir, fname), Buffer.from(b64, 'base64'));
        const esignUrl = `uploads/support-pickups/${fname}`;

        await client.query(
            `UPDATE support_ticket_items SET
                warehouse_received_at = CURRENT_TIMESTAMP,
                reached_warehouse_at = COALESCE(reached_warehouse_at, CURRENT_TIMESTAMP),
                warehouse_received_by = $3,
                warehouse_esign_url = $2,
                warehouse_esign_at = CURRENT_TIMESTAMP,
                warehouse_esign_by = $3,
                status = 'inventory_updated',
                resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [itemId, esignUrl, req.user.user_id]
        );

        let floorTicketId = null;
        const effectivePickupType = it.pickup_type
            || (it.source_item_id ? 'repair' : 'return');
        const needsFloorTicket = effectivePickupType === 'repair' || !!it.source_item_id;

        if (needsFloorTicket) {
            const ftResult = await createFloorTicketFromSupportPickup(client, {
                ...it,
                pickup_type: effectivePickupType,
            }, req.user.user_id);
            floorTicketId = ftResult.ticket_id || null;
            if (floorTicketId && !it.floor_ticket_id) {
                await client.query(
                    'UPDATE support_ticket_items SET floor_ticket_id = $1, pickup_type = COALESCE(pickup_type, $3) WHERE id = $2',
                    [floorTicketId, itemId, effectivePickupType]
                );
            }
        }

        const code = it.ttspl_id || it.unique_serial_number || it.serial_number;
        const vsnRes = await client.query(
            `SELECT serial_id, inventory_asset_code FROM vendor_serial_numbers
              WHERE deleted_at IS NULL
                AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
              LIMIT 1`,
            [code]
        );
        const vsn = vsnRes.rows[0];

        // Flip the authoritative inventory to "returned" for both repair and return.
        if (vsn) {
            await client.query(
                `UPDATE vendor_serial_numbers SET
                    inventory_status = 'returned',
                    current_customer_id = NULL,
                    status_changed_at = NOW(),
                    updated_at = NOW()
                 WHERE serial_id = $1`,
                [vsn.serial_id]
            );
        }

        if (it.customer_inventory_id) {
            await client.query(
                `UPDATE customer_inventory SET
                    passivated_at = NOW(),
                    passivated_reason = 'Returned by customer via support pickup',
                    updated_at = NOW()
                 WHERE id = $1`,
                [it.customer_inventory_id]
            );
        }

        // Close the originating complaint, if any.
        if (it.source_item_id) {
            await client.query(
                `UPDATE support_ticket_items SET
                    status = 'resolved',
                    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND status NOT IN ('resolved','closed','inventory_updated')`,
                [it.source_item_id]
            );
        }

        // Close the Return DC.
        if (it.return_dc_number) {
            await client.query(
                `UPDATE delivery_challan_lines SET
                    status = 'delivered', delivered_at = NOW(), updated_at = NOW()
                 WHERE dc_number = $1 AND movement_type = 'return'`,
                [it.return_dc_number]
            );
        }

        await logAudit(client, {
            itemId, ticketId: it.ticket_id, userId: req.user.user_id,
            action: 'warehouse_receipt_confirmed',
            detail: { pickup_type: it.pickup_type, floor_ticket_id: floorTicketId, signer_name: signer_name || null }
        });
        await bumpTicketActivity(client, it.ticket_id);
        await recomputeTicketStatus(client, it.ticket_id);
        await client.query('COMMIT');

        // Rebuild the Return DC PDF so it carries the warehouse-receipt signature.
        try {
            const fresh = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
            if (fresh.rows.length) await regenerateReturnDcPdf(pool, fresh.rows[0]);
        } catch (pdfErr) {
            console.error('[support] return DC pdf (warehouse confirm):', pdfErr.message);
        }

        const data = await getTicketWithItems(it.ticket_id, req.user);
        res.json({
            success: true,
            floor_ticket_id: floorTicketId,
            message: floorTicketId
                ? `Warehouse receipt confirmed. Floor repair ticket #${floorTicketId} created.`
                : 'Warehouse receipt confirmed.',
            ...data,
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('confirmWarehouseReceipt:', e);
        res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to confirm warehouse receipt' });
    } finally {
        client.release();
    }
};

// Technician laptop bucket: active pickup items dispatched in-house. Techs see
// only their own; leads/managers see all, grouped by technician.
exports.getTechnicianLaptopBucket = async (req, res) => {
    const isTech = req.user.role === 'support_tech';
    const params = [];
    let techFilter = '';
    if (isTech) {
        params.push(req.user.user_id);
        techFilter = `AND (sti.pickup_assigned_to = $1 OR sti.assigned_to = $1)`;
    }

    const { rows } = await pool.query(`
        SELECT sti.*, st.customer_name, st.customer_phone,
               u.name AS tech_name
          FROM support_ticket_items sti
          JOIN support_tickets st ON st.id = sti.ticket_id
          LEFT JOIN users u ON u.user_id = COALESCE(sti.pickup_assigned_to, sti.assigned_to)
         WHERE sti.item_type = 'pickup'
           AND sti.pickup_method IN ('technician','inhouse')
           AND sti.status NOT IN ('resolved','closed','inventory_updated')
           ${techFilter}
         ORDER BY sti.created_at DESC
    `, params);

    const grouped = {};
    rows.forEach((r) => {
        const key = r.pickup_assigned_to || r.assigned_to || 'unassigned';
        if (!grouped[key]) grouped[key] = { tech_id: key, tech_name: r.tech_name || null, laptops: [] };
        grouped[key].laptops.push(r);
    });

    res.json({ success: true, bucket: Object.values(grouped), total: rows.length });
};

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
    const { source_item_id, new_customer_inventory_id, new_serial_id, reason } = req.body || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const srcRes = await client.query('SELECT * FROM support_ticket_items WHERE id = $1 AND ticket_id = $2', [source_item_id, ticketId]);
        if (!srcRes.rows.length) throw new Error('Source item not found');
        const src = srcRes.rows[0];

        // Resolve the chosen replacement machine. Primary path: the authoritative
        // inventory (vendor_serial_numbers, QC-passed + in stock). Legacy path:
        // a deprecated customer_inventory row (kept for backward compatibility).
        let asset; // normalized { customerInventoryId, serial_number, unique_serial_number, brand, model, ram, storage, generation }
        if (new_serial_id) {
            const vsnRes = await client.query(
                `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, qc_status, extra
                 FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL`,
                [new_serial_id]
            );
            if (!vsnRes.rows.length) throw new Error('Replacement machine not found');
            const vsn = vsnRes.rows[0];
            if (vsn.inventory_status !== 'in_stock') {
                throw new Error('Selected machine is no longer available in stock');
            }
            const extra = vsn.extra || {};
            const assetCode = vsn.inventory_asset_code || extra.ttspl_id || vsn.serial_number;
            asset = {
                customerInventoryId: null,
                serial_number: vsn.serial_number,
                unique_serial_number: assetCode,
                brand: extra.brand || null,
                model: extra.model || extra.model_name || null,
                ram: extra.ram || null,
                storage: extra.storage || null,
                generation: extra.generation || null
            };
        } else if (new_customer_inventory_id) {
            const newAssetRes = await client.query('SELECT * FROM customer_inventory WHERE id = $1', [new_customer_inventory_id]);
            if (!newAssetRes.rows.length) throw new Error('Replacement asset not found');
            const ci = newAssetRes.rows[0];
            asset = {
                customerInventoryId: ci.id,
                serial_number: ci.serial_number,
                unique_serial_number: ci.unique_serial_number,
                brand: ci.model_name?.split(' ')[0] || null,
                model: ci.model_name,
                ram: ci.ram,
                storage: ci.storage,
                generation: ci.generation
            };
        } else {
            throw new Error('Select a replacement machine');
        }

        const otp = generateOtp();
        const itemIns = await client.query(
            `INSERT INTO support_ticket_items (
                ticket_id, customer_inventory_id, serial_number, unique_serial_number, brand, model,
                ram, storage, generation, ttspl_id, item_type, remarks, status, otp_code, source_item_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'replacement',$11,'order_placed',$12,$13) RETURNING id`,
            [
                ticketId,
                asset.customerInventoryId,
                asset.serial_number,
                asset.unique_serial_number,
                asset.brand,
                asset.model,
                asset.ram,
                asset.storage,
                asset.generation,
                asset.unique_serial_number,
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
                asset.customerInventoryId,
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
            detail: { source_item_id, new_serial_id: new_serial_id || null, new_customer_inventory_id: new_customer_inventory_id || null, new_machine_serial: asset.unique_serial_number }
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

        // Bridge into the authoritative inventory (vendor_serial_numbers):
        // return the faulty unit (stops billing) and rent out the replacement.
        try {
            // Prefer the asset codes captured on the order (authoritative path for
            // machines selected from vendor_serial_numbers). Fall back to the legacy
            // customer_inventory lookup for orders created before this flow existed.
            let old_code = order.old_machine_serial;
            let new_code = order.new_machine_serial;
            if ((!old_code && order.old_customer_inventory_id) || (!new_code && order.new_customer_inventory_id)) {
                const codeRows = await client.query(
                    `SELECT
                        (SELECT COALESCE(unique_serial_number, serial_number)
                           FROM customer_inventory WHERE id = $1) AS old_code,
                        (SELECT COALESCE(unique_serial_number, serial_number)
                           FROM customer_inventory WHERE id = $2) AS new_code`,
                    [order.old_customer_inventory_id || null, order.new_customer_inventory_id || null]
                );
                old_code = old_code || codeRows.rows[0]?.old_code;
                new_code = new_code || codeRows.rows[0]?.new_code;
            }
            if (old_code || new_code) {
                await inventorySM.bridgeSupportReplacement(client, {
                    oldCode: old_code,
                    newCode: new_code,
                    customerId,
                    dcNumber: order.return_dc_number || null,
                    actorUserId: req.user.user_id,
                    actorName: req.user.name,
                });
            }
        } catch (bridgeErr) {
            // Don't fail the support swap if the authoritative bridge can't match a serial;
            // log so it can be reconciled. (e.g. ERP-era assets without a vendor serial row.)
            console.error('[support] inventory bridge failed for order', orderId, bridgeErr.message);
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
