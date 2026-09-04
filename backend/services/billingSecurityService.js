'use strict';

const { toLocalYmd } = require('./billingMath');

function isSecurityLine(line) {
  return line?.line_type === 'security' || line?.is_security === true;
}

function rentalLinesSubtotal(lines = []) {
  return parseFloat(
    lines
      .filter((line) => !isSecurityLine(line))
      .reduce((sum, line) => sum + Number(line.amount || 0), 0)
      .toFixed(2)
  );
}

function securityLinesSubtotal(lines = []) {
  return parseFloat(
    lines
      .filter((line) => isSecurityLine(line))
      .reduce((sum, line) => sum + Number(line.amount || 0), 0)
      .toFixed(2)
  );
}

function securityAssetKey(line) {
  if (line?.serial_id != null && line.serial_id !== '') return `id:${line.serial_id}`;
  if (line?.ttspl_id) return `t:${String(line.ttspl_id).trim()}`;
  return null;
}

function perUnitSecurity(row) {
  const type = String(row.security_type || '').toLowerCase();
  const rate = Number(row.rate || row.rent_monthly_rate || 0);
  if (type === 'one_month_rental' && rate > 0) return parseFloat(rate.toFixed(2));
  const qty = Number(row.main_qty ?? row.quantity ?? 1) || 1;
  const share = Number(row.security_amount || 0) / qty;
  return parseFloat((share || 0).toFixed(2));
}

function previousMonthRange(month, year) {
  const prevEnd = new Date(year, month - 1, 0);
  const prevYear = prevEnd.getFullYear();
  const prevMonth = prevEnd.getMonth() + 1;
  const prevStart = new Date(prevYear, prevMonth - 1, 1);
  return { prevStart, prevEnd, prevMonth, prevYear };
}

function deliveryInPreviousMonth(deliveryYmd, month, year) {
  if (!deliveryYmd || !month || !year) return false;
  const { prevStart, prevEnd } = previousMonthRange(month, year);
  const day = String(deliveryYmd).slice(0, 10);
  return day >= toLocalYmd(prevStart) && day <= toLocalYmd(prevEnd);
}

function deliveryInInvoiceMonth(deliveryYmd, month, year) {
  if (!deliveryYmd || !month || !year) return false;
  const start = toLocalYmd(new Date(year, month - 1, 1));
  const end = toLocalYmd(new Date(year, month, 0));
  const day = String(deliveryYmd).slice(0, 10);
  return day >= start && day <= end;
}

/**
 * Monthly cron: one-month security on the invoice AFTER delivery
 * (Aug delivery → September). First-order invoices pass
 * includeCurrentMonth: true so security sits on the same invoice as
 * the pro-rata first rent.
 */
async function collectUnbilledSecurityLines(client, { customerId, month, year, includeCurrentMonth = false }) {
  const { prevStart, prevEnd } = previousMonthRange(month, year);
  const windowStart = includeCurrentMonth ? new Date(year, month - 1, 1) : prevStart;
  const windowEnd = includeCurrentMonth ? new Date(year, month, 0) : prevEnd;
  const result = await client.query(
    `SELECT DISTINCT ON (vsn.serial_id)
            vsn.serial_id,
            COALESCE(vsn.inventory_asset_code, sos.ttspl_id) AS ttspl_id,
            COALESCE(vsn.serial_number, sos.serial_number) AS serial_number,
            COALESCE(vsn.delivered_at::date, vsn.rent_start_date, vsn.dispatched_at::date) AS delivery_date,
            COALESCE(vsn.current_dc_number, sos.dc_number) AS dc_number,
            sos.sales_order_number,
            sol.security_type,
            sol.security_amount,
            sol.rate,
            sol.main_qty,
            sol.quantity,
            vsn.rent_monthly_rate,
            COALESCE(vsn.extra->>'brand', '') AS brand,
            COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', '') AS model,
            COALESCE(vsn.extra->>'processor', '') AS processor,
            COALESCE(vsn.extra->>'generation', '') AS generation,
            COALESCE(vsn.extra->>'ram', '') AS ram,
            COALESCE(vsn.extra->>'storage', '') AS storage
       FROM vendor_serial_numbers vsn
       JOIN sales_order_serials sos
         ON sos.serial_id = vsn.serial_id
        AND COALESCE(sos.status, '') <> 'removed'
       JOIN sales_order_lines sol ON sol.id = sos.line_id
      WHERE vsn.current_customer_id = $1
        AND vsn.deleted_at IS NULL
        AND vsn.inventory_status IN ('rented', 'returned', 'in_transit')
        AND (
          LOWER(COALESCE(sol.security_type, '')) = 'one_month_rental'
          OR COALESCE(sol.security_amount, 0) > 0
        )
        AND COALESCE(vsn.delivered_at::date, vsn.rent_start_date, vsn.dispatched_at::date) IS NOT NULL
        AND COALESCE(vsn.delivered_at::date, vsn.rent_start_date, vsn.dispatched_at::date) >= $2::date
        AND COALESCE(vsn.delivered_at::date, vsn.rent_start_date, vsn.dispatched_at::date) <= $3::date
        AND NOT EXISTS (
          SELECT 1 FROM customer_security_deposits sd
           WHERE sd.serial_id = vsn.serial_id
             AND sd.status <> 'refunded'
        )
        AND NOT EXISTS (
          SELECT 1 FROM customer_serial_billing_ack ack
           WHERE ack.serial_id = vsn.serial_id
             AND ack.security_billed = TRUE
        )
        AND NOT EXISTS (
          SELECT 1
            FROM customer_invoices ci,
                 LATERAL jsonb_array_elements(COALESCE(ci.line_items, '[]'::jsonb)) elem
           WHERE ci.customer_id = $1
             AND ci.status <> 'cancelled'
             AND (
               elem->>'line_type' = 'security'
               OR elem->>'is_security' = 'true'
             )
             AND (
               (elem->>'serial_id')::int = vsn.serial_id
               OR elem->>'ttspl_id' = COALESCE(vsn.inventory_asset_code, sos.ttspl_id)
             )
        )
      ORDER BY vsn.serial_id, sos.allocation_id DESC`,
    [customerId, toLocalYmd(windowStart), toLocalYmd(windowEnd)]
  );

  const lines = [];
  for (const row of result.rows) {
    const amount = perUnitSecurity(row);
    if (!(amount > 0) || !row.delivery_date) continue;
    const delivery = toLocalYmd(row.delivery_date);
    lines.push({
      line_type: 'security',
      is_security: true,
      serial_id: row.serial_id,
      ttspl_id: row.ttspl_id || null,
      serial_number: row.serial_number,
      dc_number: row.dc_number,
      sales_order_number: row.sales_order_number,
      brand: row.brand || '',
      model: row.model || '',
      processor: row.processor || '',
      generation: row.generation || '',
      ram: row.ram || '',
      storage: row.storage || '',
      delivery_date: delivery,
      rent_start: delivery,
      rent_end: delivery,
      period: 'security',
      days_in_month: null,
      month_days: null,
      monthly_rate: amount,
      daily_rate: null,
      amount,
      is_catchup: false,
      returned: false,
    });
  }
  return lines;
}

async function recordSecurityDeposits(client, {
  customerId, invoiceId, invoiceNumber, lines, actorUserId = null,
}) {
  const created = [];
  for (const line of lines) {
    if (!isSecurityLine(line) || !(Number(line.amount) > 0)) continue;
    const notes = [
      'One month rental security',
      line.ttspl_id || null,
      invoiceNumber ? `billed on ${invoiceNumber}` : null,
      line.dc_number ? `DC ${line.dc_number}` : null,
    ].filter(Boolean).join(' · ');
    const ins = await client.query(
      `INSERT INTO customer_security_deposits
        (customer_id, sales_order_number, amount, received_date, status, notes,
         created_by, invoice_id, serial_id, ttspl_id, dc_number)
       VALUES ($1,$2,$3,$4,'held',$5,$6,$7,$8,$9,$10)
       ON CONFLICT (customer_id, serial_id) WHERE serial_id IS NOT NULL
       DO NOTHING
       RETURNING deposit_id`,
      [
        customerId,
        line.sales_order_number || null,
        Number(line.amount).toFixed(2),
        line.delivery_date || line.rent_start,
        notes,
        actorUserId,
        invoiceId || null,
        line.serial_id || null,
        line.ttspl_id || null,
        line.dc_number || null,
      ]
    );
    if (ins.rows[0]) created.push(ins.rows[0]);
  }
  return created;
}

module.exports = {
  isSecurityLine,
  rentalLinesSubtotal,
  securityLinesSubtotal,
  securityAssetKey,
  perUnitSecurity,
  previousMonthRange,
  deliveryInPreviousMonth,
  deliveryInInvoiceMonth,
  collectUnbilledSecurityLines,
  recordSecurityDeposits,
};
