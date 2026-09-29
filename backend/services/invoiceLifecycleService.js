/**
 * Part 6.2 — the parts of an invoice's life that had no code at all.
 *
 *   BL9  nothing ever moved an invoice from 'sent' to 'overdue'. No job, no
 *        endpoint. The overdue bucket on the finance screen is permanently zero
 *        and the outstanding figure permanently understated.
 *   BL13 'cancelled' was filtered on everywhere and set nowhere, so every
 *        correction was a direct UPDATE against the database with no reason and
 *        no trail.
 *   BL12 approving a vendor bill required only edit rights and never checked
 *        that the approver was not the person who generated it. `manager` holds
 *        both by default from the seed, so maker-checker was a word, not a rule.
 */
const pool = require('../config/db');
const {
  invoiceEvent, vendorBillEvent, BILLING_EVENTS,
} = require('./billingEventService');

/** Net 15 — the term the invoice PDF has always printed. */
const DEFAULT_TERMS_DAYS = 15;

class BillingActionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BillingActionError';
    this.status = status;
  }
}

function dueDateFrom(invoiceDate, termsDays = DEFAULT_TERMS_DAYS) {
  const d = invoiceDate ? new Date(invoiceDate) : new Date();
  d.setDate(d.getDate() + Number(termsDays || DEFAULT_TERMS_DAYS));
  return d.toISOString().slice(0, 10);
}

/**
 * BL9 — move every sent invoice past its due date to 'overdue'.
 *
 * Deliberately narrow. Only 'sent' moves: a draft was never issued, a paid one
 * is closed, and a cancelled one must not come back to life. Partial payment
 * does not exempt an invoice — money still owed after the due date is overdue,
 * which is the whole point of the bucket.
 *
 * Idempotent: a second run the same day matches nothing, because the status has
 * already moved.
 */
async function sweepOverdueInvoices(db = pool, { asOf = null, actor = null, correlationId = null } = {}) {
  const client = db || pool;
  const { rows } = await client.query(
    `UPDATE customer_invoices
        SET status = 'overdue', overdue_at = NOW(), updated_at = NOW()
      WHERE LOWER(COALESCE(status, '')) = 'sent'
        AND due_date IS NOT NULL
        AND due_date < COALESCE($1::date, CURRENT_DATE)
        AND COALESCE(amount_paid, 0) < COALESCE(grand_total, 0)
      RETURNING invoice_id, invoice_number, customer_id, grand_total, amount_paid, due_date`,
    [asOf]
  );

  for (const inv of rows) {
    await invoiceEvent(client, {
      invoiceId: inv.invoice_id,
      invoiceNumber: inv.invoice_number,
      eventType: BILLING_EVENTS.INVOICE_OVERDUE,
      fromState: 'sent',
      toState: 'overdue',
      payload: {
        due_date: inv.due_date,
        outstanding: Number(inv.grand_total || 0) - Number(inv.amount_paid || 0),
      },
      actor: actor || { actor_type: 'system', actor_id: null, actor_name: 'overdue sweep' },
      correlationId,
      source: 'invoiceLifecycleService.sweepOverdueInvoices',
    });
  }

  return { moved: rows.length, invoices: rows };
}

/**
 * BL13 — cancel an invoice, with a reason and a trail.
 *
 * A paid invoice is not cancellable: money has moved, and the instrument for
 * that is a credit note, which this system already has. Refusing here is the
 * point — the alternative is what happens today, which is an UPDATE nobody sees.
 *
 * MD4: the row is locked and the status re-read under the lock, so a payment
 * posted a moment earlier (or a second cancel) is seen. Cancelling releases
 * what the invoice consumed, so none of it is lost:
 *   - credit notes applied on it go back to "approved" and apply to the next
 *     draft;
 *   - security deposits created by its security lines are removed, so the next
 *     invoice bills the security again;
 *   - each laptop's rent watermark is moved back to the day before this
 *     invoice's first rental line for it, so the next invoice bills those days
 *     again (the month slot itself stays taken by the cancelled invoice).
 */
async function cancelInvoice(db, { invoiceId, reason, actor, correlationId = null }) {
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 5) {
    throw new BillingActionError('A cancellation reason is required (at least 5 characters)');
  }
  const base = db || pool;
  const client = typeof base.connect === 'function' ? await base.connect() : base;
  const ownTx = client !== base;
  try {
    if (ownTx) await client.query('BEGIN');
    const out = await cancelInvoiceIn(client, { invoiceId, reason: trimmed, actor, correlationId });
    if (ownTx) await client.query('COMMIT');
    return out;
  } catch (err) {
    if (ownTx) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (ownTx) client.release();
  }
}

async function cancelInvoiceIn(client, { invoiceId, reason, actor, correlationId }) {
  const { rows: current } = await client.query(
    `SELECT invoice_id, invoice_number, customer_id, status, amount_paid, grand_total, line_items
       FROM customer_invoices WHERE invoice_id = $1 FOR UPDATE`,
    [invoiceId]
  );
  const invoice = current[0];
  if (!invoice) throw new BillingActionError('Invoice not found', 404);

  const status = String(invoice.status || 'draft').toLowerCase();
  if (status === 'cancelled') {
    throw new BillingActionError('This invoice is already cancelled', 409);
  }
  const ledger = await client.query(
    'SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM payment_records WHERE invoice_id = $1',
    [invoiceId]
  );
  const paidOnLedger = Number(ledger.rows[0]?.paid || 0);
  if (status === 'paid' || status === 'partially_paid' || Number(invoice.amount_paid || 0) > 0 || paidOnLedger > 0) {
    throw new BillingActionError(
      'This invoice has payment against it. Raise a credit note instead of cancelling it.',
      409
    );
  }

  const { rows } = await client.query(
    `UPDATE customer_invoices
        SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2,
            cancellation_reason = $3, updated_at = NOW()
      WHERE invoice_id = $1
      RETURNING *`,
    [invoiceId, actor?.user_id || null, reason.slice(0, 2000)]
  );

  // Credit notes consumed by this invoice go back to approved (MD4).
  const released = await client.query(
    `UPDATE customer_credit_notes
        SET status = 'approved', applied_in_invoice_id = NULL,
            invoice_id = CASE WHEN invoice_id = $1 THEN NULL ELSE invoice_id END,
            updated_at = NOW()
      WHERE applied_in_invoice_id = $1 AND status = 'applied'
      RETURNING credit_note_id, credit_note_number, amount`,
    [invoiceId]
  );
  // Open notes that were only linked to it are unlinked, so they apply elsewhere.
  await client.query(
    `UPDATE customer_credit_notes
        SET invoice_id = NULL, updated_at = NOW()
      WHERE invoice_id = $1 AND applied_in_invoice_id IS NULL AND status IN ('pending', 'approved')
        AND COALESCE(credit_note_type, '') <> 'manual'`,
    [invoiceId]
  );

  // Security billed on this invoice is released so the next invoice bills it.
  const deposits = await client.query(
    `DELETE FROM customer_security_deposits
      WHERE invoice_id = $1 AND status = 'held' AND COALESCE(refund_amount, 0) = 0
        AND so_payment_id IS NULL
      RETURNING deposit_id, serial_id, amount`,
    [invoiceId]
  );

  // Rent watermark back to the day before this invoice's first rental day for
  // each laptop still with this customer, never past its rent start.
  const watermarks = await client.query(
    `WITH lines AS (
       SELECT (elem->>'serial_id')::int AS serial_id,
              MIN(NULLIF(LEFT(elem->>'rent_start', 10), '')::date) AS first_day
         FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof($2::jsonb) = 'array' THEN $2::jsonb ELSE '[]'::jsonb END
              ) elem
        WHERE NULLIF(elem->>'serial_id', '') ~ '^[0-9]+$'
          AND COALESCE(elem->>'line_type', 'rental') <> 'security'
          AND LOWER(COALESCE(elem->>'is_security', 'false')) NOT IN ('true', 't', '1', 'yes')
          AND NULLIF(LEFT(elem->>'rent_start', 10), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        GROUP BY 1
     )
     UPDATE vendor_serial_numbers vsn
        SET rent_billed_until = GREATEST(
              l.first_day - 1,
              COALESCE(vsn.rent_start_date - 1, l.first_day - 1)
            ),
            updated_at = NOW()
       FROM lines l
      WHERE vsn.serial_id = l.serial_id
        AND vsn.current_customer_id = $1
        AND vsn.rent_billed_until IS NOT NULL
        AND vsn.rent_billed_until >= l.first_day
     RETURNING vsn.serial_id, vsn.rent_billed_until`,
    [invoice.customer_id, JSON.stringify(invoice.line_items || [])]
  );

  await invoiceEvent(client, {
    invoiceId,
    invoiceNumber: invoice.invoice_number,
    eventType: BILLING_EVENTS.INVOICE_CANCELLED,
    fromState: status,
    toState: 'cancelled',
    payload: {
      reason,
      grand_total: invoice.grand_total,
      credit_notes_released: released.rows.map((r) => r.credit_note_number),
      security_deposits_released: deposits.rows.length,
      rent_watermarks_reset: watermarks.rows.length,
    },
    actor,
    correlationId,
    source: 'invoiceLifecycleService.cancelInvoice',
  });

  return {
    ...rows[0],
    released: {
      credit_notes: released.rows,
      security_deposits: deposits.rows.length,
      rent_watermarks: watermarks.rows.length,
    },
  };
}

/** The same, for a vendor bill. */
async function cancelVendorBill(db, { billId, reason, actor, correlationId = null }) {
  const client = db || pool;
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 5) {
    throw new BillingActionError('A cancellation reason is required (at least 5 characters)');
  }

  const { rows: current } = await client.query(
    // MD5 — locked: run inside the caller's transaction (the controller opens
    // one) so a payment cannot land between this check and the UPDATE.
    `SELECT bill_id, bill_number, status, amount_paid FROM vendor_monthly_bills WHERE bill_id = $1 FOR UPDATE`,
    [billId]
  );
  const bill = current[0];
  if (!bill) throw new BillingActionError('Vendor bill not found', 404);

  const status = String(bill.status || 'generated').toLowerCase();
  if (status === 'cancelled') throw new BillingActionError('This bill is already cancelled', 409);
  if (status === 'paid' || Number(bill.amount_paid || 0) > 0) {
    throw new BillingActionError(
      'This bill has payment against it. Raise a debit note instead of cancelling it.',
      409
    );
  }

  const { rows } = await client.query(
    `UPDATE vendor_monthly_bills
        SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2,
            cancellation_reason = $3, updated_at = NOW()
      WHERE bill_id = $1 AND status <> 'cancelled'
      RETURNING *`,
    [billId, actor?.user_id || null, trimmed.slice(0, 2000)]
  );
  if (!rows.length) throw new BillingActionError('This bill is already cancelled', 409);

  // MD5 — the debit notes this bill deducted go back to 'approved', so the
  // next bill for this vendor (or a regenerated one) deducts them instead.
  const released = await client.query(
    `UPDATE vendor_debit_notes
        SET status = 'approved', adjusted_in_bill_id = NULL, updated_at = NOW()
      WHERE adjusted_in_bill_id = $1 AND status = 'adjusted'
      RETURNING debit_note_number`,
    [billId]
  );

  await vendorBillEvent(client, {
    billId,
    billNumber: bill.bill_number,
    eventType: BILLING_EVENTS.BILL_CANCELLED,
    fromState: status,
    toState: 'cancelled',
    payload: { reason: trimmed, debit_notes_released: (released.rows || []).map((r) => r.debit_note_number) },
    actor,
    correlationId,
    source: 'invoiceLifecycleService.cancelVendorBill',
  });

  return rows[0];
}

/**
 * BL12 — maker-checker on vendor bill approval.
 *
 * The approver must not be the generator. `generated_by` is already recorded on
 * every bill and was simply never read; this is the read.
 *
 * A bill with no recorded generator (the batch run, older rows) cannot be
 * checked this way, so it is allowed through rather than blocked — refusing
 * would make historical bills unapprovable and the honest answer is that we do
 * not know who made them. That gap is visible in the event payload.
 */
async function approveVendorBill(db, { billId, actor, correlationId = null }) {
  const client = db || pool;
  const approverId = Number(actor?.user_id) || null;

  const { rows: current } = await client.query(
    `SELECT bill_id, bill_number, status, generated_by FROM vendor_monthly_bills WHERE bill_id = $1 FOR UPDATE`,
    [billId]
  );
  const bill = current[0];
  if (!bill) throw new BillingActionError('Bill not found', 404);

  const status = String(bill.status || '').toLowerCase();
  if (status !== 'generated') {
    throw new BillingActionError(`This bill is "${bill.status}" — only a generated bill can be approved`, 409);
  }

  const generatedBy = Number(bill.generated_by) || null;
  if (generatedBy && approverId && generatedBy === approverId) {
    throw new BillingActionError(
      'You generated this bill, so you cannot approve it. Maker and checker must be different people.',
      403
    );
  }

  const { rows } = await client.query(
    `UPDATE vendor_monthly_bills
        SET status = 'approved', approved_by = $1, updated_at = NOW()
      WHERE bill_id = $2 AND status = 'generated'
      RETURNING *`,
    [approverId, billId]
  );
  if (!rows.length) {
    throw new BillingActionError('Bill not found or no longer in generated status', 409);
  }

  await vendorBillEvent(client, {
    billId,
    billNumber: bill.bill_number,
    eventType: BILLING_EVENTS.BILL_APPROVED,
    fromState: 'generated',
    toState: 'approved',
    payload: {
      generated_by: generatedBy,
      approved_by: approverId,
      maker_checker_verified: Boolean(generatedBy && approverId),
    },
    actor,
    correlationId,
    source: 'invoiceLifecycleService.approveVendorBill',
  });

  return rows[0];
}

/**
 * Ageing buckets for one customer, or for all of them.
 *
 * Neither this nor the statement below existed. "How much is owed, and how old
 * is it" could not be answered from this system at all.
 */
async function ageingBuckets(db, { customerId = null, asOf = null, customerTypes = null } = {}) {
  const client = db || pool;
  const { rows } = await client.query(
    `SELECT
        ci.customer_id,
        COALESCE(c.company_name, c.name)                                   AS customer_name,
        COUNT(*)::int                                                      AS invoice_count,
        SUM(COALESCE(ci.grand_total,0) - COALESCE(ci.amount_paid,0))::numeric AS outstanding,
        SUM(CASE WHEN COALESCE($2::date, CURRENT_DATE) - ci.due_date <= 0
                 THEN COALESCE(ci.grand_total,0) - COALESCE(ci.amount_paid,0) ELSE 0 END)::numeric AS not_due,
        SUM(CASE WHEN COALESCE($2::date, CURRENT_DATE) - ci.due_date BETWEEN 1 AND 30
                 THEN COALESCE(ci.grand_total,0) - COALESCE(ci.amount_paid,0) ELSE 0 END)::numeric AS days_1_30,
        SUM(CASE WHEN COALESCE($2::date, CURRENT_DATE) - ci.due_date BETWEEN 31 AND 60
                 THEN COALESCE(ci.grand_total,0) - COALESCE(ci.amount_paid,0) ELSE 0 END)::numeric AS days_31_60,
        SUM(CASE WHEN COALESCE($2::date, CURRENT_DATE) - ci.due_date BETWEEN 61 AND 90
                 THEN COALESCE(ci.grand_total,0) - COALESCE(ci.amount_paid,0) ELSE 0 END)::numeric AS days_61_90,
        SUM(CASE WHEN COALESCE($2::date, CURRENT_DATE) - ci.due_date > 90
                 THEN COALESCE(ci.grand_total,0) - COALESCE(ci.amount_paid,0) ELSE 0 END)::numeric AS days_90_plus
       FROM customer_invoices ci
       LEFT JOIN customers c ON c.customer_id = ci.customer_id
      WHERE LOWER(COALESCE(ci.status,'')) NOT IN ('cancelled', 'paid', 'draft')
        AND COALESCE(ci.grand_total,0) > COALESCE(ci.amount_paid,0)
        AND ($1::int IS NULL OR ci.customer_id = $1::int)
        AND ($3::text[] IS NULL OR COALESCE(c.customer_type, 'both') = ANY($3::text[]))
      GROUP BY ci.customer_id, COALESCE(c.company_name, c.name)
      ORDER BY outstanding DESC`,
    [customerId, asOf, customerTypes && customerTypes.length ? customerTypes : null]
  );
  return rows;
}

/**
 * Statement of account: every invoice, credit note and payment for one customer
 * in date order, with a running balance.
 */
async function statementOfAccount(db, { customerId, fromDate = null, toDate = null }) {
  const client = db || pool;
  if (!customerId) throw new BillingActionError('A customer is required');

  const { rows } = await client.query(
    `SELECT * FROM (
        SELECT ci.invoice_date::date                AS entry_date,
               'invoice'                            AS entry_type,
               ci.invoice_number                    AS reference,
               ci.status,
               COALESCE(ci.grand_total,0)::numeric  AS debit,
               0::numeric                           AS credit
          FROM customer_invoices ci
         WHERE ci.customer_id = $1
           AND LOWER(COALESCE(ci.status,'')) <> 'cancelled'
        UNION ALL
        SELECT cn.created_at::date, 'credit_note', cn.credit_note_number, cn.status,
               0::numeric, COALESCE(cn.amount,0)::numeric
          FROM customer_credit_notes cn
         WHERE cn.customer_id = $1
           AND LOWER(COALESCE(cn.status,'')) IN ('approved', 'applied')
        UNION ALL
        SELECT p.payment_date::date, 'payment', COALESCE(p.reference, p.method), 'received',
               0::numeric, COALESCE(p.amount,0)::numeric
          FROM payment_records p
         WHERE p.party_type = 'customer' AND p.customer_id = $1
     ) entries
     WHERE ($2::date IS NULL OR entry_date >= $2::date)
       AND ($3::date IS NULL OR entry_date <= $3::date)
     ORDER BY entry_date, entry_type`,
    [customerId, fromDate, toDate]
  );

  let balance = 0;
  const entries = rows.map((r) => {
    balance += Number(r.debit || 0) - Number(r.credit || 0);
    return { ...r, debit: Number(r.debit || 0), credit: Number(r.credit || 0), balance: +balance.toFixed(2) };
  });
  return { customer_id: Number(customerId), entries, closing_balance: +balance.toFixed(2) };
}

module.exports = {
  BillingActionError,
  DEFAULT_TERMS_DAYS,
  dueDateFrom,
  sweepOverdueInvoices,
  cancelInvoice,
  cancelVendorBill,
  approveVendorBill,
  ageingBuckets,
  statementOfAccount,
};
