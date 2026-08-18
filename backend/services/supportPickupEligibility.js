'use strict';

/** Canonical repair/return pickup eligibility. Do not redeclare this list. */
const PICKUP_ELIGIBLE_STATUSES = Object.freeze(['rented', 'on_demo', 'sold', 'out_stock']);

function isPickupEligibleStatus(status) {
  return PICKUP_ELIGIBLE_STATUSES.includes(String(status || ''));
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
  isPickupEligibleStatus,
  assertAssetPickupEligible,
};
