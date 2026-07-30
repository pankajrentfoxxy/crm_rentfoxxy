const inventorySM = require('./inventoryStateMachine');

/**
 * Parse delivery date from API input (YYYY-MM-DD or ISO timestamp).
 * Returns a Date at noon UTC for date-only strings (stable billing day).
 */
function parseDeliveredAtInput(raw, { required = false } = {}) {
  if (raw == null || raw === '') {
    if (required) {
      const err = new Error('Delivery date is required');
      err.status = 400;
      throw err;
    }
    return new Date();
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      const err = new Error('Invalid delivery date');
      err.status = 400;
      throw err;
    }
    return d;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    const err = new Error('Invalid delivery date');
    err.status = 400;
    throw err;
  }
  return d;
}

function toDateInputValue(d) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Recompute rent_start_date for a rented serial after delivery date correction.
 */
function rentStartForSerial({ dispatchMode, dispatchedAt, deliveredAt, inventoryStatus }) {
  if (String(inventoryStatus || '') !== inventorySM.STATUS.RENTED) return null;
  return inventorySM.computeRentStart({ dispatchMode, dispatchedAt, deliveredAt });
}

module.exports = {
  parseDeliveredAtInput,
  toDateInputValue,
  rentStartForSerial,
};
