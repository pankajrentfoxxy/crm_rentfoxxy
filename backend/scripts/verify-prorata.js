require('dotenv').config();
const pool = require('../config/db');
const billing = require('../services/billingSchedulerService');

async function showVendorBill(vendorId, m, y) {
  const r = await billing.generateVendorBill(vendorId, m, y);
  const row = (await pool.query(
    `SELECT bill_number, subtotal, gst_amount, total_payable, jsonb_array_length(line_items) n
       FROM vendor_monthly_bills WHERE vendor_id=$1 AND bill_month=$2 AND bill_year=$3`,
    [vendorId, m, y])).rows[0];
  console.log(`\n=== VENDOR ${vendorId} bill ${m}/${y} ===`, r.skipped ? `(skipped: ${r.reason || 'exists'})` : '');
  if (row) console.log(`  ${row.bill_number}: ${row.n} lines  subtotal ${row.subtotal}  GST ${row.gst_amount}  payable ${row.total_payable}`);
}

async function showCustomerInvoice(customerId, m, y) {
  const r = await billing.generateCustomerInvoice(customerId, m, y);
  const row = (await pool.query(
    `SELECT invoice_number, subtotal, gst_amount, grand_total, jsonb_array_length(line_items) n
       FROM customer_invoices WHERE customer_id=$1 AND invoice_month=$2 AND invoice_year=$3`,
    [customerId, m, y])).rows[0];
  console.log(`\n=== CUSTOMER ${customerId} invoice ${m}/${y} ===`, r.skipped && !row ? `(skipped: ${r.reason || 'exists'})` : '');
  if (row) console.log(`  ${row.invoice_number}: ${row.n} lines  subtotal ${row.subtotal}  GST ${row.gst_amount}  grand_total ${row.grand_total}`);
}

async function main() {
  // Vendor 2 — April + May
  await showVendorBill(2, 4, 2026);
  await showVendorBill(2, 5, 2026);

  // Customer A (9) — April + May ; Customer B (10) — April (expect none) + May
  await showCustomerInvoice(9, 4, 2026);
  await showCustomerInvoice(9, 5, 2026);
  await showCustomerInvoice(10, 4, 2026);
  await showCustomerInvoice(10, 5, 2026);

  process.exit(0);
}
main().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
