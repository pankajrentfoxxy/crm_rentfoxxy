/**
 * Normalized invoice/bill line mirrors (migration 119).
 * JSONB snapshots on parent rows remain the legal source; these enable SQL reporting.
 */

async function insertCustomerInvoiceLines(client, invoiceId, lineItems) {
  if (!lineItems?.length) return;
  for (const line of lineItems) {
    await client.query(
      `INSERT INTO customer_invoice_lines
        (invoice_id, serial_id, ttspl_id, brand, model, period_label,
         rent_start, rent_end, days_billed, days_in_month, monthly_rate, daily_rate,
         amount, is_catchup, is_returned, line_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        invoiceId,
        line.serial_id ?? null,
        line.ttspl_id ?? null,
        line.brand || null,
        line.model || null,
        line.period || null,
        line.rent_start || null,
        line.rent_end || null,
        line.days_in_month ?? null,
        line.month_days ?? null,
        line.monthly_rate ?? null,
        line.daily_rate ?? null,
        line.amount ?? null,
        !!line.is_catchup,
        !!line.returned,
        line.line_type || (line.is_security ? 'security' : 'rental'),
      ]
    );
  }
}

async function insertVendorBillLines(client, billId, lineItems) {
  if (!lineItems?.length) return;
  for (const line of lineItems) {
    await client.query(
      `INSERT INTO vendor_bill_lines
        (bill_id, serial_id, ttspl_id, days_in_month, monthly_rate, daily_rate, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        billId,
        line.serial_id ?? null,
        line.ttspl_id ?? null,
        line.days_in_month ?? null,
        line.monthly_rate ?? null,
        line.daily_rate ?? null,
        line.amount ?? null,
      ]
    );
  }
}

module.exports = {
  insertCustomerInvoiceLines,
  insertVendorBillLines,
};
