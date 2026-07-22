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
    if (!['rented', 'on_demo', 'sold'].includes(s.inventory_status)) {
      results.push({ serialId, skipped: true, reason: s.inventory_status });
      continue;
    }

    const wasRented = s.inventory_status === 'rented';
    const returnDate = new Date();
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
    if (wasRented) {
      creditNote = await billing.createReturnCreditNote(db, {
        serialId, returnDate, returnTicketId, actorUserId,
      });
    }
    results.push({
      serialId, ttspl_id: s.inventory_asset_code || extra.ttspl_id || null,
      returnTicketId, creditNote: creditNote ? creditNote.credit_note_number : null,
    });
  }

  // Resolve the originating support pickup ticket (if any) once all units processed.
  if (supportTicketId) {
    const replRes = await replacementFlow.onReplacementReturnPickedUp(db, {
      supportTicketId,
      returnDcNumber: dcNumber,
    });
    if (!replRes.handled) {
      await db.query(
        `UPDATE support_ticket_items
            SET status = 'resolved',
                picked_up_at = COALESCE(picked_up_at, NOW()),
                resolved_at  = COALESCE(resolved_at, NOW()),
                updated_at = NOW()
          WHERE ticket_id = $1 AND item_type = 'pickup'
            AND status NOT IN ('resolved', 'closed', 'inventory_updated')`,
        [supportTicketId]
      );
      await db.query(
        `UPDATE support_tickets
            SET status = CASE WHEN NOT EXISTS (
                  SELECT 1 FROM support_ticket_items
                   WHERE ticket_id = $1 AND status NOT IN ('resolved', 'closed', 'inventory_updated')
                ) THEN 'closed' ELSE status END,
                last_activity_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [supportTicketId]
      );
    } else {
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
    }
  }

  return results;
}

module.exports = { processReturnedSerials };
