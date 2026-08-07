/**
 * Inventory moves during support return pickup (customer → warehouse).
 *
 * - Technician / in-house: tracked via the technician bucket until warehouse receipt.
 * - Courier / porter: after customer OTP, mark in_transit until warehouse receipt.
 */
const inventorySM = require('./inventoryStateMachine');
const { logTtsplEvent } = require('./ttsplAuditService');
const { isRepairPickupItem } = require('./repairPickupInventoryService');

const COURIER_PICKUP_METHODS = new Set(['courier', 'porter']);

/**
 * After customer OTP on a return pickup (non-repair), courier/porter units are
 * en route to the warehouse — reflect that in authoritative inventory.
 */
async function markReturnPickupInTransit(client, pickupItem, actor = {}) {
  if (isRepairPickupItem(pickupItem)) return { skipped: true, reason: 'repair_pickup' };

  const method = String(pickupItem.pickup_method || '').toLowerCase();
  if (!COURIER_PICKUP_METHODS.has(method)) {
    return { skipped: true, reason: 'technician_bucket' };
  }

  const code = pickupItem.ttspl_id || pickupItem.unique_serial_number || pickupItem.serial_number;
  if (!code) return { skipped: true, reason: 'no_code' };

  const r = await client.query(
    `SELECT serial_id, inventory_asset_code, inventory_status, current_customer_id, current_dc_number
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
      LIMIT 1`,
    [code]
  );
  const serial = r.rows[0];
  if (!serial) return { skipped: true, reason: 'not_found' };

  const from = serial.inventory_status;
  if (from === inventorySM.STATUS.IN_TRANSIT) {
    return { skipped: true, reason: 'already_in_transit', serial_id: serial.serial_id };
  }
  if (!['rented', 'on_demo', 'sold', 'out_stock'].includes(from)) {
    return { skipped: true, reason: from, serial_id: serial.serial_id };
  }

  const returnDc = pickupItem.return_dc_number || null;
  const ttsplId = serial.inventory_asset_code || code;
  const reason = returnDc
    ? `Return pickup in transit to warehouse via ${returnDc}`
    : 'Return pickup in transit to warehouse';

  await inventorySM.transitionAsset(client, {
    serialId: serial.serial_id,
    toStatus: inventorySM.STATUS.IN_TRANSIT,
    dcNumber: returnDc,
    reason,
    actorUserId: actor.user_id || null,
    actorName: actor.name || 'Support return pickup',
    allowOverride: true,
  });

  await client.query(
    `UPDATE vendor_serial_numbers
        SET current_customer_id = NULL,
            updated_at = NOW()
      WHERE serial_id = $1`,
    [serial.serial_id]
  );

  await logTtsplEvent({
    ttsplId,
    vendorSerialId: serial.serial_id,
    eventType: 'support_return_pickup_in_transit',
    description: reason,
    metadata: {
      from,
      return_dc_number: returnDc,
      pickup_item_id: pickupItem.id,
      pickup_method: method,
    },
    actorUserId: actor.user_id || null,
    actorName: actor.name || null,
    db: client,
  });

  return { ok: true, from, to: inventorySM.STATUS.IN_TRANSIT, serial_id: serial.serial_id, ttspl_id: ttsplId };
}

module.exports = {
  COURIER_PICKUP_METHODS,
  markReturnPickupInTransit,
};
