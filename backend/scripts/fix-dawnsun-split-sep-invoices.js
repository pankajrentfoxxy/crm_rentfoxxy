#!/usr/bin/env node
/**
 * Split September billing after Dawnsun Exim (#126) / Kyosei (#981) laptop split.
 * Move TTSPL2441, TTSPL2769, TTSPL3254 off INV-1060 onto a new Kyosei Sep invoice.
 *
 *   node scripts/fix-dawnsun-split-sep-invoices.js           (dry-run)
 *   node scripts/fix-dawnsun-split-sep-invoices.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { generateCustomerInvoice } = require('../services/billingSchedulerService');

const COMMIT = process.argv.includes('--commit');
const EXIM_ID = 126;
const KYOSEI_ID = 981;
const SEP_INV_ID = 1443;
const MOVE_SERIALS = [20, 21, 22];
const MOVE_TTSPL = ['TTSPL2441', 'TTSPL2769', 'TTSPL3254'];

function isSecurity(line) {
  return line.line_type === 'security' || line.is_security === true;
}

function rentalSubtotal(lines) {
  return parseFloat(
    lines.filter((l) => !isSecurity(l)).reduce((s, l) => s + Number(l.amount || 0), 0).toFixed(2)
  );
}

function moneyTotals(subtotal, gstPercent) {
  const gstAmount = parseFloat((Number(subtotal || 0) * Number(gstPercent || 0) / 100).toFixed(2));
  const grandTotal = parseFloat((Number(subtotal || 0) + gstAmount).toFixed(2));
  return { gstAmount, grandTotal };
}

function parseLines(inv) {
  const raw = inv.line_items;
  return Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
}

async function main() {
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sepRes = await client.query(
      'SELECT * FROM customer_invoices WHERE invoice_id = $1 AND customer_id = $2 FOR UPDATE',
      [SEP_INV_ID, EXIM_ID]
    );
    const sep = sepRes.rows[0];
    if (!sep || sep.status !== 'draft') throw new Error('Exim September draft INV-1060 not found');

    const lines = parseLines(sep);
    const keep = [];
    const moved = [];
    for (const line of lines) {
      const sid = Number(line.serial_id);
      if (MOVE_SERIALS.includes(sid) || MOVE_TTSPL.includes(line.ttspl_id)) {
        moved.push(line);
      } else {
        keep.push(line);
      }
    }
    if (moved.length !== 3) {
      throw new Error(`Expected 3 moved lines, found ${moved.length}: ${moved.map((l) => l.ttspl_id).join(',')}`);
    }
    console.log('Moving off Exim INV-1060:', moved.map((l) => `${l.ttspl_id} ₹${l.amount}`).join(', '));
    console.log('Exim remaining:', keep.map((l) => `${l.ttspl_id || l.serial_number} ₹${l.amount}`).join(', '));

    const subtotal = rentalSubtotal(keep);
    const { gstAmount, grandTotal } = moneyTotals(subtotal, parseFloat(sep.gst_percent || 18));
    await client.query(
      `UPDATE customer_invoices
          SET line_items = $1::jsonb,
              subtotal = $2,
              gst_amount = $3,
              grand_total = $4,
              from_date = '2026-09-01',
              to_date = '2026-09-30',
              updated_at = NOW()
        WHERE invoice_id = $5`,
      [JSON.stringify(keep), subtotal.toFixed(2), gstAmount, grandTotal, SEP_INV_ID]
    );
    await client.query(
      `DELETE FROM customer_invoice_lines
        WHERE invoice_id = $1
          AND (serial_id = ANY($2::int[]) OR ttspl_id = ANY($3::text[]))`,
      [SEP_INV_ID, MOVE_SERIALS, MOVE_TTSPL]
    );

    await client.query(
      `UPDATE vendor_serial_numbers
          SET rent_billed_until = '2026-08-31',
              updated_at = NOW()
        WHERE serial_id = ANY($1::int[])
          AND current_customer_id = $2`,
      [MOVE_SERIALS, KYOSEI_ID]
    );

    console.log('Exim INV-1060 after:', { subtotal, gstAmount, grandTotal, lines: keep.length });

    if (COMMIT) {
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
      console.log('Rolled back Exim edit (dry-run).');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (!COMMIT) {
    console.log('Re-run with --commit to apply Exim strip + generate Kyosei September invoice.');
    await pool.end();
    return;
  }

  const result = await generateCustomerInvoice(KYOSEI_ID, 9, 2026);
  console.log('Kyosei generate:', result);

  const check = await pool.query(
    `SELECT ci.customer_id, ci.invoice_number, ci.subtotal, ci.gst_amount, ci.grand_total,
            jsonb_array_length(ci.line_items) AS lines,
            (
              SELECT json_agg(json_build_object(
                'ttspl', e->>'ttspl_id', 'start', LEFT(e->>'rent_start',10),
                'end', LEFT(e->>'rent_end',10), 'amount', e->>'amount'
              ) ORDER BY e->>'ttspl_id')
              FROM jsonb_array_elements(ci.line_items) e
              WHERE COALESCE(e->>'line_type','rental') <> 'security'
            ) AS rental
       FROM customer_invoices ci
      WHERE ci.customer_id IN (126, 981)
        AND ci.invoice_month = 9 AND ci.invoice_year = 2026
        AND ci.status <> 'cancelled'`
  );
  console.log('September invoices:', JSON.stringify(check.rows, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
