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

/** Months covered by one invoice, per customers.billing_frequency. */
const FREQUENCY_MONTHS = { monthly: 1, quarterly: 3, half_yearly: 6 };

function normalizeBillingFrequency(freq) {
  const f = String(freq || 'monthly').toLowerCase().replace(/[\s-]+/g, '_');
  return Object.hasOwn(FREQUENCY_MONTHS, f) ? f : 'monthly';
}

/**
 * Last day of the billing period that opens on `billStart`.
 *
 * Monthly keeps the calendar month end, which is what every existing caller
 * expects. Quarterly and half-yearly are anchored to the asset: a laptop whose
 * period opens 12 Nov bills 12 Nov - 11 Feb, then 12 Feb - 11 May. The anchor is
 * billStart, which is rent_billed_until + 1 (or the rental start when nothing has
 * been billed yet), so an asset moved onto a longer cycle mid-life transitions
 * cleanly from wherever its billing currently stands instead of re-opening a
 * period that was already invoiced.
 *
 * Month-end anchors are clamped to the target month's length rather than allowed
 * to roll forward, because `new Date(y, m, 31)` on a 30-day month silently
 * becomes the 1st of the next one and lengthens the period. A quarter opening
 * 31 Aug ends 29 Nov (31 Aug + 3 months clamps to 30 Nov, less a day), and one
 * opening 30 Nov ends 27 Feb in a non-leap year.
 *
 * The caller still caps this at rent_end_date, so a unit returned mid-quarter is
 * billed only to its return.
 */
function billingPeriodEnd(frequency, billStart, monthEnd) {
  const months = FREQUENCY_MONTHS[normalizeBillingFrequency(frequency)];
  if (months === 1) return monthEnd;

  const y = billStart.getFullYear();
  const m = billStart.getMonth();
  const d = billStart.getDate();

  // First day of the month `months` later, then step back one day from the
  // anchor day — clamped to that month's length.
  const targetMonthLast = new Date(y, m + months + 1, 0).getDate();
  const anchorDay = Math.min(d, targetMonthLast);
  return addDays(new Date(y, m + months, anchorDay), -1);
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

/**
 * Days of [start, end] (inclusive) covered by rent pauses. A pause is
 * { from, to } — `from` is the first unbilled day, `to` the last unbilled day
 * (the day before rent resumed), or null while still paused. Overlapping
 * pauses are not double-counted.
 */
function pausedDaysInRange(pauses, start, end) {
  if (!Array.isArray(pauses) || !pauses.length) return 0;
  const toDay = (d) => Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);
  const s = toDay(start);
  const e = toDay(end);
  const paused = new Set();
  for (const p of pauses) {
    if (!p || !p.from) continue;
    const from = toDay(new Date(p.from));
    const to = p.to ? toDay(new Date(p.to)) : e;
    for (let d = Math.max(from, s); d <= Math.min(to, e); d += 1) paused.add(d);
  }
  return paused.size;
}

/**
 * Vendor bill line pro-rata for one serial in a calendar month. `pauses`
 * (vendor repair, claude/carret-vendor-repair.md) are days the laptop was with
 * the vendor and rent was stopped; they are taken out of the billed days.
 */
function calcVendorLineAmount({ receivedAt, returnedAt, monthStart, monthEnd, monthlyRate, pauses = [] }) {
  const received = new Date(receivedAt);
  const returned = returnedAt ? new Date(returnedAt) : null;
  const effectiveStart = received > monthStart ? received : monthStart;
  const effectiveEnd = returned && returned < monthEnd ? returned : monthEnd;
  if (effectiveStart > effectiveEnd) return null;

  const daysInMonth = monthEnd.getDate();
  const spanDays = Math.max(1, Math.round((effectiveEnd - effectiveStart) / MS_PER_DAY) + 1);
  const pausedDays = pausedDaysInRange(pauses, effectiveStart, effectiveEnd);
  const days = spanDays - pausedDays;
  if (days <= 0) return null;
  const rate = parseFloat(monthlyRate || 0);

  // BL3, vendor side. `parseFloat(monthlyRate || 0)` produced a Rs 0 line
  // whenever the PO's line_items->0 carried no usable rate, and the caller only
  // skipped a null result — so the zero line was written onto the vendor bill.
  // There is no watermark here, so nothing is lost permanently, but a Rs 0 line
  // reads as "this unit was billed" when it was never priced: it hides the data
  // gap and under-pays the vendor silently. Return null so the caller can skip
  // it and say which serial and which PO need a rate.
  if (!(rate > 0)) return null;

  const dailyRate = rate / daysInMonth;
  const amount = parseFloat((dailyRate * days).toFixed(2));

  return {
    days,
    pausedDays,
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
  pausedDaysInRange,
  FREQUENCY_MONTHS,
  normalizeBillingFrequency,
  billingPeriodEnd,
};
