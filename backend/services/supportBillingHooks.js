'use strict';

const { getNumber } = require('./supportSettingsService');

/** Days inclusive between two Date-like values. */
function daysInclusive(a, b) {
  const start = new Date(a);
  const end = new Date(b);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end - start) / 86400000) + 1;
}

function ymd(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function overlapInclusive(a0, a1, b0, b1) {
  const start = a0 > b0 ? a0 : b0;
  const end = a1 < b1 ? a1 : b1;
  if (start > end) return 0;
  return daysInclusive(start, end);
}

/**
 * Waived days = last max(0, heldDays - free_repair_days) of the hold,
 * then how many of those fall in [billStart, billEnd].
 * A 5-day hold with free_repair_days = 3 waives exactly 2 days.
 */
function waivedDaysForHold(hold, billStart, billEnd, freeRepairDays) {
  if (!hold || !hold.waive_rent) return 0;
  const from = parseYmd(hold.hold_from);
  const to = hold.hold_to ? parseYmd(hold.hold_to) : new Date();
  // heldDays matches endBillingHold: (hold_to - hold_from) exclusive of end date
  const heldDays = Math.max(0, Math.round((to - from) / 86400000));
  const waiveCount = Math.max(0, heldDays - Number(freeRepairDays || 0));
  if (!waiveCount) return 0;
  const waiveStart = new Date(to);
  waiveStart.setDate(waiveStart.getDate() - waiveCount);
  const lastWaive = new Date(to);
  lastWaive.setDate(lastWaive.getDate() - 1);
  return overlapInclusive(waiveStart, lastWaive, parseYmd(billStart), parseYmd(billEnd));
}

function supportHooksEnabled() {
  return String(process.env.BILLING_READ_SUPPORT_HOOKS || '').toLowerCase() === 'true';
}

async function loadHolds(client, serialIds, monthStart, monthEnd) {
  if (!serialIds.length) return [];
  const r = await client.query(
    `SELECT hold_id, serial_id, customer_id, hold_from, hold_to, waive_rent, reason
       FROM asset_billing_holds
      WHERE serial_id = ANY($1::int[])
        AND waive_rent = TRUE
        AND hold_from <= $3::date
        AND COALESCE(hold_to, CURRENT_DATE) >= $2::date`,
    [serialIds, ymd(monthStart), ymd(monthEnd)]
  );
  return r.rows;
}

async function applyRentHolds(client, lineItems, monthStart, monthEnd) {
  const freeDays = await getNumber(client, 'free_repair_days', 3);
  const serialIds = [...new Set(lineItems.map((l) => l.serial_id).filter(Boolean))];
  const holds = await loadHolds(client, serialIds, monthStart, monthEnd);
  let daysWaived = 0;
  let amountWaived = 0;
  const after = lineItems.map((line) => {
    const next = { ...line };
    const mine = holds.filter((h) => Number(h.serial_id) === Number(line.serial_id));
    let waived = 0;
    for (const h of mine) {
      waived += waivedDaysForHold(h, line.rent_start, line.rent_end, freeDays);
    }
    if (waived > 0) {
      const take = Math.min(waived, Number(line.days_in_month) || 0);
      const daily = Number(line.daily_rate) || 0;
      const cut = parseFloat((daily * take).toFixed(2));
      next.days_waived = take;
      next.amount = parseFloat((Number(line.amount) - cut).toFixed(2));
      next.days_in_month = Math.max(0, (Number(line.days_in_month) || 0) - take);
      daysWaived += take;
      amountWaived += cut;
    }
    return next;
  });
  const subtotal = after.reduce((s, l) => s + Number(l.amount || 0), 0);
  return { lineItems: after, subtotal, daysWaived, amountWaived };
}

async function pullApprovedExtraLines(client, customerId) {
  const r = await client.query(
    `SELECT extra_line_id, charge_type, description, amount, ticket_id
       FROM customer_invoice_extra_lines
      WHERE customer_id = $1
        AND status = 'APPROVED'
        AND billed_in_invoice_id IS NULL
      ORDER BY extra_line_id`,
    [customerId]
  );
  return r.rows;
}

function extraLinesAsInvoiceItems(rows, period) {
  return rows.map((row) => ({
    serial_id: null,
    ttspl_id: null,
    serial_number: null,
    dc_number: null,
    brand: '',
    model: row.charge_type || 'SUPPORT',
    period,
    rent_start: null,
    rent_end: null,
    days_in_month: 0,
    month_days: 0,
    monthly_rate: 0,
    daily_rate: 0,
    amount: parseFloat(Number(row.amount || 0).toFixed(2)),
    is_catchup: false,
    returned: false,
    line_kind: 'SUPPORT_EXTRA',
    extra_line_id: row.extra_line_id,
    description: row.description || row.charge_type,
  }));
}

async function stampExtraLinesBilled(client, extraLineIds, invoiceId) {
  if (!extraLineIds.length) return;
  await client.query(
    `UPDATE customer_invoice_extra_lines
        SET billed_in_invoice_id = $2,
            status = 'BILLED',
            updated_at = NOW()
      WHERE extra_line_id = ANY($1::int[])
        AND status = 'APPROVED'
        AND billed_in_invoice_id IS NULL`,
    [extraLineIds, invoiceId]
  );
}

module.exports = {
  supportHooksEnabled,
  waivedDaysForHold,
  applyRentHolds,
  pullApprovedExtraLines,
  extraLinesAsInvoiceItems,
  stampExtraLinesBilled,
  daysInclusive,
};
