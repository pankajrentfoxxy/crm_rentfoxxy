/**
 * Billing Scheduler — customer invoices (1st 00:01 IST) + vendor bills (last day 23:59 IST)
 */
const cron = require('node-cron');
const pool = require('../config/db');

async function nextInvoiceNumber() {
  const res = await pool.query(
    `UPDATE sm_document_sequences
     SET last_value = last_value + 1
     WHERE doc_type = 'customer_invoice'
     RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`
  );
  return res.rows[0].number;
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

async function generateCustomerInvoice(customerId, month, year) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);

  const existing = await pool.query(
    `SELECT invoice_id FROM customer_invoices
     WHERE customer_id = $1 AND invoice_month = $2 AND invoice_year = $3`,
    [customerId, month, year]
  );
  if (existing.rows.length) {
    return { skipped: true, invoice_id: existing.rows[0].invoice_id };
  }

  const serialsRes = await pool.query(
    `SELECT DISTINCT ON (dcl.id)
       dcl.id,
       dcl.serial_number,
       dcl.dc_number,
       dcl.brand,
       dcl.model_name,
       dcl.delivered_at,
       dcl.status AS dc_status,
       vsn.ttspl_id,
       vsn.serial_id,
       sol.rate,
       COALESCE(sol.quotation_type, sq.quotation_type, 'rental') AS quotation_type
     FROM delivery_challan_lines dcl
     LEFT JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number AND sol.brand = dcl.brand
     LEFT JOIN sales_quotations sq ON sq.quotation_number = dcl.quotation_number
     LEFT JOIN vendor_serial_numbers vsn
       ON vsn.serial_number = (dcl.serial_number::jsonb->>0)
       OR vsn.ttspl_id = (dcl.serial_number::jsonb->>0)
     WHERE dcl.customer_id = $1
       AND dcl.status IN ('delivered', 'shipped')
       AND COALESCE(sol.quotation_type, sq.quotation_type, 'rental') = 'rental'
     ORDER BY dcl.id, dcl.delivered_at`,
    [customerId]
  );

  if (!serialsRes.rows.length) {
    return { skipped: true, reason: 'No active rental laptops' };
  }

  const daysInMonth = monthEnd.getDate();
  const lineItems = [];
  let subtotal = 0;

  for (const row of serialsRes.rows) {
    const dispatchDate = row.delivered_at ? new Date(row.delivered_at) : monthStart;
    const effectiveStart = dispatchDate > monthStart ? dispatchDate : monthStart;
    const effectiveEnd = monthEnd;

    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.max(1, Math.round((effectiveEnd - effectiveStart) / msPerDay) + 1);

    const monthlyRate = parseFloat(row.rate || 0);
    const dailyRate = monthlyRate / daysInMonth;
    const amount = parseFloat((dailyRate * days).toFixed(2));

    subtotal += amount;
    lineItems.push({
      ttspl_id: row.ttspl_id || null,
      serial_number: row.serial_number,
      dc_number: row.dc_number,
      brand: row.brand || '',
      model: row.model_name || '',
      dispatch_date: effectiveStart.toISOString().slice(0, 10),
      days_in_month: days,
      monthly_rate: monthlyRate,
      daily_rate: parseFloat(dailyRate.toFixed(2)),
      amount,
    });
  }

  const cnRes = await pool.query(
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

  const invoiceNumber = await nextInvoiceNumber();

  const insertRes = await pool.query(
    `INSERT INTO customer_invoices
      (invoice_number, customer_id, invoice_month, invoice_year,
       invoice_date, from_date, to_date, line_items,
       subtotal, gst_percent, gst_amount,
       credit_note_adjustment, grand_total, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,'draft')
     RETURNING invoice_id, invoice_number`,
    [
      invoiceNumber,
      customerId,
      month,
      year,
      new Date().toISOString().slice(0, 10),
      monthStart.toISOString().slice(0, 10),
      monthEnd.toISOString().slice(0, 10),
      JSON.stringify(lineItems),
      subtotal.toFixed(2),
      gstPercent,
      gstAmount,
      creditAdjustment.toFixed(2),
      grandTotal,
    ]
  );

  if (creditAdjustment > 0) {
    await pool.query(
      `UPDATE customer_credit_notes
       SET applied_in_invoice_id = $1, status = 'applied', updated_at = NOW()
       WHERE customer_id = $2 AND status = 'approved'
         AND applied_in_invoice_id IS NULL`,
      [insertRes.rows[0].invoice_id, customerId]
    );
  }

  console.log(`[billing] Generated invoice ${invoiceNumber} for customer ${customerId}`);
  return {
    invoice_id: insertRes.rows[0].invoice_id,
    invoice_number: insertRes.rows[0].invoice_number,
  };
}

async function generateAllCustomerInvoices(month, year) {
  const customersRes = await pool.query(
    `SELECT DISTINCT customer_id
     FROM delivery_challan_lines
     WHERE status IN ('delivered', 'shipped')
       AND customer_id IS NOT NULL`
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
    `SELECT vsn.serial_id, vsn.ttspl_id, vsn.serial_number,
            vsn.inventory_status, vsn.received_at, vsn.returned_at,
            vpo.rental_monthly_rate, vpo.po_type
     FROM vendor_serial_numbers vsn
     JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
     WHERE vsn.vendor_id = $1
       AND vpo.po_type IN ('rental_purchase','rent_to_own')
       AND vsn.received_at IS NOT NULL
       AND vsn.received_at <= $2`,
    [vendorId, monthEnd.toISOString()]
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
      received_date: receivedAt.toISOString().slice(0, 10),
      return_date: returnedAt ? returnedAt.toISOString().slice(0, 10) : null,
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
      new Date().toISOString().slice(0, 10),
      monthStart.toISOString().slice(0, 10),
      monthEnd.toISOString().slice(0, 10),
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
    `SELECT DISTINCT vsn.vendor_id
     FROM vendor_serial_numbers vsn
     JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
     WHERE vpo.po_type IN ('rental_purchase','rent_to_own')
       AND vsn.received_at IS NOT NULL`
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
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    console.log(`[billing] CRON: generating customer invoices for ${prevMonth}/${prevYear}`);
    await generateAllCustomerInvoices(prevMonth, prevYear);
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
};
