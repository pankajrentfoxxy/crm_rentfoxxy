require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const ctrl = require('../controllers/customerBillingController');

async function main() {
  // Initech June (return+credit) and Wayne June (catch-up)
  const rows = (await pool.query(
    `SELECT ci.*, c.company_name AS customer_name, c.gst_no AS gst_number
       FROM customer_invoices ci JOIN customers c ON c.customer_id=ci.customer_id
      WHERE ci.invoice_number IN ('INV-0028','INV-0029')`)).rows;
  for (const inv of rows) {
    const rel = await ctrl._generateInvoicePdf(inv);
    const abs = path.join(__dirname, '..', rel);
    const size = fs.statSync(abs).size;
    console.log(`${inv.invoice_number} -> ${rel}  (${size} bytes)  ${size > 800 ? 'OK' : 'TOO SMALL'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
