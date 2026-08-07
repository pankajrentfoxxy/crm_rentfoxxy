const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { findBlockingTicket, blockingTicketMessage } = require('../utils/floorTicketSerialGuard');
const { isSupportLead, isSupportTechnician, canCloseSupportTicket, canCancelSupportTicket } = require('../middleware/supportAccess');
const { deriveItemCurrentStep } = require('../services/supportTicketFlow');
const { ensureCustomerTables } = require('../services/customerInventoryErpSyncService');
const supportQuery = require('../services/supportQuery');
const { assertItemAllowsTechnicianAssign, itemAllowsTechnicianAssign } = require('../services/supportAssignmentRules');
const { isRestrictedToAssigned } = require('../services/dataScopeService');
const supportInventoryService = require('../services/supportInventoryService');
const inventorySM = require('../services/inventoryStateMachine');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('../services/customerDeployedAssets');
const { processReturnedSerials } = require('../services/returnCompletionService');
const {
  AWAITING_SDC_STATUS,
  isRepairPickupItem,
  removeRepairPickupFromCustomer,
  ticketHasRepairAwaitingSdc,
} = require('../services/repairPickupInventoryService');
const { createFloorTicketFromSupportPickup, resetVendorSerialForQcReentry } = require('../services/grnTicketService');
const { nextDocumentNumber, ensureReturnDcPickupItems } = require('../services/salesManagementService');
const { regenerateReturnDcPdf, regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');
const replacementFlow = require('../services/supportReplacementFlowService');
const { preserveCustomerAssetsOnCancel, forceRestoreCustomerAssetsOnCancel } = require('../services/supportCancelInventoryService');
const { applyReturnPickupAssignment } = require('../services/supportPickupAssignmentService');
const supportServiceDcService = require('../services/supportServiceDcService');
const { regenerateServiceDcPdfByNumber } = require('../services/serviceDcPdfService');
const { validateIndianMobile, normalizeIndianMobile } = require('../utils/phoneValidation');
const { appendCustomerTypeCondition, isCustomerTypeAllowed } = require('../services/customerAccessScope');
const { syncPartRequestsTechForItem } = require('./supportPartsController');

function normalizeSupportPhoneFields(body) {
    const out = { ...body };
    for (const key of ['customer_phone', 'ticket_phone_override', 'ticket_alt_phone']) {
        if (out[key] != null && String(out[key]).trim()) {
            const err = validateIndianMobile(out[key], { label: key === 'ticket_alt_phone' ? 'Alternate phone' : 'Phone' });
            if (err) return { ok: false, error: err };
            out[key] = normalizeIndianMobile(out[key]);
        }
    }
    return { ok: true, value: out };
}

const ITEM_OPEN_STATUSES = new Set(['open', 'work_done', 'awaiting_otp']);
const TICKET_OPEN = 'open';
const TICKET_IN_PROGRESS = 'in_progress';
const TICKET_CLOSED = 'closed';
const TICKET_CANCELLED = 'cancelled';

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const parseAddressJson = (raw) => {
    if (!raw) return {};
    try {
        const { normalizeDeliveryAddress } = require('../utils/deliveryAddressUtils');
        return normalizeDeliveryAddress(raw) || {};
    } catch {
        if (typeof raw === 'object') return raw;
        try { return JSON.parse(raw); } catch { return {}; }
    }
};

/** Resolve pickup address + phone from the outbound DC that delivered this unit. */
const resolvePickupDeliveryContext = async (db, customerId, code) => {
    if (!code) return null;
    const r = await db.query(
        `SELECT dcl.customer_shipping_address, dcl.customer_name, dcl.email,
                dcl.dc_number AS original_dc_number, dcl.sales_order_number,
                c.phone AS customer_phone
           FROM delivery_challan_lines dcl
           LEFT JOIN customers c ON c.customer_id = dcl.customer_id
          WHERE dcl.movement_type = 'outbound'
            AND dcl.customer_id = $1
            AND dcl.serial_number::text ILIKE '%' || $2 || '%'
          ORDER BY dcl.created_at DESC NULLS LAST
          LIMIT 1`,
        [customerId, code]
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    const addr = parseAddressJson(row.customer_shipping_address);
    const street = addr.address || addr.address_line_1 || addr.line1 || addr.address_line || '';
    return {
        pickup_address: {
            name: addr.name || row.customer_name || '',
            phone: addr.phone || row.customer_phone || '',
            address: street,
            city: addr.city || '',
            state: addr.state || '',
            pincode: addr.pincode || addr.zip_code || '',
        },
        original_dc_number: row.original_dc_number,
        sales_order_number: row.sales_order_number,
    };
};

const assertNoActivePickup = async (client, ticketId, sourceItemId = null) => {
    const active = await client.query(
        `SELECT id FROM support_ticket_items
          WHERE ticket_id = $1 AND item_type = 'pickup'
            AND status NOT IN ('resolved', 'closed', 'inventory_updated')
          LIMIT 1`,
        [ticketId]
    );
    if (active.rows.length) {
        throw Object.assign(
            new Error('An active pickup already exists on this ticket. Track it under the Pickup tab.'),
            { status: 400 }
        );
    }
    if (sourceItemId) {
        const linked = await client.query(
            `SELECT id FROM support_ticket_items
              WHERE source_item_id = $1 AND item_type = 'pickup'
                AND status NOT IN ('resolved', 'closed', 'inventory_updated')
              LIMIT 1`,
            [sourceItemId]
        );
        if (linked.rows.length) {
            throw Object.assign(
                new Error('A pickup is already scheduled for this machine.'),
                { status: 400 }
            );
        }
    }
};

const normalizeMachine = (m, ticket) => ({
    serial_number: m.serial_number || ticket?.serial_number || null,
    unique_serial_number: m.unique_serial_number || m.ttspl_id || ticket?.ttspl_id || ticket?.unique_number || null,
    ttspl_id: m.ttspl_id || m.unique_serial_number || ticket?.ttspl_id || null,
    brand: m.brand || null,
    model: m.model || null,
    ram: m.ram || null,
    storage: m.storage || null,
    generation: m.generation || null,
    customer_inventory_id: m.customer_inventory_id || null,
    source_item_id: m.source_item_id ? parseInt(m.source_item_id, 10) : null,
});

/** Core pickup + Return DC creation (single entry point for all pickup flows). */
const executePickupWithReturnDc = async (client, ticket, ticketId, userId, opts) => {
    const {
        source_item_id,
        pickup_type,
        pickup_address,
        dispatch_mode,
        technician_user_id,
        courier_name, awb_number,
        porter_tracking_id, porter_order_id,
        serial_number, unique_serial_number, ttspl_id,
        brand, model, ram, storage, generation,
        customer_inventory_id,
        machines: machinesRaw,
        dc_purpose,
        remarks: remarksOpt,
    } = opts;

    await ensureSupportTicketItemV3Columns(client);
    await ensureDeliveryChallanReplacementColumns(client);
    if (ticket.return_dc_number) {
        throw Object.assign(new Error(`Return DC already exists: ${ticket.return_dc_number}`), { status: 400 });
    }

    let machines = Array.isArray(machinesRaw) && machinesRaw.length
        ? machinesRaw.map((m) => normalizeMachine(m, ticket))
        : [normalizeMachine({
            serial_number, unique_serial_number, ttspl_id, brand, model, ram, storage, generation,
            customer_inventory_id, source_item_id,
        }, ticket)];

    // Resolve linked complaint/replacement source items.
    for (let i = 0; i < machines.length; i += 1) {
        const m = machines[i];
        const srcId = m.source_item_id || (i === 0 && source_item_id ? parseInt(source_item_id, 10) : null);
        if (srcId) {
            const srcRes = await client.query(
                'SELECT * FROM support_ticket_items WHERE id = $1 AND ticket_id = $2',
                [srcId, ticketId]
            );
            if (srcRes.rows.length) {
                const src = srcRes.rows[0];
                machines[i] = {
                    ...m,
                    source_item_id: srcId,
                    serial_number: src.serial_number || m.serial_number,
                    unique_serial_number: src.ttspl_id || src.unique_serial_number || m.unique_serial_number,
                    ttspl_id: src.ttspl_id || src.unique_serial_number || m.ttspl_id,
                    brand: src.brand || m.brand,
                    model: src.model || m.model,
                    ram: src.ram || m.ram,
                    storage: src.storage || m.storage,
                    generation: src.generation || m.generation,
                    customer_inventory_id: src.customer_inventory_id || m.customer_inventory_id,
                };
            }
        }
    }

    machines = machines.filter((m) => m.serial_number || m.ttspl_id || m.unique_serial_number);
    if (!machines.length) {
        throw Object.assign(new Error('Select at least one laptop for this pickup'), { status: 400 });
    }

    await assertNoActivePickup(client, ticketId, null);
    for (const m of machines) {
        if (!m.source_item_id) continue;
        const linked = await client.query(
            `SELECT id FROM support_ticket_items
              WHERE source_item_id = $1 AND item_type = 'pickup'
                AND status NOT IN ('resolved', 'closed', 'inventory_updated')
              LIMIT 1`,
            [m.source_item_id]
        );
        if (linked.rows.length) {
            throw Object.assign(new Error('A pickup is already scheduled for one of the selected machines.'), { status: 400 });
        }
    }

    let pickupAddr = pickup_address || parseAddressJson(ticket.pickup_address);
    if (pickupAddr) {
        pickupAddr = parseAddressJson(pickupAddr);
        if (pickupAddr.address_line_1 && !pickupAddr.address) {
            pickupAddr.address = pickupAddr.address_line_1;
        }
    }
    if (!pickupAddr?.address) {
        const firstCode = machines[0].ttspl_id || machines[0].unique_serial_number || machines[0].serial_number;
        const ctx = await resolvePickupDeliveryContext(client, ticket.customer_id, firstCode);
        if (ctx?.pickup_address) pickupAddr = ctx.pickup_address;
    }

    const customerOtp = generateOtp();
    const hasDispatch = ['technician', 'courier', 'porter'].includes(String(dispatch_mode || ''));
    const techId = hasDispatch && dispatch_mode === 'technician' && technician_user_id
        ? parseInt(technician_user_id, 10) : null;
    const pickupStatus = hasDispatch ? 'assigned' : 'pending_dispatch';

    const pickupItemIds = [];
    for (const m of machines) {
        const insertRes = await client.query(
            `INSERT INTO support_ticket_items
                (ticket_id, customer_inventory_id, serial_number, unique_serial_number,
                 ttspl_id, brand, model, ram, storage, generation,
                 item_type, pickup_type, status, source_item_id,
                 assigned_to, pickup_method, pickup_assigned_to, pickup_courier_name, pickup_awb,
                 porter_tracking_id, porter_order_id,
                 otp_code, customer_otp_code, customer_otp_sent_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                     'pickup',$11,$12,$13,
                     $14,$15,$14,$16,$17,$18,$19,
                     $20,$20,NOW())
             RETURNING id`,
            [
                ticketId, m.customer_inventory_id, m.serial_number, m.ttspl_id || m.unique_serial_number,
                m.ttspl_id || m.unique_serial_number, m.brand, m.model, m.ram, m.storage, m.generation,
                pickup_type, pickupStatus, m.source_item_id,
                techId, hasDispatch ? dispatch_mode : null,
                hasDispatch && dispatch_mode === 'courier' ? (courier_name || null) : null,
                hasDispatch && dispatch_mode === 'courier' ? (awb_number || null) : null,
                hasDispatch && dispatch_mode === 'porter' ? (porter_tracking_id || null) : null,
                hasDispatch && dispatch_mode === 'porter' ? (porter_order_id || null) : null,
                customerOtp,
            ]
        );
        pickupItemIds.push(insertRes.rows[0].id);
    }

    if (pickupAddr && Object.keys(pickupAddr).length) {
        await client.query(
            'UPDATE support_tickets SET pickup_address = $1::jsonb, updated_at = NOW() WHERE id = $2',
            [JSON.stringify(pickupAddr), ticketId]
        );
    }

    const rdc = await nextDocumentNumber('return_dc');
    const dcDispatchMode = hasDispatch
        ? (dispatch_mode === 'technician' ? 'inhouse' : dispatch_mode)
        : null;
    const dcStatus = hasDispatch ? 'in_transit' : 'pending';

    const entries = [];
    let firstSpec = {};
    let originalDcNumber = null;
    let salesOrderNumber = null;

    for (const m of machines) {
        const serialCode = m.ttspl_id || m.unique_serial_number || m.serial_number;
        if (!serialCode) continue;
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
            entries.push(`${vsn.serial_id}|${vsn.serial_number}|${vsn.inventory_asset_code || serialCode}`);
            if (!firstSpec.brand) firstSpec = vsn.extra || {};
        } else {
            entries.push(`|${serialCode}|${serialCode}`);
        }
        if (!originalDcNumber || !salesOrderNumber) {
            try {
                const outRes = await client.query(
                    `SELECT dc_number, sales_order_number
                       FROM delivery_challan_lines
                      WHERE movement_type = 'outbound'
                        AND customer_id = $1
                        AND serial_number::text ILIKE '%' || $2 || '%'
                      ORDER BY created_at DESC NULLS LAST
                      LIMIT 1`,
                    [ticket.customer_id, serialCode]
                );
                if (outRes.rows.length) {
                    originalDcNumber = originalDcNumber || outRes.rows[0].dc_number || null;
                    salesOrderNumber = salesOrderNumber || outRes.rows[0].sales_order_number || null;
                }
            } catch (_) { /* ignore */ }
        }
    }

    const firstMachine = machines[0];
    let dcRemarks = remarksOpt != null && String(remarksOpt).trim()
      ? String(remarksOpt).trim()
      : null;
    if (!dcRemarks && String(dc_purpose || '') === 'replacement') {
      dcRemarks = replacementFlow.buildReplacementRdcRemarks(machines);
    }

    const { resolveHsnForPersist } = require('../constants/hsnDefaults');
    const { resolveTxnTypeForDc } = require('../utils/hsnDocResolve');
    const { entityForQuotationType } = require('../services/salesManagementService');
    const rdcTxn = await resolveTxnTypeForDc(client, {
      salesOrderNumber,
      originalDcNumber,
    });
    const rdcHsn = resolveHsnForPersist({
      transactionType: rdcTxn,
      role: null, // auto-assign only on create; admin override via PATCH later
    });
    const rdcEntity = entityForQuotationType(rdcTxn === 'sale' ? 'sales' : 'rental');

    await client.query(
        `INSERT INTO delivery_challan_lines
            (dc_number, movement_type, support_ticket_id, customer_id, customer_name, email,
             customer_shipping_address, brand, model_name, quantity, serial_number,
             dispatch_mode, delivery_person_id, courier_name, awb_number,
             porter_tracking_id, porter_order_id,
             sales_order_number, original_dc_number, dc_purpose, remarks,
             status, dispatched_at, created_by, created_at, updated_at,
             entity_code, hsn_code)
         VALUES ($1,'return',$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,
                 $17,$18,COALESCE($19,'standard'),$20,
                 $21,CASE WHEN $22 THEN NOW() ELSE NULL END,$23,NOW(),NOW(),$24,$25)`,
        [
            rdc, ticketId, ticket.customer_id, ticket.customer_name, ticket.ticket_email || null,
            JSON.stringify(pickupAddr || {}),
            firstMachine.brand || firstSpec.brand || null,
            firstMachine.model || firstSpec.model || firstSpec.model_name || null,
            Math.max(1, entries.length), JSON.stringify(entries),
            dcDispatchMode, techId,
            hasDispatch && dispatch_mode === 'courier' ? (courier_name || null) : null,
            hasDispatch && dispatch_mode === 'courier' ? (awb_number || null) : null,
            hasDispatch && dispatch_mode === 'porter' ? (porter_tracking_id || null) : null,
            hasDispatch && dispatch_mode === 'porter' ? (porter_order_id || null) : null,
            salesOrderNumber, originalDcNumber,
            dc_purpose || 'standard',
            dcRemarks,
            dcStatus,
            hasDispatch,
            userId,
            rdcEntity,
            rdcHsn,
        ]
    );

    await client.query(
        `UPDATE support_ticket_items SET return_dc_number = $1, updated_at = NOW()
          WHERE id = ANY($2::int[])`,
        [rdc, pickupItemIds]
    );
    await client.query(
        `UPDATE support_tickets SET
            return_dc_number = $1,
            ttspl_id = COALESCE(ttspl_id, $3),
            serial_number = COALESCE(serial_number, $4),
            dc_number = COALESCE(dc_number, $5),
            sales_order_number = COALESCE(sales_order_number, $6),
            complaint_type = COALESCE(complaint_type, 'pickup'),
            ticket_category = COALESCE(ticket_category, 'pickup'),
            status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
            updated_at = NOW()
         WHERE id = $2`,
        [rdc, ticketId, firstMachine.ttspl_id, firstMachine.serial_number, originalDcNumber, salesOrderNumber]
    );

    await logAudit(client, {
        itemId: pickupItemIds[0], ticketId, userId,
        action: 'pickup_created',
        detail: {
            pickup_type, dispatch_mode, return_dc_number: rdc,
            unit_count: machines.length,
            ttspl_ids: machines.map((m) => m.ttspl_id || m.unique_serial_number).filter(Boolean),
        }
    });
    await bumpTicketActivity(client, ticketId);

    return { pickupItemIds, pickupItemId: pickupItemIds[0], rdc, customerOtp, machines };
};

/** Add pickup items and serial entries to an existing Return DC (multi-complaint replacement). */
const appendMachinesToReturnDc = async (client, ticket, ticketId, userId, opts) => {
    const {
        return_dc_number: returnDcNumber,
        pickup_type,
        pickup_address,
        dispatch_mode,
        technician_user_id,
        courier_name, awb_number,
        porter_tracking_id, porter_order_id,
        machines: machinesRaw,
        remarks: remarksOpt,
    } = opts;

    const rdc = String(returnDcNumber || ticket.return_dc_number || '').trim();
    if (!rdc) {
        throw Object.assign(new Error('Return DC number is required'), { status: 400 });
    }

    await ensureSupportTicketItemV3Columns(client);
    await ensureDeliveryChallanReplacementColumns(client);

    let machines = (Array.isArray(machinesRaw) ? machinesRaw : [])
        .map((m) => normalizeMachine(m, ticket))
        .filter((m) => m.serial_number || m.ttspl_id || m.unique_serial_number);
    if (!machines.length) {
        throw Object.assign(new Error('Select at least one laptop for this pickup'), { status: 400 });
    }

    for (const m of machines) {
        if (!m.source_item_id) continue;
        const linked = await client.query(
            `SELECT id FROM support_ticket_items
              WHERE source_item_id = $1 AND item_type = 'pickup'
                AND status NOT IN ('resolved', 'closed', 'inventory_updated')
              LIMIT 1`,
            [m.source_item_id]
        );
        if (linked.rows.length) {
            throw Object.assign(new Error('A pickup is already scheduled for one of the selected machines.'), { status: 400 });
        }
    }

    const dclRes = await client.query(
        `SELECT dc_number, serial_number, quantity, remarks, dispatch_mode, delivery_person_id,
                courier_name, awb_number, porter_tracking_id, porter_order_id, status
           FROM delivery_challan_lines
          WHERE dc_number = $1 AND movement_type = 'return'
          ORDER BY id ASC
          LIMIT 1
          FOR UPDATE`,
        [rdc]
    );
    if (!dclRes.rows.length) {
        throw Object.assign(new Error(`Return DC ${rdc} not found`), { status: 404 });
    }
    const dcl = dclRes.rows[0];

    const existingPickupRes = await client.query(
        `SELECT pickup_method, assigned_to, pickup_courier_name, pickup_awb,
                porter_tracking_id, porter_order_id, status
           FROM support_ticket_items
          WHERE ticket_id = $1 AND return_dc_number = $2 AND item_type = 'pickup'
          ORDER BY id ASC
          LIMIT 1`,
        [ticketId, rdc]
    );
    const existingPickup = existingPickupRes.rows[0] || null;

    let pickupAddr = pickup_address || parseAddressJson(ticket.pickup_address);
    if (pickupAddr) pickupAddr = parseAddressJson(pickupAddr);

    const inheritedDispatch = existingPickup?.pickup_method || dcl.dispatch_mode;
    const resolvedDispatch = dispatch_mode || (
      inheritedDispatch === 'inhouse' ? 'technician' : inheritedDispatch
    );
    const hasDispatch = ['technician', 'courier', 'porter'].includes(String(resolvedDispatch || ''))
      || (existingPickup && ['assigned', 'in_transit', 'picked_up'].includes(existingPickup.status));
    const techId = hasDispatch
      ? (parseInt(technician_user_id, 10) || existingPickup?.assigned_to || dcl.delivery_person_id || null)
      : null;
    const pickupStatus = hasDispatch ? (existingPickup?.status === 'assigned' ? 'assigned' : 'pending_dispatch') : 'pending_dispatch';
    const customerOtp = generateOtp();
    const pickupItemIds = [];

    for (const m of machines) {
        const insertRes = await client.query(
            `INSERT INTO support_ticket_items
                (ticket_id, customer_inventory_id, serial_number, unique_serial_number,
                 ttspl_id, brand, model, ram, storage, generation,
                 item_type, pickup_type, status, source_item_id,
                 assigned_to, pickup_method, pickup_assigned_to, pickup_courier_name, pickup_awb,
                 porter_tracking_id, porter_order_id,
                 otp_code, customer_otp_code, customer_otp_sent_at, return_dc_number)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                     'pickup',$11,$12,$13,
                     $14,$15,$14,$16,$17,$18,$19,
                     $20,$20,NOW(),$21)
             RETURNING id`,
            [
                ticketId, m.customer_inventory_id, m.serial_number, m.ttspl_id || m.unique_serial_number,
                m.ttspl_id || m.unique_serial_number, m.brand, m.model, m.ram, m.storage, m.generation,
                pickup_type, pickupStatus, m.source_item_id,
                techId, hasDispatch ? resolvedDispatch : null,
                hasDispatch && resolvedDispatch === 'courier' ? (courier_name || existingPickup?.pickup_courier_name || null) : null,
                hasDispatch && resolvedDispatch === 'courier' ? (awb_number || existingPickup?.pickup_awb || null) : null,
                hasDispatch && resolvedDispatch === 'porter' ? (porter_tracking_id || existingPickup?.porter_tracking_id || null) : null,
                hasDispatch && resolvedDispatch === 'porter' ? (porter_order_id || existingPickup?.porter_order_id || null) : null,
                customerOtp,
                rdc,
            ]
        );
        pickupItemIds.push(insertRes.rows[0].id);
    }

    const entries = [];
    let rawSerial = dcl.serial_number;
    if (typeof rawSerial === 'string') {
        try { rawSerial = JSON.parse(rawSerial); } catch { rawSerial = [rawSerial]; }
    }
    if (Array.isArray(rawSerial)) entries.push(...rawSerial.filter(Boolean));

    for (const m of machines) {
        const serialCode = m.ttspl_id || m.unique_serial_number || m.serial_number;
        if (!serialCode) continue;
        const vsnRes = await client.query(
            `SELECT serial_id, serial_number, inventory_asset_code
               FROM vendor_serial_numbers
              WHERE deleted_at IS NULL
                AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
              LIMIT 1`,
            [serialCode]
        );
        const vsn = vsnRes.rows[0];
        if (vsn) {
            entries.push(`${vsn.serial_id}|${vsn.serial_number}|${vsn.inventory_asset_code || serialCode}`);
        } else {
            entries.push(`|${serialCode}|${serialCode}`);
        }
    }

    const dcRemarks = remarksOpt != null && String(remarksOpt).trim()
        ? String(remarksOpt).trim()
        : replacementFlow.buildReplacementRdcRemarks(machines);

    await client.query(
        `UPDATE delivery_challan_lines
            SET serial_number = $2::jsonb,
                quantity = $3,
                remarks = $4,
                updated_at = NOW()
          WHERE dc_number = $1 AND movement_type = 'return'`,
        [rdc, JSON.stringify(entries), Math.max(1, entries.length), dcRemarks]
    );

    if (pickupAddr && Object.keys(pickupAddr).length) {
        await client.query(
            'UPDATE support_tickets SET pickup_address = $1::jsonb, updated_at = NOW() WHERE id = $2',
            [JSON.stringify(pickupAddr), ticketId]
        );
    }

    await logAudit(client, {
        itemId: pickupItemIds[0], ticketId, userId,
        action: 'pickup_appended',
        detail: {
            pickup_type, return_dc_number: rdc,
            unit_count: machines.length,
            ttspl_ids: machines.map((m) => m.ttspl_id || m.unique_serial_number).filter(Boolean),
        },
    });
    await bumpTicketActivity(client, ticketId);

    return { pickupItemIds, pickupItemId: pickupItemIds[0], rdc, customerOtp, machines, appended: true };
};

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
        WHERE t.customer_id = $1 AND t.status NOT IN ('closed', 'cancelled')
          AND i.status NOT IN ('resolved', 'closed', 'inventory_updated', 'cancelled')
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
    if (item.assigned_to) {
        assertItemAllowsTechnicianAssign(item);
    }
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
            ADD COLUMN IF NOT EXISTS technician_esign_by INTEGER REFERENCES users (user_id),
            ADD COLUMN IF NOT EXISTS processor VARCHAR(200)
    `);
};

/** Idempotent DDL for replacement / pickup Return DC columns (migration 113). */
const ensureDeliveryChallanReplacementColumns = async (client) => {
    await client.query(`
        ALTER TABLE delivery_challan_lines
            ADD COLUMN IF NOT EXISTS dc_purpose VARCHAR(40) DEFAULT 'standard',
            ADD COLUMN IF NOT EXISTS support_replacement_order_id INT
    `);
    await client.query(`
        UPDATE delivery_challan_lines SET dc_purpose = 'standard' WHERE dc_purpose IS NULL
    `);
};

const ensureSupportTicketCancellationColumns = async (client) => {
    await client.query(`
        ALTER TABLE support_tickets
            ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users (user_id),
            ADD COLUMN IF NOT EXISTS cancellation_remark TEXT
    `);
};

const assertTicketNotCancelled = async (db, ticketId) => {
    const r = await db.query('SELECT status FROM support_tickets WHERE id = $1', [ticketId]);
    if (!r.rows.length) throw Object.assign(new Error('Ticket not found'), { status: 404 });
    if (r.rows[0].status === TICKET_CANCELLED) {
        throw Object.assign(new Error('This ticket has been cancelled'), { status: 400 });
    }
    return r.rows[0];
};

const logAudit = async (client, { itemId, ticketId, userId, action, detail }) => {
    await client.query(
        `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [itemId ?? null, ticketId, userId, action, detail ? JSON.stringify(detail) : null]
    );
};

const ASSIGNMENT_AUDIT_ACTIONS = new Set([
    'return_pickup_assignee_changed',
    'return_pickup_assigned',
    'technician_assigned',
    'technician_reassigned',
]);

function parseAuditDetail(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function buildAssignmentHistory(auditRows = []) {
    return auditRows
        .filter((row) => ASSIGNMENT_AUDIT_ACTIONS.has(row.action))
        .map((row) => {
            const detail = parseAuditDetail(row.detail);
            return {
                id: row.id,
                action: row.action,
                changed_at: row.created_at,
                changed_by: row.user_name || null,
                previous_assignee: detail.previous_assignee
                    || (detail.previous_assigned_to ? `User #${detail.previous_assigned_to}` : null),
                new_assignee: detail.new_assignee
                    || (detail.assigned_to ? `User #${detail.assigned_to}` : null),
                reason: detail.reason || null,
                return_dc_number: detail.return_dc_number || null,
                dispatch_mode: detail.new_dispatch_mode || detail.dispatch_mode || null,
            };
        })
        .reverse();
}

async function resolveUserDisplayName(client, userId) {
    if (!userId) return null;
    const db = client || pool;
    const r = await db.query('SELECT name FROM users WHERE user_id = $1', [userId]);
    return r.rows[0]?.name || `User #${userId}`;
}

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

    if (!manualCloseUserId && await ticketHasRepairAwaitingSdc(client, ticketId)) {
        await client.query(
            `UPDATE support_tickets SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [ticketId, TICKET_IN_PROGRESS]
        );
        return;
    }

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
        `SELECT t.*, cb.name AS created_by_name, cx.name AS cancelled_by_name
         FROM support_tickets t
         LEFT JOIN users cb ON cb.user_id = t.created_by
         LEFT JOIN users cx ON cx.user_id = t.cancelled_by
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
               rdc.original_dc_number AS original_dc_number,
               sdc.pdf_path AS service_dc_pdf_path,
               sdc.status AS service_dc_status,
               sdc.delivered_at AS service_dc_delivered_at
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
        LEFT JOIN LATERAL (
            SELECT pdf_path, status, delivered_at
              FROM delivery_challan_lines
             WHERE dc_number = i.service_dc_number
               AND movement_type = 'outbound'
               AND dc_purpose = 'service_return'
             LIMIT 1
        ) sdc ON i.service_dc_number IS NOT NULL
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
         ORDER BY a.created_at DESC`,
        [ticketId]
    );
    const auditRows = auditRes.rows.map((row) => ({
        ...row,
        detail: parseAuditDetail(row.detail),
    }));

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
        audit: auditRows,
        assignment_history: buildAssignmentHistory(auditRows),
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
        // Role-based Customer Access scope (all/sales/rental)
        const scopeConds = [];
        appendCustomerTypeCondition(req.allowedCustomerTypes, scopeConds, params);
        if (scopeConds.length) where += ` AND ${scopeConds[0]}`;
        params.push(limit);
        const { rows } = await pool.query(
            `SELECT c.customer_id,
                    COALESCE(c.company_name, c.name) AS customer_name,
                    c.name AS contact_person_name,
                    c.phone AS contact_person_number,
                    c.phone AS customer_number,
                    c.email
             FROM customers c ${where}
             ORDER BY COALESCE(c.company_name, c.name) NULLS LAST LIMIT $${params.length}`,
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
                    c.shipping_address,
                    c.customer_type
             FROM customers c WHERE c.customer_id = $1`,
            [customerId]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        if (!isCustomerTypeAllowed(req.allowedCustomerTypes, rows[0].customer_type)) {
            return res.status(403).json({ success: false, message: 'Access denied: customer is outside your Customer Access scope' });
        }
        const { customer_type, ...customer } = rows[0];
        res.json({ success: true, customer });
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
               AND vsn.inventory_status = ANY($2::text[])
             ORDER BY vsn.inventory_asset_code`,
            [customerId, DEPLOYED_WITH_CUSTOMER_STATUSES]
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
        const pickupType = (req.query.pickup_type || '').trim();
        const closedDays = Math.min(parseInt(req.query.closed_days, 10) || 30, 365);
        const statusTab = (req.query.status_tab || '').trim();
        const priority = (req.query.priority || '').trim();
        const assignee = (req.query.assignee || '').trim();
        const dateFrom = (req.query.date_from || '').trim();
        const dateTo = (req.query.date_to || '').trim();
        const assignedOnly = await isRestrictedToAssigned(req, 'support_tickets');
        const data = await supportQuery.listTicketsEnriched({
            user: req.user,
            view,
            search,
            type,
            pickupType,
            limit,
            offset,
            closedDays,
            assignedOnly,
            statusTab,
            priority,
            assignee,
            dateFrom,
            dateTo,
        });
        res.json({ success: true, ...data });
    } catch (e) {
        console.error('support listTickets', e);
        const msg = process.env.NODE_ENV === 'production'
            ? 'Failed to load tickets'
            : (e.message || 'Failed to load tickets');
        res.status(500).json({ success: false, message: msg });
    }
};

exports.countTickets = async (req, res) => {
    try {
        const search = (req.query.search || '').trim();
        const view = (req.query.view || 'active').trim();
        const closedDays = Math.min(parseInt(req.query.closed_days, 10) || 30, 365);
        const statusTab = (req.query.status_tab || '').trim();
        const priority = (req.query.priority || '').trim();
        const assignee = (req.query.assignee || '').trim();
        const dateFrom = (req.query.date_from || '').trim();
        const dateTo = (req.query.date_to || '').trim();
        const assignedOnly = await isRestrictedToAssigned(req, 'support_tickets');
        const counts = await supportQuery.countTicketsByType({
            user: req.user,
            view,
            search,
            closedDays,
            assignedOnly,
            statusTab,
            priority,
            assignee,
            dateFrom,
            dateTo,
        });
        res.json({ success: true, counts });
    } catch (e) {
        console.error('support countTickets', e);
        res.status(500).json({ success: false, message: 'Failed to load ticket counts' });
    }
};

/** Status tabs: All / Open / In Progress / Overdue */
exports.countTicketsByStatus = async (req, res) => {
    try {
        const assignedOnly = await isRestrictedToAssigned(req, 'support_tickets');
        const counts = await supportQuery.countTicketsByStatus({
            user: req.user,
            assignedOnly,
        });
        res.json({ success: true, counts });
    } catch (e) {
        console.error('support countTicketsByStatus', e);
        res.status(500).json({ success: false, message: 'Failed to load ticket status counts' });
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

    const phoneNorm = normalizeSupportPhoneFields({
        customer_phone,
        ticket_phone_override,
        ticket_alt_phone,
    });
    if (!phoneNorm.ok) {
        return res.status(400).json({ success: false, message: phoneNorm.error });
    }
    const phones = phoneNorm.value;

    const ticketCategory = VALID_ITEM_TYPES.has(ticketCategoryRaw)
        ? ticketCategoryRaw
        : (VALID_ITEM_TYPES.has(items[0]?.item_type) ? items[0].item_type : null);
    if (!ticketCategory) {
        return res.status(400).json({ success: false, message: 'ticket_category must be complaint, pickup, or replacement' });
    }
    if (ticketCategory === 'pickup') {
        return res.status(400).json({
            success: false,
            message: 'Use POST /support/tickets/pickup-ticket to create a pickup ticket (schedules Return DC and assignment in one step).',
            code: 'USE_PICKUP_TICKET_FLOW',
        });
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
                phones.customer_phone || null,
                initialStatus,
                req.user.user_id,
                ['normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
                top_level_remarks || null,
                phones.ticket_phone_override || phones.customer_phone || null,
                phones.ticket_alt_phone || null,
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
    if (!canCloseSupportTicket(req.user)) {
        return res.status(403).json({ success: false, message: 'Not allowed to close support tickets' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    try {
        await assertTicketNotCancelled(pool, ticketId);
    } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message });
    }
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

exports.cancelTicket = async (req, res) => {
    if (!canCancelSupportTicket(req.user)) {
        return res.status(403).json({ success: false, message: 'Not allowed to cancel support tickets' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const remark = String(req.body?.cancellation_remark || req.body?.remark || '').trim();
    if (!remark) {
        return res.status(400).json({ success: false, message: 'Cancellation remark is required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await ensureSupportTicketCancellationColumns(client);
        const ticketRes = await client.query(
            'SELECT id, status, customer_id, return_dc_number, sales_order_number FROM support_tickets WHERE id = $1 FOR UPDATE',
            [ticketId]
        );
        if (!ticketRes.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }
        if (ticketRes.rows[0].status === TICKET_CANCELLED) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Ticket is already cancelled' });
        }
        const ticketRow = ticketRes.rows[0];
        const itemsRes = await client.query(
            `SELECT id, item_type, status, unique_serial_number, serial_number, ttspl_id,
                    customer_inventory_id, warehouse_received_at, picked_up_at, customer_otp_verified_at
               FROM support_ticket_items
              WHERE ticket_id = $1`,
            [ticketId]
        );

        if (req.body?.force_inventory_revert) {
            await client.query(
                `UPDATE support_ticket_items
                    SET status = 'cancelled',
                        return_dc_number = NULL,
                        updated_at = CURRENT_TIMESTAMP
                  WHERE ticket_id = $1 AND status <> 'cancelled'`,
                [ticketId]
            );
            if (ticketRow.return_dc_number) {
                await client.query(
                    `UPDATE delivery_challan_lines
                        SET status = 'cancelled', updated_at = NOW()
                      WHERE dc_number = $1 AND movement_type = 'return'
                        AND COALESCE(status, '') NOT IN ('cancelled')`,
                    [ticketRow.return_dc_number]
                );
            }
        } else {
            await client.query(
                `UPDATE support_ticket_items
                 SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                 WHERE ticket_id = $1 AND status NOT IN ('resolved','closed','inventory_updated','cancelled')`,
                [ticketId]
            );
        }
        try {
            await client.query(
                `UPDATE support_replacement_orders
                 SET status = 'cancelled'
                 WHERE ticket_id = $1 AND status NOT IN ('completed','cancelled')`,
                [ticketId]
            );
        } catch (replacementErr) {
            if (replacementErr.code !== '42P01') throw replacementErr;
        }

        await client.query(
            `UPDATE support_tickets
             SET status = $2, cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $3,
                 cancellation_remark = $4, return_dc_number = CASE WHEN $5 THEN NULL ELSE return_dc_number END,
                 last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [ticketId, TICKET_CANCELLED, req.user.user_id, remark, !!req.body?.force_inventory_revert]
        );

        const inventoryPreserved = req.body?.force_inventory_revert
            ? await forceRestoreCustomerAssetsOnCancel(client, {
                ticketId,
                customerId: ticketRow.customer_id,
                items: itemsRes.rows,
                actorUserId: req.user.user_id,
                actorName: req.user.name,
            })
            : await preserveCustomerAssetsOnCancel(client, {
                ticketId,
                customerId: ticketRow.customer_id,
                items: itemsRes.rows,
                actorUserId: req.user.user_id,
                actorName: req.user.name,
            });

        await logAudit(client, {
            itemId: null,
            ticketId,
            userId: req.user.user_id,
            action: 'ticket_cancelled',
            detail: { remark, inventory_preserved: inventoryPreserved, force_inventory_revert: !!req.body?.force_inventory_revert }
        });
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('cancelTicket:', e);
        return res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to cancel ticket' });
    } finally {
        client.release();
    }

    const data = await getTicketWithItems(ticketId, req.user);
    res.json({ success: true, message: 'Ticket cancelled', ...data });
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
    try {
        await assertTicketNotCancelled(pool, item.ticket_id);
    } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message });
    }
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
    try {
        await assertTicketNotCancelled(pool, item.ticket_id);
    } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message });
    }
    if (assignedTo) {
        try {
            assertItemAllowsTechnicianAssign(item);
        } catch (e) {
            return res.status(e.status || 400).json({ success: false, message: e.message });
        }
    }
    if (item.visited_at && item.item_type === 'complaint' && assignedTo !== item.assigned_to) {
        return res.status(409).json({
            success: false,
            message: 'Technician cannot be changed after the visit has started.',
        });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const previousName = item.assigned_to
            ? await resolveUserDisplayName(client, item.assigned_to)
            : null;
        const newName = assignedTo ? await resolveUserDisplayName(client, assignedTo) : null;
        await client.query(
            `UPDATE support_ticket_items SET assigned_to = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [itemId, assignedTo]
        );
        if (assignedTo) {
            await syncPartRequestsTechForItem(client, itemId, assignedTo);
        }
        const isReassign = item.assigned_to && assignedTo && item.assigned_to !== assignedTo;
        await logAudit(client, {
            itemId,
            ticketId: item.ticket_id,
            userId: req.user.user_id,
            action: isReassign ? 'technician_reassigned' : 'technician_assigned',
            detail: {
                assigned_to: assignedTo,
                previous_assigned_to: item.assigned_to || null,
                previous_assignee: previousName,
                new_assignee: newName,
            },
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
        await assertTicketNotCancelled(client, ticketId);
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
            if (itemType === 'pickup') {
                throw Object.assign(
                    new Error('Use "Schedule pickup" to create a pickup with Return DC and dispatch assignment.'),
                    { status: 400 }
                );
            }
            if (!VALID_ITEM_TYPES.has(itemType) || itemType === 'complaint') {
                throw Object.assign(new Error('Phase items must be replacement only — use Schedule pickup for returns'), { status: 400 });
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
        await assertTicketNotCancelled(client, ticketId);
        const { rows: eligible } = await client.query(
            `SELECT id, pickup_method, item_type, status FROM support_ticket_items
             WHERE ticket_id = $1 AND assigned_to IS NULL AND status NOT IN ('resolved','closed')`,
            [ticketId]
        );
        const toAssign = eligible.filter((row) => itemAllowsTechnicianAssign(row));
        if (!toAssign.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'No items on this ticket can be assigned to a technician (courier/porter handling or pending dispatch).'
            });
        }
        const ids = toAssign.map((r) => r.id);
        await client.query(
            `UPDATE support_ticket_items SET assigned_to = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = ANY($1::int[])`,
            [ids, assignedTo]
        );
        for (const row of toAssign) {
            await syncPartRequestsTechForItem(client, row.id, assignedTo);
        }
        for (const row of toAssign) {
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
    try {
        await assertTicketNotCancelled(pool, ticketId);
    } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message });
    }
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
    const phoneNorm = normalizeSupportPhoneFields({
        ticket_phone_override,
        ticket_alt_phone,
    });
    if (!phoneNorm.ok) {
        return res.status(400).json({ success: false, message: phoneNorm.error });
    }
    const phones = phoneNorm.value;
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
                phones.ticket_phone_override ?? null,
                phones.ticket_alt_phone ?? null,
                ticket_email ?? null,
                ticket_address ?? null,
                priority ?? null,
                top_level_remarks ?? null
            ]
        );
        if (Array.isArray(items)) {
            for (const item of items) {
                if (!item.id) continue;
                if (item.assigned_to != null) {
                    const itemRes = await client.query(
                        'SELECT * FROM support_ticket_items WHERE id = $1 AND ticket_id = $2',
                        [item.id, ticketId]
                    );
                    if (!itemRes.rows.length) continue;
                    assertItemAllowsTechnicianAssign(itemRes.rows[0]);
                }
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
        return res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to update ticket' });
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
        const isRepair = isRepairPickupItem(item);
        const terminalStatus = isRepair ? AWAITING_SDC_STATUS : 'inventory_updated';

        const stageRes = await client.query(
            `SELECT stage_id FROM stages WHERE stage_name = 'Floor Manager' LIMIT 1`
        );
        const stageId = stageRes.rows[0]?.stage_id || null;

        let floorTicketId = null;
        if (stageId) {
            const code = item.ttspl_id || item.unique_serial_number || item.serial_number;
            const vsnRes = await client.query(
                `SELECT serial_id, inventory_asset_code, current_customer_id FROM vendor_serial_numbers
                 WHERE (inventory_asset_code = $1 OR serial_number = $1)
                   AND deleted_at IS NULL LIMIT 1`,
                [code]
            );
            const vsn = vsnRes.rows[0];
            if (vsn) {
                const blocked = await findBlockingTicket(client, {
                    serialNumber: item.serial_number,
                    ttsplId: item.ttspl_id || item.unique_serial_number,
                    vendorSerialId: vsn.serial_id,
                });
                if (blocked) {
                    throw Object.assign(
                        new Error(blockingTicketMessage(blocked)),
                        { status: 409, blocking_ticket_id: blocked.ticket_id }
                    );
                }
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
                if (isRepair && vsn.current_customer_id) {
                    await removeRepairPickupFromCustomer(client, item, req.user);
                } else if (!isRepair) {
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
                await resetVendorSerialForQcReentry(client, vsn.serial_id);
            }
        }

        await client.query(
            `UPDATE support_ticket_items SET
                status = $4,
                warehouse_received_at = CURRENT_TIMESTAMP,
                reached_warehouse_at = CURRENT_TIMESTAMP,
                warehouse_received_by = $2,
                floor_ticket_id = $3,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [itemId, req.user.user_id, floorTicketId, terminalStatus]
        );

        if (!isRepair && item.customer_inventory_id) {
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
        if (!isRepair && item.source_item_id) {
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
    const body = req.body || {};

    if (!['repair', 'return'].includes(body.pickup_type)) {
        return res.status(400).json({ success: false, message: 'pickup_type must be repair or return' });
    }
    if (!['technician', 'courier', 'porter'].includes(body.dispatch_mode)) {
        return res.status(400).json({ success: false, message: 'Invalid dispatch_mode' });
    }
    if (body.dispatch_mode === 'technician' && !body.technician_user_id) {
        return res.status(400).json({ success: false, message: 'Select a technician for this pickup' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const ticketRes = await client.query('SELECT * FROM support_tickets WHERE id = $1', [ticketId]);
        if (!ticketRes.rows.length) throw Object.assign(new Error('Ticket not found'), { status: 404 });
        const ticket = ticketRes.rows[0];

        const result = await executePickupWithReturnDc(client, ticket, ticketId, req.user.user_id, body);
        await client.query('COMMIT');

        try { await regenerateReturnDcPdfByRdc(pool, result.rdc); } catch (pdfErr) {
            console.error('[support] return DC pdf (create):', pdfErr.message);
        }

        const data = await getTicketWithItems(ticketId, req.user);
        res.status(201).json({
            success: true,
            pickup_item_id: result.pickupItemId,
            pickup_item_ids: result.pickupItemIds,
            return_dc_number: result.rdc,
            dispatch_mode: body.dispatch_mode,
            unit_count: result.machines.length,
            message: `Pickup scheduled for ${result.machines.length} laptop(s). Return DC: ${result.rdc}.`,
            customer_otp_visible: result.customerOtp,
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

/** Create a new pickup ticket + Return DC + assignment in one step (new-ticket form). */
exports.createPickupTicket = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Support lead only' });
    }
    const {
        customer_id, customer_name, customer_phone,
        priority, top_level_remarks,
        ticket_phone_override, ticket_alt_phone, ticket_email, ticket_address,
        machine = {},
        machines: machinesRaw,
        pickup_type, pickup_address, dispatch_mode,
        technician_user_id, courier_name, awb_number,
        porter_tracking_id, porter_order_id,
    } = req.body || {};

    const machinesList = Array.isArray(machinesRaw) && machinesRaw.length
        ? machinesRaw
        : (machine?.serial_number || machine?.unique_serial_number || machine?.ttspl_id ? [machine] : []);

    if (!customer_id) {
        return res.status(400).json({ success: false, message: 'customer_id is required' });
    }
    if (!machinesList.length) {
        return res.status(400).json({ success: false, message: 'Select at least one laptop for pickup' });
    }
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
        await assertMachinesAvailable(client, customer_id, machinesList.map((m) => ({
            serial_number: m.serial_number,
            unique_serial_number: m.unique_serial_number || m.ttspl_id,
        })));

        const firstMachine = machinesList[0];
        const ttspl = firstMachine.unique_serial_number || firstMachine.ttspl_id || null;
        const ticketRes = await client.query(
            `INSERT INTO support_tickets (
                customer_id, customer_name, customer_phone, status, created_by, last_activity_at,
                priority, top_level_remarks, ticket_phone_override, ticket_alt_phone, ticket_email, ticket_address,
                ticket_category, ttspl_id, serial_number, complaint_type
            ) VALUES ($1,$2,$3,'in_progress',$4,CURRENT_TIMESTAMP,$5,$6,$7,$8,$9,$10,
                      'pickup',$11,$12,'pickup')
            RETURNING *`,
            [
                customer_id, customer_name || null, customer_phone || null,
                req.user.user_id,
                ['normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
                top_level_remarks || null,
                ticket_phone_override || customer_phone || null,
                ticket_alt_phone || null,
                ticket_email || null,
                ticket_address || null,
                ttspl,
                firstMachine.serial_number || null,
            ]
        );
        const ticket = ticketRes.rows[0];
        await logAudit(client, {
            itemId: null, ticketId: ticket.id, userId: req.user.user_id,
            action: 'ticket_created', detail: { customer_id, ticket_category: 'pickup', unit_count: machinesList.length }
        });

        const result = await executePickupWithReturnDc(client, ticket, ticket.id, req.user.user_id, {
            pickup_type, pickup_address, dispatch_mode,
            technician_user_id, courier_name, awb_number,
            porter_tracking_id, porter_order_id,
            machines: machinesList,
        });

        await client.query('COMMIT');

        try { await regenerateReturnDcPdfByRdc(pool, result.rdc); } catch (pdfErr) {
            console.error('[support] return DC pdf (pickup ticket):', pdfErr.message);
        }

        const data = await getTicketWithItems(ticket.id, req.user);
        res.status(201).json({
            success: true,
            pickup_item_id: result.pickupItemId,
            pickup_item_ids: result.pickupItemIds,
            return_dc_number: result.rdc,
            customer_otp_visible: result.customerOtp,
            unit_count: result.machines.length,
            message: `Pickup ticket created with ${result.machines.length} laptop(s). Return DC: ${result.rdc}.`,
            ...data,
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('createPickupTicket:', e);
        res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to create pickup ticket' });
    } finally {
        client.release();
    }
};

exports.getPickupDeliveryContext = async (req, res) => {
    try {
        const customerId = parseInt(req.params.customerId, 10);
        const code = (req.query.ttspl || req.query.serial || '').trim();
        if (!code) {
            return res.status(400).json({ success: false, message: 'ttspl or serial query param required' });
        }
        const ctx = await resolvePickupDeliveryContext(pool, customerId, code);
        if (!ctx) {
            return res.json({ success: true, found: false, pickup_address: null });
        }
        res.json({ success: true, found: true, ...ctx });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message || 'Failed to resolve delivery context' });
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
             WHERE id = $1
                OR (
                  return_dc_number IS NOT NULL
                  AND return_dc_number = $4
                  AND item_type = 'pickup'
                  AND technician_esign_url IS NULL
                )`,
            [itemId, esignUrl, req.user.user_id, it.return_dc_number]
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
        if (it.return_dc_number) await regenerateReturnDcPdfByRdc(pool, it.return_dc_number);
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
             WHERE id = $1
                OR (
                  return_dc_number IS NOT NULL
                  AND return_dc_number = $2
                  AND item_type = 'pickup'
                  AND customer_otp_verified_at IS NULL
                )`,
            [itemId, it.return_dc_number]
        );

        const affectedRes = await client.query(
            `SELECT * FROM support_ticket_items
              WHERE id = $1
                 OR (
                   return_dc_number IS NOT NULL
                   AND return_dc_number = $2
                   AND item_type = 'pickup'
                   AND customer_otp_verified_at IS NOT NULL
                   AND picked_up_at IS NOT NULL
                 )`,
            [itemId, it.return_dc_number]
        );
        for (const pickupItem of affectedRes.rows) {
            if (!isRepairPickupItem(pickupItem)) continue;
            const invResult = await removeRepairPickupFromCustomer(client, pickupItem, req.user);
            await logAudit(client, {
                itemId: pickupItem.id,
                ticketId: pickupItem.ticket_id,
                userId: req.user.user_id,
                action: 'repair_pickup_customer_removed',
                detail: invResult,
            });
        }

        await logAudit(client, {
            itemId, ticketId: it.ticket_id, userId: req.user.user_id,
            action: 'pickup_otp_verified', detail: null
        });
        await bumpTicketActivity(client, it.ticket_id);
        await recomputeTicketStatus(client, it.ticket_id);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('verifyPickupCustomerOtp:', e);
        return res.status(500).json({ success: false, message: 'Failed to verify OTP' });
    } finally {
        client.release();
    }
    try {
        if (it.return_dc_number) await regenerateReturnDcPdfByRdc(pool, it.return_dc_number);
    } catch (pdfErr) {
        console.error('[support] return DC pdf (otp verify):', pdfErr.message);
    }
    const data = await getTicketWithItems(it.ticket_id, req.user);
    res.json({ success: true, message: 'OTP verified. Laptop picked up successfully.', ...data });
};

// Warehouse confirms receipt of the laptop with an e-signature. For a repair
// pickup a floor QC ticket is auto-created; for a return pickup the unit is
// marked returned. The Return DC is closed as delivered.
const saveWarehouseEsignPng = (itemId, esign_data) => {
    const dir = path.join(__dirname, '..', 'uploads', 'support-pickups');
    fs.mkdirSync(dir, { recursive: true });
    const fname = `wh_esign_${itemId}_${Date.now()}.png`;
    const b64 = String(esign_data).replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(path.join(dir, fname), Buffer.from(b64, 'base64'));
    return `uploads/support-pickups/${fname}`;
};

const warehouseReceiveSinglePickupItem = async (client, it, userId, esignUrl, signerName) => {
    const effectivePickupType = it.pickup_type || (it.source_item_id ? 'repair' : 'return');
    const isRepair = effectivePickupType === 'repair';
    const terminalStatus = isRepair ? AWAITING_SDC_STATUS : 'inventory_updated';

    await client.query(
        `UPDATE support_ticket_items SET
            warehouse_received_at = CURRENT_TIMESTAMP,
            reached_warehouse_at = COALESCE(reached_warehouse_at, CURRENT_TIMESTAMP),
            warehouse_received_by = $3,
            warehouse_esign_url = $2,
            warehouse_esign_at = CURRENT_TIMESTAMP,
            warehouse_esign_by = $3,
            status = $4,
            resolved_at = CASE WHEN $5 THEN resolved_at ELSE COALESCE(resolved_at, CURRENT_TIMESTAMP) END,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [it.id, esignUrl, userId, terminalStatus, isRepair]
    );

    let floorTicketId = null;

    // Every warehouse receipt (return or repair) creates a floor QC ticket for the floor manager.
    const ftResult = await createFloorTicketFromSupportPickup(client, {
        ...it,
        pickup_type: effectivePickupType,
    }, userId);
    floorTicketId = ftResult.ticket_id || null;
    if (floorTicketId && !it.floor_ticket_id) {
        await client.query(
            'UPDATE support_ticket_items SET floor_ticket_id = $1, pickup_type = COALESCE(pickup_type, $3) WHERE id = $2',
            [floorTicketId, it.id, effectivePickupType]
        );
    }

    const code = it.ttspl_id || it.unique_serial_number || it.serial_number;
    const vsnRes = await client.query(
        `SELECT serial_id, inventory_asset_code, inventory_status, current_customer_id
           FROM vendor_serial_numbers
          WHERE deleted_at IS NULL
            AND (
              inventory_asset_code = $1
              OR serial_number = $1
              OR extra->>'ttspl_id' = $1
              OR extra->>'unique_product_serial' = $1
            )
          ORDER BY
            CASE WHEN inventory_asset_code = $1 THEN 0 ELSE 1 END,
            CASE WHEN serial_number = $1 THEN 0 ELSE 1 END,
            serial_id ASC
          LIMIT 1`,
        [code]
    );
    const vsn = vsnRes.rows[0];
    if (vsn) {
        if (isRepair) {
            if (vsn.current_customer_id) {
                await removeRepairPickupFromCustomer(client, it, { user_id: userId });
            }
        } else {
            const activeOutbound = await client.query(
                `SELECT dc_number, status
                   FROM delivery_challan_lines
                  WHERE movement_type = 'outbound'
                    AND status IN ('in_transit', 'reached', 'shipped')
                    AND serial_number::text ILIKE '%' || $1 || '%'
                  LIMIT 1`,
                [code]
            );
            if (activeOutbound.rows.length) {
                console.warn(
                    `[support] Skipping returned status for ${code}: active outbound ${activeOutbound.rows[0].dc_number}`
                );
            } else {
                await client.query(
                    `UPDATE vendor_serial_numbers SET
                        inventory_status = 'returned',
                        current_customer_id = NULL,
                        current_dc_number = NULL,
                        status_changed_at = NOW(),
                        updated_at = NOW()
                     WHERE serial_id = $1`,
                    [vsn.serial_id]
                );
            }
        }
        await resetVendorSerialForQcReentry(client, vsn.serial_id);
    }

    if (!isRepair && it.customer_inventory_id) {
        await client.query(
            `UPDATE customer_inventory SET
                passivated_at = NOW(),
                passivated_reason = 'Returned by customer via support pickup',
                updated_at = NOW()
             WHERE id = $1`,
            [it.customer_inventory_id]
        );
    }

    if (!isRepair && it.source_item_id) {
        await client.query(
            `UPDATE support_ticket_items SET
                status = 'resolved',
                resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status NOT IN ('resolved','closed','inventory_updated')`,
            [it.source_item_id]
        );
    }

    await logAudit(client, {
        itemId: it.id, ticketId: it.ticket_id, userId,
        action: 'warehouse_receipt_confirmed',
        detail: {
            pickup_type: effectivePickupType,
            floor_ticket_id: floorTicketId,
            signer_name: signerName || null,
            awaiting_service_return: isRepair,
        }
    });

    return { floorTicketId };
};

const warehouseReceiveReturnDcBatch = async (client, triggerItem, userId, esignUrl, signerName, dcl = null) => {
    let siblings = [triggerItem];
    if (triggerItem.return_dc_number) {
        const sibRes = await client.query(
            `SELECT sti.*
               FROM support_ticket_items sti
               LEFT JOIN LATERAL (
                 SELECT v.inventory_status
                   FROM vendor_serial_numbers v
                  WHERE v.deleted_at IS NULL
                    AND (
                      v.inventory_asset_code = COALESCE(sti.ttspl_id, sti.unique_serial_number)
                      OR v.serial_number = sti.serial_number
                    )
                  ORDER BY
                    CASE WHEN v.inventory_asset_code = COALESCE(sti.ttspl_id, sti.unique_serial_number) THEN 0 ELSE 1 END,
                    v.serial_id ASC
                  LIMIT 1
               ) vsn ON TRUE
              WHERE sti.return_dc_number = $1 AND sti.item_type = 'pickup'
                AND (
                  sti.warehouse_received_at IS NULL
                  OR sti.id = $2
                  OR sti.floor_ticket_id IS NULL
                  OR COALESCE(vsn.inventory_status, '') IN ('rented','on_demo','in_transit','out_stock')
                  OR (
                    sti.warehouse_received_at IS NOT NULL
                    AND sti.warehouse_esign_at IS NULL
                    AND sti.warehouse_esign_url IS NULL
                  )
                )
              ORDER BY sti.id ASC`,
            [triggerItem.return_dc_number, triggerItem.id]
        );
        if (sibRes.rows.length) siblings = sibRes.rows;
        // Clear stale incomplete timestamps so warehouseReceiveSinglePickupItem can re-run.
        for (const s of siblings) {
            const needsClear = s.warehouse_received_at
                && (!s.warehouse_esign_at && !s.warehouse_esign_url);
            if (s.warehouse_received_at && (needsClear || s.id === triggerItem.id)) {
                await client.query(
                    `UPDATE support_ticket_items
                        SET warehouse_received_at = NULL,
                            warehouse_esign_url = NULL,
                            warehouse_esign_at = NULL,
                            warehouse_esign_by = NULL,
                            reached_warehouse_at = NULL,
                            updated_at = NOW()
                      WHERE id = $1`,
                    [s.id]
                );
                s.warehouse_received_at = null;
            }
        }
    }

    const isDelivered = dcl && (dcl.status === 'delivered' || !!dcl.delivered_at);
    for (const s of siblings) {
        const isInhouse = s.pickup_method !== 'courier' && s.pickup_method !== 'porter';
        if (isInhouse && !s.customer_otp_verified_at && !isDelivered) {
            throw Object.assign(
                new Error('Customer OTP must be verified for all units before warehouse can confirm receipt'),
                { status: 400 }
            );
        }
    }

    const floorTicketIds = [];
    for (const s of siblings) {
        const { floorTicketId } = await warehouseReceiveSinglePickupItem(client, s, userId, esignUrl, signerName);
        if (floorTicketId) floorTicketIds.push(floorTicketId);
    }

    if (triggerItem.return_dc_number) {
        await client.query(
            `UPDATE delivery_challan_lines SET
                status = 'delivered', delivered_at = NOW(), updated_at = NOW()
             WHERE dc_number = $1 AND movement_type = 'return'`,
            [triggerItem.return_dc_number]
        );
    }

    for (const s of siblings) {
        try {
            await replacementFlow.onReplacementWarehouseReceived(client, s.id);
        } catch (whErr) {
            console.error('[support] replacement warehouse hook:', whErr.message);
        }
    }

    await bumpTicketActivity(client, triggerItem.ticket_id);
    await recomputeTicketStatus(client, triggerItem.ticket_id);

    return { floorTicketIds, unitCount: siblings.length };
};

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
        // Allow retry when a prior confirm left inventory still with the customer
        // (warehouse_received_at set but no floor ticket / still rented).
        const missingWarehouseEsign = it.warehouse_received_at
            && !it.warehouse_esign_at
            && !it.warehouse_esign_url;
        if (it.warehouse_received_at && it.floor_ticket_id) {
            const code = it.ttspl_id || it.unique_serial_number || it.serial_number;
            const inv = code ? await client.query(
                `SELECT inventory_status FROM vendor_serial_numbers
                  WHERE deleted_at IS NULL
                    AND (inventory_asset_code = $1 OR serial_number = $1)
                  ORDER BY CASE WHEN inventory_asset_code = $1 THEN 0 ELSE 1 END
                  LIMIT 1`,
                [code]
            ) : { rows: [] };
            const st = String(inv.rows[0]?.inventory_status || '').toLowerCase();
            const stillOut = ['rented', 'on_demo', 'in_transit', 'out_stock'].includes(st);
            if (!stillOut && !missingWarehouseEsign) {
                throw Object.assign(new Error('Already confirmed at warehouse'), { status: 400 });
            }
            await client.query(
                `UPDATE support_ticket_items
                    SET warehouse_received_at = NULL, warehouse_esign_url = NULL,
                        warehouse_esign_at = NULL, warehouse_esign_by = NULL,
                        reached_warehouse_at = NULL,
                        updated_at = NOW()
                  WHERE id = $1`,
                [it.id]
            );
            it.warehouse_received_at = null;
        } else if (it.warehouse_received_at && !it.floor_ticket_id) {
            await client.query(
                `UPDATE support_ticket_items
                    SET warehouse_received_at = NULL, warehouse_esign_url = NULL,
                        warehouse_esign_at = NULL, warehouse_esign_by = NULL,
                        updated_at = NOW()
                  WHERE id = $1`,
                [it.id]
            );
            it.warehouse_received_at = null;
        }

        const esignUrl = saveWarehouseEsignPng(it.id, esign_data);
        const { floorTicketIds, unitCount } = await warehouseReceiveReturnDcBatch(
            client, it, req.user.user_id, esignUrl, signer_name
        );
        await client.query('COMMIT');

        try {
            if (it.return_dc_number) await regenerateReturnDcPdfByRdc(pool, it.return_dc_number);
        } catch (pdfErr) {
            console.error('[support] return DC pdf (warehouse confirm):', pdfErr.message);
        }

        const data = await getTicketWithItems(it.ticket_id, req.user);
        const floorTicketId = floorTicketIds[0] || null;
        res.json({
            success: true,
            floor_ticket_id: floorTicketId,
            floor_ticket_ids: floorTicketIds,
            units_received: unitCount,
            message: floorTicketIds.length
                ? `Warehouse receipt confirmed for ${unitCount} unit(s). Floor ticket(s): ${floorTicketIds.join(', ')}.`
                : `Warehouse receipt confirmed for ${unitCount} unit(s).`,
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

/** Warehouse e-sign for an entire Return DC (all pending pickup units). */
exports.confirmReturnDcWarehouseReceipt = async (req, res) => {
    const rdcNumber = String(req.params.rdcNumber || '').trim();
    const { esign_data, signer_name } = req.body || {};

    if (!['warehouse', 'admin', 'support_lead', 'manager', 'floor_manager', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Warehouse access required' });
    }
    if (!rdcNumber) {
        return res.status(400).json({ success: false, message: 'Return DC number required' });
    }
    if (!esign_data || !String(esign_data).startsWith('data:image')) {
        return res.status(400).json({ success: false, message: 'Warehouse e-sign required' });
    }

    const dclRes = await pool.query(
        `SELECT * FROM delivery_challan_lines
          WHERE dc_number = $1 AND movement_type = 'return' LIMIT 1`,
        [rdcNumber]
    );
    const dcl = dclRes.rows[0];
    if (!dcl) {
        return res.status(404).json({ success: false, message: 'Return DC not found' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await ensureSupportTicketItemV3Columns(client);
        await ensureReturnDcPickupItems(client, dcl);

        // Include incomplete receives: timestamp set but still rented / no floor ticket.
        const pendingRes = await client.query(
            `SELECT sti.*
               FROM support_ticket_items sti
               LEFT JOIN LATERAL (
                 SELECT v.inventory_status
                   FROM vendor_serial_numbers v
                  WHERE v.deleted_at IS NULL
                    AND (
                      v.inventory_asset_code = COALESCE(sti.ttspl_id, sti.unique_serial_number)
                      OR v.serial_number = sti.serial_number
                    )
                  ORDER BY
                    CASE WHEN v.inventory_asset_code = COALESCE(sti.ttspl_id, sti.unique_serial_number) THEN 0 ELSE 1 END,
                    v.serial_id ASC
                  LIMIT 1
               ) vsn ON TRUE
              WHERE sti.return_dc_number = $1 AND sti.item_type = 'pickup'
                AND (
                  sti.warehouse_received_at IS NULL
                  OR sti.floor_ticket_id IS NULL
                  OR COALESCE(vsn.inventory_status, '') IN ('rented','on_demo','in_transit','out_stock')
                  OR (
                    sti.warehouse_received_at IS NOT NULL
                    AND sti.warehouse_esign_at IS NULL
                    AND sti.warehouse_esign_url IS NULL
                  )
                )
              ORDER BY sti.id ASC LIMIT 1`,
            [rdcNumber]
        );
        if (!pendingRes.rows.length) {
            throw Object.assign(new Error('All units on this Return DC are already received'), { status: 400 });
        }
        const trigger = pendingRes.rows[0];
        if (trigger.warehouse_received_at) {
            await client.query(
                `UPDATE support_ticket_items
                    SET warehouse_received_at = NULL, warehouse_esign_url = NULL,
                        warehouse_esign_at = NULL, warehouse_esign_by = NULL,
                        reached_warehouse_at = NULL,
                        updated_at = NOW()
                  WHERE id = $1`,
                [trigger.id]
            );
            trigger.warehouse_received_at = null;
        }

        const esignUrl = saveWarehouseEsignPng(trigger.id, esign_data);
        const { floorTicketIds, unitCount } = await warehouseReceiveReturnDcBatch(
            client, trigger, req.user.user_id, esignUrl, signer_name, dcl
        );
        await client.query('COMMIT');

        try { await regenerateReturnDcPdfByRdc(pool, rdcNumber); } catch (pdfErr) {
            console.error('[support] return DC pdf (RDC warehouse confirm):', pdfErr.message);
        }

        res.json({
            success: true,
            return_dc_number: rdcNumber,
            units_received: unitCount,
            floor_ticket_ids: floorTicketIds,
            pdf_regenerated: true,
            message: `Warehouse receipt confirmed for ${unitCount} unit(s) on ${rdcNumber}.`,
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('confirmReturnDcWarehouseReceipt:', e);
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
                replacement_flagged_by = CASE WHEN ($2::text) = 'replacement_required' THEN $3::int ELSE NULL END,
                replacement_flag_reason = CASE WHEN ($2::text) = 'replacement_required' THEN $4::text ELSE NULL END,
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

exports.getReplacementContext = async (req, res) => {
    const ticketId = parseInt(req.params.ticketId, 10);
    try {
        const ticketRes = await pool.query('SELECT * FROM support_tickets WHERE id = $1', [ticketId]);
        if (!ticketRes.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });
        const ticket = ticketRes.rows[0];
        const eligible = await replacementFlow.listEligibleComplaintItems(pool, ticketId);
        const context = await replacementFlow.buildTicketReplacementContext(pool, ticket, eligible);
        res.json({ success: true, ...context });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message || 'Failed to load replacement context' });
    }
};

exports.moveComplaintToReplacement = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only support lead can move to replacement' });
    }
    const itemId = parseInt(req.params.itemId, 10);
    const { reason } = req.body || {};
    const itemRes = await pool.query('SELECT * FROM support_ticket_items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ success: false, message: 'Item not found' });
    const item = itemRes.rows[0];
    if (item.item_type !== 'complaint') {
        return res.status(400).json({ success: false, message: 'Only complaint items can move to replacement' });
    }
    const flagReason = String(reason || '').trim() || item.replacement_flag_reason || 'Replacement required';
    await pool.query(
        `UPDATE support_ticket_items SET
            outcome = 'replacement_required',
            outcome_set_by = $2,
            outcome_set_at = CURRENT_TIMESTAMP,
            replacement_flagged_by = $2,
            replacement_flag_reason = $3,
            status = CASE WHEN status IN ('resolved','closed') THEN status ELSE 'repair_failed' END,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [itemId, req.user.user_id, flagReason]
    );
    await logAudit(pool, {
        itemId,
        ticketId: item.ticket_id,
        userId: req.user.user_id,
        action: 'moved_to_replacement',
        detail: { reason: flagReason },
    });
    await bumpTicketActivity(pool, item.ticket_id);
    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({ success: true, message: 'Complaint marked for replacement', ...data });
};

exports.initiateReplacement = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only team lead can initiate replacement' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const body = req.body || {};
    const {
        source_item_ids: sourceItemIdsRaw,
        source_item_id,
        reason,
        remarks: remarksBody,
        contact_name,
        contact_phone,
        pickup_address,
        dispatch_mode,
        technician_user_id,
        courier_name,
        awb_number,
        porter_tracking_id,
        porter_order_id,
    } = body;

    const client = await pool.connect();
    let resultPayload = {};
    try {
        await ensureSupportTicketItemV3Columns(client);
        await ensureDeliveryChallanReplacementColumns(client);
        await client.query('BEGIN');

        const ticketRes = await client.query('SELECT * FROM support_tickets WHERE id = $1', [ticketId]);
        if (!ticketRes.rows.length) throw Object.assign(new Error('Ticket not found'), { status: 404 });
        const ticket = ticketRes.rows[0];

        const isAppend = !!(ticket.return_dc_number && ticket.sales_order_number);
        if (!isAppend && ticket.return_dc_number) {
            throw Object.assign(new Error('Replacement order already created on this ticket'), { status: 400 });
        }
        if (isAppend) {
            const outboundDc = await client.query(
                `SELECT dc_number FROM delivery_challan_lines
                  WHERE sales_order_number = $1 AND movement_type = 'outbound'
                    AND COALESCE(status, '') NOT IN ('cancelled')
                  LIMIT 1`,
                [ticket.sales_order_number]
            );
            if (outboundDc.rows.length) {
                throw Object.assign(
                    new Error(`Cannot add laptops: outbound delivery DC ${outboundDc.rows[0].dc_number} already exists on ${ticket.sales_order_number}`),
                    { status: 400 }
                );
            }
        }

        let sourceIds = Array.isArray(sourceItemIdsRaw)
            ? sourceItemIdsRaw.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0)
            : [];
        if (!sourceIds.length && source_item_id) sourceIds = [Number(source_item_id)];

        let sourceItems;
        if (sourceIds.length) {
            const srcRes = await client.query(
                `SELECT * FROM support_ticket_items
                  WHERE ticket_id = $1 AND id = ANY($2::int[]) AND item_type = 'complaint'`,
                [ticketId, sourceIds]
            );
            sourceItems = srcRes.rows;
        } else {
            sourceItems = await replacementFlow.listEligibleComplaintItems(client, ticketId);
        }

        if (!sourceItems.length) {
            throw Object.assign(new Error('No complaint items are ready for replacement'), { status: 400 });
        }

        for (const src of sourceItems) {
            const dup = await client.query(
                `SELECT id FROM support_replacement_orders
                  WHERE source_item_id = $1 AND status NOT IN ('completed','cancelled') LIMIT 1`,
                [src.id]
            );
            if (dup.rows.length) {
                throw Object.assign(
                    new Error(`Replacement already exists for ${src.ttspl_id || src.unique_serial_number || src.serial_number}`),
                    { status: 400 }
                );
            }
        }

        const defaults = await replacementFlow.loadDeliveryDefaults(client, ticket, sourceItems[0]);
        const addr = pickup_address && typeof pickup_address === 'object' ? pickup_address : {};
        const shippingAddress = {
            name: contact_name || addr.name || defaults.contact_name || ticket.customer_name || '',
            phone: contact_phone || addr.phone || defaults.contact_phone || '',
            address: addr.address || defaults.address || '',
            city: addr.city || defaults.city || '',
            state: addr.state || defaults.state || '',
            pincode: addr.pincode || defaults.pincode || '',
        };
        if (!String(shippingAddress.address || '').trim()) {
            throw Object.assign(new Error('Delivery / pickup address is required'), { status: 400 });
        }

        const custRes = await client.query(
            `SELECT customer_id, name, company_name, email, phone, gst_no, billing_state,
                    billing_address, billing_city, billing_pincode
               FROM customers WHERE customer_id = $1`,
            [ticket.customer_id]
        );
        const cust = custRes.rows[0] || {};
        const customerName = ticket.customer_name || cust.company_name || cust.name || '';
        const billingAddress = {
            name: customerName,
            phone: cust.phone || shippingAddress.phone,
            address: cust.billing_address || shippingAddress.address,
            city: cust.billing_city || shippingAddress.city,
            state: cust.billing_state || shippingAddress.state,
            pincode: cust.billing_pincode || shippingAddress.pincode,
            gst_number: cust.gst_no || null,
        };

        const lineConfigs = [];
        for (const src of sourceItems) {
            lineConfigs.push(await replacementFlow.resolveConfigFromComplaint(client, src, ticket.customer_id));
        }

        const { salesOrderNumber, lineIds } = isAppend
            ? await replacementFlow.appendConfigSalesOrderLines(client, {
                salesOrderNumber: ticket.sales_order_number,
                customerId: ticket.customer_id,
                customerName,
                customerEmail: ticket.ticket_email || cust.email,
                customerMobile: shippingAddress.phone || cust.phone,
                shippingAddress,
                billingAddress,
                gstNumber: cust.gst_no,
                supplyState: cust.billing_state,
                lineConfigs,
                userId: req.user.user_id,
            })
            : await replacementFlow.createConfigSalesOrder(client, {
                customerId: ticket.customer_id,
                customerName,
                customerEmail: ticket.ticket_email || cust.email,
                customerMobile: shippingAddress.phone || cust.phone,
                shippingAddress,
                billingAddress,
                gstNumber: cust.gst_no,
                supplyState: cust.billing_state,
                lineConfigs,
                userId: req.user.user_id,
            });

        const replacementOrderIds = [];
        for (let i = 0; i < sourceItems.length; i += 1) {
            const src = sourceItems[i];
            const cfg = lineConfigs[i];
            const lineId = lineIds[i];
            const sharedReason = reason || src.replacement_flag_reason || 'Replacement required';

            const itemIns = await client.query(
                `INSERT INTO support_ticket_items (
                    ticket_id, brand, model, processor, generation, ram, storage,
                    item_type, remarks, status, source_item_id
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,'replacement',$8,'order_placed',$9) RETURNING id`,
                [
                    ticketId,
                    cfg.brand,
                    cfg.model,
                    cfg.processor,
                    cfg.generation,
                    cfg.ram,
                    cfg.storage,
                    sharedReason,
                    src.id,
                ]
            );
            const replacementItemId = itemIns.rows[0].id;

            const orderIns = await client.query(
                `INSERT INTO support_replacement_orders (
                    ticket_id, item_id, source_item_id, complaint_item_id,
                    sales_order_number, sales_order_line_id,
                    old_customer_inventory_id, old_machine_serial,
                    old_serial_id, old_rent_monthly_rate,
                    delivery_address, contact_name, contact_phone,
                    status, created_by, notes, approved_at
                ) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,'order_placed',$13,$14,CURRENT_TIMESTAMP)
                RETURNING id`,
                [
                    ticketId,
                    replacementItemId,
                    src.id,
                    salesOrderNumber,
                    lineId,
                    cfg.old_customer_inventory_id,
                    cfg.old_machine_serial,
                    cfg.old_serial_id,
                    cfg.monthly_rate || null,
                    JSON.stringify(shippingAddress),
                    shippingAddress.name,
                    shippingAddress.phone,
                    req.user.user_id,
                    sharedReason,
                ]
            );
            replacementOrderIds.push(orderIns.rows[0].id);

            await client.query(
                `UPDATE support_ticket_items SET
                    replacement_approved_by = $2,
                    replacement_approved_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [src.id, req.user.user_id]
            );
        }

        const machines = sourceItems.map((src) => ({
            source_item_id: src.id,
            serial_number: src.serial_number,
            unique_serial_number: src.ttspl_id || src.unique_serial_number,
            ttspl_id: src.ttspl_id || src.unique_serial_number,
            brand: src.brand,
            model: src.model,
            ram: src.ram,
            storage: src.storage,
            generation: src.generation,
            customer_inventory_id: src.customer_inventory_id,
        }));

        const rdcRemarks = remarksBody != null && String(remarksBody).trim()
            ? String(remarksBody).trim()
            : replacementFlow.buildReplacementRdcRemarks(machines);

        const pickupResult = isAppend
            ? await appendMachinesToReturnDc(client, ticket, ticketId, req.user.user_id, {
                return_dc_number: ticket.return_dc_number,
                pickup_type: 'return',
                pickup_address: shippingAddress,
                dispatch_mode: dispatch_mode || null,
                technician_user_id,
                courier_name,
                awb_number,
                porter_tracking_id,
                porter_order_id,
                machines,
                remarks: rdcRemarks,
            })
            : await executePickupWithReturnDc(client, ticket, ticketId, req.user.user_id, {
                pickup_type: 'return',
                pickup_address: shippingAddress,
                dispatch_mode: dispatch_mode || null,
                technician_user_id,
                courier_name,
                awb_number,
                porter_tracking_id,
                porter_order_id,
                machines,
                dc_purpose: 'replacement',
                remarks: rdcRemarks,
            });

        for (let i = 0; i < replacementOrderIds.length; i += 1) {
            await client.query(
                `UPDATE support_replacement_orders SET
                    return_dc_number = $2,
                    pickup_item_id = $3
                 WHERE id = $1`,
                [replacementOrderIds[i], pickupResult.rdc, pickupResult.pickupItemIds[i] || pickupResult.pickupItemId]
            );
        }

        if (!isAppend) {
            await client.query(
                `UPDATE support_tickets SET
                    ticket_category = 'replacement',
                    sales_order_number = $2,
                    return_dc_number = $3,
                    pickup_address = $4::jsonb,
                    status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
                    updated_at = NOW()
                 WHERE id = $1`,
                [ticketId, salesOrderNumber, pickupResult.rdc, JSON.stringify(shippingAddress)]
            );
        } else {
            await client.query(
                `UPDATE support_tickets SET
                    pickup_address = $2::jsonb,
                    status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
                    updated_at = NOW()
                 WHERE id = $1`,
                [ticketId, JSON.stringify(shippingAddress)]
            );
        }

        await logAudit(client, {
            ticketId,
            userId: req.user.user_id,
            action: 'replacement_initiated',
            detail: {
                source_item_ids: sourceItems.map((s) => s.id),
                unit_count: sourceItems.length,
                sales_order_number: salesOrderNumber,
                return_dc_number: pickupResult.rdc,
            },
        });
        await bumpTicketActivity(client, ticketId);
        await client.query('COMMIT');

        resultPayload = {
            sales_order_number: salesOrderNumber,
            return_dc_number: pickupResult.rdc,
            unit_count: sourceItems.length,
            appended: isAppend,
            customer_otp_visible: pickupResult.customerOtp,
            next_steps: isAppend
                ? 'New SO lines added — attach laptops on the sales order and extend the same return pickup.'
                : 'Attach laptops to the sales order, complete Dispatch QC, then create delivery DC.',
        };
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(e.status || 400).json({ success: false, message: e.message || 'Failed to initiate replacement' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(ticketId, req.user);
    res.json({ success: true, ...resultPayload, ...data });
};

/** Cancel a Return DC + pickup before collection — resets ticket so replacement/pickup can be recreated. */
async function cancelReplacementSalesOrder(client, soNumber, actor) {
    if (!soNumber) return { cancelled: false };
    const outboundDc = await client.query(
        `SELECT dc_number FROM delivery_challan_lines
          WHERE sales_order_number = $1 AND movement_type = 'outbound'
            AND COALESCE(status, '') NOT IN ('cancelled')
          LIMIT 1`,
        [soNumber]
    );
    if (outboundDc.rows.length) {
        throw Object.assign(
            new Error(`Cannot cancel sales order ${soNumber}: outbound delivery DC ${outboundDc.rows[0].dc_number} already exists`),
            { status: 400 }
        );
    }

    const attachedRes = await client.query(
        `SELECT allocation_id, serial_id, qc_ticket_id
           FROM sales_order_serials
          WHERE sales_order_number = $1 AND status = 'attached'
          FOR UPDATE`,
        [soNumber]
    );
    for (const alloc of attachedRes.rows) {
        if (alloc.serial_id) {
            try {
                await inventorySM.backToStock(client, alloc.serial_id, {
                    reason: `Sales order ${soNumber} cancelled (return pickup reset)`,
                    actorUserId: actor?.user_id,
                    actorName: actor?.name,
                });
            } catch (_) { /* tolerate */ }
        }
        if (alloc.qc_ticket_id) {
            await client.query(
                `UPDATE tickets SET status = 'cancelled', updated_at = NOW()
                  WHERE ticket_id = $1 AND status NOT IN ('completed', 'cancelled')`,
                [alloc.qc_ticket_id]
            );
        }
        await client.query(
            `UPDATE sales_order_serials SET status = 'removed', updated_at = NOW() WHERE allocation_id = $1`,
            [alloc.allocation_id]
        );
    }
    await client.query(
        `UPDATE sales_order_lines SET status = 'cancelled' WHERE sales_order_number = $1`,
        [soNumber]
    );
    return { cancelled: true, released: attachedRes.rows.length };
}

exports.cancelReturnPickup = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only support lead can cancel return pickup' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const reason = String(req.body?.reason || req.body?.cancellation_remark || '').trim()
        || 'Return pickup cancelled — will recreate';
    const requestedRdc = String(req.body?.return_dc_number || '').trim() || null;
    const cancelReplacementOrder = req.body?.cancel_replacement_order !== false;
    const force = !!req.body?.force;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const ticketRes = await client.query(
            'SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE',
            [ticketId]
        );
        if (!ticketRes.rows.length) {
            throw Object.assign(new Error('Ticket not found'), { status: 404 });
        }
        const ticket = ticketRes.rows[0];
        const rdc = requestedRdc || ticket.return_dc_number;
        if (!rdc) {
            throw Object.assign(new Error('No Return DC on this ticket'), { status: 400 });
        }

        const dcRes = await client.query(
            `SELECT status, sales_order_number FROM delivery_challan_lines
              WHERE dc_number = $1 AND movement_type = 'return' LIMIT 1`,
            [rdc]
        );
        if (!dcRes.rows.length) {
            throw Object.assign(new Error(`Return DC ${rdc} not found`), { status: 404 });
        }
        const dcStatus = String(dcRes.rows[0].status || '').toLowerCase();
        if (dcStatus === 'cancelled') {
            throw Object.assign(new Error(`Return DC ${rdc} is already cancelled`), { status: 400 });
        }
        if (!force && dcStatus === 'delivered') {
            throw Object.assign(new Error(`Return DC ${rdc} is already delivered — cannot cancel`), { status: 400 });
        }

        const pickupRes = await client.query(
            `SELECT id, status, picked_up_at, warehouse_received_at, customer_otp_verified_at,
                    floor_ticket_id, ttspl_id, unique_serial_number, serial_number, customer_inventory_id
               FROM support_ticket_items
              WHERE ticket_id = $1 AND item_type = 'pickup'
                AND ($2::text IS NULL OR return_dc_number = $2 OR return_dc_number IS NULL)`,
            [ticketId, rdc]
        );
        if (!force) {
            for (const row of pickupRes.rows) {
                if (row.picked_up_at || row.warehouse_received_at || row.customer_otp_verified_at) {
                    throw Object.assign(
                        new Error('Pickup already started or completed — cannot cancel this Return DC'),
                        { status: 400 }
                    );
                }
                if (['resolved', 'closed', 'inventory_updated'].includes(row.status)) {
                    throw Object.assign(
                        new Error('Pickup item is already closed — cannot cancel this Return DC'),
                        { status: 400 }
                    );
                }
            }
        } else {
            await forceRestoreCustomerAssetsOnCancel(client, {
                ticketId,
                customerId: ticket.customer_id,
                items: pickupRes.rows,
                actorUserId: req.user.user_id,
                actorName: req.user.name,
            });
        }

        if (pickupRes.rows.length) {
            await client.query(
                `UPDATE support_ticket_items
                    SET status = 'cancelled',
                        return_dc_number = NULL,
                        assigned_to = NULL,
                        pickup_assigned_to = NULL,
                        pickup_method = NULL,
                        picked_up_at = NULL,
                        warehouse_received_at = NULL,
                        customer_otp_verified_at = NULL,
                        warehouse_received_by = NULL,
                        floor_ticket_id = NULL,
                        updated_at = NOW()
                  WHERE ticket_id = $1 AND item_type = 'pickup'
                    AND ($2::text IS NULL OR return_dc_number = $2 OR id = ANY($3::int[]))`,
                [ticketId, rdc, pickupRes.rows.map((r) => r.id)]
            );
        }

        await client.query(
            `UPDATE delivery_challan_lines
                SET status = 'cancelled', updated_at = NOW()
              WHERE dc_number = $1 AND movement_type = 'return'`,
            [rdc]
        );

        await client.query(
            `UPDATE support_ticket_items
                SET return_dc_number = NULL, updated_at = NOW()
              WHERE ticket_id = $1 AND return_dc_number = $2`,
            [ticketId, rdc]
        );

        let soCancelled = null;
        if (cancelReplacementOrder) {
            try {
                await client.query(
                    `UPDATE support_replacement_orders
                        SET status = 'cancelled'
                      WHERE ticket_id = $1 AND status NOT IN ('completed', 'cancelled')`,
                    [ticketId]
                );
            } catch (replacementErr) {
                if (replacementErr.code !== '42P01') throw replacementErr;
            }

            await client.query(
                `UPDATE support_ticket_items
                    SET status = 'cancelled', updated_at = NOW()
                  WHERE ticket_id = $1 AND item_type = 'replacement'
                    AND status NOT IN ('resolved', 'closed', 'inventory_updated', 'cancelled')`,
                [ticketId]
            );

            const soNumber = ticket.sales_order_number || null;
            if (soNumber) {
                soCancelled = await cancelReplacementSalesOrder(client, soNumber, req.user);
            }

            const srcRes = await client.query(
                `SELECT DISTINCT COALESCE(complaint_item_id, source_item_id) AS complaint_id
                   FROM support_replacement_orders
                  WHERE ticket_id = $1 AND COALESCE(complaint_item_id, source_item_id) IS NOT NULL`,
                [ticketId]
            );
            const complaintIds = srcRes.rows.map((r) => r.complaint_id).filter(Boolean);
            if (complaintIds.length) {
                await client.query(
                    `UPDATE support_ticket_items
                        SET outcome = COALESCE(outcome, 'replacement_required'),
                            replacement_approved_by = NULL,
                            replacement_approved_at = NULL,
                            updated_at = NOW()
                      WHERE id = ANY($1::int[]) AND item_type = 'complaint'`,
                    [complaintIds]
                );
            } else {
                await client.query(
                    `UPDATE support_ticket_items
                        SET outcome = COALESCE(outcome, 'replacement_required'),
                            replacement_approved_by = NULL,
                            replacement_approved_at = NULL,
                            updated_at = NOW()
                      WHERE ticket_id = $1 AND item_type = 'complaint'
                        AND status NOT IN ('resolved', 'closed', 'inventory_updated', 'cancelled')`,
                    [ticketId]
                );
            }
        }

        await client.query(
            `UPDATE support_tickets
                SET return_dc_number = NULL,
                    sales_order_number = CASE WHEN $2 THEN NULL ELSE sales_order_number END,
                    updated_at = NOW()
              WHERE id = $1`,
            [ticketId, cancelReplacementOrder]
        );

        if (force) {
            const nonPickupRes = await client.query(
                `SELECT COUNT(*)::int AS n FROM support_ticket_items
                  WHERE ticket_id = $1 AND item_type <> 'pickup' AND status <> 'cancelled'`,
                [ticketId]
            );
            if (Number(nonPickupRes.rows[0]?.n || 0) === 0) {
                await ensureSupportTicketCancellationColumns(client);
                await client.query(
                    `UPDATE support_tickets
                        SET status = $2, cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $3,
                            cancellation_remark = $4, return_dc_number = NULL, updated_at = CURRENT_TIMESTAMP
                      WHERE id = $1`,
                    [ticketId, TICKET_CANCELLED, req.user.user_id, reason]
                );
            }
        }

        await logAudit(client, {
            ticketId,
            userId: req.user.user_id,
            action: 'return_pickup_cancelled',
            detail: {
                return_dc_number: rdc,
                reason,
                cancel_replacement_order: cancelReplacementOrder,
                sales_order_cancelled: soCancelled?.cancelled || false,
            },
        });
        await bumpTicketActivity(client, ticketId);
        await client.query('COMMIT');

        const data = await getTicketWithItems(ticketId, req.user);
        return res.json({
            success: true,
            message: `Return DC ${rdc} cancelled. You can create a new replacement or pickup.`,
            return_dc_number: rdc,
            sales_order_released: soCancelled?.released || 0,
            ...data,
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('cancelReturnPickup:', e);
        return res.status(e.status || 400).json({
            success: false,
            message: e.message || 'Failed to cancel return pickup',
        });
    } finally {
        client.release();
    }
};

/** Assign technician / courier / porter to an existing Return DC (created without dispatch). */
exports.assignReturnPickupDispatch = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only support lead can assign pickup' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    try {
        const result = await applyReturnPickupAssignment({
            ticketId,
            body: req.body || {},
            allowChange: false,
        });
        if (!result.ok) {
            return res.status(result.status || 400).json({ success: false, message: result.message });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const pickupItem = await client.query(
                `SELECT id FROM support_ticket_items
                  WHERE ticket_id = $1 AND item_type = 'pickup' LIMIT 1`,
                [ticketId]
            );
            await logAudit(client, {
                itemId: pickupItem.rows[0]?.id || null,
                ticketId,
                userId: req.user.user_id,
                action: 'return_pickup_assigned',
                detail: {
                    return_dc_number: result.data.return_dc_number,
                    dispatch_mode: result.data.dispatch_mode,
                    previous_assignee: 'Unassigned',
                    new_assignee: result.data.new_assignee,
                    new_dispatch_mode: result.data.dispatch_mode,
                },
            });
            await bumpTicketActivity(client, ticketId);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        try { await regenerateReturnDcPdfByRdc(pool, result.data.return_dc_number); } catch (pdfErr) {
            console.error('[support] return DC pdf (assign):', pdfErr.message);
        }

        const data = await getTicketWithItems(ticketId, req.user);
        res.json({
            success: true,
            message: 'Return pickup assigned',
            return_dc_number: result.data.return_dc_number,
            dispatch_mode: result.data.dispatch_mode,
            ...data,
        });
    } catch (e) {
        console.error('assignReturnPickupDispatch:', e);
        return res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to assign pickup' });
    }
};

/** Change return pickup assignee before pickup starts (technician / courier / porter). */
exports.changeReturnPickupAssignment = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only support lead can change pickup assignment' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    try {
        const result = await applyReturnPickupAssignment({
            ticketId,
            body: req.body || {},
            allowChange: true,
        });
        if (!result.ok) {
            return res.status(result.status || 400).json({ success: false, message: result.message });
        }

        const { previousLabel, newLabel, previousMeta, nextMeta, reason, return_dc_number } = result.activity;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const pickupItem = await client.query(
                `SELECT id FROM support_ticket_items
                  WHERE ticket_id = $1 AND item_type = 'pickup' AND return_dc_number = $2
                  LIMIT 1`,
                [ticketId, return_dc_number]
            );
            await logAudit(client, {
                itemId: pickupItem.rows[0]?.id || null,
                ticketId,
                userId: req.user.user_id,
                action: 'return_pickup_assignee_changed',
                detail: {
                    return_dc_number,
                    previous_assignee: previousLabel,
                    new_assignee: newLabel,
                    previous_dispatch_mode: previousMeta.dispatch_mode,
                    new_dispatch_mode: nextMeta.dispatch_mode,
                    reason,
                },
            });
            await bumpTicketActivity(client, ticketId);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        try { await regenerateReturnDcPdfByRdc(pool, return_dc_number); } catch (pdfErr) {
            console.error('[support] return DC pdf (change assignee):', pdfErr.message);
        }

        const data = await getTicketWithItems(ticketId, req.user);
        res.json({
            success: true,
            message: 'Pickup assignee updated',
            data: result.data,
            ...data,
        });
    } catch (e) {
        console.error('changeReturnPickupAssignment:', e);
        return res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to update pickup assignee' });
    }
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
    const orderCheck = await pool.query('SELECT sales_order_number, dc_number FROM support_replacement_orders WHERE id = $1', [orderId]);
    if (orderCheck.rows[0]?.sales_order_number && orderCheck.rows[0]?.dc_number) {
        return res.status(400).json({
            success: false,
            message: 'This replacement uses the sales delivery flow. Complete delivery via My Deliveries / Delivery Register on the outbound DC.',
        });
    }
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
            pickupType: (req.query.pickup_type || '').trim(),
            limit: 500,
            offset: 0,
            closedDays: 365
        });
        const header = ['Ticket ID', 'Customer', 'Phone', 'Machines', 'Types', 'Pickup kind', 'Status', 'Technicians', 'Created', 'Last updated', 'Resolved'];
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
                JSON.stringify(t.pickup_kind_label || ''),
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

exports.getServiceDcEligibility = async (req, res) => {
    try {
        const ticketId = parseInt(req.params.ticketId, 10);
        const ctx = await supportServiceDcService.getServiceDcContext(pool, ticketId);
        res.json({ success: true, ...ctx });
    } catch (e) {
        res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to load service DC eligibility' });
    }
};

exports.createServiceDc = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only support lead can create Service Delivery Challan' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const client = await pool.connect();
    let result;
    try {
        await client.query('BEGIN');
        result = await supportServiceDcService.createServiceDc(client, {
            ticketId,
            itemIds: req.body?.item_ids,
            dispatch: req.body || {},
            actor: req.user,
        });
        const pickupItemId = result.item_ids?.[0] || null;
        await logAudit(client, {
            itemId: pickupItemId,
            ticketId,
            userId: req.user.user_id,
            action: 'service_dc_created',
            detail: {
                service_dc_number: result.sdcNumber,
                sales_order_number: result.sales_order_number,
                original_dc_number: result.original_dc_number,
                item_ids: result.item_ids,
                dispatch_mode: result.dispatch_mode,
            },
        });
        await bumpTicketActivity(client, ticketId);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('createServiceDc:', e);
        return res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to create Service DC' });
    } finally {
        client.release();
    }
    try {
        await regenerateServiceDcPdfByNumber(pool, result.sdcNumber);
    } catch (pdfErr) {
        console.error('[support] service DC pdf:', pdfErr.message);
    }
    const data = await getTicketWithItems(ticketId, req.user);
    res.json({
        success: true,
        message: 'Service Delivery Challan created',
        service_dc_number: result.sdcNumber,
        ...data,
    });
};

exports.getRepairSwapContext = async (req, res) => {
    try {
        const ticketId = parseInt(req.params.ticketId, 10);
        const ctx = await replacementFlow.buildRepairSwapContext(pool, ticketId);
        res.json({ success: true, ...ctx });
    } catch (e) {
        res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to load repair swap context' });
    }
};

exports.initiateRepairSwap = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only support lead can initiate a repair swap' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const body = req.body || {};
    const client = await pool.connect();
    let resultPayload = {};
    try {
        await ensureSupportTicketItemV3Columns(client);
        await ensureDeliveryChallanReplacementColumns(client);
        await client.query('BEGIN');

        const addr = body.pickup_address && typeof body.pickup_address === 'object' ? body.pickup_address : {};
        const shippingAddress = {
            name: body.contact_name || addr.name || '',
            phone: body.contact_phone || addr.phone || '',
            address: addr.address || '',
            city: addr.city || '',
            state: addr.state || '',
            pincode: addr.pincode || '',
        };

        resultPayload = await replacementFlow.initiateSwapFromRepairPickup(client, {
            ticketId,
            pickupItemIds: body.pickup_item_ids,
            reason: body.reason,
            shippingAddress,
            userId: req.user.user_id,
        });

        await logAudit(client, {
            ticketId,
            userId: req.user.user_id,
            action: 'repair_swap_initiated',
            detail: {
                sales_order_number: resultPayload.sales_order_number,
                return_dc_number: resultPayload.return_dc_number,
                pickup_item_ids: resultPayload.pickup_item_ids,
                unit_count: resultPayload.unit_count,
            },
        });
        await bumpTicketActivity(client, ticketId);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(e.status || 400).json({ success: false, message: e.message || 'Failed to initiate repair swap' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(ticketId, req.user);
    res.json({
        success: true,
        message: 'Replacement swap started — attach a different laptop to the sales order',
        ...resultPayload,
        ...data,
    });
};

exports.getResendLaptopContext = async (req, res) => {
    try {
        const ticketId = parseInt(req.params.ticketId, 10);
        const ctx = await replacementFlow.buildResendLaptopContext(pool, ticketId);
        res.json({ success: true, ...ctx });
    } catch (e) {
        res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to load resend context' });
    }
};

exports.initiateResendLaptop = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only support lead can resend a replacement laptop' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const { reason } = req.body || {};
    const client = await pool.connect();
    let resultPayload = {};
    try {
        await client.query('BEGIN');
        resultPayload = await replacementFlow.initiateResendLaptop(client, ticketId, req.user.user_id, { reason });
        await logAudit(client, {
            ticketId,
            userId: req.user.user_id,
            action: 'replacement_resend_initiated',
            detail: {
                sales_order_number: resultPayload.sales_order_number,
                reason: resultPayload.reason,
                detached_serial_count: resultPayload.detached_serial_count,
                backfilled_order_count: resultPayload.backfilled_order_count,
                ticket_reopened: resultPayload.ticket_reopened,
            },
        });
        await bumpTicketActivity(client, ticketId);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(e.status || 400).json({ success: false, message: e.message || 'Failed to prepare resend' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(ticketId, req.user);
    res.json({
        success: true,
        message: 'Ready to resend replacement laptop — attach a new unit on the sales order',
        ...resultPayload,
        ...data,
    });
};

exports.getReturnRedeliveryContext = async (req, res) => {
    try {
        const ticketId = parseInt(req.params.ticketId, 10);
        const ctx = await replacementFlow.buildReturnRedeliveryContext(pool, ticketId);
        res.json({ success: true, ...ctx });
    } catch (e) {
        res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to load replacement context' });
    }
};

exports.initiateReturnRedelivery = async (req, res) => {
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Only support lead can create a replacement order' });
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    const body = req.body || {};
    const client = await pool.connect();
    let resultPayload = {};
    try {
        await ensureSupportTicketItemV3Columns(client);
        await client.query('BEGIN');

        const addr = body.pickup_address && typeof body.pickup_address === 'object' ? body.pickup_address : {};
        const shippingAddress = {
            name: body.contact_name || addr.name || '',
            phone: body.contact_phone || addr.phone || '',
            address: addr.address || '',
            city: addr.city || '',
            state: addr.state || '',
            pincode: addr.pincode || '',
        };

        resultPayload = await replacementFlow.initiateReturnRedelivery(client, {
            ticketId,
            pickupItemIds: body.pickup_item_ids,
            reason: body.reason,
            shippingAddress,
            userId: req.user.user_id,
        });

        await logAudit(client, {
            ticketId,
            userId: req.user.user_id,
            action: 'replacement_order_created',
            detail: {
                sales_order_number: resultPayload.sales_order_number,
                previous_sales_order_number: resultPayload.previous_sales_order_number,
                return_dc_number: resultPayload.return_dc_number,
                pickup_item_ids: resultPayload.pickup_item_ids,
                unit_count: resultPayload.unit_count,
            },
        });
        await bumpTicketActivity(client, ticketId);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(e.status || 400).json({ success: false, message: e.message || 'Failed to create replacement order' });
    } finally {
        client.release();
    }
    const data = await getTicketWithItems(ticketId, req.user);
    res.json({
        success: true,
        message: `New replacement sales order ${resultPayload.sales_order_number} created`,
        ...resultPayload,
        ...data,
    });
};

exports.regenerateServiceDcPdf = async (req, res) => {
    const sdcNumber = decodeURIComponent(req.params.sdcNumber || '');
    try {
        const pdfPath = await regenerateServiceDcPdfByNumber(pool, sdcNumber);
        if (!pdfPath) {
            return res.status(404).json({ success: false, message: 'Service DC not found' });
        }
        res.json({ success: true, pdf_path: pdfPath });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message || 'PDF generation failed' });
    }
};

exports.ensureSupportSchema = async () => {
    const files = [
        '025_support_module.sql',
        '026_support_redesign.sql',
        '027_support_v2.sql',
        '028_support_user_roles.sql',
        '029_support_v3.sql',
        '031_support_ticket_category.sql',
        '068_phase6_support_customer_portal.sql',
        '096_support_v3_columns.sql',
        '097_support_phase18.sql',
        '098_support_parts_bucket.sql',
        '099_support_parts_reassign.sql',
        '106_support_delivery_technician_permissions.sql',
        '113_support_replacement_flow.sql',
        '114_support_replacement_so_line.sql',
        '117_support_ticket_cancellation.sql',
        '138_support_ticket_items_processor.sql',
    ];
    for (const file of files) {
        const sqlPath = path.join(__dirname, '../migrations', file);
        if (fs.existsSync(sqlPath)) {
            const sql = fs.readFileSync(sqlPath, 'utf8');
            await pool.query(sql);
        }
    }
};
