#!/usr/bin/env node
/**
 * Cancel unused-prepaid credit notes for August deliver-and-return occupancies
 * that were never invoiced to that customer. Then append those occupancies
 * onto September drafts.
 *
 *   node scripts/cancel-unbilled-return-credit-notes.js           (dry-run)
 *   node scripts/cancel-unbilled-return-credit-notes.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { generateCustomerInvoice } = require('../services/billingSchedulerService');

const COMMIT = process.argv.includes('--commit');

const DC_ELEM = `
  jsonb_array_elements_text(
    CASE jsonb_typeof(COALESCE(dcl.delivered_serial_numbers, dcl.serial_number, '[]'::jsonb))
      WHEN 'array' THEN COALESCE(dcl.delivered_serial_numbers, dcl.serial_number)
      ELSE '[]'::jsonb END
  ) elem
`;

function ymd(d) {
  if (!d) return null;
  return new Date(d).toISOString().slice(0, 10);
}

function lineOverlaps(line, start, end) {
  if ((line.line_type || 'rental') === 'security' || line.is_security) return false;
  const s = String(line.rent_start || '').slice(0, 10);
  const e = String(line.rent_end || '').slice(0, 10);
  return s && e && s <= end && e >= start;
}

async function main() {
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

  const occ = await pool.query(`
    WITH outbound AS (
      SELECT dcl.customer_id,
             UPPER(NULLIF(split_part(elem, '|', 3), '')) AS ttspl,
             (COALESCE(dcl.delivered_at, dcl.created_at) AT TIME ZONE 'Asia/Kolkata')::date AS delivery_date
        FROM delivery_challan_lines dcl, ${DC_ELEM}
       WHERE COALESCE(dcl.movement_type, 'outbound') = 'outbound'
         AND COALESCE(dcl.status, '') NOT IN ('cancelled')
         AND (COALESCE(dcl.delivered_at, dcl.created_at) AT TIME ZONE 'Asia/Kolkata')::date
             BETWEEN DATE '2026-08-01' AND DATE '2026-08-31'
         AND NULLIF(split_part(elem, '|', 3), '') <> ''
    ),
    ret AS (
      SELECT rl.customer_id,
             UPPER(COALESCE(sti.ttspl_id, sti.unique_serial_number, '')) AS ttspl,
             (sti.warehouse_received_at AT TIME ZONE 'Asia/Kolkata')::date AS return_date,
             sti.return_dc_number
        FROM support_ticket_items sti
        JOIN delivery_challan_lines rl
          ON rl.dc_number = sti.return_dc_number
         AND rl.movement_type = 'return'
         AND COALESCE(rl.status, '') NOT IN ('cancelled')
       WHERE sti.item_type = 'pickup'
         AND sti.warehouse_received_at IS NOT NULL
    )
    SELECT DISTINCT ON (o.customer_id, o.ttspl, o.delivery_date)
           o.customer_id, o.ttspl, o.delivery_date, r.return_date, r.return_dc_number
      FROM outbound o
      JOIN ret r
        ON r.customer_id = o.customer_id
       AND r.ttspl = o.ttspl
       AND r.return_date >= o.delivery_date
     ORDER BY o.customer_id, o.ttspl, o.delivery_date, r.return_date ASC
  `);

  const toCancel = [];
  const skip = [];
  const chargeCustomers = new Set();

  for (const row of occ.rows) {
    const del = ymd(row.delivery_date);
    const ret = ymd(row.return_date);
    const so = await pool.query(
      `SELECT sol.rate, sol.quotation_type
         FROM sales_order_serials sos
         JOIN sales_order_lines sol ON sol.id = sos.line_id
        WHERE UPPER(sos.ttspl_id) = $1
          AND sol.customer_id = $2
          AND sos.status <> 'removed'
        ORDER BY sos.allocation_id DESC
        LIMIT 1`,
      [row.ttspl, row.customer_id]
    );
    const qt = String(so.rows[0]?.quotation_type || 'rental').toLowerCase();
    const rate = parseFloat(so.rows[0]?.rate || 0);
    if (qt === 'demo' || qt === 'sale' || qt === 'sales' || rate <= 1) {
      skip.push({ ...row, del, ret, reason: `not rental (${qt} ₹${rate})` });
      continue;
    }

    const cil = await pool.query(
      `SELECT ci.invoice_number, cil.rent_start, cil.rent_end, cil.amount
         FROM customer_invoice_lines cil
         JOIN customer_invoices ci ON ci.invoice_id = cil.invoice_id
        WHERE ci.customer_id = $1
          AND UPPER(cil.ttspl_id) = $2
          AND COALESCE(cil.line_type, 'rental') <> 'security'
          AND LOWER(COALESCE(ci.status, '')) <> 'cancelled'
          AND cil.rent_start <= $4::date
          AND cil.rent_end >= $3::date`,
      [row.customer_id, row.ttspl, del, ret]
    );
    const jsonb = await pool.query(
      `SELECT invoice_number, line_items
         FROM customer_invoices
        WHERE customer_id = $1
          AND LOWER(COALESCE(status, '')) <> 'cancelled'
          AND line_items::text ILIKE $2`,
      [row.customer_id, `%${row.ttspl}%`]
    );
    const jsonHits = [];
    for (const inv of jsonb.rows) {
      for (const line of inv.line_items || []) {
        if (String(line.ttspl_id || '').toUpperCase() === row.ttspl && lineOverlaps(line, del, ret)) {
          jsonHits.push(`${inv.invoice_number} ${line.rent_start}..${line.rent_end}`);
        }
      }
    }

    const billed = cil.rows.length > 0 || jsonHits.length > 0;
    const cns = await pool.query(
      `SELECT credit_note_id, credit_note_number, amount, status, from_date, to_date
         FROM customer_credit_notes
        WHERE customer_id = $1
          AND status <> 'cancelled'
          AND reason ILIKE '%unused prepaid%'
          AND (
            return_dc_number = $2
            OR ttspl_ids::text ILIKE $3
          )`,
      [row.customer_id, row.return_dc_number, `%${row.ttspl}%`]
    );

    if (!billed) {
      chargeCustomers.add(row.customer_id);
      for (const cn of cns.rows) {
        toCancel.push({
          id: cn.credit_note_id,
          cn: cn.credit_note_number,
          customer_id: row.customer_id,
          ttspl: row.ttspl,
          del,
          ret,
          amount: cn.amount,
        });
      }
    }
  }

  console.log('\nCredit notes to cancel (August deliver→return, never invoiced):', toCancel.length);
  for (const p of toCancel) {
    console.log(`  ${p.cn} #${p.customer_id} ${p.ttspl} ${p.del}→${p.ret} ₹${p.amount}`);
  }
  console.log('\nCustomers to charge on September draft:', [...chargeCustomers].join(', '));

  if (!COMMIT) {
    await pool.end();
    return;
  }

  if (toCancel.length) {
    const ids = [...new Set(toCancel.map((p) => p.id))];
    const upd = await pool.query(
      `UPDATE customer_credit_notes
          SET status = 'cancelled',
              invoice_id = NULL,
              applied_in_invoice_id = NULL,
              updated_at = NOW()
        WHERE credit_note_id = ANY($1::int[])
        RETURNING credit_note_number`,
      [ids]
    );
    console.log('\nCancelled', upd.rows.map((r) => r.credit_note_number).join(', '));
  }

  console.log('\nAppending completed occupancies to September drafts...');
  for (const customerId of chargeCustomers) {
    const result = await generateCustomerInvoice(customerId, 9, 2026, { appendToDraft: true });
    console.log(`  customer ${customerId}`, {
      skipped: result.skipped,
      invoice: result.invoice_number || result.invoice_id,
      appended: result.appended,
      catchup: result.catchup_lines,
      cn: result.credit_notes_created,
      reason: result.reason,
    });
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
