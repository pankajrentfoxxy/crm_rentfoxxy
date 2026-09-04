/**
 * Billing Scheduler — customer invoices (1st 00:01 IST) + vendor bills (last day 23:59 IST)
 */
const cron = require('node-cron');
const pool = require('../config/db');
const logger = require('../utils/logger');
const { enqueueEmail } = require('./emailQueueService');
const {
  toLocalYmd,
  addDays,
  daysInclusive,
  monthSegments,
  calcReturnCreditNoteAmount,
  calcVendorLineAmount,
} = require('./billingMath');
const {
  insertCustomerInvoiceLines,
  insertVendorBillLines,
} = require('./billingLineItemsService');
const {
  isSecurityLine,
  rentalLinesSubtotal,
  securityLinesSubtotal,
  previousMonthRange,
  deliveryInPreviousMonth,
  collectUnbilledSecurityLines,
  recordSecurityDeposits,
} = require('./billingSecurityService');

const billingLog = logger.child ? logger.child({ module: 'billing' }) : logger;

async function nextInvoiceNumber(entity = 'rentfoxxy') {
  const docType = entity === 'gorefurbo' ? 'invoice_gorefurbo' : 'invoice_rentfoxxy';
  const res = await pool.query(
    `UPDATE sm_document_sequences
     SET last_value = last_value + 1
     WHERE doc_type = $1
     RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`,
    [docType]
  );
  if (res.rows.length) return res.rows[0].number;
  const fb = await pool.query(
    `UPDATE sm_document_sequences SET last_value = last_value + 1
     WHERE doc_type = 'customer_invoice'
     RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`
  );
  return fb.rows[0].number;
}

async function nextVendorBillNumber() {
  const res = await pool.query(
    `UPDATE sm_document_sequences
     SET last_value = last_value + 1
     WHERE doc_type = 'vendor_bill'
     RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`
  );
  return res.rows[0].number;
}

async function alertOpsOnBillingFailure(runName, summary) {
  const to = process.env.OPS_ALERT_EMAIL || process.env.SMTP_USER;
  if (!to) return;
  try {
    await enqueueEmail({
      toEmail: to,
      subject: `[Rentfoxxy CRM] Billing cron errors — ${runName}`,
      bodyText: `Billing run "${runName}" completed with errors.\n\n${JSON.stringify(summary, null, 2)}`,
      bodyHtml: `<pre>${JSON.stringify(summary, null, 2)}</pre>`,
      dedupeKey: `billing-alert-${runName}-${new Date().toISOString().slice(0, 13)}`,
    });
  } catch (e) {
    billingLog.error({ err: e.message, run: runName }, 'Failed to enqueue ops billing alert');
  }
}

async function runBillingBatch(runName, fn) {
  try {
    const results = await fn();
    const errors = results.filter((r) => r.error).length;
    const skipped = results.filter((r) => r.skipped).length;
    const summary = { run: runName, processed: results.length, skipped, errors };
    billingLog.info(summary, 'billing cron complete');
    if (errors > 0) await alertOpsOnBillingFailure(runName, { ...summary, results });
    return results;
  } catch (err) {
    billingLog.error({ run: runName, err: err.message }, 'billing cron failed');
    await alertOpsOnBillingFailure(runName, { run: runName, fatal: err.message });
    throw err;
  }
}

/**
 * Latest warehouse-received customer return for this customer, ignoring a later
 * re-delivery to the same customer. Customer Active already uses this rule;
 * billing must too — VSN can stay `rented` after warehouse e-sign.
 */
async function loadCustomerWarehouseReturnDates(client, customerId, serialIds) {
  const ids = [...new Set((serialIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  const bySerial = new Map();
  if (!customerId || !ids.length) return bySerial;
  const { rows } = await client.query(
    `SELECT DISTINCT ON (vsn.serial_id)
            vsn.serial_id,
            (sti.warehouse_received_at AT TIME ZONE 'Asia/Kolkata')::date::text AS return_date
       FROM vendor_serial_numbers vsn
       JOIN support_ticket_items sti
         ON sti.item_type = 'pickup'
        AND sti.warehouse_received_at IS NOT NULL
        AND (
          sti.ttspl_id = vsn.inventory_asset_code
          OR sti.unique_serial_number = vsn.inventory_asset_code
          OR sti.serial_number = vsn.serial_number
        )
       JOIN delivery_challan_lines rl
         ON rl.dc_number = sti.return_dc_number
        AND rl.movement_type = 'return'
        AND rl.customer_id = $1
        AND COALESCE(rl.status, '') NOT IN ('cancelled')
      WHERE vsn.serial_id = ANY($2::int[])
        -- Still rented to this customer (complaint/repair, not a real return).
        AND NOT (
          vsn.current_customer_id = $1
          AND vsn.inventory_status IN ('rented', 'on_demo', 'in_transit')
        )
        AND NOT EXISTS (
          SELECT 1
            FROM delivery_challan_lines o
           WHERE COALESCE(o.movement_type, 'outbound') = 'outbound'
             AND o.customer_id = $1
             AND COALESCE(o.status, '') NOT IN ('cancelled')
             AND o.serial_number::text ILIKE '%' || vsn.inventory_asset_code || '%'
             AND COALESCE(o.delivered_at, o.created_at) >
                 COALESCE(rl.delivered_at, rl.created_at, sti.warehouse_received_at)
        )
      ORDER BY vsn.serial_id, sti.warehouse_received_at DESC`,
    [customerId, ids]
  );
  for (const row of rows) {
    const parsed = parseInvoiceLineDate(row.return_date);
    if (parsed) bySerial.set(Number(row.serial_id), parsed);
  }
  return bySerial;
}

/**
 * Latest outbound DC delivery for this customer. `null` means the DC exists
 * but POD / delivered_at was never marked — do not bill previous-month
 * catch-up or security until that date is set.
 */
async function loadCustomerOutboundDeliveryDates(client, customerId, serialIds) {
  const ids = [...new Set((serialIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  const bySerial = new Map();
  if (!customerId || !ids.length) return bySerial;
  const { rows } = await client.query(
    `SELECT DISTINCT ON (vsn.serial_id)
            vsn.serial_id,
            (dcl.delivered_at AT TIME ZONE 'Asia/Kolkata')::date::text AS delivery_date
       FROM vendor_serial_numbers vsn
       JOIN delivery_challan_lines dcl
         ON COALESCE(dcl.movement_type, 'outbound') = 'outbound'
        AND dcl.customer_id = $1
        AND COALESCE(dcl.status, '') NOT IN ('cancelled')
        AND dcl.serial_number::text ILIKE '%' || vsn.inventory_asset_code || '%'
      WHERE vsn.serial_id = ANY($2::int[])
      ORDER BY vsn.serial_id, dcl.delivered_at DESC NULLS LAST, dcl.created_at DESC`,
    [customerId, ids]
  );
  for (const row of rows) {
    bySerial.set(Number(row.serial_id), parseInvoiceLineDate(row.delivery_date));
  }
  return bySerial;
}

function recalcRentalLineToEnd(line, newEnd) {
  const start = parseInvoiceLineDate(line.rent_start);
  const monthDays = Number(
    line.month_days
    || new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
  );
  const days = daysInclusive(start, newEnd);
  const monthlyRate = parseFloat(line.monthly_rate || 0);
  const dailyRate = monthDays ? monthlyRate / monthDays : 0;
  return {
    ...line,
    rent_end: toLocalYmd(newEnd),
    days_in_month: days,
    month_days: monthDays,
    daily_rate: parseFloat(dailyRate.toFixed(2)),
    amount: parseFloat((dailyRate * days).toFixed(2)),
    returned: true,
  };
}

function lineYmd(value) {
  return String(value || '').slice(0, 10);
}

function rentalLineBucketKey(line) {
  if (isSecurityLine(line)) {
    return `s|${line.serial_id || ''}|${String(line.ttspl_id || '').toUpperCase()}`;
  }
  const period = String(line.period || lineYmd(line.rent_start)).slice(0, 7);
  return `${line.is_catchup ? 'c' : 'r'}|${line.serial_id || ''}|${String(line.ttspl_id || '').toUpperCase()}|${period}`;
}

function recalcRentalLineSpan(line, newStart, newEnd) {
  const start = newStart instanceof Date ? newStart : parseInvoiceLineDate(newStart);
  const end = newEnd instanceof Date ? newEnd : parseInvoiceLineDate(newEnd);
  const monthDays = Number(
    line.month_days
    || new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
  );
  const days = daysInclusive(start, end);
  const monthlyRate = parseFloat(line.monthly_rate || 0);
  const dailyRate = monthDays ? monthlyRate / monthDays : 0;
  return {
    ...line,
    rent_start: toLocalYmd(start),
    rent_end: toLocalYmd(end),
    days_in_month: days,
    month_days: monthDays,
    daily_rate: parseFloat(dailyRate.toFixed(2)),
    amount: parseFloat((dailyRate * days).toFixed(2)),
  };
}

function snapCatchupToDelivery(line, outboundBySerial = new Map()) {
  if (!line?.is_catchup || isSecurityLine(line)) return line;
  const delivered = outboundBySerial.get(Number(line.serial_id));
  if (!delivered) return line;
  const delYmd = toLocalYmd(delivered);
  const startYmd = lineYmd(line.rent_start);
  const endYmd = lineYmd(line.rent_end);
  if (startYmd && delYmd && startYmd < delYmd && (!endYmd || delYmd <= endYmd)) {
    return recalcRentalLineSpan(line, delivered, parseInvoiceLineDate(line.rent_end));
  }
  return line;
}

function collapseRentalGroup(group, outboundBySerial = new Map()) {
  const snapped = group.map((line) => snapCatchupToDelivery(line, outboundBySerial));
  const uniq = [];
  const seen = new Set();
  for (const line of snapped) {
    const key = `${lineYmd(line.rent_start)}|${lineYmd(line.rent_end)}|${Number(line.amount || 0).toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(line);
  }
  if (uniq.length === 1) return uniq[0];

  uniq.sort((a, b) => lineYmd(a.rent_start).localeCompare(lineYmd(b.rent_start)));
  const overlapping = uniq.some((a, i) =>
    uniq.slice(i + 1).some((b) =>
      lineYmd(a.rent_start) <= lineYmd(b.rent_end) && lineYmd(b.rent_start) <= lineYmd(a.rent_end)
    )
  );
  if (overlapping) {
    const delivered = outboundBySerial.get(Number(uniq[0].serial_id));
    const delYmd = delivered ? toLocalYmd(delivered) : '';
    const matches = delYmd ? uniq.filter((line) => lineYmd(line.rent_start) === delYmd) : [];
    if (matches.length) {
      return matches.reduce((best, line) => (
        lineYmd(line.rent_end) > lineYmd(best.rent_end) ? line : best
      ));
    }
    return uniq[uniq.length - 1];
  }
  const template = uniq[uniq.length - 1];
  const start = parseInvoiceLineDate(uniq[0].rent_start);
  const end = parseInvoiceLineDate(
    uniq.reduce((best, line) => (lineYmd(line.rent_end) > lineYmd(best.rent_end) ? line : best)).rent_end
  );
  return recalcRentalLineSpan(template, start, end);
}

/**
 * One security / catch-up / current-month rental line per laptop per period.
 * Overlapping catch-up keeps the outbound-DC start; adjacent fragments merge.
 */
function collapseDuplicateRentalLines(lines, outboundBySerial = new Map()) {
  const groups = new Map();
  const order = [];
  for (const line of lines || []) {
    const key = rentalLineBucketKey(line);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(line);
  }
  return order.map((key) => {
    const group = groups.get(key);
    if (isSecurityLine(group[0]) || group.length === 1) return group[0];
    return collapseRentalGroup(group, outboundBySerial);
  });
}

async function loadOutboundForLines(client, customerId, lines) {
  const serialIds = [...new Set((lines || []).map((line) => Number(line.serial_id)).filter((id) => id > 0))];
  return loadCustomerOutboundDeliveryDates(client, customerId, serialIds);
}

/**
 * Build prorated line items for unbilled rental serials and advance rent_billed_until.
 * Mutates serial rows via the open transaction client.
 */
async function buildCustomerInvoiceLines(client, {
  customerId, month, year, monthStart, monthEnd, includeCurrentMonthStarts = false,
}) {
  // Deliveries in the invoice month wait for the NEXT month as catch-up
  // (sent 10 Aug or 1 Sep → next invoice bills that start span + the new month).
  // includeCurrentMonthStarts is only for rare same-month backfills.
  const startCutoff = includeCurrentMonthStarts ? monthEnd : addDays(monthStart, -1);
  const serialsRes = await client.query(
    `SELECT vsn.serial_id,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
            vsn.serial_number,
            vsn.current_dc_number AS dc_number,
            vsn.inventory_status,
            vsn.rent_start_date,
            vsn.delivered_at,
            vsn.dispatched_at,
            vsn.rent_billed_until,
            CASE
              WHEN vsn.inventory_status = 'returned'
                THEN COALESCE(vsn.rent_end_date, vsn.returned_at::date)
              ELSE vsn.rent_end_date
            END AS rent_end_date,
            vsn.rent_monthly_rate,
            COALESCE(vsn.extra->>'brand', '') AS brand,
            COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', '') AS model,
            COALESCE(vsn.extra->>'processor', '') AS processor,
            COALESCE(vsn.extra->>'generation', '') AS generation,
            COALESCE(vsn.extra->>'ram', '') AS ram,
            COALESCE(vsn.extra->>'storage', '') AS storage
       FROM vendor_serial_numbers vsn
      WHERE vsn.current_customer_id = $1
        AND vsn.deleted_at IS NULL
        -- in_transit: first bill can start at DC generate (dispatch), before POD.
        AND vsn.inventory_status IN ('rented', 'returned', 'in_transit')
        AND vsn.rent_start_date IS NOT NULL
        AND vsn.rent_start_date <= $2::date
        AND (vsn.rent_billed_until IS NULL OR vsn.rent_billed_until < $3::date)
      FOR UPDATE`,
    [customerId, toLocalYmd(startCutoff), toLocalYmd(monthEnd)]
  );

  const lineItems = [];
  let subtotal = 0;
  let periodStart = null;
  let periodEnd = null;
  const serialIdsForWindow = serialsRes.rows.map((row) => row.serial_id);
  const warehouseReturnBySerial = await loadCustomerWarehouseReturnDates(
    client,
    customerId,
    serialIdsForWindow
  );
  const outboundDeliveryBySerial = await loadCustomerOutboundDeliveryDates(
    client,
    customerId,
    serialIdsForWindow
  );

  for (const row of serialsRes.rows) {
    const rentStart = new Date(row.rent_start_date);
    const billedUntil = row.rent_billed_until ? new Date(row.rent_billed_until) : null;
    const rentEndRaw = row.rent_end_date ? new Date(row.rent_end_date) : null;
    // Ignore a leftover return date from a previous rental cycle.
    let rentEnd = rentEndRaw && rentEndRaw >= rentStart ? rentEndRaw : null;
    const warehouseReturn = warehouseReturnBySerial.get(Number(row.serial_id));
    if (warehouseReturn && (!rentEnd || warehouseReturn < rentEnd)) {
      rentEnd = warehouseReturn;
    }

    let billStart = billedUntil ? addDays(billedUntil, 1) : rentStart;
    if (billStart < rentStart) billStart = rentStart;

    // Previous-month catch-up only when THIS customer's outbound DC has a
    // marked delivery in that month. Unmarked POD or an older delivery
    // must not create a full August span on September.
    const dcDelivery = outboundDeliveryBySerial.get(Number(row.serial_id));
    const deliveryYmd = dcDelivery
      ? toLocalYmd(dcDelivery)
      : toLocalYmd(new Date(row.delivered_at || row.rent_start_date || row.dispatched_at));
    const { prevStart } = previousMonthRange(month, year);
    const prevStartYmd = toLocalYmd(prevStart);
    const markedInPrevMonth = Boolean(dcDelivery && deliveryYmd >= prevStartYmd && deliveryYmd < toLocalYmd(monthStart));
    if (!includeCurrentMonthStarts && billStart < monthStart && !markedInPrevMonth) {
      billStart = new Date(monthStart);
    }

    let billEnd = monthEnd;
    if (rentEnd && rentEnd < billEnd) billEnd = rentEnd;

    if (billStart > billEnd) continue;

    const monthlyRate = parseFloat(row.rent_monthly_rate || 0);
    for (const seg of monthSegments(billStart, billEnd)) {
      const days = daysInclusive(seg.segStart, seg.segEnd);
      const dailyRate = monthlyRate / seg.daysInMonth;
      const amount = parseFloat((dailyRate * days).toFixed(2));
      subtotal += amount;
      const isCatchup = seg.year !== year || seg.month !== month;
      lineItems.push({
        serial_id: row.serial_id,
        ttspl_id: row.ttspl_id || null,
        serial_number: row.serial_number,
        dc_number: row.dc_number,
        brand: row.brand || '',
        model: row.model || '',
        processor: row.processor || '',
        generation: row.generation || '',
        ram: row.ram || '',
        storage: row.storage || '',
        period: `${seg.year}-${String(seg.month).padStart(2, '0')}`,
        rent_start: toLocalYmd(seg.segStart),
        rent_end: toLocalYmd(seg.segEnd),
        days_in_month: days,
        month_days: seg.daysInMonth,
        monthly_rate: monthlyRate,
        daily_rate: parseFloat(dailyRate.toFixed(2)),
        amount,
        is_catchup: isCatchup,
        returned: row.inventory_status === 'returned' || Boolean(warehouseReturn),
      });
    }

    if (!periodStart || billStart < periodStart) periodStart = billStart;
    if (!periodEnd || billEnd > periodEnd) periodEnd = billEnd;

    await client.query(
      `UPDATE vendor_serial_numbers SET rent_billed_until = $1, updated_at = NOW()
       WHERE serial_id = $2`,
      [toLocalYmd(billEnd), row.serial_id]
    );
  }

  return { lineItems, subtotal, periodStart, periodEnd };
}

async function getCustomerBillingType(clientOrPool, customerId) {
  const { rows } = await clientOrPool.query(
    `SELECT COALESCE(billing_type, 'prepaid') AS billing_type
       FROM customers WHERE customer_id = $1`,
    [customerId]
  );
  return String(rows[0]?.billing_type || 'prepaid').toLowerCase() === 'postpaid'
    ? 'postpaid'
    : 'prepaid';
}

/**
 * Postpaid occupancy for one calendar month: every laptop this customer held
 * during the month, from max(1st, delivery) through min(month-end, warehouse receive).
 * No previous-month catch-up and no unused-day credit notes.
 */
async function buildPostpaidInvoiceLines(client, { customerId, month, year, monthStart, monthEnd }) {
  const serialsRes = await client.query(
    `SELECT DISTINCT ON (vsn.serial_id)
            vsn.serial_id,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
            vsn.serial_number,
            vsn.current_dc_number AS dc_number,
            vsn.inventory_status,
            vsn.rent_monthly_rate,
            COALESCE(
              (
                SELECT cil.monthly_rate
                  FROM customer_invoice_lines cil
                  JOIN customer_invoices ci ON ci.invoice_id = cil.invoice_id
                 WHERE cil.serial_id = vsn.serial_id
                   AND ci.customer_id = $1
                   AND COALESCE(cil.line_type, 'rental') <> 'security'
                   AND LOWER(COALESCE(ci.status, '')) <> 'cancelled'
                 ORDER BY ci.invoice_year DESC, ci.invoice_month DESC, cil.rent_end DESC
                 LIMIT 1
              ),
              vsn.rent_monthly_rate
            ) AS billed_rate,
            COALESCE(vsn.extra->>'brand', '') AS brand,
            COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', '') AS model,
            COALESCE(vsn.extra->>'processor', '') AS processor,
            COALESCE(vsn.extra->>'generation', '') AS generation,
            COALESCE(vsn.extra->>'ram', '') AS ram,
            COALESCE(vsn.extra->>'storage', '') AS storage
       FROM vendor_serial_numbers vsn
       JOIN delivery_challan_lines dcl
         ON COALESCE(dcl.movement_type, 'outbound') = 'outbound'
        AND dcl.customer_id = $1
        AND COALESCE(dcl.status, '') NOT IN ('cancelled', 'rejected')
        AND dcl.delivered_at IS NOT NULL
        AND (dcl.delivered_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date
        AND (
          dcl.serial_number::text ILIKE '%|' || vsn.inventory_asset_code || '%'
          OR dcl.serial_number::text ILIKE vsn.serial_id::text || '|%'
        )
      WHERE vsn.deleted_at IS NULL
        AND COALESCE(vsn.inventory_asset_code, '') <> ''
      ORDER BY vsn.serial_id`,
    [customerId, toLocalYmd(monthEnd)]
  );

  const lineItems = [];
  let periodStart = null;
  let periodEnd = null;
  const serialIds = serialsRes.rows.map((row) => row.serial_id);
  const warehouseReturnBySerial = await loadCustomerWarehouseReturnDates(client, customerId, serialIds);
  const outboundDeliveryBySerial = await loadCustomerOutboundDeliveryDates(client, customerId, serialIds);

  for (const row of serialsRes.rows) {
    const delivered = outboundDeliveryBySerial.get(Number(row.serial_id));
    if (!delivered || delivered > monthEnd) continue;
    const returnedOn = warehouseReturnBySerial.get(Number(row.serial_id));
    if (returnedOn && returnedOn < monthStart) continue;

    let billStart = delivered > monthStart ? delivered : new Date(monthStart);
    let billEnd = new Date(monthEnd);
    if (returnedOn && returnedOn < billEnd) billEnd = returnedOn;
    if (billStart > billEnd) continue;

    const monthlyRate = parseFloat(row.billed_rate || row.rent_monthly_rate || 0);
    const days = daysInclusive(billStart, billEnd);
    const daysInMonth = monthEnd.getDate();
    const dailyRate = monthlyRate / daysInMonth;
    const amount = parseFloat((dailyRate * days).toFixed(2));
    lineItems.push({
      serial_id: row.serial_id,
      ttspl_id: row.ttspl_id || null,
      serial_number: row.serial_number,
      dc_number: row.dc_number,
      brand: row.brand || '',
      model: row.model || '',
      processor: row.processor || '',
      generation: row.generation || '',
      ram: row.ram || '',
      storage: row.storage || '',
      period: `${year}-${String(month).padStart(2, '0')}`,
      rent_start: toLocalYmd(billStart),
      rent_end: toLocalYmd(billEnd),
      days_in_month: days,
      month_days: daysInMonth,
      monthly_rate: monthlyRate,
      daily_rate: parseFloat(dailyRate.toFixed(2)),
      amount,
      is_catchup: false,
      returned: Boolean(returnedOn),
    });

    if (!periodStart || billStart < periodStart) periodStart = billStart;
    if (!periodEnd || billEnd > periodEnd) periodEnd = billEnd;

    await client.query(
      `UPDATE vendor_serial_numbers SET rent_billed_until = $1, updated_at = NOW()
        WHERE serial_id = $2`,
      [toLocalYmd(billEnd), row.serial_id]
    );
  }

  return {
    lineItems,
    subtotal: rentalLinesSubtotal(lineItems),
    periodStart,
    periodEnd,
  };
}

async function persistPostpaidDraft(client, inv, lineItems, monthStart, monthEnd) {
  const persisted = await persistDraftInvoiceLines(client, inv, lineItems, monthStart, monthEnd);
  await client.query('DELETE FROM customer_invoice_lines WHERE invoice_id = $1', [inv.invoice_id]);
  await insertCustomerInvoiceLines(client, inv.invoice_id, lineItems);
  return persisted;
}

async function generatePostpaidCustomerInvoice(customerId, month, year) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const invoiceDate = new Date(year, month, 1);
  const issueMonth = invoiceDate.getMonth() + 1;
  const issueYear = invoiceDate.getFullYear();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Invoice month is the issue month (1st of next month) so list/revenue
    // filters match invoice_date. Also pick up leftover drafts still stored
    // under the occupancy month from the first postpaid rollout.
    const existing = await client.query(
      `SELECT invoice_id, invoice_number, status, line_items, subtotal,
              gst_percent, credit_note_adjustment, from_date, to_date,
              invoice_month, invoice_year
         FROM customer_invoices
        WHERE customer_id = $1
          AND (
            (invoice_month = $2 AND invoice_year = $3)
            OR (invoice_month = $4 AND invoice_year = $5)
          )
        ORDER BY CASE WHEN invoice_month = $2 AND invoice_year = $3 THEN 0 ELSE 1 END,
                 invoice_id DESC
        LIMIT 1
        FOR UPDATE`,
      [customerId, issueMonth, issueYear, month, year]
    );

    if (existing.rows.length && String(existing.rows[0].status || '').toLowerCase() !== 'draft') {
      await client.query('COMMIT');
      return {
        skipped: true,
        invoice_id: existing.rows[0].invoice_id,
        invoice_number: existing.rows[0].invoice_number,
        reason: 'Invoice already exists',
      };
    }

    const built = await buildPostpaidInvoiceLines(client, {
      customerId, month, year, monthStart, monthEnd,
    });
    if (!built.lineItems.length) {
      await client.query('COMMIT');
      return { skipped: true, reason: 'No rental occupancy in this month' };
    }

    const cancelledNotes = await client.query(
      `UPDATE customer_credit_notes
          SET status = 'cancelled', updated_at = NOW()
        WHERE customer_id = $1
          AND status = 'pending'
          AND reason ILIKE '%prepaid%'
        RETURNING credit_note_number, amount`,
      [customerId]
    );

    const gstPercent = 18;
    const { gstAmount, grandTotal } = invoiceMoneyTotals(built.subtotal, gstPercent, 0);
    const fromDate = built.periodStart || monthStart;
    const toDate = built.periodEnd || monthEnd;

    if (existing.rows.length) {
      const inv = existing.rows[0];
      await persistPostpaidDraft(client, {
        ...inv,
        gst_percent: gstPercent,
        credit_note_adjustment: 0,
      }, built.lineItems, monthStart, monthEnd);
      await client.query(
        `UPDATE customer_invoices
            SET invoice_date = $1,
                invoice_month = $2,
                invoice_year = $3,
                credit_note_adjustment = 0,
                updated_at = NOW()
          WHERE invoice_id = $4`,
        [toLocalYmd(invoiceDate), issueMonth, issueYear, inv.invoice_id]
      );
      await client.query('COMMIT');
      billingLog.info(
        {
          invoiceNumber: inv.invoice_number,
          customerId,
          lines: built.lineItems.length,
          subtotal: built.subtotal,
          cancelledNotes: cancelledNotes.rows.length,
        },
        'Rebuilt postpaid draft invoice'
      );
      return {
        invoice_id: inv.invoice_id,
        invoice_number: inv.invoice_number,
        rebuilt: true,
        billing_type: 'postpaid',
        credit_notes_cancelled: cancelledNotes.rows,
        credit_notes_created: 0,
      };
    }

    const entityCode = 'rentfoxxy';
    const invoiceNumber = await nextInvoiceNumber(entityCode);
    const insertRes = await client.query(
      `INSERT INTO customer_invoices
        (invoice_number, customer_id, invoice_month, invoice_year,
         invoice_date, from_date, to_date, line_items,
         subtotal, gst_percent, gst_amount, credit_note_adjustment, grand_total, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,0,$12,'draft')
       RETURNING invoice_id, invoice_number`,
      [
        invoiceNumber,
        customerId,
        issueMonth,
        issueYear,
        toLocalYmd(invoiceDate),
        toLocalYmd(fromDate),
        toLocalYmd(toDate),
        JSON.stringify(built.lineItems),
        built.subtotal.toFixed(2),
        gstPercent,
        gstAmount,
        grandTotal,
      ]
    );
    await insertCustomerInvoiceLines(client, insertRes.rows[0].invoice_id, built.lineItems);
    await client.query('COMMIT');
    billingLog.info(
      { invoiceNumber, customerId, lines: built.lineItems.length, subtotal: built.subtotal },
      'Created postpaid customer invoice'
    );
    return {
      invoice_id: insertRes.rows[0].invoice_id,
      invoice_number: insertRes.rows[0].invoice_number,
      billing_type: 'postpaid',
      credit_notes_cancelled: cancelledNotes.rows,
      credit_notes_created: 0,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function parseInvoiceLineDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function invoiceLinesArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function linePeriodBounds(lines) {
  let fromDate = null;
  let toDate = null;
  for (const line of lines) {
    const start = parseInvoiceLineDate(line.rent_start);
    const end = parseInvoiceLineDate(line.rent_end);
    if (start && (!fromDate || start < fromDate)) fromDate = start;
    if (end && (!toDate || end > toDate)) toDate = end;
  }
  return { fromDate, toDate };
}

/**
 * First-month rental (delivered in the previous invoice month, including the 1st)
 * belongs on the NEXT month as catch-up (sent 10 Aug or 1 Sep → next invoice).
 * Move still-draft start-month rental lines forward. Security stays put —
 * it is reconciled separately to the previous calendar month only.
 */
async function takeMidMonthStartLinesFromPreviousInvoice(client, { customerId, month, year }) {
  const prevEnd = new Date(year, month - 1, 0);
  const prevMonth = prevEnd.getMonth() + 1;
  const prevYear = prevEnd.getFullYear();
  const prevStart = new Date(prevYear, prevMonth - 1, 1);
  const expectedPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  const prev = await client.query(
    `SELECT invoice_id, invoice_number, status, line_items, gst_percent, credit_note_adjustment
       FROM customer_invoices
      WHERE customer_id = $1 AND invoice_month = $2 AND invoice_year = $3
      FOR UPDATE`,
    [customerId, prevMonth, prevYear]
  );
  if (!prev.rows.length) return [];
  const inv = prev.rows[0];
  if (String(inv.status || '').toLowerCase() !== 'draft') return [];

  const lines = invoiceLinesArray(inv.line_items);
  const rentalSerialIds = [...new Set(
    lines.filter((line) => !isSecurityLine(line)).map((line) => Number(line.serial_id)).filter((id) => id > 0)
  )];
  let firstMonthIds = new Set();
  if (rentalSerialIds.length) {
    const outbound = await loadCustomerOutboundDeliveryDates(client, customerId, rentalSerialIds);
    for (const [serialId, deliveredOn] of outbound.entries()) {
      if (
        deliveredOn
        && deliveredOn >= prevStart
        && deliveredOn <= prevEnd
      ) {
        firstMonthIds.add(Number(serialId));
      }
    }
  }

  const stay = [];
  const move = [];
  for (const line of lines) {
    if (isSecurityLine(line)) {
      stay.push(line);
      continue;
    }
    const lineStart = parseInvoiceLineDate(line.rent_start);
    const startInPrevMonth = Boolean(
      lineStart
      && lineStart.getFullYear() === prevYear
      && lineStart.getMonth() + 1 === prevMonth
    );
    // Only move the previous-month span. A later re-rent updates VSN
    // delivered_at, which must not drag leftover July lines onto September.
    if (firstMonthIds.has(Number(line.serial_id)) && startInPrevMonth) {
      move.push({ ...line, is_catchup: true, period: expectedPeriod });
      continue;
    }
    const start = parseInvoiceLineDate(line.rent_start);
    const midStart = !line.serial_id
      && start
      && start.getFullYear() === prevYear
      && start.getMonth() + 1 === prevMonth
      && start.getDate() > 1;
    const period = String(line.period || line.period_label || '');
    const samePeriod = !period || period === expectedPeriod;
    if (midStart && samePeriod) {
      move.push({ ...line, is_catchup: true, period: expectedPeriod });
    } else {
      stay.push(line);
    }
  }
  if (!move.length) return [];

  const staySubtotal = rentalLinesSubtotal(stay);
  const securityDeposit = securityLinesSubtotal(stay);
  const gstPercent = parseFloat(inv.gst_percent != null ? inv.gst_percent : 18);
  const credit = parseFloat(inv.credit_note_adjustment || 0);
  const money = invoiceMoneyTotals(staySubtotal, gstPercent, credit, securityDeposit);
  const bounds = linePeriodBounds(stay.filter((line) => !isSecurityLine(line)));

  await client.query(
    `UPDATE customer_invoices
        SET line_items = $1::jsonb,
            subtotal = $2,
            gst_amount = $3,
            grand_total = $4,
            security_deposit = $5,
            from_date = $6,
            to_date = $7,
            updated_at = NOW()
      WHERE invoice_id = $8`,
    [
      JSON.stringify(stay),
      staySubtotal.toFixed(2),
      money.gstAmount,
      money.grandTotal,
      securityDeposit.toFixed(2),
      toLocalYmd(bounds.fromDate || prevStart),
      toLocalYmd(bounds.toDate || prevEnd),
      inv.invoice_id,
    ]
  );

  const serialIds = [...new Set(move.map((l) => Number(l.serial_id)).filter((id) => id > 0))];
  const ttspls = [...new Set(move.map((l) => l.ttspl_id).filter(Boolean))];
  await client.query(
    `DELETE FROM customer_invoice_lines
      WHERE invoice_id = $1
        AND COALESCE(line_type, 'rental') <> 'security'
        AND rent_start >= $2::date
        AND rent_start <= $3::date
        AND (
          (serial_id IS NOT NULL AND serial_id = ANY($4::int[]))
          OR (ttspl_id IS NOT NULL AND ttspl_id = ANY($5::text[]))
        )`,
    [inv.invoice_id, toLocalYmd(prevStart), toLocalYmd(prevEnd), serialIds, ttspls]
  );

  billingLog.info(
    {
      customerId,
      fromInvoice: inv.invoice_number,
      moved: move.length,
      month,
      year,
    },
    'Moved first-month start lines to next-month catch-up'
  );
  return move;
}

async function mergeCatchupOntoDraft(client, inv, catchupLines) {
  if (!catchupLines.length) return inv;
  const existing = invoiceLinesArray(inv.line_items);
  const customerRes = await client.query(
    `SELECT customer_id FROM customer_invoices WHERE invoice_id = $1`,
    [inv.invoice_id]
  );
  const outbound = await loadOutboundForLines(
    client,
    customerRes.rows[0]?.customer_id,
    [...catchupLines, ...existing]
  );
  const merged = collapseDuplicateRentalLines([...catchupLines, ...existing], outbound);
  if (merged.length === existing.length && rentalLinesSubtotal(merged) === rentalLinesSubtotal(existing)) {
    return inv;
  }

  const persisted = await persistDraftInvoiceLines(
    client,
    inv,
    merged,
    parseInvoiceLineDate(inv.from_date),
    parseInvoiceLineDate(inv.to_date)
  );
  await client.query('DELETE FROM customer_invoice_lines WHERE invoice_id = $1', [inv.invoice_id]);
  await insertCustomerInvoiceLines(client, inv.invoice_id, merged);
  return persisted;
}

function invoiceMoneyTotals(subtotal, gstPercent, creditAdjustment, securityDeposit = 0) {
  const gstAmount = parseFloat((Number(subtotal || 0) * Number(gstPercent || 0) / 100).toFixed(2));
  const grandTotal = Math.max(
    0,
    parseFloat((
      Number(subtotal || 0)
      + gstAmount
      - Number(creditAdjustment || 0)
      + Number(securityDeposit || 0)
    ).toFixed(2))
  );
  return { gstAmount, grandTotal };
}

/**
 * Same-month deliveries (including the 1st) stay off this month's draft.
 * Rewind rent_billed_until so the next invoice can bill that first span.
 */
async function stripSameMonthStartRentalsFromDraft(client, inv, month, year) {
  if (!inv || String(inv.status || '').toLowerCase() !== 'draft') {
    return { stripped: 0, inv };
  }
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const lines = invoiceLinesArray(inv.line_items);
  const rental = lines.filter((line) => !isSecurityLine(line));
  const security = lines.filter(isSecurityLine);
  const serialIds = [...new Set(rental.map((line) => Number(line.serial_id)).filter((id) => id > 0))];
  if (!serialIds.length) return { stripped: 0, inv };

  const starts = await client.query(
    `SELECT serial_id
       FROM vendor_serial_numbers
      WHERE serial_id = ANY($1::int[])
        AND rent_start_date >= $2::date
        AND rent_start_date <= $3::date`,
    [serialIds, toLocalYmd(monthStart), toLocalYmd(monthEnd)]
  );
  const dropIds = new Set(starts.rows.map((row) => Number(row.serial_id)));
  if (!dropIds.size) return { stripped: 0, inv };

  const keep = rental.filter((line) => !dropIds.has(Number(line.serial_id)));
  const drop = rental.filter((line) => dropIds.has(Number(line.serial_id)));
  if (!drop.length) return { stripped: 0, inv };

  const dropSerialIds = [...dropIds];
  await client.query(
    `UPDATE vendor_serial_numbers
        SET rent_billed_until = NULL,
            updated_at = NOW()
      WHERE serial_id = ANY($1::int[])
        AND rent_start_date >= $2::date
        AND rent_start_date <= $3::date`,
    [dropSerialIds, toLocalYmd(monthStart), toLocalYmd(monthEnd)]
  );
  await client.query(
    `DELETE FROM customer_invoice_lines
      WHERE invoice_id = $1
        AND COALESCE(line_type, 'rental') <> 'security'
        AND serial_id = ANY($2::int[])`,
    [inv.invoice_id, dropSerialIds]
  );

  const merged = [...keep, ...security];
  const subtotal = rentalLinesSubtotal(merged);
  const securityDeposit = securityLinesSubtotal(merged);
  const gstPercent = parseFloat(inv.gst_percent != null ? inv.gst_percent : 18);
  const credit = parseFloat(inv.credit_note_adjustment || 0);
  const money = invoiceMoneyTotals(subtotal, gstPercent, credit, securityDeposit);
  const bounds = linePeriodBounds(keep);

  await client.query(
    `UPDATE customer_invoices
        SET line_items = $1::jsonb,
            subtotal = $2,
            gst_amount = $3,
            grand_total = $4,
            security_deposit = $5,
            from_date = $6,
            to_date = $7,
            updated_at = NOW()
      WHERE invoice_id = $8`,
    [
      JSON.stringify(merged),
      subtotal.toFixed(2),
      money.gstAmount,
      money.grandTotal,
      securityDeposit.toFixed(2),
      toLocalYmd(bounds.fromDate || monthStart),
      toLocalYmd(bounds.toDate || monthEnd),
      inv.invoice_id,
    ]
  );
  billingLog.info(
    {
      invoiceNumber: inv.invoice_number,
      stripped: drop.length,
      serials: dropSerialIds,
      month,
      year,
    },
    'Removed same-month delivery rental lines from draft'
  );
  return {
    stripped: drop.length,
    inv: {
      ...inv,
      line_items: merged,
      subtotal,
      gst_amount: money.gstAmount,
      grand_total: money.grandTotal,
      security_deposit: securityDeposit,
    },
  };
}

async function persistDraftInvoiceLines(client, inv, merged, fallbackStart, fallbackEnd) {
  const subtotal = rentalLinesSubtotal(merged);
  const securityDeposit = securityLinesSubtotal(merged);
  const gstPercent = parseFloat(inv.gst_percent != null ? inv.gst_percent : 18);
  const credit = parseFloat(inv.credit_note_adjustment || 0);
  const money = invoiceMoneyTotals(subtotal, gstPercent, credit, securityDeposit);
  const bounds = linePeriodBounds(merged.filter((line) => !isSecurityLine(line)));
  await client.query(
    `UPDATE customer_invoices
        SET line_items = $1::jsonb,
            subtotal = $2,
            gst_amount = $3,
            grand_total = $4,
            security_deposit = $5,
            from_date = $6,
            to_date = $7,
            updated_at = NOW()
      WHERE invoice_id = $8`,
    [
      JSON.stringify(merged),
      subtotal.toFixed(2),
      money.gstAmount,
      money.grandTotal,
      securityDeposit.toFixed(2),
      toLocalYmd(bounds.fromDate || fallbackStart),
      toLocalYmd(bounds.toDate || fallbackEnd),
      inv.invoice_id,
    ]
  );
  return {
    ...inv,
    line_items: merged,
    subtotal,
    gst_amount: money.gstAmount,
    grand_total: money.grandTotal,
    security_deposit: securityDeposit,
  };
}

/**
 * Catch-up for months before the invoice month only applies when the laptop
 * was delivered in the previous calendar month. July deliveries were already
 * billed on 1 August — drop those leftover catch-up lines from September.
 */
async function stripEarlyDeliveryCatchupFromDraft(client, inv, month, year) {
  if (!inv || String(inv.status || '').toLowerCase() !== 'draft') {
    return { stripped: 0, inv };
  }
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const { prevStart, prevEnd } = previousMonthRange(month, year);
  const prevStartYmd = toLocalYmd(prevStart);
  const prevEndYmd = toLocalYmd(prevEnd);
  const lines = invoiceLinesArray(inv.line_items);
  const rental = lines.filter((line) => !isSecurityLine(line));
  const security = lines.filter(isSecurityLine);
  const serialIds = [...new Set(rental.map((line) => Number(line.serial_id)).filter((id) => id > 0))];
  if (!serialIds.length) return { stripped: 0, inv };

  const customerRes = await client.query(
    `SELECT customer_id FROM customer_invoices WHERE invoice_id = $1`,
    [inv.invoice_id]
  );
  const outbound = await loadCustomerOutboundDeliveryDates(
    client,
    customerRes.rows[0]?.customer_id,
    serialIds
  );

  const keep = [];
  const drop = [];
  for (const line of rental) {
    const lineStart = String(line.rent_start || '').slice(0, 10);
    const deliveredOn = outbound.get(Number(line.serial_id));
    const deliveredYmd = deliveredOn ? toLocalYmd(deliveredOn) : '';
    const catchupWithoutMarkedPrevMonth = Boolean(
      line.is_catchup
      && lineStart
      && lineStart >= prevStartYmd
      && lineStart <= prevEndYmd
      && (!deliveredYmd || deliveredYmd < prevStartYmd || deliveredYmd > prevEndYmd)
    );
    // September must never bill July (or earlier), even if VSN delivered_at
    // was overwritten by a later re-rent to another customer.
    // Also drop previous-month catch-up when this customer's DC has no POD.
    if ((lineStart && lineStart < prevStartYmd) || catchupWithoutMarkedPrevMonth) {
      drop.push(line);
    } else {
      keep.push(line);
    }
  }
  if (!drop.length) return { stripped: 0, inv };

  const dropSerialIds = [...new Set(drop.map((line) => Number(line.serial_id)).filter((id) => id > 0))];
  const dropStarts = [...new Set(drop.map((line) => String(line.rent_start || '').slice(0, 10)).filter(Boolean))];
  await client.query(
    `DELETE FROM customer_invoice_lines
      WHERE invoice_id = $1
        AND COALESCE(line_type, 'rental') <> 'security'
        AND serial_id = ANY($2::int[])
        AND rent_start = ANY($3::date[])`,
    [inv.invoice_id, dropSerialIds, dropStarts]
  );

  const nextInv = await persistDraftInvoiceLines(client, inv, [...keep, ...security], monthStart, monthEnd);
  billingLog.info(
    {
      invoiceNumber: inv.invoice_number,
      stripped: drop.length,
      serials: dropSerialIds,
      month,
      year,
    },
    'Removed pre-window catch-up rental lines from draft'
  );
  return { stripped: drop.length, inv: nextInv };
}

/**
 * Drop or cap draft rental lines after a warehouse-received return for this
 * customer. Inventory can still say `rented`; the customer page already hides
 * these units from Active.
 */
async function stripWarehouseReturnedRentalsFromDraft(client, inv, month, year) {
  if (!inv || String(inv.status || '').toLowerCase() !== 'draft') {
    return { stripped: 0, inv };
  }
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const customerRes = await client.query(
    `SELECT customer_id FROM customer_invoices WHERE invoice_id = $1`,
    [inv.invoice_id]
  );
  const customerId = customerRes.rows[0]?.customer_id;
  const lines = invoiceLinesArray(inv.line_items);
  const rental = lines.filter((line) => !isSecurityLine(line));
  const security = lines.filter(isSecurityLine);
  const serialIds = [...new Set(rental.map((line) => Number(line.serial_id)).filter((id) => id > 0))];
  if (!customerId || !serialIds.length) return { stripped: 0, inv };

  const returnBySerial = await loadCustomerWarehouseReturnDates(client, customerId, serialIds);
  if (!returnBySerial.size) return { stripped: 0, inv };

  const keep = [];
  const drop = [];
  const capped = [];
  for (const line of rental) {
    const serialId = Number(line.serial_id);
    const returnedOn = returnBySerial.get(serialId);
    if (!returnedOn) {
      keep.push(line);
      continue;
    }
    const start = parseInvoiceLineDate(line.rent_start);
    const end = parseInvoiceLineDate(line.rent_end);
    // Warehouse receive on the 1st (or earlier) means this month is not billable.
    if (start && start > returnedOn) {
      drop.push(line);
      continue;
    }
    // Catch-up on a later invoice is leftover prepaid, not current-month rent.
    // Remove it; unused days after warehouse receive are credited separately.
    if (line.is_catchup && end && end >= returnedOn) {
      drop.push(line);
      continue;
    }
    if (end && end > returnedOn) {
      const next = recalcRentalLineToEnd(line, returnedOn);
      keep.push(next);
      capped.push(next);
      continue;
    }
    keep.push(line);
  }
  if (!drop.length && !capped.length) return { stripped: 0, inv };

  if (drop.length) {
    const dropSerialIds = [...new Set(drop.map((line) => Number(line.serial_id)).filter((id) => id > 0))];
    const dropStarts = [...new Set(drop.map((line) => String(line.rent_start || '').slice(0, 10)).filter(Boolean))];
    await client.query(
      `DELETE FROM customer_invoice_lines
        WHERE invoice_id = $1
          AND COALESCE(line_type, 'rental') <> 'security'
          AND serial_id = ANY($2::int[])
          AND rent_start = ANY($3::date[])`,
      [inv.invoice_id, dropSerialIds, dropStarts]
    );
  }
  for (const line of capped) {
    await client.query(
      `UPDATE customer_invoice_lines
          SET rent_end = $1::date,
              days_billed = $2,
              amount = $3,
              is_returned = TRUE
        WHERE invoice_id = $4
          AND serial_id = $5
          AND COALESCE(line_type, 'rental') <> 'security'
          AND rent_start = $6::date`,
      [
        line.rent_end,
        line.days_in_month,
        line.amount,
        inv.invoice_id,
        line.serial_id,
        String(line.rent_start || '').slice(0, 10),
      ]
    );
  }

  const affectedIds = [...new Set([
    ...drop.map((line) => Number(line.serial_id)),
    ...capped.map((line) => Number(line.serial_id)),
  ].filter((id) => id > 0))];
  for (const serialId of affectedIds) {
    const returnedOn = returnBySerial.get(serialId);
    if (!returnedOn) continue;
    await client.query(
      `UPDATE vendor_serial_numbers
          SET rent_billed_until = $1::date,
              updated_at = NOW()
        WHERE serial_id = $2
          AND (rent_billed_until IS NULL OR rent_billed_until > $1::date)`,
      [toLocalYmd(returnedOn), serialId]
    );
  }

  const nextInv = await persistDraftInvoiceLines(client, inv, [...keep, ...security], monthStart, monthEnd);
  billingLog.info(
    {
      invoiceNumber: inv.invoice_number,
      dropped: drop.length,
      capped: capped.length,
      serials: affectedIds,
      month,
      year,
    },
    'Removed warehouse-returned rental lines from draft'
  );
  return { stripped: drop.length + capped.length, inv: nextInv };
}

async function collapseDuplicateCatchupOnDraft(client, inv, month, year) {
  if (!inv || String(inv.status || '').toLowerCase() !== 'draft') {
    return { stripped: 0, inv };
  }
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const customerRes = await client.query(
    `SELECT customer_id FROM customer_invoices WHERE invoice_id = $1`,
    [inv.invoice_id]
  );
  const lines = invoiceLinesArray(inv.line_items);
  const outbound = await loadOutboundForLines(client, customerRes.rows[0]?.customer_id, lines);
  const next = collapseDuplicateRentalLines(lines, outbound);
  const beforeAmt = rentalLinesSubtotal(lines);
  const afterAmt = rentalLinesSubtotal(next);
  if (next.length === lines.length && beforeAmt === afterAmt) {
    return { stripped: 0, inv };
  }
  const persisted = await persistDraftInvoiceLines(client, inv, next, monthStart, monthEnd);
  await client.query('DELETE FROM customer_invoice_lines WHERE invoice_id = $1', [inv.invoice_id]);
  await insertCustomerInvoiceLines(client, inv.invoice_id, next);
  billingLog.info(
    {
      invoiceNumber: inv.invoice_number,
      before: lines.length,
      after: next.length,
      beforeAmt,
      afterAmt,
    },
    'Collapsed duplicate catch-up / rental lines on draft'
  );
  return { stripped: lines.length - next.length, inv: persisted };
}

async function reconcileDraftRentalWindow(client, inv, month, year) {
  const same = await stripSameMonthStartRentalsFromDraft(client, inv, month, year);
  const early = await stripEarlyDeliveryCatchupFromDraft(client, same.inv, month, year);
  const returned = await stripWarehouseReturnedRentalsFromDraft(client, early.inv, month, year);
  const collapsed = await collapseDuplicateCatchupOnDraft(client, returned.inv, month, year);
  return {
    stripped: (same.stripped || 0) + (early.stripped || 0) + (returned.stripped || 0) + (collapsed.stripped || 0),
    inv: collapsed.inv,
  };
}

async function ensureInvoiceSecurityLines(client, {
  customerId, invoiceId, month, year, actorUserId = null,
}) {
  const invRes = await client.query(
    `SELECT invoice_id, invoice_number, status, line_items, subtotal,
            gst_percent, credit_note_adjustment, security_deposit,
            invoice_month, invoice_year
       FROM customer_invoices
      WHERE invoice_id = $1
      FOR UPDATE`,
    [invoiceId]
  );
  const inv = invRes.rows[0];
  if (!inv || String(inv.status || '').toLowerCase() !== 'draft') {
    return { added: 0, removed: 0, security_total: parseFloat(inv?.security_deposit || 0) };
  }

  const invMonth = Number(month || inv.invoice_month);
  const invYear = Number(year || inv.invoice_year);
  const existing = invoiceLinesArray(inv.line_items);
  const rental = existing.filter((line) => !isSecurityLine(line));
  const securityLines = existing.filter(isSecurityLine);
  const securitySerialIds = [...new Set(
    securityLines.map((line) => Number(line.serial_id)).filter((id) => id > 0)
  )];
  const deliveryById = new Map();
  if (securitySerialIds.length) {
    const deliveries = await client.query(
      `SELECT vsn.serial_id,
              COALESCE(
                (
                  SELECT (dcl.delivered_at AT TIME ZONE 'Asia/Kolkata')::date
                    FROM delivery_challan_lines dcl
                   WHERE COALESCE(dcl.movement_type, 'outbound') = 'outbound'
                     AND dcl.customer_id = $2
                     AND COALESCE(dcl.status, '') NOT IN ('cancelled')
                     AND dcl.serial_number::text ILIKE '%' || vsn.inventory_asset_code || '%'
                     AND dcl.delivered_at IS NOT NULL
                   ORDER BY dcl.delivered_at DESC
                   LIMIT 1
                ),
                vsn.delivered_at::date,
                vsn.rent_start_date,
                vsn.dispatched_at::date
              )::text AS delivery_date
         FROM vendor_serial_numbers vsn
        WHERE vsn.serial_id = ANY($1::int[])`,
      [securitySerialIds, customerId]
    );
    for (const row of deliveries.rows) {
      deliveryById.set(Number(row.serial_id), String(row.delivery_date || '').slice(0, 10));
    }
  }
  const keepSecurity = [];
  const dropSecurity = [];
  for (const line of securityLines) {
    const delivery = deliveryById.get(Number(line.serial_id)) || line.delivery_date || line.rent_start;
    if (deliveryInPreviousMonth(delivery, invMonth, invYear)) keepSecurity.push(line);
    else dropSecurity.push(line);
  }

  if (dropSecurity.length) {
    const dropIds = [...new Set(dropSecurity.map((line) => Number(line.serial_id)).filter((id) => id > 0))];
    const dropTtspl = [...new Set(dropSecurity.map((line) => line.ttspl_id).filter(Boolean))];
    await client.query(
      `DELETE FROM customer_security_deposits
        WHERE invoice_id = $1
          AND status <> 'refunded'
          AND (
            (serial_id IS NOT NULL AND serial_id = ANY($2::int[]))
            OR (ttspl_id IS NOT NULL AND ttspl_id = ANY($3::text[]))
          )`,
      [invoiceId, dropIds, dropTtspl]
    );
    await client.query(
      `DELETE FROM customer_invoice_lines
        WHERE invoice_id = $1
          AND line_type = 'security'
          AND (
            (serial_id IS NOT NULL AND serial_id = ANY($2::int[]))
            OR (ttspl_id IS NOT NULL AND ttspl_id = ANY($3::text[]))
          )`,
      [invoiceId, dropIds, dropTtspl]
    );
  }

  const already = new Set(
    keepSecurity.map((line) => String(line.serial_id || line.ttspl_id || ''))
  );
  const collected = await collectUnbilledSecurityLines(client, {
    customerId,
    month: invMonth,
    year: invYear,
  });
  const fresh = collected.filter((line) => !already.has(String(line.serial_id || line.ttspl_id || '')));
  if (!fresh.length && !dropSecurity.length) {
    return { added: 0, removed: 0, security_total: securityLinesSubtotal(existing) };
  }

  const merged = [...rental, ...keepSecurity, ...fresh];
  const subtotal = rentalLinesSubtotal(merged);
  const securityDeposit = securityLinesSubtotal(merged);
  const gstPercent = parseFloat(inv.gst_percent != null ? inv.gst_percent : 18);
  const credit = parseFloat(inv.credit_note_adjustment || 0);
  const money = invoiceMoneyTotals(subtotal, gstPercent, credit, securityDeposit);

  if (fresh.length) {
    await insertCustomerInvoiceLines(client, invoiceId, fresh);
    await recordSecurityDeposits(client, {
      customerId,
      invoiceId,
      invoiceNumber: inv.invoice_number,
      lines: fresh,
      actorUserId,
    });
  }
  await client.query(
    `UPDATE customer_invoices
        SET line_items = $1::jsonb,
            subtotal = $2,
            gst_amount = $3,
            grand_total = $4,
            security_deposit = $5,
            updated_at = NOW()
      WHERE invoice_id = $6`,
    [
      JSON.stringify(merged),
      subtotal.toFixed(2),
      money.gstAmount,
      money.grandTotal,
      securityDeposit.toFixed(2),
      invoiceId,
    ]
  );
  billingLog.info(
    {
      invoiceNumber: inv.invoice_number,
      customerId,
      added: fresh.length,
      removed: dropSecurity.length,
      securityDeposit,
    },
    'Reconciled one-month security deposit lines'
  );
  return { added: fresh.length, removed: dropSecurity.length, security_total: securityDeposit };
}

/**
 * Attach open draft credit notes to an invoice without changing totals.
 * They stay pending until accounts approves them.
 */
async function linkOpenCreditNotesToInvoice(client, { customerId, invoiceId }) {
  if (!customerId || !invoiceId) return 0;
  const { rowCount } = await client.query(
    `UPDATE customer_credit_notes
        SET invoice_id = COALESCE(invoice_id, $1),
            updated_at = NOW()
      WHERE customer_id = $2
        AND applied_in_invoice_id IS NULL
        AND status IN ('pending', 'approved')`,
    [invoiceId, customerId]
  );
  return rowCount || 0;
}

async function refreshInvoiceCreditTotals(client, invoiceId) {
  const inv = await client.query(
    `SELECT invoice_id, invoice_number, subtotal, gst_percent, credit_note_adjustment, security_deposit
       FROM customer_invoices WHERE invoice_id = $1 FOR UPDATE`,
    [invoiceId]
  );
  if (!inv.rows.length) return null;
  const row = inv.rows[0];
  const applied = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total
       FROM customer_credit_notes
      WHERE applied_in_invoice_id = $1 AND status = 'applied'`,
    [invoiceId]
  );
  const creditAdjustment = parseFloat(applied.rows[0]?.total || 0);
  const next = invoiceMoneyTotals(
    parseFloat(row.subtotal || 0),
    parseFloat(row.gst_percent != null ? row.gst_percent : 18),
    creditAdjustment,
    parseFloat(row.security_deposit || 0)
  );
  await client.query(
    `UPDATE customer_invoices
        SET credit_note_adjustment = $1,
            gst_amount = $2,
            grand_total = $3,
            updated_at = NOW()
      WHERE invoice_id = $4`,
    [creditAdjustment.toFixed(2), next.gstAmount, next.grandTotal, invoiceId]
  );
  return { ...row, credit_note_adjustment: creditAdjustment, ...next };
}

/**
 * Apply approved credit notes onto an invoice and log activity.
 * Draft/pending notes are never applied here.
 */
async function applyOpenCreditNotes(client, { customerId, invoiceId, invoiceNumber, creditNoteIds = null }) {
  const params = [invoiceId, customerId];
  let extra = '';
  if (Array.isArray(creditNoteIds) && creditNoteIds.length) {
    params.push(creditNoteIds);
    extra = ` AND credit_note_id = ANY($3::int[])`;
  }
  const { rows } = await client.query(
    `UPDATE customer_credit_notes
        SET applied_in_invoice_id = $1,
            invoice_id = COALESCE(invoice_id, $1),
            status = 'applied',
            updated_at = NOW()
      WHERE customer_id = $2
        AND applied_in_invoice_id IS NULL
        AND status = 'approved'
        ${extra}
      RETURNING credit_note_id, credit_note_number, amount, serial_id, ttspl_ids, reason`,
    params
  );

  let total = 0;
  for (const cn of rows) {
    total += parseFloat(cn.amount || 0);
    const ttsplIds = Array.isArray(cn.ttspl_ids)
      ? cn.ttspl_ids
      : (typeof cn.ttspl_ids === 'string' ? (() => { try { return JSON.parse(cn.ttspl_ids); } catch { return []; } })() : []);
    const ttspl = ttsplIds.length ? String(ttsplIds[0]) : null;
    await client.query(
      `INSERT INTO customer_asset_activity
        (customer_id, vendor_serial_id, ttspl_id, action, description, changes)
       VALUES ($1, $2, $3, 'credit_note_applied', $4, $5::jsonb)`,
      [
        customerId,
        cn.serial_id || null,
        ttspl,
        `${cn.credit_note_number} applied on ${invoiceNumber || `invoice #${invoiceId}`} — ${cn.reason} (₹${Number(cn.amount).toFixed(2)})`,
        JSON.stringify([{
          field: 'credit_note',
          label: 'Credit note',
          old_value: null,
          new_value: cn.credit_note_number,
          amount: Number(cn.amount),
          invoice_id: invoiceId,
          invoice_number: invoiceNumber || null,
        }]),
      ]
    );
  }

  if (rows.length) {
    billingLog.info(
      { customerId, invoiceId, invoiceNumber, count: rows.length, total },
      'Applied credit notes on invoice'
    );
  }

  return { total: parseFloat(total.toFixed(2)), notes: rows };
}

/**
 * Approve a draft credit note, then apply it to the linked (or latest draft) invoice.
 */
async function approveAndApplyCreditNote(creditNoteId, actorUserId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE customer_credit_notes
          SET status = 'approved',
              approved_by = $1,
              updated_at = NOW()
        WHERE credit_note_id = $2 AND status = 'pending'
        RETURNING *`,
      [actorUserId, creditNoteId]
    );
    if (!updated.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'Credit note not found or not pending' };
    }
    const cn = updated.rows[0];
    let invoiceId = cn.invoice_id || null;
    if (!invoiceId) {
      const draft = await client.query(
        `SELECT invoice_id, invoice_number
           FROM customer_invoices
          WHERE customer_id = $1 AND status = 'draft'
          ORDER BY invoice_year DESC, invoice_month DESC, invoice_id DESC
          LIMIT 1`,
        [cn.customer_id]
      );
      invoiceId = draft.rows[0]?.invoice_id || null;
    }
    let applied = { total: 0, notes: [] };
    if (invoiceId) {
      const inv = await client.query(
        `SELECT invoice_id, invoice_number, status FROM customer_invoices WHERE invoice_id = $1`,
        [invoiceId]
      );
      const invoice = inv.rows[0];
      if (invoice && String(invoice.status || '').toLowerCase() === 'draft') {
        applied = await applyOpenCreditNotes(client, {
          customerId: cn.customer_id,
          invoiceId,
          invoiceNumber: invoice.invoice_number,
          creditNoteIds: [cn.credit_note_id],
        });
        if (applied.notes.length) {
          await refreshInvoiceCreditTotals(client, invoiceId);
        }
      }
    }
    const latest = await client.query(
      `SELECT * FROM customer_credit_notes WHERE credit_note_id = $1`,
      [creditNoteId]
    );
    await client.query('COMMIT');
    return {
      ok: true,
      credit_note: latest.rows[0],
      applied: applied.notes.length > 0,
      invoice_id: invoiceId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Credit unused prepaid days when this customer returned a unit to
 * warehouse. Inventory may already say `rented` on a later customer;
 * use this customer's RDC + billed rate, not current VSN state.
 */
async function createMissingReturnCreditNotes(client, {
  customerId, actorUserId = null, month = null, year = null,
}) {
  const params = [customerId];
  let returnWindowSql = '';
  if (month && year) {
    const { prevStart } = previousMonthRange(month, year);
    const windowEnd = new Date(year, month, 0);
    params.push(toLocalYmd(prevStart), toLocalYmd(windowEnd));
    returnWindowSql = `AND (sti.warehouse_received_at AT TIME ZONE 'Asia/Kolkata')::date
                         BETWEEN $2::date AND $3::date`;
  }

  const { rows } = await client.query(
    `SELECT DISTINCT ON (vsn.serial_id)
            vsn.serial_id,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
            (sti.warehouse_received_at AT TIME ZONE 'Asia/Kolkata')::date AS return_date,
            sti.ticket_id,
            sti.return_dc_number,
            last_line.monthly_rate,
            last_line.rent_end AS billed_until
       FROM vendor_serial_numbers vsn
       JOIN support_ticket_items sti
         ON sti.item_type = 'pickup'
        AND sti.warehouse_received_at IS NOT NULL
        AND (
          sti.ttspl_id = vsn.inventory_asset_code
          OR sti.unique_serial_number = vsn.inventory_asset_code
          OR sti.serial_number = vsn.serial_number
        )
       JOIN delivery_challan_lines rl
         ON rl.dc_number = sti.return_dc_number
        AND rl.movement_type = 'return'
        AND rl.customer_id = $1
        AND COALESCE(rl.status, '') NOT IN ('cancelled')
       JOIN LATERAL (
         SELECT cil.monthly_rate, cil.rent_end
           FROM customer_invoice_lines cil
           JOIN customer_invoices ci ON ci.invoice_id = cil.invoice_id
          WHERE cil.serial_id = vsn.serial_id
            AND ci.customer_id = $1
            AND COALESCE(cil.line_type, 'rental') <> 'security'
            AND LOWER(COALESCE(ci.status, '')) <> 'cancelled'
          ORDER BY cil.rent_end DESC NULLS LAST
          LIMIT 1
       ) last_line ON TRUE
      WHERE vsn.deleted_at IS NULL
        ${returnWindowSql}
        AND NOT (
          vsn.current_customer_id = $1
          AND vsn.inventory_status IN ('rented', 'on_demo', 'in_transit')
        )
        AND last_line.rent_end > (sti.warehouse_received_at AT TIME ZONE 'Asia/Kolkata')::date
        AND NOT EXISTS (
          SELECT 1 FROM customer_credit_notes cn
           WHERE cn.serial_id = vsn.serial_id
             AND cn.customer_id = $1
             AND cn.status <> 'cancelled'
        )
        AND NOT EXISTS (
          SELECT 1
            FROM delivery_challan_lines o
           WHERE COALESCE(o.movement_type, 'outbound') = 'outbound'
             AND o.customer_id = $1
             AND COALESCE(o.status, '') NOT IN ('cancelled')
             AND o.serial_number::text ILIKE '%' || vsn.inventory_asset_code || '%'
             AND COALESCE(o.delivered_at, o.created_at) >
                 COALESCE(rl.delivered_at, rl.created_at, sti.warehouse_received_at)
        )
      ORDER BY vsn.serial_id, sti.warehouse_received_at DESC`,
    params
  );

  const created = [];
  for (const row of rows) {
    const returnDate = new Date(row.return_date);
    const billedUntil = new Date(returnDate.getFullYear(), returnDate.getMonth() + 1, 0);
    const calc = calcReturnCreditNoteAmount({
      rentMonthlyRate: row.monthly_rate,
      returnDate,
      rentBilledUntil: billedUntil,
    });
    if (!calc) continue;

    const num = await client.query(
      `UPDATE sm_document_sequences SET last_value = last_value + 1
        WHERE doc_type = 'credit_note'
        RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`
    );
    const cnNumber = num.rows[0].number;
    const ins = await client.query(
      `INSERT INTO customer_credit_notes
        (credit_note_number, customer_id, reason, description, amount,
         quantity, unit_rate, from_date, to_date, ttspl_ids, status, created_by,
         serial_id, source, support_ticket_id, return_dc_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'pending',$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        cnNumber, customerId,
        'Rental return — unused prepaid days',
        `Unit ${row.ttspl_id || row.serial_id} warehouse received on ${toLocalYmd(returnDate)}` +
          (row.return_dc_number ? ` via ${row.return_dc_number}` : '') +
          `; ${calc.unusedDays} prepaid day(s) (${toLocalYmd(calc.refundStart)} to ${toLocalYmd(calc.billedUntil)}) refunded at ₹${calc.dailyRate.toFixed(2)}/day (base, excl. GST).`,
        calc.amount, calc.unusedDays, calc.dailyRate,
        toLocalYmd(calc.refundStart), toLocalYmd(calc.billedUntil),
        JSON.stringify([row.ttspl_id].filter(Boolean)), actorUserId,
        row.serial_id, 'invoice_generation',
        row.ticket_id || null, row.return_dc_number || null,
      ]
    );
    billingLog.info(
      { cnNumber, amount: calc.amount, customerId, serialId: row.serial_id },
      'Return credit note created'
    );
    created.push(ins.rows[0]);
  }
  return created;
}

async function generateCustomerInvoice(customerId, month, year, options = {}) {
  const billingType = await getCustomerBillingType(pool, customerId);
  if (billingType === 'postpaid') {
    return generatePostpaidCustomerInvoice(customerId, month, year);
  }
  const includeCurrentMonthStarts = Boolean(options.includeCurrentMonthStarts);
  const appendToDraft = Boolean(options.appendToDraft);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const createdNotes = await createMissingReturnCreditNotes(client, {
      customerId, month, year,
    });
    const movedCatchup = await takeMidMonthStartLinesFromPreviousInvoice(client, {
      customerId, month, year,
    });

    const existing = await client.query(
      `SELECT invoice_id, invoice_number, status, line_items, subtotal,
              gst_percent, credit_note_adjustment, from_date, to_date
         FROM customer_invoices
        WHERE customer_id = $1 AND invoice_month = $2 AND invoice_year = $3
        FOR UPDATE`,
      [customerId, month, year]
    );

    const canAppend = appendToDraft
      && existing.rows.length
      && String(existing.rows[0].status || '').toLowerCase() === 'draft';

    if (existing.rows.length && !canAppend) {
      const inv = existing.rows[0];
      const isDraft = String(inv.status || '').toLowerCase() === 'draft';
      let catchupAdded = 0;
      let strippedCount = 0;
      if (isDraft) {
        if (movedCatchup.length) {
          await mergeCatchupOntoDraft(client, inv, movedCatchup);
          catchupAdded = movedCatchup.length;
        }
        const stripped = await reconcileDraftRentalWindow(client, inv, month, year);
        strippedCount = stripped.stripped;
        await linkOpenCreditNotesToInvoice(client, {
          customerId,
          invoiceId: inv.invoice_id,
        });
      }
      const security = isDraft
        ? await ensureInvoiceSecurityLines(client, {
          customerId,
          invoiceId: inv.invoice_id,
          month,
          year,
        })
        : { added: 0, removed: 0 };
      await client.query('COMMIT');
      const changed = catchupAdded > 0 || security.added > 0 || (security.removed || 0) > 0 || strippedCount > 0;
      return {
        skipped: !changed,
        invoice_id: inv.invoice_id,
        invoice_number: inv.invoice_number,
        catchup_lines: catchupAdded,
        security_lines: security.added,
        security_removed: security.removed || 0,
        rental_stripped: strippedCount,
        credit_notes_created: createdNotes.length,
        credit_notes_applied: 0,
        reason: changed
          ? 'Reconciled draft invoice billing window'
          : 'Invoice already exists',
      };
    }

    const built = await buildCustomerInvoiceLines(client, {
      customerId, month, year, monthStart, monthEnd, includeCurrentMonthStarts,
    });
    const outboundForMerge = await loadOutboundForLines(
      client,
      customerId,
      [...movedCatchup, ...built.lineItems]
    );
    const lineItems = collapseDuplicateRentalLines(
      [...movedCatchup, ...built.lineItems],
      outboundForMerge
    );
    const subtotal = rentalLinesSubtotal(lineItems);
    const catchupStarts = movedCatchup
      .map((line) => parseInvoiceLineDate(line.rent_start))
      .filter(Boolean);
    const periodStart = [built.periodStart, ...catchupStarts]
      .filter(Boolean)
      .sort((a, b) => a - b)[0] || built.periodStart;
    const periodEnd = built.periodEnd;

    if (canAppend) {
      const inv = existing.rows[0];
      // Second (or later) delivery in the same month: append unbilled lines onto
      // the existing draft. Sent/approved invoices stay untouched — cron catch-up
      // remains the safety net for any still-unbilled spans.
      if (!lineItems.length) {
        const stripped = await reconcileDraftRentalWindow(client, inv, month, year);
        await linkOpenCreditNotesToInvoice(client, {
          customerId,
          invoiceId: inv.invoice_id,
        });
        const security = await ensureInvoiceSecurityLines(client, {
          customerId,
          invoiceId: inv.invoice_id,
          month,
          year,
        });
        await client.query('COMMIT');
        const changed = security.added > 0 || (security.removed || 0) > 0 || stripped.stripped > 0;
        return {
          skipped: !changed,
          invoice_id: inv.invoice_id,
          invoice_number: inv.invoice_number,
          security_lines: security.added,
          security_removed: security.removed || 0,
          rental_stripped: stripped.stripped,
          credit_notes_created: createdNotes.length,
          credit_notes_applied: 0,
          reason: changed ? 'Reconciled draft invoice billing window' : 'No new unbilled rental lines',
        };
      }
      const stripped = await reconcileDraftRentalWindow(client, inv, month, year);
      const baseInv = stripped.inv || inv;
      const prevLines = invoiceLinesArray(baseInv.line_items);
      const outboundForAppend = await loadOutboundForLines(
        client,
        customerId,
        [...prevLines, ...lineItems]
      );
      const merged = collapseDuplicateRentalLines([...prevLines, ...lineItems], outboundForAppend);
      const newSubtotal = rentalLinesSubtotal(merged);
      const gstPercent = parseFloat(inv.gst_percent != null ? inv.gst_percent : 18);
      const prevFrom = inv.from_date ? new Date(inv.from_date) : null;
      const prevTo = inv.to_date ? new Date(inv.to_date) : null;
      const fromDate = periodStart && (!prevFrom || periodStart < prevFrom) ? periodStart : (prevFrom || periodStart || monthStart);
      const toDate = periodEnd && (!prevTo || periodEnd > prevTo) ? periodEnd : (prevTo || periodEnd || monthEnd);

      await client.query('DELETE FROM customer_invoice_lines WHERE invoice_id = $1', [inv.invoice_id]);
      await insertCustomerInvoiceLines(client, inv.invoice_id, merged);
      await linkOpenCreditNotesToInvoice(client, {
        customerId,
        invoiceId: inv.invoice_id,
      });
      const creditAdjustment = parseFloat(inv.credit_note_adjustment || 0);
      const existingSecurity = securityLinesSubtotal(merged);
      const { gstAmount, grandTotal } = invoiceMoneyTotals(
        newSubtotal, gstPercent, creditAdjustment, existingSecurity
      );

      await client.query(
        `UPDATE customer_invoices
            SET line_items = $1::jsonb,
                subtotal = $2,
                gst_amount = $3,
                credit_note_adjustment = $4,
                grand_total = $5,
                from_date = $6,
                to_date = $7,
                updated_at = NOW()
          WHERE invoice_id = $8`,
        [
          JSON.stringify(merged),
          newSubtotal.toFixed(2),
          gstAmount,
          creditAdjustment.toFixed(2),
          grandTotal,
          toLocalYmd(fromDate),
          toLocalYmd(toDate),
          inv.invoice_id,
        ]
      );
      const security = await ensureInvoiceSecurityLines(client, {
        customerId,
        invoiceId: inv.invoice_id,
        month,
        year,
      });
      await client.query('COMMIT');
      billingLog.info(
        { invoiceNumber: inv.invoice_number, customerId, appended: lineItems.length },
        'Appended unbilled lines to draft PREPAID customer invoice'
      );
      return {
        invoice_id: inv.invoice_id,
        invoice_number: inv.invoice_number,
        appended: true,
        security_lines: security.added,
        credit_notes_created: createdNotes.length,
        credit_notes_applied: 0,
      };
    }

    if (!lineItems.length) {
      await client.query('COMMIT');
      return {
        skipped: true,
        reason: 'No active rental laptops',
        credit_notes_created: createdNotes.length,
        credit_notes_applied: 0,
      };
    }

    const gstPercent = 18;
    const { gstAmount, grandTotal } = invoiceMoneyTotals(subtotal, gstPercent, 0);

    const entityCode = 'rentfoxxy';
    const invoiceNumber = await nextInvoiceNumber(entityCode);

    const insertRes = await client.query(
      `INSERT INTO customer_invoices
        (invoice_number, customer_id, invoice_month, invoice_year,
         invoice_date, from_date, to_date, line_items,
         subtotal, gst_percent, gst_amount,
         credit_note_adjustment, grand_total, status, entity_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,'draft',$14)
       RETURNING invoice_id, invoice_number`,
      [
        invoiceNumber, customerId, month, year,
        toLocalYmd(new Date()),
        toLocalYmd(periodStart || monthStart),
        toLocalYmd(periodEnd || monthEnd),
        JSON.stringify(lineItems),
        subtotal.toFixed(2), gstPercent, gstAmount,
        '0.00', grandTotal, entityCode,
      ]
    );

    const invoiceId = insertRes.rows[0].invoice_id;
    await insertCustomerInvoiceLines(client, invoiceId, lineItems);
    await linkOpenCreditNotesToInvoice(client, { customerId, invoiceId });
    const security = await ensureInvoiceSecurityLines(client, {
      customerId,
      invoiceId,
      month,
      year,
    });

    await client.query('COMMIT');
    billingLog.info(
      { invoiceNumber, customerId, creditNotesCreated: createdNotes.length, securityLines: security.added },
      'Generated PREPAID customer invoice'
    );
    return {
      invoice_id: invoiceId,
      invoice_number: insertRes.rows[0].invoice_number,
      security_lines: security.added,
      credit_notes_created: createdNotes.length,
      credit_notes_applied: 0,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function monthYearFromRentStart(value) {
  if (value == null || value === '') return null;
  let ymd;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // pg DATE often arrives as a JS Date (UTC midnight of the calendar day).
    // Billing uses local calendar dates — match that.
    ymd = toLocalYmd(value);
  } else {
    const s = String(value).trim();
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) {
      ymd = iso[1];
    } else {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return null;
      ymd = toLocalYmd(d);
    }
  }
  const [year, month] = ymd.split('-').map(Number);
  if (!year || !month) return null;
  return { month, year };
}

/**
 * Shared first-period invoice path (DC generate or delivery / demo→keep).
 * Never throws to callers — failures are logged; the 1st-of-month cron is the safety net.
 */
async function maybeInvoiceFirstRentalPeriod({
  customerId,
  dcNumber = null,
  serialIds = null,
  quotationType = 'rental',
  statuses = ['rented'],
  logLabel = 'On-delivery',
} = {}) {
  const qt = String(quotationType || 'rental').toLowerCase();
  if (qt === 'demo' || qt === 'sales' || qt === 'sale') {
    return { skipped: true, reason: `not a rental (${qt})` };
  }
  if (!customerId) {
    return { skipped: true, reason: 'no customer' };
  }

  const billingType = await getCustomerBillingType(pool, customerId);
  if (billingType === 'postpaid') {
    billingLog.info(
      { customerId, dcNumber, serialIds },
      `${logLabel} invoice skipped — postpaid bills previous month on the 1st`
    );
    return { skipped: true, reason: 'postpaid customer' };
  }

  try {
    const params = [customerId, statuses];
    let extra = '';
    if (dcNumber) {
      params.push(dcNumber);
      extra += ` AND current_dc_number = $${params.length}`;
    } else if (Array.isArray(serialIds) && serialIds.length) {
      params.push(serialIds);
      extra += ` AND serial_id = ANY($${params.length}::int[])`;
    }

    const candidates = await pool.query(
      `SELECT serial_id, rent_start_date
         FROM vendor_serial_numbers
        WHERE current_customer_id = $1
          AND deleted_at IS NULL
          AND inventory_status = ANY($2::text[])
          AND rent_billed_until IS NULL
          AND rent_start_date IS NOT NULL
          AND rent_monthly_rate IS NOT NULL
          AND rent_monthly_rate > 0
          ${extra}
        ORDER BY rent_start_date ASC`,
      params
    );

    if (!candidates.rows.length) {
      billingLog.info(
        { customerId, dcNumber, serialIds, statuses },
        `${logLabel} invoice skipped — no first-billed rental assets`
      );
      return { skipped: true, reason: 'no first-billed rental assets' };
    }

    const anchor = monthYearFromRentStart(candidates.rows[0].rent_start_date);
    if (!anchor) {
      billingLog.warn({ customerId, dcNumber }, `${logLabel} invoice skipped — invalid rent_start_date`);
      return { skipped: true, reason: 'invalid rent_start_date' };
    }

    const result = await generateCustomerInvoice(customerId, anchor.month, anchor.year, {
      // Same-month starts wait for the next month as catch-up
      // (sent 10 Aug or 1 Sep → billed on the following month's invoice).
      includeCurrentMonthStarts: false,
      appendToDraft: true,
    });

    if (result.skipped) {
      billingLog.info(
        { customerId, dcNumber, month: anchor.month, year: anchor.year, ...result },
        `${logLabel} invoice skipped (idempotent)`
      );
    } else {
      billingLog.info(
        { customerId, dcNumber, month: anchor.month, year: anchor.year, ...result },
        `${logLabel} rental invoice generated`
      );
    }

    // Always email + mark sent after a new/appended first-period invoice.
    // Opt out with INVOICE_EMAIL_ON_DELIVERY=false.
    const emailDisabled = String(process.env.INVOICE_EMAIL_ON_DELIVERY || 'true').toLowerCase() === 'false';
    if (!emailDisabled && result.invoice_id && !result.skipped) {
      try {
        const sent = await sendGeneratedCustomerInvoice(result.invoice_id);
        result.email_sent = sent;
        billingLog.info(
          { customerId, invoiceId: result.invoice_id, email_sent: sent },
          `${logLabel} invoice send attempted`
        );
      } catch (mailErr) {
        billingLog.error(
          { customerId, invoiceId: result.invoice_id, err: mailErr.message },
          `${logLabel} invoice email failed`
        );
        result.email_error = mailErr.message;
      }
    }

    return result;
  } catch (err) {
    billingLog.error(
      { customerId, dcNumber, serialIds, err: err.message },
      `${logLabel} rental invoice failed — monthly cron remains the safety net`
    );
    return { error: err.message };
  }
}

/**
 * Post-commit: first rental invoice when DC is generated (dispatch).
 * Anchors rent_start_date + rate on in_transit serials, then bills dispatch → month-end.
 * Delivery path remains a no-op safety net once rent_billed_until is set.
 */
async function maybeInvoiceOnRentalDcCreate({
  customerId,
  dcNumber = null,
  quotationType = 'rental',
} = {}) {
  const qt = String(quotationType || 'rental').toLowerCase();
  if (qt === 'demo' || qt === 'sales' || qt === 'sale') {
    return { skipped: true, reason: `not a rental (${qt})` };
  }
  if (!customerId || !dcNumber) {
    return { skipped: true, reason: !customerId ? 'no customer' : 'no dc' };
  }

  try {
    const { resolveSerialRentRate } = require('./serialRentRateService');
    const serials = await pool.query(
      `SELECT serial_id, rent_monthly_rate, rent_start_date, rent_billed_until
         FROM vendor_serial_numbers
        WHERE current_dc_number = $1
          AND current_customer_id = $2
          AND deleted_at IS NULL
          AND inventory_status = 'in_transit'
          AND (rent_billed_until IS NULL)`,
      [dcNumber, customerId]
    );

    if (!serials.rows.length) {
      billingLog.info(
        { customerId, dcNumber },
        'On-DC-create invoice skipped — no unbilled in_transit serials'
      );
      return { skipped: true, reason: 'no unbilled in_transit serials' };
    }

    for (const row of serials.rows) {
      let rate = parseFloat(row.rent_monthly_rate || 0);
      if (!(rate > 0)) {
        rate = await resolveSerialRentRate(pool, row.serial_id, dcNumber);
      }
      if (!(rate > 0)) continue;
      await pool.query(
        `UPDATE vendor_serial_numbers
            SET rent_monthly_rate = $1,
                rent_start_date = COALESCE(rent_start_date, CURRENT_DATE),
                updated_at = NOW()
          WHERE serial_id = $2
            AND rent_billed_until IS NULL`,
        [rate, row.serial_id]
      );
    }

    return maybeInvoiceFirstRentalPeriod({
      customerId,
      dcNumber,
      quotationType,
      statuses: ['in_transit', 'rented'],
      logLabel: 'On-DC-create',
    });
  } catch (err) {
    billingLog.error(
      { customerId, dcNumber, err: err.message },
      'On-DC-create rental invoice failed — delivery/cron remain safety nets'
    );
    return { error: err.message };
  }
}

/**
 * Post-commit trigger for first-period rental billing on delivery (or demo→keep).
 * Gates: rented, rent_billed_until IS NULL, rent_start_date + rent_monthly_rate set.
 */
async function maybeInvoiceOnRentalDelivery(opts = {}) {
  return maybeInvoiceFirstRentalPeriod({
    ...opts,
    statuses: ['rented'],
    logLabel: 'On-delivery',
  });
}

/** Generate PDF, email customer, mark invoice sent. Returns whether SMTP accepted the mail. */
async function sendGeneratedCustomerInvoice(invoiceId, actorUserId = null) {
  const ctrl = require('../controllers/customerBillingController');
  const { emailDocument } = require('./salesManagementPdfService');
  const invRes = await pool.query(
    `SELECT ci.*, c.company_name AS customer_name, c.email AS customer_email
       FROM customer_invoices ci
       LEFT JOIN customers c ON c.customer_id = ci.customer_id
      WHERE ci.invoice_id = $1`,
    [invoiceId]
  );
  const invoice = invRes.rows[0];
  if (!invoice) throw new Error('Invoice not found');
  if (!invoice.customer_email) {
    billingLog.warn({ invoiceId }, 'On-delivery invoice has no customer email — marked sent without email');
  }

  let pdfPath = invoice.pdf_path;
  if (typeof ctrl._generateInvoicePdf === 'function') {
    pdfPath = await ctrl._generateInvoicePdf(invoice);
    await pool.query(
      `UPDATE customer_invoices SET pdf_path = $1, updated_at = NOW() WHERE invoice_id = $2`,
      [pdfPath, invoiceId]
    );
  }

  let sent = false;
  if (invoice.customer_email && pdfPath) {
    sent = await emailDocument({
      to: invoice.customer_email,
      subject: `Invoice ${invoice.invoice_number} — Rentfoxxy`,
      text: `Please find attached invoice ${invoice.invoice_number} for the billing period ${invoice.from_date} to ${invoice.to_date}.`,
      pdfRelativePath: pdfPath,
    });
  }

  await pool.query(
    `UPDATE customer_invoices
        SET status = 'sent', sent_at = NOW(), sent_by = $1, updated_at = NOW()
      WHERE invoice_id = $2 AND status = 'draft'`,
    [actorUserId, invoiceId]
  );

  return Boolean(sent);
}

async function createReturnCreditNote(client, {
  serialId, returnDate, returnTicketId = null, actorUserId = null,
  supportTicketId = null, returnDcNumber = null,
  source = 'return_pickup',
  customerId = null,
}) {
  const r = await client.query(
    `SELECT serial_id, current_customer_id,
            COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl_id,
            rent_billed_until, rent_monthly_rate
       FROM vendor_serial_numbers WHERE serial_id = $1`,
    [serialId]
  );
  const s = r.rows[0];
  const resolvedCustomerId = customerId || s?.current_customer_id;
  if (!s || !resolvedCustomerId || !s.rent_billed_until) return null;

  const billingType = await getCustomerBillingType(client, resolvedCustomerId);
  if (billingType === 'postpaid') {
    billingLog.info(
      { customerId: resolvedCustomerId, serialId },
      'Return credit note skipped — postpaid bills through warehouse received date'
    );
    return null;
  }

  const calc = calcReturnCreditNoteAmount({
    rentMonthlyRate: s.rent_monthly_rate,
    returnDate,
    rentBilledUntil: s.rent_billed_until,
  });
  if (!calc) return null;

  const retDate = new Date(returnDate);
  const num = await client.query(
    `UPDATE sm_document_sequences SET last_value = last_value + 1
     WHERE doc_type = 'credit_note'
     RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`
  );
  const cnNumber = num.rows[0].number;

  const ins = await client.query(
    `INSERT INTO customer_credit_notes
      (credit_note_number, customer_id, reason, description, amount,
       quantity, unit_rate, from_date, to_date, ttspl_ids, status, created_by,
       serial_id, return_ticket_id, source, support_ticket_id, return_dc_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'pending',$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      cnNumber, resolvedCustomerId,
      'Rental return — unused prepaid days',
      `Unit ${s.ttspl_id || s.serial_id} warehouse received on ${toLocalYmd(retDate)}; ` +
        `${calc.unusedDays} prepaid day(s) (${toLocalYmd(calc.refundStart)} to ${toLocalYmd(calc.billedUntil)}) refunded at ₹${calc.dailyRate.toFixed(2)}/day (base, excl. GST).`,
      calc.amount, calc.unusedDays, calc.dailyRate,
      toLocalYmd(calc.refundStart), toLocalYmd(calc.billedUntil),
      JSON.stringify([s.ttspl_id].filter(Boolean)), actorUserId,
      serialId, returnTicketId, source || 'return_pickup',
      supportTicketId, returnDcNumber,
    ]
  );
  billingLog.info({ cnNumber, amount: calc.amount, customerId: resolvedCustomerId, serialId }, 'Return credit note created');
  return ins.rows[0];
}

async function generateAllCustomerInvoices(month, year) {
  const monthEnd = new Date(year, month, 0);
  const { prevStart } = previousMonthRange(month, year);
  const prevMonth = prevStart.getMonth() + 1;
  const prevYear = prevStart.getFullYear();
  const customersRes = await pool.query(
    `SELECT DISTINCT customer_id, billing_type
       FROM (
         SELECT vsn.current_customer_id AS customer_id,
                COALESCE(c.billing_type, 'prepaid') AS billing_type
           FROM vendor_serial_numbers vsn
           JOIN customers c ON c.customer_id = vsn.current_customer_id
          WHERE vsn.current_customer_id IS NOT NULL
            AND vsn.deleted_at IS NULL
            AND vsn.inventory_status IN ('rented', 'returned', 'in_transit')
            AND vsn.rent_start_date IS NOT NULL
            AND vsn.rent_start_date <= $1::date
         UNION
         SELECT c.customer_id, COALESCE(c.billing_type, 'prepaid') AS billing_type
           FROM customers c
          WHERE COALESCE(c.billing_type, 'prepaid') = 'postpaid'
       ) x`,
    [toLocalYmd(monthEnd)]
  );

  return runBillingBatch(`customer-invoices-${month}-${year}`, async () => {
    const results = [];
    for (const row of customersRes.rows) {
      const billMonth = row.billing_type === 'postpaid' ? prevMonth : month;
      const billYear = row.billing_type === 'postpaid' ? prevYear : year;
      try {
        const result = await generateCustomerInvoice(row.customer_id, billMonth, billYear);
        results.push({
          customer_id: row.customer_id,
          billing_type: row.billing_type,
          invoice_month: billMonth,
          invoice_year: billYear,
          ...result,
        });
      } catch (err) {
        billingLog.error({ customerId: row.customer_id, err: err.message }, 'Customer invoice generation failed');
        results.push({ customer_id: row.customer_id, error: err.message });
      }
    }
    return results;
  });
}

async function generateVendorBill(vendorId, month, year) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT bill_id FROM vendor_monthly_bills
       WHERE vendor_id = $1 AND bill_month = $2 AND bill_year = $3`,
      [vendorId, month, year]
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return { skipped: true, bill_id: existing.rows[0].bill_id };
    }

    const serialsRes = await client.query(
      `SELECT vsn.serial_id,
              COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
              vsn.serial_number,
              vsn.inventory_status,
              COALESCE((vsn.extra->>'received_at')::date, vsn.rental_start_date, vsn.created_at::date) AS received_at,
              (vsn.extra->>'returned_at')::date AS returned_at,
              (vpo.line_items->0->>'rate')::numeric AS rental_monthly_rate,
              vpo.purchase_order_type AS po_type
       FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
       WHERE vpo.vendor_id = $1
         AND vpo.purchase_order_type IN ('rental_purchase','rent_to_own')
         AND COALESCE((vsn.extra->>'received_at')::date, vsn.rental_start_date, vsn.created_at::date) IS NOT NULL
         AND COALESCE((vsn.extra->>'received_at')::date, vsn.rental_start_date, vsn.created_at::date) <= $2::date`,
      [vendorId, toLocalYmd(monthEnd)]
    );

    if (!serialsRes.rows.length) {
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'No rental serials' };
    }

    const lineItems = [];
    let subtotal = 0;

    for (const row of serialsRes.rows) {
      const calc = calcVendorLineAmount({
        receivedAt: row.received_at,
        returnedAt: row.returned_at,
        monthStart,
        monthEnd,
        monthlyRate: row.rental_monthly_rate,
      });
      if (!calc) continue;

      subtotal += calc.amount;
      lineItems.push({
        serial_id: row.serial_id,
        ttspl_id: row.ttspl_id || null,
        serial_number: row.serial_number,
        received_date: toLocalYmd(new Date(row.received_at)),
        return_date: row.returned_at ? toLocalYmd(new Date(row.returned_at)) : null,
        days_in_month: calc.days,
        monthly_rate: calc.monthlyRate,
        daily_rate: calc.dailyRate,
        amount: calc.amount,
      });
    }

    if (!lineItems.length) {
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'No active serials in this month' };
    }

    const dnRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_dn
       FROM vendor_debit_notes
       WHERE vendor_id = $1 AND status = 'approved'
         AND adjusted_in_bill_id IS NULL`,
      [vendorId]
    );
    const debitAdjustment = parseFloat(dnRes.rows[0].total_dn || 0);

    const gstAmount = parseFloat((subtotal * 0.18).toFixed(2));
    const totalPayable = Math.max(0, parseFloat((subtotal + gstAmount - debitAdjustment).toFixed(2)));

    const billNumber = await nextVendorBillNumber();

    const insertRes = await client.query(
      `INSERT INTO vendor_monthly_bills
        (bill_number, vendor_id, bill_month, bill_year,
         bill_date, from_date, to_date, line_items,
         subtotal, gst_amount, debit_note_adjustment, total_payable, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,'generated')
       RETURNING bill_id, bill_number`,
      [
        billNumber, vendorId, month, year,
        toLocalYmd(new Date()),
        toLocalYmd(monthStart),
        toLocalYmd(monthEnd),
        JSON.stringify(lineItems),
        subtotal.toFixed(2), gstAmount, debitAdjustment.toFixed(2), totalPayable,
      ]
    );

    const billId = insertRes.rows[0].bill_id;
    await insertVendorBillLines(client, billId, lineItems);

    if (debitAdjustment > 0) {
      await client.query(
        `UPDATE vendor_debit_notes
         SET adjusted_in_bill_id = $1, status = 'adjusted', updated_at = NOW()
         WHERE vendor_id = $2 AND status = 'approved'
           AND adjusted_in_bill_id IS NULL`,
        [billId, vendorId]
      );
    }

    await client.query('COMMIT');
    billingLog.info({ billNumber, vendorId }, 'Generated vendor bill');
    return { bill_id: billId, bill_number: insertRes.rows[0].bill_number };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function generateAllVendorBills(month, year) {
  const vendorsRes = await pool.query(
    `SELECT DISTINCT vpo.vendor_id
     FROM vendor_serial_numbers vsn
     JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
     WHERE vpo.purchase_order_type IN ('rental_purchase','rent_to_own')
       AND COALESCE((vsn.extra->>'received_at')::date, vsn.rental_start_date, vsn.created_at::date) IS NOT NULL`
  );

  return runBillingBatch(`vendor-bills-${month}-${year}`, async () => {
    const results = [];
    for (const row of vendorsRes.rows) {
      try {
        const result = await generateVendorBill(row.vendor_id, month, year);
        results.push({ vendor_id: row.vendor_id, ...result });
      } catch (err) {
        billingLog.error({ vendorId: row.vendor_id, err: err.message }, 'Vendor bill generation failed');
        results.push({ vendor_id: row.vendor_id, error: err.message });
      }
    }
    return results;
  });
}

function billingCronEnabled() {
  const raw = String(process.env.BILLING_CRON_ENABLED ?? 'false').toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}

function startBillingScheduler() {
  if (!billingCronEnabled()) {
    billingLog.info('Billing cron disabled (BILLING_CRON_ENABLED=false) — use manual invoice APIs/scripts');
    return;
  }

  cron.schedule('1 0 1 * *', async () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    billingLog.info({ month, year }, 'CRON: generating PREPAID customer invoices');
    await generateAllCustomerInvoices(month, year);
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('59 23 28-31 * *', async () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (tomorrow.getMonth() !== now.getMonth()) {
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      billingLog.info({ month, year }, 'CRON: generating vendor bills');
      await generateAllVendorBills(month, year);
    }
  }, { timezone: 'Asia/Kolkata' });

  billingLog.info('Billing scheduler started (customer: 1st 00:01 IST, vendor: last day 23:59 IST)');
}

module.exports = {
  startBillingScheduler,
  generateCustomerInvoice,
  generatePostpaidCustomerInvoice,
  generateAllCustomerInvoices,
  generateVendorBill,
  generateAllVendorBills,
  createReturnCreditNote,
  approveAndApplyCreditNote,
  runBillingBatch,
  maybeInvoiceOnRentalDelivery,
  maybeInvoiceOnRentalDcCreate,
  sendGeneratedCustomerInvoice,
  stripSameMonthStartRentalsFromDraft,
  stripEarlyDeliveryCatchupFromDraft,
  stripWarehouseReturnedRentalsFromDraft,
  reconcileDraftRentalWindow,
  createMissingReturnCreditNotes,
  collapseDuplicateRentalLines,
  collapseDuplicateCatchupOnDraft,
  ensureInvoiceSecurityLines,
};
