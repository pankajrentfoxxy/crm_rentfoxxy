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
 * Build prorated line items for unbilled rental serials and advance rent_billed_until.
 * Mutates serial rows via the open transaction client.
 */
async function buildCustomerInvoiceLines(client, {
  customerId, month, year, monthStart, monthEnd, includeCurrentMonthStarts = false,
}) {
  // Mid-month starts wait for the NEXT month as catch-up
  // (sent 10 Aug → Sept invoice bills 10–31 Aug + 1–30 Sep).
  // includeCurrentMonthStarts is only for rare same-month backfills.
  const startCutoff = includeCurrentMonthStarts ? monthEnd : monthStart;
  const serialsRes = await client.query(
    `SELECT vsn.serial_id,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
            vsn.serial_number,
            vsn.current_dc_number AS dc_number,
            vsn.inventory_status,
            vsn.rent_start_date,
            vsn.rent_billed_until,
            CASE
              WHEN vsn.inventory_status = 'returned'
                THEN COALESCE(vsn.rent_end_date, vsn.returned_at::date)
              ELSE vsn.rent_end_date
            END AS rent_end_date,
            vsn.rent_monthly_rate,
            COALESCE(vsn.extra->>'brand', '') AS brand,
            COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', '') AS model
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

  for (const row of serialsRes.rows) {
    const rentStart = new Date(row.rent_start_date);
    const billedUntil = row.rent_billed_until ? new Date(row.rent_billed_until) : null;
    const rentEndRaw = row.rent_end_date ? new Date(row.rent_end_date) : null;
    // Ignore a leftover return date from a previous rental cycle.
    const rentEnd = rentEndRaw && rentEndRaw >= rentStart ? rentEndRaw : null;

    let billStart = billedUntil ? addDays(billedUntil, 1) : rentStart;
    if (billStart < rentStart) billStart = rentStart;

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
        period: `${seg.year}-${String(seg.month).padStart(2, '0')}`,
        rent_start: toLocalYmd(seg.segStart),
        rent_end: toLocalYmd(seg.segEnd),
        days_in_month: days,
        month_days: seg.daysInMonth,
        monthly_rate: monthlyRate,
        daily_rate: parseFloat(dailyRate.toFixed(2)),
        amount,
        is_catchup: isCatchup,
        returned: row.inventory_status === 'returned',
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
 * Mid-month starts belong on the NEXT month as catch-up (e.g. sent 10 Aug →
 * Sept invoice bills 10–31 Aug catch-up + 1–30 Sep). On-delivery used to put
 * those days on the August invoice, so Sept generate saw billed_until=31 Aug
 * and created no catch-up. Move still-draft start-month lines forward.
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
  const stay = [];
  const move = [];
  for (const line of lines) {
    const start = parseInvoiceLineDate(line.rent_start);
    const midStart = start
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

  const staySubtotal = parseFloat(stay.reduce((sum, line) => sum + Number(line.amount || 0), 0).toFixed(2));
  const gstPercent = parseFloat(inv.gst_percent != null ? inv.gst_percent : 18);
  const credit = parseFloat(inv.credit_note_adjustment || 0);
  const money = invoiceMoneyTotals(staySubtotal, gstPercent, credit);
  const bounds = linePeriodBounds(stay);

  await client.query(
    `UPDATE customer_invoices
        SET line_items = $1::jsonb,
            subtotal = $2,
            gst_amount = $3,
            grand_total = $4,
            from_date = $5,
            to_date = $6,
            updated_at = NOW()
      WHERE invoice_id = $7`,
    [
      JSON.stringify(stay),
      staySubtotal.toFixed(2),
      money.gstAmount,
      money.grandTotal,
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
        AND COALESCE(period_label, $2) = $2
        AND rent_start > $3::date
        AND (
          (serial_id IS NOT NULL AND serial_id = ANY($4::int[]))
          OR (ttspl_id IS NOT NULL AND ttspl_id = ANY($5::text[]))
        )`,
    [inv.invoice_id, expectedPeriod, toLocalYmd(prevStart), serialIds, ttspls]
  );

  billingLog.info(
    {
      customerId,
      fromInvoice: inv.invoice_number,
      moved: move.length,
      month,
      year,
    },
    'Moved mid-month start lines to next-month catch-up'
  );
  return move;
}

async function mergeCatchupOntoDraft(client, inv, catchupLines) {
  if (!catchupLines.length) return inv;
  const existing = invoiceLinesArray(inv.line_items);
  const seen = new Set(existing.map((l) => `${l.serial_id || ''}|${l.ttspl_id || ''}|${l.period || l.rent_start || ''}`));
  const extra = catchupLines.filter((l) => !seen.has(`${l.serial_id || ''}|${l.ttspl_id || ''}|${l.period || l.rent_start || ''}`));
  if (!extra.length) return inv;

  const merged = [...extra, ...existing];
  const subtotal = parseFloat(merged.reduce((sum, line) => sum + Number(line.amount || 0), 0).toFixed(2));
  const gstPercent = parseFloat(inv.gst_percent != null ? inv.gst_percent : 18);
  const credit = parseFloat(inv.credit_note_adjustment || 0);
  const money = invoiceMoneyTotals(subtotal, gstPercent, credit);
  const bounds = linePeriodBounds(merged);

  await insertCustomerInvoiceLines(client, inv.invoice_id, extra);
  await client.query(
    `UPDATE customer_invoices
        SET line_items = $1::jsonb,
            subtotal = $2,
            gst_amount = $3,
            grand_total = $4,
            from_date = $5,
            to_date = $6,
            updated_at = NOW()
      WHERE invoice_id = $7`,
    [
      JSON.stringify(merged),
      subtotal.toFixed(2),
      money.gstAmount,
      money.grandTotal,
      toLocalYmd(bounds.fromDate || new Date(inv.from_date)),
      toLocalYmd(bounds.toDate || new Date(inv.to_date)),
      inv.invoice_id,
    ]
  );
  return {
    ...inv,
    line_items: merged,
    subtotal,
    gst_amount: money.gstAmount,
    grand_total: money.grandTotal,
  };
}

function invoiceMoneyTotals(subtotal, gstPercent, creditAdjustment) {
  const gstAmount = parseFloat((Number(subtotal || 0) * Number(gstPercent || 0) / 100).toFixed(2));
  const grandTotal = Math.max(
    0,
    parseFloat((Number(subtotal || 0) + gstAmount - Number(creditAdjustment || 0)).toFixed(2))
  );
  return { gstAmount, grandTotal };
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
    `SELECT invoice_id, invoice_number, subtotal, gst_percent, credit_note_adjustment
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
    creditAdjustment
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
 * Raise credit notes for returned units that still have unused prepaid days
 * and no CN yet. Must run before invoice lines advance rent_billed_until.
 */
const WAREHOUSE_RETURN_DATE_SQL = `COALESCE(
  (pickup.warehouse_received_at AT TIME ZONE 'Asia/Kolkata')::date,
  (rdc.warehouse_received_at AT TIME ZONE 'Asia/Kolkata')::date
)`;

async function createMissingReturnCreditNotes(client, { customerId, actorUserId = null }) {
  const { rows } = await client.query(
    `SELECT vsn.serial_id,
            ${WAREHOUSE_RETURN_DATE_SQL} AS return_date,
            pickup.ticket_id,
            COALESCE(pickup.return_dc_number, rdc.dc_number) AS return_dc_number
       FROM vendor_serial_numbers vsn
       LEFT JOIN LATERAL (
         SELECT sti.warehouse_received_at,
                sti.ticket_id,
                sti.return_dc_number
           FROM support_ticket_items sti
          WHERE (sti.ttspl_id = vsn.inventory_asset_code
                 OR sti.unique_serial_number = vsn.inventory_asset_code
                 OR sti.serial_number = vsn.serial_number)
            AND sti.item_type = 'pickup'
            AND sti.warehouse_received_at IS NOT NULL
            AND COALESCE(sti.pickup_type, CASE WHEN sti.source_item_id IS NOT NULL THEN 'repair' END, '') <> 'repair'
          ORDER BY sti.warehouse_received_at DESC
          LIMIT 1
       ) pickup ON TRUE
       LEFT JOIN LATERAL (
         SELECT rl.warehouse_received_at, rl.dc_number
           FROM delivery_challan_lines rl
          WHERE rl.movement_type = 'return'
            AND rl.customer_id = $1
            AND COALESCE(rl.status, '') NOT IN ('cancelled')
            AND rl.warehouse_received_at IS NOT NULL
            AND (
              vsn.inventory_asset_code = NULLIF(split_part(rl.serial_number->>0, '|', 3), '')
              OR vsn.serial_number = NULLIF(split_part(rl.serial_number->>0, '|', 2), '')
            )
          ORDER BY rl.warehouse_received_at DESC
          LIMIT 1
       ) rdc ON TRUE
      WHERE vsn.deleted_at IS NULL
        AND vsn.rent_billed_until IS NOT NULL
        AND ${WAREHOUSE_RETURN_DATE_SQL} IS NOT NULL
        AND vsn.rent_billed_until > ${WAREHOUSE_RETURN_DATE_SQL}
        AND (
          vsn.inventory_status IN ('returned', 'in_stock')
          OR vsn.current_customer_id IS NULL
        )
        AND (
          vsn.current_customer_id = $1
          OR EXISTS (
            SELECT 1
              FROM customer_invoice_lines cil
              JOIN customer_invoices ci ON ci.invoice_id = cil.invoice_id
             WHERE cil.serial_id = vsn.serial_id
               AND ci.customer_id = $1
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM customer_credit_notes cn
           WHERE cn.serial_id = vsn.serial_id
             AND cn.status <> 'cancelled'
        )`,
    [customerId]
  );

  const created = [];
  for (const row of rows) {
    const cn = await createReturnCreditNote(client, {
      serialId: row.serial_id,
      returnDate: row.return_date,
      actorUserId,
      supportTicketId: row.ticket_id || null,
      returnDcNumber: row.return_dc_number || null,
      source: 'invoice_generation',
      customerId,
    });
    if (cn) created.push(cn);
  }
  return created;
}

async function generateCustomerInvoice(customerId, month, year, options = {}) {
  const includeCurrentMonthStarts = Boolean(options.includeCurrentMonthStarts);
  const appendToDraft = Boolean(options.appendToDraft);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const createdNotes = await createMissingReturnCreditNotes(client, { customerId });
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
      if (isDraft) {
        if (movedCatchup.length) {
          await mergeCatchupOntoDraft(client, inv, movedCatchup);
          catchupAdded = movedCatchup.length;
        }
        await linkOpenCreditNotesToInvoice(client, {
          customerId,
          invoiceId: inv.invoice_id,
        });
      }
      await client.query('COMMIT');
      return {
        skipped: catchupAdded === 0,
        invoice_id: inv.invoice_id,
        invoice_number: inv.invoice_number,
        catchup_lines: catchupAdded,
        credit_notes_created: createdNotes.length,
        credit_notes_applied: 0,
        reason: catchupAdded ? 'Added previous-month catch-up lines' : 'Invoice already exists',
      };
    }

    const built = await buildCustomerInvoiceLines(client, {
      customerId, month, year, monthStart, monthEnd, includeCurrentMonthStarts,
    });
    const lineItems = [...movedCatchup, ...built.lineItems];
    const subtotal = parseFloat(
      (movedCatchup.reduce((sum, line) => sum + Number(line.amount || 0), 0) + Number(built.subtotal || 0)).toFixed(2)
    );
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
        await linkOpenCreditNotesToInvoice(client, {
          customerId,
          invoiceId: inv.invoice_id,
        });
        await client.query('COMMIT');
        return {
          skipped: true,
          invoice_id: inv.invoice_id,
          invoice_number: inv.invoice_number,
          credit_notes_created: createdNotes.length,
          credit_notes_applied: 0,
          reason: 'No new unbilled rental lines',
        };
      }
      const prevLines = Array.isArray(inv.line_items)
        ? inv.line_items
        : (typeof inv.line_items === 'string' ? JSON.parse(inv.line_items || '[]') : []);
      const merged = [...prevLines, ...lineItems];
      const newSubtotal = parseFloat((parseFloat(inv.subtotal || 0) + subtotal).toFixed(2));
      const gstPercent = parseFloat(inv.gst_percent != null ? inv.gst_percent : 18);
      const prevFrom = inv.from_date ? new Date(inv.from_date) : null;
      const prevTo = inv.to_date ? new Date(inv.to_date) : null;
      const fromDate = periodStart && (!prevFrom || periodStart < prevFrom) ? periodStart : (prevFrom || periodStart || monthStart);
      const toDate = periodEnd && (!prevTo || periodEnd > prevTo) ? periodEnd : (prevTo || periodEnd || monthEnd);

      await insertCustomerInvoiceLines(client, inv.invoice_id, lineItems);
      await linkOpenCreditNotesToInvoice(client, {
        customerId,
        invoiceId: inv.invoice_id,
      });
      const creditAdjustment = parseFloat(inv.credit_note_adjustment || 0);
      const { gstAmount, grandTotal } = invoiceMoneyTotals(newSubtotal, gstPercent, creditAdjustment);

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
      await client.query('COMMIT');
      billingLog.info(
        { invoiceNumber: inv.invoice_number, customerId, appended: lineItems.length },
        'Appended unbilled lines to draft PREPAID customer invoice'
      );
      return {
        invoice_id: inv.invoice_id,
        invoice_number: inv.invoice_number,
        appended: true,
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

    await client.query('COMMIT');
    billingLog.info(
      { invoiceNumber, customerId, creditNotesCreated: createdNotes.length },
      'Generated PREPAID customer invoice'
    );
    return {
      invoice_id: invoiceId,
      invoice_number: insertRes.rows[0].invoice_number,
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
      // Mid-month starts wait for the next month as catch-up
      // (sent 10 Aug → billed 10–31 Aug + 1–30 Sep on the September invoice).
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
  const customersRes = await pool.query(
    `SELECT DISTINCT current_customer_id AS customer_id
     FROM vendor_serial_numbers
     WHERE current_customer_id IS NOT NULL
       AND deleted_at IS NULL
       AND inventory_status IN ('rented', 'returned')
       AND rent_start_date IS NOT NULL`
  );

  return runBillingBatch(`customer-invoices-${month}-${year}`, async () => {
    const results = [];
    for (const row of customersRes.rows) {
      try {
        const result = await generateCustomerInvoice(row.customer_id, month, year);
        results.push({ customer_id: row.customer_id, ...result });
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
              COALESCE(
                NULLIF((vpo.line_items->0->>'rate')::numeric, 0),
                NULLIF((vpo.line_items->0->>'monthly_rental_amount')::numeric, 0),
                NULLIF((vpo.line_items->0->>'monthly_rate')::numeric, 0)
              ) AS rental_monthly_rate,
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
  generateAllCustomerInvoices,
  generateVendorBill,
  generateAllVendorBills,
  createReturnCreditNote,
  approveAndApplyCreditNote,
  runBillingBatch,
  maybeInvoiceOnRentalDelivery,
  maybeInvoiceOnRentalDcCreate,
  sendGeneratedCustomerInvoice,
};
