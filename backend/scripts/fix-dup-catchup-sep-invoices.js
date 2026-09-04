#!/usr/bin/env node
/**
 * Collapse duplicate / overlapping August catch-up on September drafts.
 * Also snaps catch-up start to this customer's outbound DC delivery.
 *
 *   node scripts/fix-dup-catchup-sep-invoices.js           (dry-run)
 *   node scripts/fix-dup-catchup-sep-invoices.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const {
  collapseDuplicateRentalLines,
} = require('../services/billingSchedulerService');
const { insertCustomerInvoiceLines } = require('../services/billingLineItemsService');
const { rentalLinesSubtotal, securityLinesSubtotal, isSecurityLine } = require('../services/billingSecurityService');
const { toLocalYmd, calcReturnCreditNoteAmount } = require('../services/billingMath');

const COMMIT = process.argv.includes('--commit');
const FOCUS = ['INV-1006', 'INV-1016', 'INV-1112', 'INV-1009', 'INV-1125', 'INV-1014', 'INV-1148', 'INV-1151', 'INV-1183'];

function moneyTotals(subtotal, gstPercent, creditAdjustment = 0, securityDeposit = 0) {
  const gstAmount = parseFloat((Number(subtotal || 0) * Number(gstPercent || 0) / 100).toFixed(2));
  const grandTotal = Math.max(
    0,
    parseFloat((
      Number(subtotal || 0) + gstAmount - Number(creditAdjustment || 0) + Number(securityDeposit || 0)
    ).toFixed(2))
  );
  return { gstAmount, grandTotal };
}

async function loadOutbound(client, customerId, lines) {
  const ids = [...new Set(lines.map((l) => Number(l.serial_id)).filter((id) => id > 0))];
  const bySerial = new Map();
  if (!customerId || !ids.length) return bySerial;
  const { rows } = await client.query(
    `SELECT DISTINCT ON (vsn.serial_id)
            vsn.serial_id,
            (dcl.delivered_at AT TIME ZONE 'Asia/Kolkata')::date::text AS delivery_date
       FROM vendor_serial_numbers vsn
       JOIN delivery_challan_lines dcl
         ON COALESCE(dcl.movement_type, 'outbound') = 'outbound'
        AND dcl.customer_id = $1
        AND COALESCE(dcl.status, '') NOT IN ('cancelled', 'rejected')
        AND dcl.serial_number::text ILIKE '%' || vsn.inventory_asset_code || '%'
      WHERE vsn.serial_id = ANY($2::int[])
      ORDER BY vsn.serial_id, dcl.delivered_at DESC NULLS LAST, dcl.created_at DESC`,
    [customerId, ids]
  );
  for (const row of rows) {
    if (!row.delivery_date) continue;
    const [y, m, d] = row.delivery_date.split('-').map(Number);
    bySerial.set(Number(row.serial_id), new Date(y, m - 1, d));
  }
  return bySerial;
}

async function persistInvoice(client, inv, lines) {
  const rental = lines.filter((l) => !isSecurityLine(l));
  const subtotal = rentalLinesSubtotal(lines);
  const securityDeposit = securityLinesSubtotal(lines);
  const gstPercent = parseFloat(inv.gst_percent != null ? inv.gst_percent : 18);
  const credit = parseFloat(inv.credit_note_adjustment || 0);
  const { gstAmount, grandTotal } = moneyTotals(subtotal, gstPercent, credit, securityDeposit);
  const starts = rental.map((l) => String(l.rent_start || '').slice(0, 10)).filter(Boolean).sort();
  const ends = rental.map((l) => String(l.rent_end || '').slice(0, 10)).filter(Boolean).sort();
  await client.query(
    `UPDATE customer_invoices
        SET line_items = $1::jsonb,
            subtotal = $2,
            gst_amount = $3,
            grand_total = $4,
            security_deposit = $5,
            from_date = $6,
            to_date = $7,
            updated_at = NOW()
      WHERE invoice_id = $8`,
    [
      JSON.stringify(lines),
      subtotal.toFixed(2),
      gstAmount,
      grandTotal,
      securityDeposit.toFixed(2),
      starts[0] || inv.from_date,
      ends[ends.length - 1] || inv.to_date,
      inv.invoice_id,
    ]
  );
  await client.query('DELETE FROM customer_invoice_lines WHERE invoice_id = $1', [inv.invoice_id]);
  await insertCustomerInvoiceLines(client, inv.invoice_id, lines);
  return { subtotal, gstAmount, grandTotal, lines: lines.length };
}

function summarizeCatchup(lines) {
  return lines
    .filter((l) => l.is_catchup && !isSecurityLine(l))
    .map((l) => `${l.ttspl_id} ${String(l.rent_start).slice(0, 10)}..${String(l.rent_end).slice(0, 10)} ₹${l.amount}`)
    .join(' | ');
}

async function main() {
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: invoices } = await client.query(
      `SELECT *
         FROM customer_invoices
        WHERE invoice_month = 9 AND invoice_year = 2026
          AND status = 'draft'
        ORDER BY invoice_number`
    );

    const changed = [];
    for (const inv of invoices) {
      const lines = Array.isArray(inv.line_items) ? inv.line_items : JSON.parse(inv.line_items || '[]');
      const buckets = new Map();
      for (const line of lines) {
        if (isSecurityLine(line)) continue;
        const period = String(line.period || String(line.rent_start || '').slice(0, 7));
        const key = `${line.is_catchup ? 'c' : 'r'}|${line.serial_id || ''}|${String(line.ttspl_id || '').toUpperCase()}|${period}`;
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }
      const hasDup = [...buckets.values()].some((n) => n > 1);
      if (!hasDup) continue;

      const outbound = await loadOutbound(client, inv.customer_id, lines);
      const next = collapseDuplicateRentalLines(lines, outbound);
      const before = rentalLinesSubtotal(lines);
      const after = rentalLinesSubtotal(next);
      if (next.length === lines.length && before === after) continue;

      const report = {
        invoice: inv.invoice_number,
        customer_id: inv.customer_id,
        lines_before: lines.length,
        lines_after: next.length,
        subtotal_before: Number(inv.subtotal),
        subtotal_after: after,
        dropped: Number((before - after).toFixed(2)),
        catchup_before: summarizeCatchup(lines),
        catchup_after: summarizeCatchup(next),
      };
      changed.push(report);
      console.log(JSON.stringify(report, null, 2));

      if (COMMIT) {
        const money = await persistInvoice(client, inv, next);
        report.grand_after = money.grandTotal;
      }
    }

    const listedUnchanged = FOCUS.filter((num) => !changed.some((c) => c.invoice === num));
    console.log('\nListed invoices with no duplicate catch-up to remove:', listedUnchanged.join(', ') || 'none');

    const invoiceIds = changed.map((c) => {
      const row = invoices.find((i) => i.invoice_number === c.invoice);
      return row?.invoice_id;
    }).filter(Boolean);

    if (invoiceIds.length) {
      const cns = await client.query(
        `SELECT cn.credit_note_number, cn.customer_id, cn.invoice_id, cn.status, cn.amount,
                cn.from_date, cn.to_date, cn.serial_id, cn.ttspl_ids, cn.reason,
                ci.invoice_number
           FROM customer_credit_notes cn
           JOIN customer_invoices ci ON ci.invoice_id = cn.invoice_id
          WHERE cn.invoice_id = ANY($1::int[])
            AND cn.status = 'pending'
          ORDER BY ci.invoice_number, cn.credit_note_id`,
        [invoiceIds]
      );
      console.log('\nPending CNs on changed invoices (unused-day CNs, not the duplicate catch-up):');
      for (const cn of cns.rows) {
        const last = await client.query(
          `SELECT cil.monthly_rate, cil.rent_end
             FROM customer_invoice_lines cil
             JOIN customer_invoices ci ON ci.invoice_id = cil.invoice_id
            WHERE cil.serial_id = $1 AND ci.customer_id = $2
              AND COALESCE(cil.line_type, 'rental') <> 'security'
              AND LOWER(COALESCE(ci.status, '')) <> 'cancelled'
            ORDER BY cil.rent_end DESC NULLS LAST
            LIMIT 1`,
          [cn.serial_id, cn.customer_id]
        );
        const rate = last.rows[0]?.monthly_rate;
        const ret = cn.from_date ? new Date(new Date(cn.from_date).getTime() - 86400000) : null;
        const billedUntil = cn.to_date ? new Date(cn.to_date) : null;
        const calc = rate && ret && billedUntil
          ? calcReturnCreditNoteAmount({
            rentMonthlyRate: rate,
            returnDate: ret,
            rentBilledUntil: billedUntil,
          })
          : null;
        console.log(
          `  ${cn.invoice_number} ${cn.credit_note_number} ${JSON.stringify(cn.ttspl_ids)} ` +
          `₹${cn.amount} recalc=${calc ? calc.amount : 'n/a'} (${toLocalYmd(new Date(cn.from_date))}..${toLocalYmd(new Date(cn.to_date))})`
        );
      }
    }

    console.log(`\nInvoices changed: ${changed.length}`);
    if (COMMIT) await client.query('COMMIT');
    else await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
