/**
 * Single source of truth for "a rented unit has been picked up / returned".
 * Called from every pickup-completion path:
 *   - Return DC POD completion (technician submitDeliveryWithPod / admin override
 *     -> salesManagementController.finalizeDeliveryInventory)
 *   - courier/porter Return DC POD (deliveryRegisterController.submitPod)
 *   - legacy support pickup OTP (supportController.verifyOtp)
 *
 * For each serial: mark returned (rent stops) -> reset qc_status so it shows in
 * "QC Process Laptops" -> create the return_qc floor ticket -> raise the prepaid
 * credit note linked to the unit + ticket. Optionally resolves the support pickup.
 */
const inventorySM = require('./inventoryStateMachine');
const replacementFlow = require('./supportReplacementFlowService');
const billing = require('./billingSchedulerService');
const { createTicketFromReturn } = require('./grnTicketService');
const {
  isRepairPickupItem,
  removeRepairPickupFromCustomer,
} = require('./repairPickupInventoryService');

async function findPickupItemForSerial(db, { serialRow, supportTicketId, dcNumber }) {
  if (!supportTicketId && !dcNumber) return null;
  const code = serialRow.inventory_asset_code || serialRow.extra?.ttspl_id || serialRow.serial_number;
  const params = [code];
  let sql = `
    SELECT sti.*
      FROM support_ticket_items sti
     WHERE sti.item_type = 'pickup'
       AND (
         sti.ttspl_id = $1
         OR sti.unique_serial_number = $1
         OR sti.serial_number = $1
       )
  `;
  if (supportTicketId) {
    params.push(supportTicketId);
    sql += ` AND sti.ticket_id = $${params.length}`;
  }
  if (dcNumber) {
    params.push(dcNumber);
    sql += ` AND sti.return_dc_number = $${params.length}`;
  }
  sql += ' ORDER BY sti.id ASC LIMIT 1';
  const r = await db.query(sql, params);
  return r.rows[0] || null;
}

async function markRepairPickupPickedUp(db, item, actorUserId, actorName) {
  const out = await removeRepairPickupFromCustomer(db, item, {
    user_id: actorUserId,
    name: actorName,
  });
  await db.query(
    `UPDATE support_ticket_items
        SET picked_up_at = COALESCE(picked_up_at, NOW()),
            customer_otp_verified_at = COALESCE(customer_otp_verified_at, NOW()),
            status = CASE
              WHEN status IN ('resolved', 'closed', 'inventory_updated', 'awaiting_service_return') THEN status
              ELSE 'picked_up'
            END,
            updated_at = NOW()
      WHERE id = $1`,
    [item.id]
  );
  return { itemId: item.id, repair_pickup: true, ...out };
}

async function finalizeSupportPickupTicket(db, supportTicketId, dcNumber) {
  if (!supportTicketId) return;

  const replRes = await replacementFlow.onReplacementReturnPickedUp(db, {
    supportTicketId,
    returnDcNumber: dcNumber,
  });
  if (replRes.handled) {
    await db.query(
      `UPDATE support_ticket_items
          SET picked_up_at = COALESCE(picked_up_at, NOW()),
              status = CASE WHEN status = 'inventory_updated' THEN status ELSE 'picked_up' END,
              updated_at = NOW()
        WHERE ticket_id = $1 AND item_type = 'pickup'
          AND return_dc_number = $2`,
      [supportTicketId, dcNumber]
    );
    await db.query(
      `UPDATE support_tickets SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [supportTicketId]
    );
    return;
  }

  await db.query(
    `UPDATE support_ticket_items
        SET status = 'resolved',
            picked_up_at = COALESCE(picked_up_at, NOW()),
            resolved_at  = COALESCE(resolved_at, NOW()),
            updated_at = NOW()
      WHERE ticket_id = $1 AND item_type = 'pickup'
        AND status NOT IN ('resolved', 'closed', 'inventory_updated', 'awaiting_service_return')
        AND COALESCE(pickup_type, CASE WHEN source_item_id IS NOT NULL THEN 'repair' END) <> 'repair'`,
    [supportTicketId]
  );
  await db.query(
    `UPDATE support_tickets
        SET status = CASE WHEN NOT EXISTS (
              SELECT 1 FROM support_ticket_items
               WHERE ticket_id = $1
                 AND status NOT IN ('resolved', 'closed', 'inventory_updated', 'awaiting_service_return')
            ) THEN 'closed' ELSE 'in_progress' END,
            last_activity_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [supportTicketId]
  );
}

async function processReturnedSerials(db, {
  serialIds = [],
  dcNumber = null,
  supportTicketId = null,
  customerLabel = null,
  actorUserId = null,
  actorName = null,
} = {}) {
  const results = [];

  for (const serialId of serialIds) {
    const r = await db.query(
      `SELECT serial_id, serial_number, inventory_asset_code, inventory_status,
              current_customer_id, current_dc_number, extra
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [serialId]
    );
    const s = r.rows[0];
    if (!s) { results.push({ serialId, skipped: true, reason: 'not_found' }); continue; }

    const pickupItem = await findPickupItemForSerial(db, {
      serialRow: s,
      supportTicketId,
      dcNumber,
    });
    if (pickupItem && isRepairPickupItem(pickupItem)) {
      results.push(await markRepairPickupPickedUp(db, pickupItem, actorUserId, actorName));
      continue;
    }

    if (!['rented', 'on_demo', 'sold'].includes(s.inventory_status)) {
      results.push({ serialId, skipped: true, reason: s.inventory_status });
      continue;
    }

    const wasRented = s.inventory_status === 'rented';
    const warehouseReceivedAt = pickupItem?.warehouse_received_at
      ? new Date(pickupItem.warehouse_received_at)
      : null;
    const returnDate = warehouseReceivedAt || new Date();
    await inventorySM.markReturned(db, serialId, {
      reason: dcNumber ? `Picked up via Return DC ${dcNumber}` : 'Picked up (customer return)',
      rentEndDate: returnDate, actorUserId, actorName,
    });

    // Re-enter QC so it appears in "QC Process Laptops" (qc_status <> 'passed').
    await db.query(
      `UPDATE vendor_serial_numbers SET qc_status = 'pending', updated_at = NOW() WHERE serial_id = $1`,
      [serialId]
    );

    const extra = s.extra || {};
    let label = customerLabel;
    if (!label && s.current_customer_id) {
      const c = await db.query(`SELECT company_name, name FROM customers WHERE customer_id = $1`, [s.current_customer_id]);
      label = c.rows[0]?.company_name || c.rows[0]?.name || null;
    }

    const tk = await createTicketFromReturn(db, {
      serialId,
      serialNumber: s.serial_number,
      inventoryAssetCode: s.inventory_asset_code || extra.ttspl_id,
      customerLabel: label,
      dcNumber: dcNumber || s.current_dc_number || null,
      reason: 'Customer return',
      specs: {
        brand: extra.brand, model: extra.model || extra.model_name,
        processor: extra.processor, ram: extra.ram, storage: extra.storage,
      },
      actorUserId,
    });
    const returnTicketId = tk && tk.ok ? tk.ticket_id : null;

    let creditNote = null;
    // Unused prepaid days are credited from warehouse received date, not
    // pickup/created date. Invoice generate creates the CN when warehouse
    // receipt is recorded later.
    if (wasRented && warehouseReceivedAt) {
      creditNote = await billing.createReturnCreditNote(db, {
        serialId, returnDate: warehouseReceivedAt, returnTicketId, actorUserId,
        supportTicketId, returnDcNumber: dcNumber,
      });
    }
    results.push({
      serialId, ttspl_id: s.inventory_asset_code || extra.ttspl_id || null,
      returnTicketId, creditNote: creditNote ? creditNote.credit_note_number : null,
    });
  }

  if (supportTicketId) {
    await finalizeSupportPickupTicket(db, supportTicketId, dcNumber);
  }

  return results;
}

module.exports = { processReturnedSerials };
