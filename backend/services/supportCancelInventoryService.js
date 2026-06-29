/**
 * When a support pickup ticket is cancelled before warehouse receipt, the laptop
 * must remain with the customer. This reverts any premature return-side inventory
 * moves (returned / in_stock + QC pending) without creating new movements.
 */
const inventorySM = require('./inventoryStateMachine');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('./customerDeployedAssets');
const { logTtsplEvent } = require('./ttsplAuditService');
const supportInventoryService = require('./supportInventoryService');

const WAREHOUSE_COMPLETE_STATUSES = new Set(['inventory_updated']);

function wasWarehouseReceived(item) {
    return !!item.warehouse_received_at || WAREHOUSE_COMPLETE_STATUSES.has(item.status);
}

async function resolveDeployedStatus(client, customerId, code) {
    const r = await client.query(
        `SELECT COALESCE(sol.quotation_type, sq.quotation_type, 'rental') AS quotation_type
           FROM delivery_challan_lines dcl
           LEFT JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
           LEFT JOIN sales_quotations sq ON sq.quotation_number = sol.quotation_number
          WHERE dcl.movement_type = 'outbound'
            AND dcl.customer_id = $1
            AND dcl.serial_number::text ILIKE '%' || $2 || '%'
          ORDER BY dcl.created_at DESC NULLS LAST
          LIMIT 1`,
        [customerId, code]
    );
    return inventorySM.deliveredStatusForType(r.rows[0]?.quotation_type || 'rental');
}

async function loadSerialRow(client, code) {
    const r = await client.query(
        `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, qc_status,
                current_customer_id, current_dc_number, extra
           FROM vendor_serial_numbers
          WHERE deleted_at IS NULL
            AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
          LIMIT 1`,
        [code]
    );
    return r.rows[0] || null;
}

function shouldPreserveCustomerAssignment(item, serial, customerId) {
    if (!serial || wasWarehouseReceived(item)) return false;
    if (!serial.current_customer_id || Number(serial.current_customer_id) !== Number(customerId)) {
        return false;
    }

    const deployedStatuses = new Set(DEPLOYED_WITH_CUSTOMER_STATUSES);
    const inWarehousePool = ['returned', 'in_stock'].includes(serial.inventory_status);
    const qcStillWithCustomer = serial.qc_status === 'pending'
        && (deployedStatuses.has(serial.inventory_status) || inWarehousePool);

    if (inWarehousePool) return true;
    if (qcStillWithCustomer) return true;
    return false;
}

async function cancelPrematureReturnQcTickets(client, serialId) {
    await client.query(
        `UPDATE tickets
            SET status = 'cancelled', updated_at = NOW()
          WHERE vendor_serial_id = $1
            AND ticket_type = 'return_qc'
            AND status IN ('in_progress', 'on_hold')`,
        [serialId]
    );
}

async function restoreSerialToCustomer(client, {
    serial,
    targetStatus,
    ticketId,
    itemId,
    actorUserId,
    actorName,
}) {
    const from = serial.inventory_status;
    const fromQc = serial.qc_status;
    const ttsplId = serial.inventory_asset_code || serial.extra?.ttspl_id || serial.serial_number;
    const reason = `Support ticket #${ticketId} cancelled — unit not received at warehouse; customer assignment preserved`;

    await client.query(
        `UPDATE vendor_serial_numbers
            SET inventory_status = $2,
                qc_status = 'passed',
                returned_at = NULL,
                rent_end_date = NULL,
                updated_at = NOW()
          WHERE serial_id = $1`,
        [serial.serial_id, targetStatus]
    );

    await client.query(
        `INSERT INTO inventory_status_transitions
            (serial_id, ttspl_id, from_status, to_status, reason, customer_id, actor_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [serial.serial_id, ttsplId, from, targetStatus, reason, serial.current_customer_id, actorUserId]
    );

    await logTtsplEvent({
        ttsplId,
        vendorSerialId: serial.serial_id,
        eventType: 'support_cancel_preserve',
        description: reason,
        metadata: {
            from,
            to: targetStatus,
            from_qc: fromQc,
            to_qc: 'passed',
            support_ticket_id: ticketId,
            support_item_id: itemId,
        },
        actorUserId,
        actorName,
        db: client,
    });

    return { code: ttsplId, from, to: targetStatus, from_qc: fromQc, to_qc: 'passed' };
}

/**
 * Keep laptops with the customer when a support pickup ticket is cancelled before
 * warehouse receipt. Does nothing once the return workflow has completed inward.
 */
async function preserveCustomerAssetsOnCancel(client, {
    ticketId,
    customerId,
    items,
    actorUserId,
    actorName,
}) {
    const preserved = [];

    for (const item of items || []) {
        if (item.item_type !== 'pickup') continue;

        const code = item.unique_serial_number || item.ttspl_id || item.serial_number;
        if (!code) continue;

        const serial = await loadSerialRow(client, code);
        if (!shouldPreserveCustomerAssignment(item, serial, customerId)) continue;

        const targetStatus = await resolveDeployedStatus(client, customerId, code);
        const result = await restoreSerialToCustomer(client, {
            serial,
            targetStatus,
            ticketId,
            itemId: item.id,
            actorUserId,
            actorName,
        });

        await cancelPrematureReturnQcTickets(client, serial.serial_id);

        if (item.customer_inventory_id) {
            await supportInventoryService.activateAsset(client, item.customer_inventory_id);
        }

        preserved.push(result);
    }

    return preserved;
}

module.exports = {
    wasWarehouseReceived,
    preserveCustomerAssetsOnCancel,
};
