/**
 * Pure billing date / pro-rata helpers — unit-tested, no DB access.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toLocalYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const daysInclusive = (a, b) => Math.round((b - a) / MS_PER_DAY) + 1;

function monthSegments(start, end) {
  const segs = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = cur.getMonth();
    const monthLast = new Date(y, m + 1, 0);
    const segEnd = monthLast < end ? monthLast : end;
    segs.push({
      segStart: new Date(cur),
      segEnd,
      year: y,
      month: m + 1,
      daysInMonth: monthLast.getDate(),
    });
    cur = new Date(y, m + 1, 1);
  }
  return segs;
}

/** Return-credit unused prepaid days that were actually invoiced past return. */
function calcReturnCreditNoteAmount({ rentMonthlyRate, returnDate, rentBilledUntil }) {
  if (!rentBilledUntil || !returnDate) return null;
  const billedUntil = new Date(rentBilledUntil);
  const retDate = new Date(returnDate);
  if (billedUntil <= retDate) return null;

  const refundStart = addDays(retDate, 1);
  const unusedDays = daysInclusive(refundStart, billedUntil);
  if (unusedDays <= 0) return null;

  const monthDays = new Date(billedUntil.getFullYear(), billedUntil.getMonth() + 1, 0).getDate();
  const monthlyRate = parseFloat(rentMonthlyRate || 0);
  const dailyRate = monthlyRate / monthDays;
  const amount = parseFloat((dailyRate * unusedDays).toFixed(2));
  if (amount <= 0) return null;

  return {
    unusedDays,
    amount,
    dailyRate: parseFloat(dailyRate.toFixed(2)),
    refundStart,
    billedUntil,
    monthDays,
  };
}

/**
 * Credit for the days a unit sat in the warehouse for repair.
 *
 * A repair pickup is not the end of the rental — the unit goes back to the same
 * customer — so billing runs continuously across the repair and this credits the
 * warehouse days back. Both transit legs stay billed: the credit starts the day
 * AFTER warehouse arrival and ends the day BEFORE it is dispatched back, so a
 * unit that arrives and leaves the same day credits nothing.
 */
function calcRepairWindowCreditAmount({ rentMonthlyRate, warehouseReceivedAt, dispatchedBackAt }) {
  if (!warehouseReceivedAt || !dispatchedBackAt) return null;
  const received = new Date(warehouseReceivedAt);
  const dispatched = new Date(dispatchedBackAt);
  if (Number.isNaN(received.getTime()) || Number.isNaN(dispatched.getTime())) return null;
  if (dispatched <= received) return null;

  const creditStart = addDays(received, 1);
  const creditEnd = addDays(dispatched, -1);
  if (creditEnd < creditStart) return null;

  const days = daysInclusive(creditStart, creditEnd);
  if (days <= 0) return null;

  // Divisor follows the month the warehouse days fall in, matching how the rent
  // line for that month was priced.
  const monthDays = new Date(creditStart.getFullYear(), creditStart.getMonth() + 1, 0).getDate();
  const monthlyRate = parseFloat(rentMonthlyRate || 0);
  if (!(monthlyRate > 0)) return null;
  const dailyRate = monthlyRate / monthDays;
  const amount = parseFloat((dailyRate * days).toFixed(2));
  if (amount <= 0) return null;

  return {
    days,
    amount,
    dailyRate: parseFloat(dailyRate.toFixed(2)),
    creditStart,
    creditEnd,
    monthDays,
  };
}

/** Vendor bill line pro-rata for one serial in a calendar month. */
function calcVendorLineAmount({ receivedAt, returnedAt, monthStart, monthEnd, monthlyRate }) {
  const received = new Date(receivedAt);
  const returned = returnedAt ? new Date(returnedAt) : null;
  const effectiveStart = received > monthStart ? received : monthStart;
  const effectiveEnd = returned && returned < monthEnd ? returned : monthEnd;
  if (effectiveStart > effectiveEnd) return null;

  const daysInMonth = monthEnd.getDate();
  const days = Math.max(1, Math.round((effectiveEnd - effectiveStart) / MS_PER_DAY) + 1);
  const rate = parseFloat(monthlyRate || 0);
  const dailyRate = rate / daysInMonth;
  const amount = parseFloat((dailyRate * days).toFixed(2));

  return {
    days,
    amount,
    dailyRate: parseFloat(dailyRate.toFixed(2)),
    monthlyRate: rate,
    effectiveStart,
    effectiveEnd,
    daysInMonth,
  };
}

module.exports = {
  MS_PER_DAY,
  toLocalYmd,
  addDays,
  daysInclusive,
  monthSegments,
  calcReturnCreditNoteAmount,
  calcRepairWindowCreditAmount,
  calcVendorLineAmount,
};
