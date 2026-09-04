#!/usr/bin/env node
/**
 * INV-1184 (#1567, Synergie September): drop duplicate Aug catch-up and
 * July-delivery TTSPL4604 August leftover. Put 4604 July+August on INV-0899.
 * Recalc pending CNs for 19 Aug warehouse receives.
 *
 *   node scripts/fix-inv1184-synergie-catchup.js           (dry-run)
 *   node scripts/fix-inv1184-synergie-catchup.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { toLocalYmd, daysInclusive, calcReturnCreditNoteAmount } = require('../services/billingMath');
const { insertCustomerInvoiceLines } = require('../services/billingLineItemsService');

const COMMIT = process.argv.includes('--commit');
const SEP_ID = 1567;
const AUG_ID = 1282;

function isSecurity(line) {
  return line.line_type === 'security' || line.is_security === true;
}

function rentalSubtotal(lines) {
  return parseFloat(
    lines
      .filter((l) => !isSecurity(l))
      .reduce((s, l) => s + Number(l.amount || 0), 0)
      .toFixed(2)
  );
}

function moneyTotals(subtotal, gstPercent, creditAdjustment = 0, securityDeposit = 0) {
  const gstAmount = parseFloat((Number(subtotal || 0) * Number(gstPercent || 0) / 100).toFixed(2));
  const grandTotal = Math.max(
    0,
    parseFloat((Number(subtotal || 0) + gstAmount - Number(creditAdjustment || 0) + Number(securityDeposit || 0)).toFixed(2))
  );
  return { gstAmount, grandTotal };
}

function lineKey(line) {
  return [
    line.serial_id || '',
    line.ttspl_id || '',
    String(line.rent_start || '').slice(0, 10),
    String(line.rent_end || '').slice(0, 10),
    line.is_catchup ? '1' : '0',
    isSecurity(line) ? 's' : 'r',
  ].join('|');
}

function parseLines(inv) {
  const raw = inv.line_items;
  return Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
}

function makeProrataLine(template, { start, end, monthDays, isCatchup, period }) {
  const startD = new Date(`${start}T00:00:00`);
  const endD = new Date(`${end}T00:00:00`);
  const days = daysInclusive(startD, endD);
  const monthly = parseFloat(template.monthly_rate || 0);
  const daily = monthly / monthDays;
  return {
    ...template,
    period,
    rent_start: start,
    rent_end: end,
    days_in_month: days,
    month_days: monthDays,
    daily_rate: parseFloat(daily.toFixed(2)),
    amount: parseFloat((daily * days).toFixed(2)),
    is_catchup: isCatchup,
    returned: false,
  };
}

async function persistInvoice(client, inv, lines, fallbackFrom, fallbackTo) {
  const rental = lines.filter((l) => !isSecurity(l));
  const subtotal = rentalSubtotal(lines);
  const securityDeposit = parseFloat(
    lines.filter(isSecurity).reduce((s, l) => s + Number(l.amount || 0), 0).toFixed(2)
  );
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
      starts[0] || fallbackFrom,
      ends[ends.length - 1] || fallbackTo,
      inv.invoice_id,
    ]
  );
  await client.query('DELETE FROM customer_invoice_lines WHERE invoice_id = $1', [inv.invoice_id]);
  await insertCustomerInvoiceLines(client, inv.invoice_id, lines);
  return { subtotal, gstAmount, grandTotal, lines: lines.length };
}

async function main() {
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sepRes = await client.query('SELECT * FROM customer_invoices WHERE invoice_id = $1 FOR UPDATE', [SEP_ID]);
    const sep = sepRes.rows[0];
    if (!sep || sep.status !== 'draft') throw new Error('September draft INV-1184 not found');
    const sepLines = parseLines(sep);
    console.log('Sep before: lines', sepLines.length, 'subtotal', sep.subtotal, 'grand', sep.grand_total);

    const kept = [];
    const seen = new Set();
    const dropped = [];
    for (const line of sepLines) {
      if (
        line.ttspl_id === 'TTSPL4604'
        && line.is_catchup
        && String(line.rent_start || '').slice(0, 10) === '2026-08-01'
      ) {
        dropped.push({ reason: 'july_delivery_aug_catchup', ttspl: line.ttspl_id, start: line.rent_start, amount: line.amount });
        continue;
      }
      const key = lineKey(line);
      if (seen.has(key)) {
        dropped.push({ reason: 'duplicate', ttspl: line.ttspl_id, start: line.rent_start, amount: line.amount });
        continue;
      }
      seen.add(key);
      kept.push(line);
    }
    console.log('Dropped from Sep:', JSON.stringify(dropped, null, 2));

    const sepAfter = await persistInvoice(client, sep, kept, '2026-08-06', '2026-09-30');
    console.log('Sep after:', sepAfter);

    const augRes = await client.query('SELECT * FROM customer_invoices WHERE invoice_id = $1 FOR UPDATE', [AUG_ID]);
    const aug = augRes.rows[0];
    if (!aug || aug.status !== 'draft') throw new Error('August draft INV-0899 not found');
    const augLines = parseLines(aug);
    const has4604 = augLines.some((l) => l.ttspl_id === 'TTSPL4604');
    if (!has4604) {
      const template = kept.find((l) => l.ttspl_id === 'TTSPL4604' && !l.is_catchup)
        || dropped.find(() => false)
        || sepLines.find((l) => l.ttspl_id === 'TTSPL4604');
      if (!template) throw new Error('No TTSPL4604 template line');
      const july = makeProrataLine(template, {
        start: '2026-07-10',
        end: '2026-07-31',
        monthDays: 31,
        isCatchup: true,
        period: '2026-07',
      });
      const august = makeProrataLine(template, {
        start: '2026-08-01',
        end: '2026-08-31',
        monthDays: 31,
        isCatchup: false,
        period: '2026-08',
      });
      const nextAug = [...augLines, july, august];
      const augAfter = await persistInvoice(client, aug, nextAug, '2026-08-01', '2026-08-31');
      console.log('Aug added 4604 July+August:', july.amount, august.amount, augAfter);
    } else {
      console.log('Aug already has TTSPL4604 — left unchanged');
    }

    const cnRows = await client.query(
      `SELECT * FROM customer_credit_notes
        WHERE customer_id = 25
          AND credit_note_id IN (201, 202, 203, 204)
        FOR UPDATE`
    );
    for (const cn of cnRows.rows) {
      const rate = Number(cn.unit_rate) > 70 ? 2499 : 1999;
      const calc = calcReturnCreditNoteAmount({
        rentMonthlyRate: rate,
        returnDate: '2026-08-19',
        rentBilledUntil: '2026-08-31',
      });
      if (!calc) continue;
      const fromYmd = toLocalYmd(calc.refundStart);
      const toYmd = toLocalYmd(calc.billedUntil);
      const ttspl = Array.isArray(cn.ttspl_ids) ? cn.ttspl_ids[0] : cn.ttspl_ids;
      const desc = `Unit ${ttspl} warehouse received on 2026-08-19 via ${cn.return_dc_number}; `
        + `${calc.unusedDays} prepaid day(s) (${fromYmd} to ${toYmd}) refunded at ₹${calc.dailyRate.toFixed(2)}/day (base, excl. GST).`;
      const changed = Number(cn.amount) !== calc.amount
        || Number(cn.quantity) !== calc.unusedDays
        || Number(cn.invoice_id) !== SEP_ID;
      await client.query(
        `UPDATE customer_credit_notes
            SET amount = $1,
                quantity = $2,
                unit_rate = $3,
                from_date = $4,
                to_date = $5,
                description = $6,
                invoice_id = $7,
                updated_at = NOW()
          WHERE credit_note_id = $8`,
        [calc.amount, calc.unusedDays, calc.dailyRate, fromYmd, toYmd, desc, SEP_ID, cn.credit_note_id]
      );
      console.log(
        `${cn.credit_note_number} ${ttspl}: ₹${cn.amount} → ₹${calc.amount} `
        + `(${calc.unusedDays}d ${fromYmd}–${toYmd})${changed ? ' UPDATED' : ' confirmed'}`
      );
    }

    if (COMMIT) {
      await client.query('COMMIT');
      console.log('Committed.');
    } else {
      await client.query('ROLLBACK');
      console.log('Rolled back (dry-run). Re-run with --commit to apply.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
