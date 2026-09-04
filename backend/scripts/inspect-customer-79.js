'use strict';

require('dotenv').config();
const pool = require('../config/db');

(async () => {
  const c = await pool.query(`
    SELECT customer_id, name, company_name, customer_type, status
      FROM customers WHERE customer_id = 79
  `);
  console.log('CUSTOMER', c.rows[0]);

  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'customers' AND column_name ILIKE '%bill%'
        OR (table_name = 'customers' AND column_name ILIKE '%pay%')
        OR (table_name = 'customers' AND column_name ILIKE '%type%')
     ORDER BY column_name
  `);
  console.log('customer cols', cols.rows.map((r) => r.column_name));

  const inv = await pool.query(`
    SELECT invoice_id, invoice_number, invoice_month, invoice_year, status,
           subtotal, gst_amount, security_deposit, credit_note_adjustment, grand_total,
           from_date, to_date
      FROM customer_invoices
     WHERE customer_id = 79
     ORDER BY invoice_year, invoice_month, invoice_id
  `);
  console.log('\nINVOICES');
  for (const r of inv.rows) {
    console.log(r);
    const full = await pool.query('SELECT line_items FROM customer_invoices WHERE invoice_id=$1', [r.invoice_id]);
    const lines = full.rows[0].line_items || [];
    console.log('  lines', lines.length);
    for (const l of lines) {
      console.log(
        `    ${l.ttspl_id} catchup=${!!l.is_catchup} ${l.period} ${String(l.rent_start || '').slice(0, 10)}..${String(l.rent_end || '').slice(0, 10)} amt=${l.amount} type=${l.line_type || 'rental'}`
      );
    }
  }

  const cn = await pool.query(`
    SELECT credit_note_number, status, amount, from_date, to_date, ttspl_ids, serial_id, reason, invoice_id
      FROM customer_credit_notes WHERE customer_id = 79
     ORDER BY credit_note_id
  `);
  console.log('\nCNs', cn.rows);

  const vsn = await pool.query(`
    SELECT serial_id, inventory_asset_code, inventory_status, current_customer_id,
           LEFT(rent_start_date::text,10) AS rent_start,
           LEFT(rent_end_date::text,10) AS rent_end,
           LEFT(rent_billed_until::text,10) AS billed_until,
           LEFT((delivered_at AT TIME ZONE 'Asia/Kolkata')::date::text,10) AS delivered,
           rent_monthly_rate
      FROM vendor_serial_numbers
     WHERE current_customer_id = 79
        OR serial_id IN (
          SELECT DISTINCT (elem->>'serial_id')::int
            FROM customer_invoices ci,
                 LATERAL jsonb_array_elements(ci.line_items) elem
           WHERE ci.customer_id = 79 AND elem->>'serial_id' ~ '^[0-9]+$'
        )
     ORDER BY inventory_asset_code
  `);
  console.log('\nVSN', vsn.rows);

  const tickets = await pool.query(`
    SELECT sti.ticket_id, sti.ttspl_id, sti.item_type,
           LEFT((sti.warehouse_received_at AT TIME ZONE 'Asia/Kolkata')::date::text,10) AS wh,
           sti.return_dc_number, sti.unique_serial_number
      FROM support_ticket_items sti
     WHERE sti.warehouse_received_at IS NOT NULL
       AND (
         sti.ttspl_id IN (SELECT inventory_asset_code FROM vendor_serial_numbers WHERE current_customer_id = 79)
         OR sti.return_dc_number IN (
           SELECT dc_number FROM delivery_challan_lines WHERE customer_id = 79 AND movement_type = 'return'
         )
       )
     ORDER BY sti.warehouse_received_at
  `);
  console.log('\nWAREHOUSE RECEIVES', tickets.rows);

  const rdc = await pool.query(`
    SELECT dc_number, status, movement_type,
           LEFT((delivered_at AT TIME ZONE 'Asia/Kolkata')::date::text,10) AS delivered,
           LEFT((warehouse_received_at AT TIME ZONE 'Asia/Kolkata')::date::text,10) AS wh,
           LEFT(created_at::text,10) AS created,
           serial_number
      FROM delivery_challan_lines
     WHERE customer_id = 79
     ORDER BY created_at
  `);
  console.log('\nDCs');
  for (const r of rdc.rows) {
    console.log(r.movement_type, r.status, r.dc_number, 'del=' + r.delivered, 'wh=' + r.wh, 'cr=' + r.created, r.serial_number);
  }

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
