/**
 * Customer credit notes raised and withdrawn by hand (MD2,
 * claude/carret-remaining-build.md).
 *
 * The automatic return / repair notes are written by billingSchedulerService;
 * this module holds the two manual actions, with the rules the old handler did
 * not have:
 *   - the number comes from the one CN/yy-yy/NNNN series (nextCreditNoteNumber)
 *     inside the write transaction — the old handler took CN0001-style numbers
 *     from the same counter, outside any transaction;
 *   - the amount is more than Rs 0 and no more than what the invoice has left
 *     to credit (its grand total less every other live credit note against it);
 *   - the invoice belongs to the customer and is not cancelled or a draft;
 *   - it is created as a draft (pending) — a different person approves it;
 *   - cancelling releases it: a note applied on a draft comes off that draft
 *     and the draft's totals are recomputed; a note applied on an issued invoice
 *     cannot be withdrawn here.
 */
const pool = require('../config/db');
const {
  nextCreditNoteNumber,
  refreshInvoiceCreditTotals,
} = require('./billingSchedulerService');
const { creditNoteEvent, BILLING_EVENTS } = require('./billingEventService');

class CreditNoteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CreditNoteError';
    this.status = status;
  }
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function ymdOrNull(v, label) {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new CreditNoteError(`${label} must be a date (YYYY-MM-DD)`);
  return s;
}

/**
 * What an invoice still has to credit: its grand total less every live credit
 * note raised against it (pending, approved or applied elsewhere). Notes applied
 * INTO this invoice already reduced its grand total, so they are not counted
 * twice.
 */
async function creditableBalance(client, invoiceId, { excludeCreditNoteId = null } = {}) {
  const inv = await client.query(
    'SELECT grand_total FROM customer_invoices WHERE invoice_id = $1',
    [invoiceId]
  );
  if (!inv.rows.length) return 0;
  const other = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total
       FROM customer_credit_notes
      WHERE invoice_id = $1
        AND status IN ('pending', 'approved', 'applied')
        AND COALESCE(applied_in_invoice_id, 0) <> $1
        AND ($2::int IS NULL OR credit_note_id <> $2::int)`,
    [invoiceId, excludeCreditNoteId]
  );
  return round2(Number(inv.rows[0].grand_total || 0) - Number(other.rows[0].total || 0));
}

async function withTx(db, fn) {
  const base = db || pool;
  const client = typeof base.connect === 'function' ? await base.connect() : base;
  const own = client !== base;
  try {
    if (own) await client.query('BEGIN');
    const out = await fn(client);
    if (own) await client.query('COMMIT');
    return out;
  } catch (err) {
    if (own) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (own) client.release();
  }
}

async function createManualCreditNote(db, body, { actor = null, correlationId = null } = {}) {
  const customerId = Number(body.customer_id);
  const invoiceId = Number(body.invoice_id);
  const reason = String(body.reason || '').trim();
  if (!Number.isInteger(customerId) || customerId <= 0) throw new CreditNoteError('Choose the customer');
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    throw new CreditNoteError('Choose the invoice this credit note is against — a GST credit note must reference its invoice');
  }
  if (reason.length < 3) throw new CreditNoteError('Give the reason for the credit note');
  const amount = round2(body.amount);
  if (!Number.isFinite(Number(body.amount)) || !(amount > 0)) {
    throw new CreditNoteError('Amount must be more than Rs 0');
  }
  const fromDate = ymdOrNull(body.from_date, 'From date');
  const toDate = ymdOrNull(body.to_date, 'To date');
  if (fromDate && toDate && fromDate > toDate) throw new CreditNoteError('From date is after To date');
  const ttspls = (Array.isArray(body.ttspl_ids) ? body.ttspl_ids : [])
    .map((t) => String(t || '').trim()).filter(Boolean).slice(0, 500);
  const quantity = Math.max(0, parseInt(body.quantity, 10) || 0);
  const unitRate = Math.max(0, round2(body.unit_rate));

  return withTx(db, async (client) => {
    const inv = await client.query(
      `SELECT invoice_id, invoice_number, customer_id, status, grand_total
         FROM customer_invoices WHERE invoice_id = $1 FOR UPDATE`,
      [invoiceId]
    );
    const invoice = inv.rows[0];
    if (!invoice) throw new CreditNoteError('Invoice not found', 404);
    if (Number(invoice.customer_id) !== customerId) {
      throw new CreditNoteError('That invoice belongs to a different customer', 409);
    }
    const st = String(invoice.status || '').toLowerCase();
    if (st === 'cancelled') throw new CreditNoteError('That invoice is cancelled — there is nothing to credit', 409);
    if (st === 'draft') {
      throw new CreditNoteError('That invoice is still a draft — correct the draft instead of crediting it', 409);
    }
    const balance = await creditableBalance(client, invoiceId);
    if (amount > balance + 0.001) {
      throw new CreditNoteError(
        `Rs ${amount.toFixed(2)} is more than the Rs ${Math.max(0, balance).toFixed(2)} this invoice has left to credit`,
        409
      );
    }
    const number = await nextCreditNoteNumber(client);
    const ins = await client.query(
      // Raised by hand, so typed 'manual' — never mixed with the automated
      // return and repair credits.
      `INSERT INTO customer_credit_notes
        (credit_note_number, customer_id, invoice_id, reason, description, amount,
         quantity, unit_rate, from_date, to_date, ttspl_ids, created_by, credit_note_type, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,'manual','pending','manual')
       RETURNING *`,
      [
        number, customerId, invoiceId, reason.slice(0, 250),
        body.description ? String(body.description).slice(0, 4000) : null,
        amount.toFixed(2), quantity, unitRate.toFixed(2), fromDate, toDate,
        JSON.stringify(ttspls), actor?.user_id || null,
      ]
    );
    const cn = ins.rows[0];
    await creditNoteEvent(client, {
      creditNoteId: cn.credit_note_id,
      creditNoteNumber: cn.credit_note_number,
      eventType: BILLING_EVENTS.CREDIT_NOTE_CREATED,
      toState: 'pending',
      payload: { amount, invoice_number: invoice.invoice_number, reason },
      actor,
      correlationId,
      source: 'creditNoteService.createManualCreditNote',
    });
    return cn;
  });
}

async function cancelCreditNote(db, { creditNoteId, reason, actor = null, correlationId = null }) {
  const why = String(reason || '').trim();
  if (why.length < 5) throw new CreditNoteError('A cancellation reason is required (at least 5 characters)');
  return withTx(db, async (client) => {
    const r = await client.query(
      'SELECT * FROM customer_credit_notes WHERE credit_note_id = $1 FOR UPDATE',
      [creditNoteId]
    );
    const cn = r.rows[0];
    if (!cn) throw new CreditNoteError('Credit note not found', 404);
    const st = String(cn.status || '').toLowerCase();
    if (st === 'cancelled') throw new CreditNoteError('This credit note is already cancelled', 409);

    let releasedFrom = null;
    if (st === 'applied' && cn.applied_in_invoice_id) {
      const inv = await client.query(
        'SELECT invoice_id, invoice_number, status FROM customer_invoices WHERE invoice_id = $1 FOR UPDATE',
        [cn.applied_in_invoice_id]
      );
      const target = inv.rows[0];
      if (target && String(target.status || '').toLowerCase() !== 'draft'
        && String(target.status || '').toLowerCase() !== 'cancelled') {
        throw new CreditNoteError(
          `This credit note is already on issued invoice ${target.invoice_number}; it cannot be withdrawn`,
          409
        );
      }
      releasedFrom = target || null;
    }

    const upd = await client.query(
      `UPDATE customer_credit_notes
          SET status = 'cancelled', applied_in_invoice_id = NULL,
              cancelled_at = NOW(), cancelled_by = $2, cancellation_reason = $3,
              updated_at = NOW()
        WHERE credit_note_id = $1
        RETURNING *`,
      [creditNoteId, actor?.user_id || null, why.slice(0, 2000)]
    );
    if (releasedFrom && String(releasedFrom.status || '').toLowerCase() === 'draft') {
      await refreshInvoiceCreditTotals(client, releasedFrom.invoice_id);
    }
    await creditNoteEvent(client, {
      creditNoteId: cn.credit_note_id,
      creditNoteNumber: cn.credit_note_number,
      eventType: BILLING_EVENTS.CREDIT_NOTE_CANCELLED,
      fromState: st,
      toState: 'cancelled',
      payload: {
        reason: why,
        amount: Number(cn.amount),
        released_from_invoice: releasedFrom ? releasedFrom.invoice_number : null,
      },
      actor,
      correlationId,
      source: 'creditNoteService.cancelCreditNote',
    });
    return upd.rows[0];
  });
}

module.exports = {
  CreditNoteError,
  creditableBalance,
  createManualCreditNote,
  cancelCreditNote,
};
