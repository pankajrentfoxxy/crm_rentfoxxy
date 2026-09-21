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
 */
async function cancelInvoice(db, { invoiceId, reason, actor, correlationId = null }) {
  const client = db || pool;
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 5) {
    throw new BillingActionError('A cancellation reason is required (at least 5 characters)');
  }

  const { rows: current } = await client.query(
    `SELECT invoice_id, invoice_number, status, amount_paid, grand_total
       FROM customer_invoices WHERE invoice_id = $1`,
    [invoiceId]
  );
  const invoice = current[0];
  if (!invoice) throw new BillingActionError('Invoice not found', 404);

  const status = String(invoice.status || 'draft').toLowerCase();
  if (status === 'cancelled') {
    throw new BillingActionError('This invoice is already cancelled', 409);
  }
  if (status === 'paid' || Number(invoice.amount_paid || 0) > 0) {
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
    [invoiceId, actor?.user_id || null, trimmed.slice(0, 2000)]
  );

  await invoiceEvent(client, {
    invoiceId,
    invoiceNumber: invoice.invoice_number,
    eventType: BILLING_EVENTS.INVOICE_CANCELLED,
    fromState: status,
    toState: 'cancelled',
    payload: { reason: trimmed, grand_total: invoice.grand_total },
    actor,
    correlationId,
    source: 'invoiceLifecycleService.cancelInvoice',
  });

  return rows[0];
}

/** The same, for a vendor bill. */
async function cancelVendorBill(db, { billId, reason, actor, correlationId = null }) {
  const client = db || pool;
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 5) {
    throw new BillingActionError('A cancellation reason is required (at least 5 characters)');
  }

  const { rows: current } = await client.query(
    `SELECT bill_id, bill_number, status, amount_paid FROM vendor_monthly_bills WHERE bill_id = $1`,
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
      WHERE bill_id = $1
      RETURNING *`,
    [billId, actor?.user_id || null, trimmed.slice(0, 2000)]
  );

  await vendorBillEvent(client, {
    billId,
    billNumber: bill.bill_number,
    eventType: BILLING_EVENTS.BILL_CANCELLED,
    fromState: status,
    toState: 'cancelled',
    payload: { reason: trimmed },
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
    `SELECT bill_id, bill_number, status, generated_by FROM vendor_monthly_bills WHERE bill_id = $1`,
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
async function ageingBuckets(db, { customerId = null, asOf = null } = {}) {
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
      GROUP BY ci.customer_id, COALESCE(c.company_name, c.name)
      ORDER BY outstanding DESC`,
    [customerId, asOf]
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
