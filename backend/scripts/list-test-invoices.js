require('dotenv').config();
const pool = require('../config/db');
async function main() {
  const inv = (await pool.query(
    `SELECT ci.invoice_id, ci.invoice_number, ci.customer_id, c.company_name,
            ci.invoice_month, ci.invoice_year, ci.from_date, ci.to_date,
            ci.subtotal, ci.credit_note_adjustment, ci.grand_total,
            jsonb_array_length(ci.line_items) AS lines
       FROM customer_invoices ci JOIN customers c ON c.customer_id=ci.customer_id
      WHERE ci.customer_id IN (9,10,12,13)
      ORDER BY ci.customer_id, ci.invoice_year, ci.invoice_month`)).rows;
  console.table(inv.map(r => ({ inv: r.invoice_number, cust: r.company_name, m: `${r.invoice_month}/${r.invoice_year}`,
    from: String(r.from_date).slice(0,10), to: String(r.to_date).slice(0,10), lines: r.lines,
    sub: r.subtotal, credit: r.credit_note_adjustment, grand: r.grand_total })));
  const cn = (await pool.query(
    `SELECT cn.credit_note_number, c.company_name, cn.amount, cn.status, cn.from_date, cn.to_date, cn.ttspl_ids, cn.applied_in_invoice_id
       FROM customer_credit_notes cn JOIN customers c ON c.customer_id=cn.customer_id
      WHERE cn.customer_id IN (9,10,12,13) ORDER BY cn.credit_note_id`)).rows;
  console.log('\nCredit notes:');
  console.table(cn.map(r => ({ cn: r.credit_note_number, cust: r.company_name, amt: r.amount, status: r.status,
    period: `${String(r.from_date).slice(0,10)}..${String(r.to_date).slice(0,10)}`, ttspl: JSON.stringify(r.ttspl_ids), applied_in: r.applied_in_invoice_id })));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
