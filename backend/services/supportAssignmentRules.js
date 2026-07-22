/** Pickup / return handling uses pickup_method: technician | courier | porter | inhouse */

function normalizePickupMethod(method) {
  return String(method || '').trim().toLowerCase();
}

function isCourierOrPorterMethod(method) {
  const m = normalizePickupMethod(method);
  return m === 'courier' || m === 'porter';
}

function isTechnicianVisitMethod(method) {
  const m = normalizePickupMethod(method);
  if (!m) return true;
  return m === 'technician' || m === 'inhouse';
}

/** True when a support item may receive assigned_to (technician visit). */
function itemAllowsTechnicianAssign(item) {
  if (!item) return true;
  if (isCourierOrPorterMethod(item.pickup_method)) return false;
  if (item.item_type === 'pickup' && item.status === 'pending_dispatch') return false;
  return true;
}

function assertItemAllowsTechnicianAssign(item) {
  if (!itemAllowsTechnicianAssign(item)) {
    const method = normalizePickupMethod(item?.pickup_method);
    const label = method === 'courier' ? 'Courier' : method === 'porter' ? 'Porter' : 'this handling method';
    const err = new Error(`Technician assignment is not available for ${label} handling. Use courier/porter tracking instead.`);
    err.status = 400;
    throw err;
  }
}

module.exports = {
  normalizePickupMethod,
  isCourierOrPorterMethod,
  isTechnicianVisitMethod,
  itemAllowsTechnicianAssign,
  assertItemAllowsTechnicianAssign,
};
