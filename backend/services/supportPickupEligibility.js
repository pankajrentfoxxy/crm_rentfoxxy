'use strict';

/** Canonical repair/return pickup eligibility. Do not redeclare this list. */
const PICKUP_ELIGIBLE_STATUSES = Object.freeze(['rented', 'on_demo', 'sold', 'out_stock']);

function isPickupEligibleStatus(status) {
  return PICKUP_ELIGIBLE_STATUSES.includes(String(status || ''));
}

const OPEN_PICKUP_STATUSES = `('DRAFT','PENDING_ASSIGNMENT','ASSIGNED','ACCEPTED','EN_ROUTE','ON_SITE','IN_PROGRESS')`;

/**
 * A leftover migrated pickup must not block a new job after the laptop
 * moved to another customer, was returned, or the old ticket was closed.
 */
async function findBlockingOpenPickup(db, serialId, excludeWoId) {
  const r = await db.query(
    `SELECT w.wo_id, w.wo_number, w.wo_type, w.status, t.ticket_number
       FROM support_work_orders w
       JOIN support_work_order_assets l ON l.wo_id = w.wo_id
       JOIN support_ticket_assets ta ON ta.line_id = l.line_id
       JOIN support_tickets_v2 t ON t.ticket_id = w.ticket_id
       JOIN vendor_serial_numbers s ON s.serial_id = ta.serial_id
      WHERE ta.serial_id = $1
        AND w.wo_type IN ('REPAIR_PICKUP','RETURN_PICKUP')
        AND w.status IN ${OPEN_PICKUP_STATUSES}
        AND t.status NOT IN ('CLOSED','CANCELLED')
        AND s.current_customer_id IS NOT DISTINCT FROM t.customer_id
        AND ($2::int IS NULL OR w.wo_id <> $2)
      ORDER BY w.wo_id
      LIMIT 1`,
    [serialId, excludeWoId || null]
  );
  return r.rows[0] || null;
}

async function assertAssetPickupEligible(db, serialId) {
  const r = await db.query(
    `SELECT serial_id, inventory_status, current_customer_id, inventory_asset_code, serial_number
       FROM vendor_serial_numbers
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [serialId]
  );
  const serial = r.rows[0];
  if (!serial) throw Object.assign(new Error('Serial not found'), { status: 400 });
  if (!isPickupEligibleStatus(serial.inventory_status)) {
    throw Object.assign(
      new Error(`Serial ${serial.inventory_asset_code || serial.serial_id} is ${serial.inventory_status}, not eligible for pickup`),
      { status: 400 }
    );
  }
  return serial;
}

module.exports = {
  PICKUP_ELIGIBLE_STATUSES,
  OPEN_PICKUP_STATUSES,
  isPickupEligibleStatus,
  findBlockingOpenPickup,
  assertAssetPickupEligible,
};
