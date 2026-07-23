/**
 * Repair pickup lifecycle: remove the unit from the customer's deployed fleet when
 * picked up, pause billing (no credit note), keep the support ticket open until
 * the same unit is sent back via Service Delivery Challan (SDC).
 */
const inventorySM = require('./inventoryStateMachine');
const { passivateAsset } = require('./supportInventoryService');

const AWAITING_SDC_STATUS = 'awaiting_service_return';

function isRepairPickupItem(item) {
  if (!item || item.item_type !== 'pickup') return false;
  const pickupType = item.pickup_type || (item.source_item_id ? 'repair' : 'return');
  return pickupType === 'repair';
}

async function resolveSerialForItem(client, item) {
  const code = item.ttspl_id || item.unique_serial_number || item.serial_number;
  if (!code) return null;
  const r = await client.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status,
            current_customer_id, rent_end_date, extra
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
        serial_id ASC
      LIMIT 1`,
    [code]
  );
  return r.rows[0] || null;
}

/**
 * Remove a repair-pickup unit from the customer's fleet when the laptop is picked
 * up from site (customer OTP) or when a courier Return DC POD completes.
 * Idempotent — safe to call more than once.
 */
async function removeRepairPickupFromCustomer(client, item, actor = {}) {
  if (!isRepairPickupItem(item)) {
    return { skipped: true, reason: 'not_repair_pickup' };
  }

  const serial = await resolveSerialForItem(client, item);
  if (!serial) {
    return { skipped: true, reason: 'serial_not_found' };
  }

  const deployed = ['rented', 'on_demo', 'sold', 'out_stock'].includes(serial.inventory_status);
  const alreadyRemoved = !serial.current_customer_id
    && ['returned', 'in_stock', 'in_repair'].includes(serial.inventory_status);

  if (alreadyRemoved && serial.rent_end_date) {
    return { skipped: true, reason: 'already_removed', serialId: serial.serial_id };
  }

  if (deployed) {
    await inventorySM.markReturned(client, serial.serial_id, {
      reason: `Repair pickup from customer (support item #${item.id})`,
      rentEndDate: new Date(),
      actorUserId: actor.user_id || actor.userId || null,
      actorName: actor.name || null,
    });
  }

  await client.query(
    `UPDATE vendor_serial_numbers
        SET current_customer_id = NULL,
            current_dc_number = NULL,
            updated_at = NOW()
      WHERE serial_id = $1`,
    [serial.serial_id]
  );

  if (item.customer_inventory_id) {
    await passivateAsset(client, {
      inventoryId: item.customer_inventory_id,
      reason: 'Repair pickup — unit with service team',
    });
  }

  return { removed: true, serialId: serial.serial_id };
}

async function ticketHasRepairAwaitingSdc(client, ticketId) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM support_ticket_items sti
       LEFT JOIN delivery_challan_lines dcl
         ON dcl.dc_number = sti.service_dc_number
        AND dcl.movement_type = 'outbound'
        AND dcl.dc_purpose = 'service_return'
      WHERE sti.ticket_id = $1
        AND sti.item_type = 'pickup'
        AND COALESCE(sti.pickup_type, CASE WHEN sti.source_item_id IS NOT NULL THEN 'repair' END) = 'repair'
        AND (
          sti.status = $2
          OR (
            sti.service_dc_number IS NOT NULL
            AND COALESCE(dcl.status, '') <> 'delivered'
          )
        )`,
    [ticketId, AWAITING_SDC_STATUS]
  );
  return (r.rows[0]?.n || 0) > 0;
}

module.exports = {
  AWAITING_SDC_STATUS,
  isRepairPickupItem,
  resolveSerialForItem,
  removeRepairPickupFromCustomer,
  ticketHasRepairAwaitingSdc,
};
