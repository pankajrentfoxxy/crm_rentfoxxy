/**
 * Billing Scheduler — customer invoices (1st 00:01 IST) + vendor bills (last day 23:59 IST)
 */
const cron = require('node-cron');
const pool = require('../config/db');

// Format a Date as YYYY-MM-DD in LOCAL time. Using .toISOString() here shifts
// dates back a day in IST (UTC+5:30 midnight = previous day in UTC), which both
// mislabels invoice line items and skews the month-boundary overlap test.
function toLocalYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function nextInvoiceNumber(entity = 'rentfoxxy') {
  // Rentals invoice under Rentfoxxy; per-entity sequence (migration 074),
  // falling back to the legacy shared sequence if the entity one is absent.
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysInclusive = (a, b) => Math.round((b - a) / MS_PER_DAY) + 1;

// Split [start, end] (inclusive, JS Dates at local midnight) into one segment per
// calendar month, each carrying that month's days-in-month for exact pro-rata.
function monthSegments(start, end) {
  const segs = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = cur.getMonth();
    const monthLast = new Date(y, m + 1, 0);
    const segEnd = monthLast < end ? monthLast : end;
    segs.push({ segStart: new Date(cur), segEnd, year: y, month: m + 1, daysInMonth: monthLast.getDate() });
    cur = new Date(y, m + 1, 1);
  }
  return segs;
}

// PREPAID customer invoice for `month/year`.
//  - Bills the invoice month IN ADVANCE (1st -> last day) for every held unit.
//  - CATCH-UP: a unit taken mid-prior-month whose partial period was never
//    invoiced (rent_billed_until IS NULL) is billed from its rent_start_date,
//    so the line spans e.g. 15-May -> 30-Jun on the June invoice.
//  - Each unit emits one line per calendar-month segment (exact pro-rata).
//  - rent_billed_until advances to the billed-through date so the next invoice
//    continues from there (no double billing).
//  - Returned units are billed only up to their return date; the unused prepaid
//    tail is refunded separately by a credit note created at pickup.
//  - Approved, unapplied credit notes are subtracted (base amount) and marked
//    applied. Rentals always bill under Rentfoxxy.
async function generateCustomerInvoice(customerId, month, year) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT invoice_id FROM customer_invoices
       WHERE customer_id = $1 AND invoice_month = $2 AND invoice_year = $3`,
      [customerId, month, year]
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return { skipped: true, invoice_id: existing.rows[0].invoice_id };
    }

    // Units held by this customer with an unbilled rental period up to monthEnd.
    const serialsRes = await client.query(
      `SELECT vsn.serial_id,
              COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
              vsn.serial_number,
              vsn.current_dc_number AS dc_number,
              vsn.inventory_status,
              vsn.rent_start_date,
              vsn.rent_billed_until,
              COALESCE(vsn.rent_end_date, vsn.returned_at::date) AS rent_end_date,
              vsn.rent_monthly_rate,
              COALESCE(vsn.extra->>'brand', '') AS brand,
              COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', '') AS model
         FROM vendor_serial_numbers vsn
        WHERE vsn.current_customer_id = $1
          AND vsn.deleted_at IS NULL
          AND vsn.inventory_status IN ('rented', 'returned')
          AND vsn.rent_start_date IS NOT NULL
          AND vsn.rent_start_date <= $2::date
          AND (vsn.rent_billed_until IS NULL OR vsn.rent_billed_until < $2::date)
        FOR UPDATE`,
      [customerId, toLocalYmd(monthEnd)]
    );

    const lineItems = [];
    let subtotal = 0;
    let periodStart = null;
    let periodEnd = null;

    for (const row of serialsRes.rows) {
      const rentStart = new Date(row.rent_start_date);
      const billedUntil = row.rent_billed_until ? new Date(row.rent_billed_until) : null;
      const rentEnd = row.rent_end_date ? new Date(row.rent_end_date) : null;

      // Start where we left off (prepaid cursor), else from rent start (catch-up).
      let billStart = billedUntil ? addDays(billedUntil, 1) : rentStart;
      if (billStart < rentStart) billStart = rentStart;

      // Advance to end of the invoice month; a returned unit stops at its return.
      let billEnd = monthEnd;
      if (rentEnd && rentEnd < billEnd) billEnd = rentEnd;

      if (billStart > billEnd) continue; // already fully billed / returned before window

      const monthlyRate = parseFloat(row.rent_monthly_rate || 0);
      for (const seg of monthSegments(billStart, billEnd)) {
        const days = daysInclusive(seg.segStart, seg.segEnd);
        const dailyRate = monthlyRate / seg.daysInMonth;
        const amount = parseFloat((dailyRate * days).toFixed(2));
        subtotal += amount;
        const isCatchup = seg.year !== year || seg.month !== month;
        lineItems.push({
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

      // Advance the prepaid cursor so next month continues cleanly.
      await client.query(
        `UPDATE vendor_serial_numbers SET rent_billed_until = $1, updated_at = NOW()
         WHERE serial_id = $2`,
        [toLocalYmd(billEnd), row.serial_id]
      );
    }

    if (!lineItems.length) {
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'No active rental laptops' };
    }

    const cnRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_cn
       FROM customer_credit_notes
       WHERE customer_id = $1 AND status = 'approved'
         AND applied_in_invoice_id IS NULL`,
      [customerId]
    );
    const creditAdjustment = parseFloat(cnRes.rows[0].total_cn || 0);

    const gstPercent = 18;
    const gstAmount = parseFloat((subtotal * gstPercent / 100).toFixed(2));
    const grandTotal = Math.max(0, parseFloat((subtotal + gstAmount - creditAdjustment).toFixed(2)));

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
        creditAdjustment.toFixed(2), grandTotal, entityCode,
      ]
    );

    if (creditAdjustment > 0) {
      await client.query(
        `UPDATE customer_credit_notes
         SET applied_in_invoice_id = $1, status = 'applied', updated_at = NOW()
         WHERE customer_id = $2 AND status = 'approved'
           AND applied_in_invoice_id IS NULL`,
        [insertRes.rows[0].invoice_id, customerId]
      );
    }

    await client.query('COMMIT');
    console.log(`[billing] Generated PREPAID invoice ${invoiceNumber} for customer ${customerId}`);
    return {
      invoice_id: insertRes.rows[0].invoice_id,
      invoice_number: insertRes.rows[0].invoice_number,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Called when a rental unit is picked up (returned). If the customer prepaid
// beyond the return date, raise a PENDING credit note for the unused days
// (base amount only — GST not refunded), for the accounts team to approve.
// Runs inside the caller's transaction (`client`). Returns the credit note row
// or null when nothing is refundable.
async function createReturnCreditNote(client, { serialId, returnDate, returnTicketId = null, actorUserId = null }) {
  const r = await client.query(
    `SELECT serial_id, current_customer_id,
            COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl_id,
            rent_billed_until, rent_monthly_rate
       FROM vendor_serial_numbers WHERE serial_id = $1`,
    [serialId]
  );
  const s = r.rows[0];
  if (!s || !s.current_customer_id || !s.rent_billed_until) return null;

  const billedUntil = new Date(s.rent_billed_until);
  const retDate = new Date(returnDate);
  if (billedUntil <= retDate) return null; // nothing prepaid beyond the return

  // Unused days = (return+1 .. billed-through); priced at the billed-through month.
  const refundStart = addDays(retDate, 1);
  const unusedDays = daysInclusive(refundStart, billedUntil);
  if (unusedDays <= 0) return null;

  const monthDays = new Date(billedUntil.getFullYear(), billedUntil.getMonth() + 1, 0).getDate();
  const monthlyRate = parseFloat(s.rent_monthly_rate || 0);
  const dailyRate = monthlyRate / monthDays;
  const amount = parseFloat((dailyRate * unusedDays).toFixed(2));
  if (amount <= 0) return null;

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
       serial_id, return_ticket_id, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'pending',$11,$12,$13,'return_pickup')
     RETURNING *`,
    [
      cnNumber, s.current_customer_id,
      'Rental return — unused prepaid days',
      `Unit ${s.ttspl_id || s.serial_id} returned on ${toLocalYmd(retDate)}; ` +
        `${unusedDays} prepaid day(s) (${toLocalYmd(refundStart)} to ${toLocalYmd(billedUntil)}) refunded at ₹${dailyRate.toFixed(2)}/day (base, excl. GST).`,
      amount, unusedDays, parseFloat(dailyRate.toFixed(2)),
      toLocalYmd(refundStart), toLocalYmd(billedUntil),
      JSON.stringify([s.ttspl_id].filter(Boolean)), actorUserId,
      serialId, returnTicketId,
    ]
  );
  console.log(`[billing] Return credit note ${cnNumber} (₹${amount}) for customer ${s.current_customer_id}, serial ${serialId}`);
  return ins.rows[0];
}

async function generateAllCustomerInvoices(month, year) {
  // Customers holding billable rental units, per the authoritative inventory.
  const customersRes = await pool.query(
    `SELECT DISTINCT current_customer_id AS customer_id
     FROM vendor_serial_numbers
     WHERE current_customer_id IS NOT NULL
       AND deleted_at IS NULL
       AND inventory_status IN ('rented', 'returned')
       AND rent_start_date IS NOT NULL`
  );

  const results = [];
  for (const row of customersRes.rows) {
    try {
      const result = await generateCustomerInvoice(row.customer_id, month, year);
      results.push({ customer_id: row.customer_id, ...result });
    } catch (err) {
      console.error(`[billing] Error generating invoice for customer ${row.customer_id}:`, err.message);
      results.push({ customer_id: row.customer_id, error: err.message });
    }
  }

  console.log(`[billing] Monthly invoice run complete: ${results.length} customers processed`);
  return results;
}

async function generateVendorBill(vendorId, month, year) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);

  const existing = await pool.query(
    `SELECT bill_id FROM vendor_monthly_bills
     WHERE vendor_id = $1 AND bill_month = $2 AND bill_year = $3`,
    [vendorId, month, year]
  );
  if (existing.rows.length) {
    return { skipped: true, bill_id: existing.rows[0].bill_id };
  }

  const serialsRes = await pool.query(
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
    return { skipped: true, reason: 'No rental serials' };
  }

  const daysInMonth = monthEnd.getDate();
  const lineItems = [];
  let subtotal = 0;

  for (const row of serialsRes.rows) {
    const receivedAt = new Date(row.received_at);
    const returnedAt = row.returned_at ? new Date(row.returned_at) : null;

    const effectiveStart = receivedAt > monthStart ? receivedAt : monthStart;
    const effectiveEnd = (returnedAt && returnedAt < monthEnd) ? returnedAt : monthEnd;

    if (effectiveStart > effectiveEnd) continue;

    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.max(1, Math.round((effectiveEnd - effectiveStart) / msPerDay) + 1);

    const monthlyRate = parseFloat(row.rental_monthly_rate || 0);
    const dailyRate = monthlyRate / daysInMonth;
    const amount = parseFloat((dailyRate * days).toFixed(2));

    subtotal += amount;
    lineItems.push({
      serial_id: row.serial_id,
      ttspl_id: row.ttspl_id || null,
      serial_number: row.serial_number,
      received_date: toLocalYmd(receivedAt),
      return_date: returnedAt ? toLocalYmd(returnedAt) : null,
      days_in_month: days,
      monthly_rate: monthlyRate,
      daily_rate: parseFloat(dailyRate.toFixed(2)),
      amount,
    });
  }

  if (!lineItems.length) {
    return { skipped: true, reason: 'No active serials in this month' };
  }

  const dnRes = await pool.query(
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

  const insertRes = await pool.query(
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

  if (debitAdjustment > 0) {
    await pool.query(
      `UPDATE vendor_debit_notes
       SET adjusted_in_bill_id = $1, status = 'adjusted', updated_at = NOW()
       WHERE vendor_id = $2 AND status = 'approved'
         AND adjusted_in_bill_id IS NULL`,
      [insertRes.rows[0].bill_id, vendorId]
    );
  }

  console.log(`[billing] Generated vendor bill ${billNumber} for vendor ${vendorId}`);
  return { bill_id: insertRes.rows[0].bill_id, bill_number: insertRes.rows[0].bill_number };
}

async function generateAllVendorBills(month, year) {
  const vendorsRes = await pool.query(
    `SELECT DISTINCT vpo.vendor_id
     FROM vendor_serial_numbers vsn
     JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
     WHERE vpo.purchase_order_type IN ('rental_purchase','rent_to_own')
       AND COALESCE((vsn.extra->>'received_at')::date, vsn.rental_start_date, vsn.created_at::date) IS NOT NULL`
  );

  const results = [];
  for (const row of vendorsRes.rows) {
    try {
      const result = await generateVendorBill(row.vendor_id, month, year);
      results.push({ vendor_id: row.vendor_id, ...result });
    } catch (err) {
      console.error(`[billing] Error generating bill for vendor ${row.vendor_id}:`, err.message);
      results.push({ vendor_id: row.vendor_id, error: err.message });
    }
  }
  return results;
}

function startBillingScheduler() {
  cron.schedule('1 0 1 * *', async () => {
    // Customer billing is PREPAID: on the 1st, bill the CURRENT month in advance
    // (the engine also catches up any unbilled mid-prior-month starts).
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    console.log(`[billing] CRON: generating PREPAID customer invoices for ${month}/${year}`);
    await generateAllCustomerInvoices(month, year);
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('59 23 28-31 * *', async () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (tomorrow.getMonth() !== now.getMonth()) {
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      console.log(`[billing] CRON: generating vendor bills for ${month}/${year}`);
      await generateAllVendorBills(month, year);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('[billing] Scheduler started (customer: 1st 00:01 IST, vendor: last day 23:59 IST)');
}

module.exports = {
  startBillingScheduler,
  generateCustomerInvoice,
  generateAllCustomerInvoices,
  generateVendorBill,
  generateAllVendorBills,
  createReturnCreditNote,
};
