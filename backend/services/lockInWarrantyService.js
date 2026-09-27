/**
 * Per-laptop lock-in and warranty dates (claude/carret-lockin-warranty.md).
 *
 * The SO line holds the terms in months (locking_period, technical_warranty,
 * battery_charger_warranty). At delivery they become dates on the laptop:
 *   rental → lock_in_start_date = rent start, lock_in_end_date = start + N months
 *   sale   → warranty_start_date = delivery day, warranty / battery end = start + N months
 * A replacement passes the old laptop's dates, which win: the customer's lock-in
 * and warranty run from the original delivery, not from the swap (L1).
 *
 * A return is free on or after lock_in_end_date.
 */
const pool = require('../config/db');

const toDateStr = (d) => {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  // The server's calendar day (the box runs in UTC, like the state machine's toDateStr).
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** 'YYYY-MM-DD' + n months, clamped to the month's last day (31 Jan + 1 = 28/29 Feb). */
function addMonths(dateStr, months) {
  const n = Number(months);
  if (!dateStr || !Number.isFinite(n) || n <= 0) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetMonth = m - 1 + n;
  const ty = y + Math.floor(targetMonth / 12);
  const tm = ((targetMonth % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Whole days from `from` (default today) until `to`; 0 once reached. */
function daysUntil(to, from = null) {
  if (!to) return 0;
  const a = Date.parse(`${toDateStr(from || new Date())}T00:00:00Z`);
  const b = Date.parse(`${toDateStr(to)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** The SO line the laptop was delivered against: this DC's first, else its latest live line. */
async function loadLineTerms(client, serialId, dcNumber = null, salesOrderNumber = null) {
  const r = await client.query(
    `SELECT sol.locking_period, sol.technical_warranty, sol.battery_charger_warranty,
            sol.quotation_type, sol.sales_order_number
       FROM sales_order_serials sos
       JOIN sales_order_lines sol ON sol.id = sos.line_id
      WHERE sos.serial_id = $1 AND COALESCE(sos.status, '') <> 'removed'
      ORDER BY ($2::text IS NOT NULL AND sos.dc_number = $2) DESC,
               ($3::text IS NOT NULL AND sos.sales_order_number = $3) DESC,
               sos.created_at DESC
      LIMIT 1`,
    [serialId, dcNumber, salesOrderNumber]
  );
  return r.rows[0] || null;
}

/**
 * Called by inventoryStateMachine.markDelivered / markSoldInPlace after the
 * status change. `carried` = { lockInEndDate, warrantyEndDate, batteryWarrantyEndDate }
 * from the laptop being replaced.
 */
async function stampOnDelivery(db, serialId, {
  status, dcNumber = null, salesOrderNumber = null, saleDate = null, carried = null,
} = {}) {
  const client = db || pool;
  const cur = await client.query(
    `SELECT rent_start_date, delivered_at, lock_in_start_date, lock_in_end_date, rent_billed_until
       FROM vendor_serial_numbers WHERE serial_id = $1`,
    [serialId]
  );
  const row = cur.rows[0];
  if (!row) return null;
  const terms = await loadLineTerms(client, serialId, dcNumber, salesOrderNumber);

  if (status === 'rented') {
    const start = toDateStr(row.rent_start_date);
    let end;
    if (carried && carried.lockInEndDate !== undefined) {
      end = toDateStr(carried.lockInEndDate);
    } else if (row.rent_billed_until && row.lock_in_end_date) {
      // Same as the rent start: a redelivery after billing began keeps the anchor.
      end = toDateStr(row.lock_in_end_date);
    } else {
      end = addMonths(start, terms?.locking_period);
    }
    await client.query(
      `UPDATE vendor_serial_numbers
          SET lock_in_start_date = $2, lock_in_end_date = $3,
              warranty_start_date = NULL, warranty_end_date = NULL, battery_warranty_end_date = NULL
        WHERE serial_id = $1`,
      [serialId, start, end]
    );
    return { lock_in_start_date: start, lock_in_end_date: end };
  }

  if (status === 'sold') {
    const start = toDateStr(saleDate || row.delivered_at || new Date());
    const carriedHas = carried && (carried.warrantyEndDate !== undefined || carried.batteryWarrantyEndDate !== undefined);
    const end = carriedHas ? toDateStr(carried.warrantyEndDate) : addMonths(start, terms?.technical_warranty);
    const bEnd = carriedHas ? toDateStr(carried.batteryWarrantyEndDate) : addMonths(start, terms?.battery_charger_warranty);
    await client.query(
      `UPDATE vendor_serial_numbers
          SET warranty_start_date = $2, warranty_end_date = $3, battery_warranty_end_date = $4,
              lock_in_start_date = NULL, lock_in_end_date = NULL
        WHERE serial_id = $1`,
      [serialId, start, end, bEnd]
    );
    return { warranty_start_date: start, warranty_end_date: end, battery_warranty_end_date: bEnd };
  }

  // Demo or anything else: no lock-in, no warranty.
  await client.query(
    `UPDATE vendor_serial_numbers
        SET lock_in_start_date = NULL, lock_in_end_date = NULL,
            warranty_start_date = NULL, warranty_end_date = NULL, battery_warranty_end_date = NULL
      WHERE serial_id = $1`,
    [serialId]
  );
  return null;
}

/** The dates a replacement carries, read off the laptop being replaced. */
async function snapshotForReplacement(db, serialId) {
  if (!serialId) return null;
  const r = await (db || pool).query(
    `SELECT lock_in_end_date, warranty_end_date, battery_warranty_end_date
       FROM vendor_serial_numbers WHERE serial_id = $1`,
    [serialId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    lockInEndDate: toDateStr(row.lock_in_end_date),
    warrantyEndDate: toDateStr(row.warranty_end_date),
    batteryWarrantyEndDate: toDateStr(row.battery_warranty_end_date),
  };
}

/**
 * in | out | battery_only — for a sold laptop. `null` for anything else, or a
 * sold laptop with no recorded warranty (treated as out: nothing to honour).
 */
function warrantyStatus(row, today = null) {
  if (String(row?.inventory_status || row?.asset_bucket || '') !== 'sold') return null;
  const t = toDateStr(today || new Date());
  const tech = row.warranty_end_date && toDateStr(row.warranty_end_date) > t;
  const batt = row.battery_warranty_end_date && toDateStr(row.battery_warranty_end_date) > t;
  if (tech) return 'in';
  if (batt) return 'battery_only';
  return 'out';
}

function lockInActive(row, today = null) {
  if (String(row?.inventory_status || row?.asset_bucket || '') !== 'rented') return false;
  if (!row.lock_in_end_date) return false;
  return toDateStr(row.lock_in_end_date) > toDateStr(today || new Date());
}

module.exports = {
  toDateStr,
  addMonths,
  daysUntil,
  loadLineTerms,
  stampOnDelivery,
  snapshotForReplacement,
  warrantyStatus,
  lockInActive,
};
