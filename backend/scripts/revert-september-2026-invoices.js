/**
 * Revert draft September 2026 customer invoices and auto return credit notes.
 * Rolls back rent_billed_until from those lines, deletes draft Sept invoices,
 * deletes pending/approved auto return CNs so generate can recreate them from
 * warehouse received date, and rewinds INV / CN sequences.
 *
 * Usage: node scripts/revert-september-2026-invoices.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const pool = require('../config/db');

const MONTH = 9;
const YEAR = 2026;

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inv = await client.query(
      `SELECT invoice_id, invoice_number
         FROM customer_invoices
        WHERE invoice_month = $1 AND invoice_year = $2 AND status = 'draft'
        FOR UPDATE`,
      [MONTH, YEAR]
    );
    const ids = inv.rows.map((r) => r.invoice_id);

    if (ids.length) {
      const paid = await client.query(
        `SELECT count(*)::int AS n FROM payment_records WHERE invoice_id = ANY($1::int[])`,
        [ids]
      );
      if (paid.rows[0].n > 0) {
        throw new Error(`Refusing revert: ${paid.rows[0].n} payment(s) exist on September invoices`);
      }
    }

    const billed = ids.length
      ? await client.query(
        `SELECT cil.serial_id, (MIN(cil.rent_start)::date - INTERVAL '1 day')::date AS new_until
           FROM customer_invoice_lines cil
          WHERE cil.invoice_id = ANY($1::int[])
            AND cil.serial_id IS NOT NULL
          GROUP BY cil.serial_id`,
        [ids]
      )
      : { rows: [], rowCount: 0 };

    if (ids.length) {
      await client.query(
        `UPDATE customer_credit_notes
            SET applied_in_invoice_id = NULL,
                invoice_id = CASE WHEN invoice_id = ANY($1::int[]) THEN NULL ELSE invoice_id END,
                status = CASE WHEN status = 'applied' THEN 'approved' ELSE status END,
                updated_at = NOW()
          WHERE applied_in_invoice_id = ANY($1::int[])
             OR invoice_id = ANY($1::int[])`,
        [ids]
      );
    }

    const cnToDelete = await client.query(
      `SELECT credit_note_id, credit_note_number
         FROM customer_credit_notes
        WHERE status IN ('pending', 'approved')
          AND (
            source IN ('invoice_generation', 'return_pickup')
            OR reason ILIKE 'Rental return%'
          )
        FOR UPDATE`
    );
    const cnIds = cnToDelete.rows.map((r) => r.credit_note_id);
    let cnDeleted = 0;
    let cnSequence = null;
    if (cnIds.length) {
      await client.query(
        `DELETE FROM customer_asset_activity
          WHERE action = 'credit_note_applied'
            AND (
              changes::text ILIKE ANY($1::text[])
              OR description ILIKE ANY($1::text[])
            )`,
        [cnToDelete.rows.map((r) => `%${r.credit_note_number}%`)]
      );
      const delCn = await client.query(
        `DELETE FROM customer_credit_notes WHERE credit_note_id = ANY($1::int[])`,
        [cnIds]
      );
      cnDeleted = delCn.rowCount;
      const remainingCn = await client.query(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(credit_note_number, '\\D', '', 'g'), '')::int), 0) AS max_n
           FROM customer_credit_notes
          WHERE credit_note_number LIKE 'CN-%'`
      );
      cnSequence = Number(remainingCn.rows[0].max_n || 0);
      await client.query(
        `UPDATE sm_document_sequences
            SET last_value = $1, updated_at = NOW()
          WHERE doc_type = 'credit_note'`,
        [cnSequence]
      );
    }

    for (const row of billed.rows) {
      await client.query(
        `UPDATE vendor_serial_numbers
            SET rent_billed_until = CASE
                  WHEN $2::date IS NULL THEN NULL
                  WHEN rent_start_date IS NOT NULL AND $2::date < rent_start_date THEN NULL
                  ELSE $2::date
                END,
                updated_at = NOW()
          WHERE serial_id = $1`,
        [row.serial_id, row.new_until]
      );
    }

    let linesDeleted = 0;
    let invoiceSequence = null;
    if (ids.length) {
      const lines = await client.query(
        `DELETE FROM customer_invoice_lines WHERE invoice_id = ANY($1::int[])`,
        [ids]
      );
      linesDeleted = lines.rowCount;
      await client.query(
        `DELETE FROM customer_invoices WHERE invoice_id = ANY($1::int[])`,
        [ids]
      );
      const remaining = await client.query(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_number, '\\D', '', 'g'), '')::int), 0) AS max_n
           FROM customer_invoices
          WHERE invoice_number LIKE 'INV-%'`
      );
      invoiceSequence = Number(remaining.rows[0].max_n || 0);
      await client.query(
        `UPDATE sm_document_sequences
            SET last_value = $1, updated_at = NOW()
          WHERE doc_type = 'invoice_rentfoxxy'`,
        [invoiceSequence]
      );
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      reverted_invoices: ids.length,
      numbers: inv.rows.map((r) => r.invoice_number),
      invoice_lines_deleted: linesDeleted,
      serials_rolled_back: billed.rowCount,
      credit_notes_deleted: cnDeleted,
      credit_note_numbers: cnToDelete.rows.map((r) => r.credit_note_number),
      invoice_sequence_last_value: invoiceSequence,
      credit_note_sequence_last_value: cnSequence,
    }, null, 2));
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
