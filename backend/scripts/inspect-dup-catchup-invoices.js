'use strict';

require('dotenv').config();
const pool = require('../config/db');

const NUMS = [
  'INV-1006', 'INV-1016', 'INV-1112', 'INV-1009', 'INV-1125',
  'INV-1014', 'INV-1148', 'INV-1151', 'INV-1183',
];

function isSecurity(line) {
  return line?.line_type === 'security' || line?.is_security === true;
}

(async () => {
  const inv = await pool.query(
    `SELECT invoice_id, invoice_number, customer_id, invoice_month, invoice_year, status,
            subtotal, gst_amount, security_deposit, credit_note_adjustment, grand_total
       FROM customer_invoices
      WHERE invoice_number = ANY($1)
      ORDER BY invoice_number`,
    [NUMS]
  );
  console.log('INVOICES');
  for (const r of inv.rows) {
    console.log(
      `${r.invoice_number} #${r.invoice_id} cust=${r.customer_id} ${r.invoice_month}/${r.invoice_year} ${r.status}` +
      ` sub=${r.subtotal} gst=${r.gst_amount} sec=${r.security_deposit} cn=${r.credit_note_adjustment} grand=${r.grand_total}`
    );
  }

  const lines = await pool.query(
    `SELECT ci.invoice_id, ci.invoice_number, ci.customer_id,
            COALESCE(NULLIF(c.company_name, ''), c.name) AS customer,
            ci.line_items
       FROM customer_invoices ci
       LEFT JOIN customers c ON c.customer_id = ci.customer_id
      WHERE ci.invoice_number = ANY($1)
      ORDER BY ci.invoice_number`,
    [NUMS]
  );

  console.log('\nDUPLICATE CATCH-UP / MULTI LINES PER LAPTOP');
  for (const invRow of lines.rows) {
    const items = Array.isArray(invRow.line_items) ? invRow.line_items : [];
    const byKey = new Map();
    for (const line of items) {
      const key = String(line.ttspl_id || line.serial_id || line.serial_number || '?');
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(line);
    }
    for (const [key, arr] of byKey) {
      const catchups = arr.filter((l) => l.is_catchup && !isSecurity(l));
      if (arr.length < 2 && catchups.length < 2) continue;
      if (catchups.length < 2 && arr.filter((l) => !isSecurity(l)).length < 2) continue;
      console.log(`\n${invRow.invoice_number} ${invRow.customer} ${key} total=${arr.length} catchup=${catchups.length}`);
      for (const x of arr) {
        console.log(
          `  type=${x.line_type || 'rental'} catchup=${!!x.is_catchup} period=${x.period || ''} ` +
          `${String(x.rent_start || '').slice(0, 10)}..${String(x.rent_end || '').slice(0, 10)} ` +
          `${x.days_in_month}/${x.month_days} rate=${x.monthly_rate} amt=${x.amount} sid=${x.serial_id}`
        );
      }
    }
  }

  const ttspl = await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, status, customer_id,
            rent_start_date, rent_end_date, rent_billed_until, delivered_at, dispatched_at,
            rent_monthly_rate, extra
       FROM vendor_serial_numbers
      WHERE inventory_asset_code ILIKE 'TTSPL5609'
         OR serial_number ILIKE '%5609%'
      ORDER BY serial_id`
  );
  console.log('\nTTSPL5609 VSN');
  console.log(JSON.stringify(ttspl.rows, null, 2));

  if (ttspl.rows[0]) {
    const sid = ttspl.rows[0].serial_id;
    const dc = await pool.query(
      `SELECT dc.dc_id, dc.dc_number, dc.customer_id, dc.status, dc.delivered_at, dc.dispatched_at,
              dc.created_at, dci.serial_id
         FROM sales_delivery_challans dc
         JOIN sales_dc_items dci ON dci.dc_id = dc.dc_id
        WHERE dci.serial_id = $1
        ORDER BY dc.dc_id`,
      [sid]
    ).catch(() => ({ rows: [] }));
    console.log('\nDC rows', dc.rows);

    const hist = await pool.query(
      `SELECT invoice_id, invoice_number, invoice_month, invoice_year, customer_id, status
         FROM customer_invoices
        WHERE line_items::text ILIKE '%TTSPL5609%'
           OR line_items::text ILIKE '%"serial_id": ${sid}%'
           OR line_items::text ILIKE '%"serial_id":${sid}%'
        ORDER BY invoice_year, invoice_month`
    );
    console.log('\nInvoices mentioning TTSPL5609');
    for (const r of hist.rows) {
      const full = await pool.query('SELECT line_items FROM customer_invoices WHERE invoice_id=$1', [r.invoice_id]);
      const items = (full.rows[0].line_items || []).filter((l) =>
        String(l.ttspl_id || '').toUpperCase() === 'TTSPL5609' || Number(l.serial_id) === sid
      );
      console.log(`${r.invoice_number} ${r.invoice_month}/${r.invoice_year} cust=${r.customer_id} ${r.status}`);
      for (const x of items) {
        console.log(
          `  catchup=${!!x.is_catchup} ${x.period} ${String(x.rent_start || '').slice(0, 10)}..${String(x.rent_end || '').slice(0, 10)} amt=${x.amount}`
        );
      }
    }
  }

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
