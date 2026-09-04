'use strict';

require('dotenv').config();
const pool = require('../config/db');

const FOCUS = [
  { invoice: 'INV-1183', ttspl: 'TTSPL5609' },
  { invoice: 'INV-1009', ttspl: 'TTSPL4426' },
  { invoice: 'INV-1014', ttspl: 'TTSPL7203' },
  { invoice: 'INV-1014', ttspl: 'TTSPL5278' },
  { invoice: 'INV-1016', ttspl: 'TTSPL6720' },
  { invoice: 'INV-1125', ttspl: 'TTSPL3876' },
  { invoice: 'INV-1151', ttspl: 'TTSPL6618' },
  { invoice: 'INV-1148', ttspl: null },
];

(async () => {
  for (const item of FOCUS) {
    const inv = (await pool.query(
      `SELECT invoice_id, invoice_number, customer_id, invoice_month, invoice_year, status, line_items
         FROM customer_invoices WHERE invoice_number = $1`,
      [item.invoice]
    )).rows[0];
    if (!inv) {
      console.log('MISSING', item.invoice);
      continue;
    }
    const lines = (inv.line_items || []).filter((l) =>
      !item.ttspl || String(l.ttspl_id || '').toUpperCase() === item.ttspl
    );
    console.log(`\n======== ${item.invoice} cust=${inv.customer_id} ${item.ttspl || 'ALL LINES'} ========`);
    if (!item.ttspl) {
      const by = new Map();
      for (const l of inv.line_items || []) {
        const k = l.ttspl_id || l.serial_id;
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(l);
      }
      for (const [k, arr] of by) {
        const cu = arr.filter((l) => l.is_catchup && l.line_type !== 'security' && !l.is_security);
        if (cu.length > 1 || arr.filter((l) => !l.is_security && l.line_type !== 'security').length > 2) {
          console.log(k, 'lines', arr.length, 'catchup', cu.length);
          for (const x of arr) {
            console.log(' ', x.is_catchup, x.period, String(x.rent_start).slice(0, 10), String(x.rent_end).slice(0, 10), x.amount);
          }
        }
      }
      continue;
    }

    for (const x of lines) {
      console.log(
        `  catchup=${!!x.is_catchup} type=${x.line_type || 'rental'} ${x.period} ` +
        `${String(x.rent_start || '').slice(0, 10)}..${String(x.rent_end || '').slice(0, 10)} amt=${x.amount} sid=${x.serial_id}`
      );
    }
    const sid = Number(lines[0]?.serial_id);
    if (!sid) continue;

    const vsn = (await pool.query(
      `SELECT serial_id, inventory_asset_code, current_customer_id, inventory_status,
              rent_start_date, rent_end_date, rent_billed_until,
              delivered_at, dispatched_at, rent_monthly_rate
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [sid]
    )).rows[0];
    console.log('VSN', vsn);

    const dc = await pool.query(
      `SELECT dc_number, customer_id, status, movement_type,
              LEFT(delivered_at::text,19) AS delivered_at,
              LEFT(created_at::text,19) AS created_at,
              serial_number
         FROM delivery_challan_lines
        WHERE serial_number::text ILIKE '%' || $1 || '%'
        ORDER BY created_at`,
      [item.ttspl]
    );
    console.log('DCs', dc.rows);

    const hist = await pool.query(
      `SELECT invoice_number, invoice_month, invoice_year, customer_id, status, invoice_id
         FROM customer_invoices
        WHERE customer_id = $1
          AND line_items::text ILIKE $2
        ORDER BY invoice_year, invoice_month, invoice_id`,
      [inv.customer_id, `%${item.ttspl}%`]
    );
    for (const r of hist.rows) {
      const full = (await pool.query('SELECT line_items FROM customer_invoices WHERE invoice_id=$1', [r.invoice_id])).rows[0];
      const items = (full.line_items || []).filter((l) => String(l.ttspl_id || '').toUpperCase() === item.ttspl);
      console.log(`HIST ${r.invoice_number} ${r.invoice_month}/${r.invoice_year} ${r.status}`);
      for (const x of items) {
        console.log(
          `    catchup=${!!x.is_catchup} ${x.period} ${String(x.rent_start || '').slice(0, 10)}..${String(x.rent_end || '').slice(0, 10)} amt=${x.amount}`
        );
      }
    }

    const cn = await pool.query(
      `SELECT credit_note_number, invoice_id, applied_in_invoice_id, status, amount,
              from_date, to_date, ttspl_ids, serial_id, reason
         FROM customer_credit_notes
        WHERE customer_id = $1
          AND (
            serial_id = $2
            OR ttspl_ids::text ILIKE $3
            OR invoice_id = $4
            OR applied_in_invoice_id = $4
          )
        ORDER BY credit_note_id`,
      [inv.customer_id, sid, `%${item.ttspl}%`, inv.invoice_id]
    );
    console.log('CNs', cn.rows);
  }

  const listed = ['INV-1006','INV-1016','INV-1112','INV-1009','INV-1125','INV-1014','INV-1148','INV-1151','INV-1183'];
  const allCn = await pool.query(
    `SELECT ci.invoice_number, cn.credit_note_number, cn.status, cn.amount, cn.from_date, cn.to_date,
            cn.serial_id, cn.ttspl_ids, cn.reason, cn.invoice_id
       FROM customer_invoices ci
       JOIN customer_credit_notes cn ON cn.invoice_id = ci.invoice_id OR cn.applied_in_invoice_id = ci.invoice_id
      WHERE ci.invoice_number = ANY($1)
      ORDER BY ci.invoice_number, cn.credit_note_id`,
    [listed]
  );
  console.log('\nALL CNs ON LISTED INVOICES');
  console.log(JSON.stringify(allCn.rows, null, 2));

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
