/**
 * Payment ledger — partial/full payments for customer invoices and vendor bills.
 *
 * MD1 (claude/carret-remaining-build.md): every payment is posted inside one
 * transaction that holds a row lock on the invoice / bill, so two clicks (or two
 * people) cannot both read the same "outstanding" and both post against it.
 *
 *   - the amount is capped at what is still outstanding (grand total less the
 *     ledger's own sum, not the cached amount_paid column);
 *   - a cancelled document takes no payment, nor does a draft invoice (it was
 *     never issued — send it first);
 *   - an idempotency key makes a repeated request return the first payment
 *     instead of posting a second one;
 *   - "mark paid" is a full payment of the outstanding computed under the lock,
 *     so a second click finds nothing outstanding and posts nothing.
 */
const pool = require('../config/db');

class PaymentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PaymentError';
    this.status = status;
  }
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function deriveCustomerStatus(amountPaid, grandTotal, currentStatus) {
  const paid = parseFloat(amountPaid || 0);
  const total = parseFloat(grandTotal || 0);
  if (total > 0 && paid >= total) return 'paid';
  if (paid > 0 && paid < total) {
    // Part-paying an overdue invoice does not make it any less overdue.
    return String(currentStatus || '').toLowerCase() === 'overdue' ? 'overdue' : 'partially_paid';
  }
  return currentStatus || 'draft';
}

function deriveVendorStatus(amountPaid, totalPayable, currentStatus) {
  const paid = parseFloat(amountPaid || 0);
  const total = parseFloat(totalPayable || 0);
  if (total > 0 && paid >= total) return 'paid';
  if (paid > 0 && paid < total) return 'partially_paid';
  return currentStatus || 'generated';
}

async function sumPayments(client, { invoiceId, billId }) {
  if (invoiceId) {
    const r = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM payment_records WHERE invoice_id = $1`,
      [invoiceId]
    );
    return parseFloat(r.rows[0].total || 0);
  }
  const r = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM payment_records WHERE bill_id = $1`,
    [billId]
  );
  return parseFloat(r.rows[0].total || 0);
}

function normaliseKey(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  if (s.length > 80 || !/^[A-Za-z0-9._:-]+$/.test(s)) {
    throw new PaymentError('Invalid idempotency key');
  }
  return s;
}

function todayYmd() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function normaliseDate(raw) {
  if (raw == null || raw === '') return todayYmd();
  const s = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00`).getTime())) {
    throw new PaymentError('Payment date must be a valid date (YYYY-MM-DD)');
  }
  if (s > todayYmd()) throw new PaymentError('Payment date cannot be in the future');
  return s;
}

/**
 * Post one payment. `full: true` pays exactly what is outstanding (mark paid).
 * Returns { payment, amount_paid, status, outstanding } — or, for a repeated
 * idempotency key, the first payment with duplicate: true; or, for a full
 * payment on a settled document, { skipped: true, reason }.
 */
async function recordPayment(db, {
  partyType,
  invoiceId = null,
  billId = null,
  amount,
  full = false,
  paymentDate = null,
  method = null,
  reference = null,
  notes = null,
  recordedBy = null,
  idempotencyKey = null,
}) {
  if (partyType !== 'customer' && partyType !== 'vendor') throw new PaymentError('Unknown party type');
  if (partyType === 'customer' && !invoiceId) throw new PaymentError('invoice_id required');
  if (partyType === 'vendor' && !billId) throw new PaymentError('bill_id required');
  const key = normaliseKey(idempotencyKey);
  const payDate = normaliseDate(paymentDate);
  let requested = null;
  if (!full) {
    requested = round2(amount);
    if (!Number.isFinite(Number(amount)) || !(requested > 0)) {
      throw new PaymentError('Payment amount must be greater than zero');
    }
  }

  const client = db.connect ? await db.connect() : null;
  const q = client || db;
  const ownTx = !!client;

  try {
    if (ownTx) await client.query('BEGIN');

    // Lock the document first: a concurrent request with the same key waits
    // here and then finds the first payment below.
    let doc;
    if (partyType === 'customer') {
      const inv = await q.query(
        `SELECT invoice_id, invoice_number, customer_id, grand_total, status
           FROM customer_invoices WHERE invoice_id = $1 FOR UPDATE`,
        [invoiceId]
      );
      if (!inv.rows.length) throw new PaymentError('Invoice not found', 404);
      doc = inv.rows[0];
    } else {
      const bill = await q.query(
        `SELECT bill_id, bill_number, vendor_id, total_payable, status
           FROM vendor_monthly_bills WHERE bill_id = $1 FOR UPDATE`,
        [billId]
      );
      if (!bill.rows.length) throw new PaymentError('Bill not found', 404);
      doc = bill.rows[0];
    }

    if (key) {
      const dup = await q.query(
        `SELECT * FROM payment_records WHERE party_type = $1 AND idempotency_key = $2`,
        [partyType, key]
      );
      if (dup.rows.length) {
        const prior = dup.rows[0];
        const sameDoc = partyType === 'customer'
          ? Number(prior.invoice_id) === Number(invoiceId)
          : Number(prior.bill_id) === Number(billId);
        if (!sameDoc) throw new PaymentError('This request key was already used for another document', 409);
        const paidNow = await sumPayments(q, { invoiceId, billId });
        if (ownTx) await client.query('COMMIT');
        return {
          payment: prior,
          duplicate: true,
          amount_paid: paidNow,
          status: doc.status,
          outstanding: round2(Number(partyType === 'customer' ? doc.grand_total : doc.total_payable) - paidNow),
        };
      }
    }

    const status = String(doc.status || '').toLowerCase();
    if (status === 'cancelled') {
      throw new PaymentError(`This ${partyType === 'customer' ? 'invoice' : 'bill'} is cancelled — it cannot take a payment`, 409);
    }
    if (partyType === 'customer' && (status === 'draft' || !status)) {
      throw new PaymentError('This invoice is still a draft. Send it to the customer before recording a payment.', 409);
    }

    const total = round2(partyType === 'customer' ? doc.grand_total : doc.total_payable);
    const paidBefore = round2(await sumPayments(q, { invoiceId, billId }));
    const outstanding = round2(total - paidBefore);

    let amt = requested;
    if (full) {
      if (!(outstanding > 0)) {
        if (ownTx) await client.query('COMMIT');
        return { skipped: true, reason: 'Already fully paid', amount_paid: paidBefore, status: doc.status, outstanding: 0 };
      }
      amt = outstanding;
    } else {
      if (!(outstanding > 0)) throw new PaymentError('Nothing is outstanding on this document', 409);
      if (amt > outstanding + 0.001) {
        throw new PaymentError(`Rs ${amt.toFixed(2)} is more than the Rs ${outstanding.toFixed(2)} outstanding`, 409);
      }
    }

    const ins = await q.query(
      `INSERT INTO payment_records
        (party_type, customer_id, vendor_id, invoice_id, bill_id, amount,
         payment_date, method, reference, notes, recorded_by, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        partyType,
        partyType === 'customer' ? doc.customer_id : null,
        partyType === 'vendor' ? doc.vendor_id : null,
        invoiceId,
        billId,
        amt.toFixed(2),
        payDate,
        method ? String(method).slice(0, 50) : null,
        reference ? String(reference).trim().slice(0, 100) || null : null,
        notes ? String(notes).slice(0, 2000) : null,
        recordedBy,
        key,
      ]
    );

    const amountPaid = round2(paidBefore + amt);
    const newStatus = partyType === 'customer'
      ? deriveCustomerStatus(amountPaid, total, doc.status)
      : deriveVendorStatus(amountPaid, total, doc.status);

    if (partyType === 'customer') {
      await q.query(
        `UPDATE customer_invoices
         SET amount_paid = $1, status = $2::varchar,
             paid_at = CASE WHEN $2::varchar = 'paid' THEN NOW() ELSE paid_at END,
             payment_reference = COALESCE($3, payment_reference),
             updated_at = NOW()
         WHERE invoice_id = $4`,
        [amountPaid.toFixed(2), newStatus, ins.rows[0].reference, invoiceId]
      );
    } else {
      await q.query(
        `UPDATE vendor_monthly_bills
         SET amount_paid = $1, status = $2::varchar,
             payment_date = CASE WHEN $2::varchar = 'paid' THEN COALESCE($3::date, CURRENT_DATE) ELSE payment_date END,
             payment_reference = COALESCE($4, payment_reference),
             updated_at = NOW()
         WHERE bill_id = $5`,
        [amountPaid.toFixed(2), newStatus, payDate, ins.rows[0].reference, billId]
      );
    }

    if (ownTx) await client.query('COMMIT');
    return {
      payment: ins.rows[0],
      amount_paid: amountPaid,
      status: newStatus,
      from_status: doc.status,
      outstanding: round2(total - amountPaid),
      document_number: doc.invoice_number || doc.bill_number || null,
    };
  } catch (err) {
    if (ownTx) await client.query('ROLLBACK');
    if (err && err.code === '23505' && /idempotency/.test(String(err.constraint || err.message))) {
      throw new PaymentError('This payment was already recorded', 409);
    }
    throw err;
  } finally {
    if (client) client.release();
  }
}

/** Pay what is outstanding, computed under the row lock (mark paid). */
function recordFullPayment(db, {
  partyType, invoiceId, billId, reference, recordedBy, method = 'adjustment', paymentDate = null, idempotencyKey = null,
}) {
  return recordPayment(db, {
    partyType, invoiceId, billId, full: true, reference, method, recordedBy, paymentDate, idempotencyKey,
  });
}

async function listPayments({ invoiceId, billId }) {
  if (invoiceId) {
    const r = await pool.query(
      `SELECT p.*, u.name AS recorded_by_name
         FROM payment_records p
         LEFT JOIN users u ON u.user_id = p.recorded_by
        WHERE p.invoice_id = $1 ORDER BY p.payment_date DESC, p.payment_id DESC`,
      [invoiceId]
    );
    return r.rows;
  }
  if (billId) {
    const r = await pool.query(
      `SELECT * FROM payment_records WHERE bill_id = $1 ORDER BY payment_date DESC, payment_id DESC`,
      [billId]
    );
    return r.rows;
  }
  return [];
}

/**
 * Customer payments received, newest first — the Finance "Payments received"
 * list. customerTypes narrows to the caller's Customer Access scope.
 */
async function listCustomerPayments(db, {
  search = '', customerId = null, from = null, to = null, method = null,
  page = 1, limit = 50, customerTypes = null,
} = {}) {
  const params = [];
  const where = [`p.party_type = 'customer'`];
  if (customerId) {
    params.push(Number(customerId));
    where.push(`p.customer_id = $${params.length}`);
  }
  if (from) {
    params.push(String(from).slice(0, 10));
    where.push(`p.payment_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(String(to).slice(0, 10));
    where.push(`p.payment_date <= $${params.length}::date`);
  }
  if (method) {
    params.push(String(method));
    where.push(`p.method = $${params.length}`);
  }
  if (Array.isArray(customerTypes) && customerTypes.length) {
    params.push(customerTypes);
    where.push(`COALESCE(c.customer_type, 'both') = ANY($${params.length}::text[])`);
  }
  const s = String(search || '').trim();
  if (s) {
    params.push(`%${s}%`);
    const n = params.length;
    where.push(`(ci.invoice_number ILIKE $${n} OR COALESCE(p.reference, '') ILIKE $${n}
                 OR COALESCE(c.company_name, '') ILIKE $${n} OR COALESCE(c.name, '') ILIKE $${n})`);
  }
  const lim = Math.min(200, Math.max(10, Number(limit) || 50));
  const pg = Math.max(1, Number(page) || 1);
  const from_ = `FROM payment_records p
      LEFT JOIN customer_invoices ci ON ci.invoice_id = p.invoice_id
      LEFT JOIN customers c ON c.customer_id = p.customer_id
      LEFT JOIN users u ON u.user_id = p.recorded_by
     WHERE ${where.join(' AND ')}`;
  const [rows, agg] = await Promise.all([
    db.query(
      `SELECT p.payment_id, p.invoice_id, p.customer_id, p.amount, p.payment_date, p.method,
              p.reference, p.notes, p.created_at, u.name AS recorded_by_name,
              ci.invoice_number, ci.status AS invoice_status, ci.grand_total, ci.amount_paid,
              COALESCE(NULLIF(c.company_name, ''), c.name) AS customer_name
         ${from_}
        ORDER BY p.payment_date DESC, p.payment_id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, lim, (pg - 1) * lim]
    ),
    db.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(p.amount), 0)::numeric AS total ${from_}`, params),
  ]);
  return {
    payments: rows.rows,
    total: agg.rows[0].n,
    amount_total: round2(agg.rows[0].total),
    page: pg,
    limit: lim,
  };
}

module.exports = {
  PaymentError,
  deriveCustomerStatus,
  deriveVendorStatus,
  recordPayment,
  recordFullPayment,
  listPayments,
  listCustomerPayments,
  sumPayments,
};
