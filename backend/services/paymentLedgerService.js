/**
 * Payment ledger — partial/full payments for customer invoices and vendor bills.
 */
const pool = require('../config/db');

function deriveCustomerStatus(amountPaid, grandTotal, currentStatus) {
  const paid = parseFloat(amountPaid || 0);
  const total = parseFloat(grandTotal || 0);
  if (total > 0 && paid >= total) return 'paid';
  if (paid > 0 && paid < total) return 'partially_paid';
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

async function recordPayment(db, {
  partyType,
  invoiceId = null,
  billId = null,
  amount,
  paymentDate = null,
  method = null,
  reference = null,
  notes = null,
  recordedBy = null,
}) {
  const client = db.connect ? await db.connect() : null;
  const q = client || db;
  const ownTx = !!client;

  try {
    if (ownTx) await client.query('BEGIN');

    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error('Payment amount must be greater than zero');
    }
    if (partyType === 'customer' && !invoiceId) throw new Error('invoice_id required');
    if (partyType === 'vendor' && !billId) throw new Error('bill_id required');

    let customerId = null;
    let vendorId = null;
    let grandTotal = 0;
    let currentStatus = null;

    if (partyType === 'customer') {
      const inv = await q.query(
        `SELECT invoice_id, customer_id, grand_total, status FROM customer_invoices WHERE invoice_id = $1`,
        [invoiceId]
      );
      if (!inv.rows.length) throw new Error('Invoice not found');
      customerId = inv.rows[0].customer_id;
      grandTotal = parseFloat(inv.rows[0].grand_total || 0);
      currentStatus = inv.rows[0].status;
    } else {
      const bill = await q.query(
        `SELECT bill_id, vendor_id, total_payable, status FROM vendor_monthly_bills WHERE bill_id = $1`,
        [billId]
      );
      if (!bill.rows.length) throw new Error('Bill not found');
      vendorId = bill.rows[0].vendor_id;
      grandTotal = parseFloat(bill.rows[0].total_payable || 0);
      currentStatus = bill.rows[0].status;
    }

    const payDate = paymentDate || new Date().toISOString().slice(0, 10);

    const ins = await q.query(
      `INSERT INTO payment_records
        (party_type, customer_id, vendor_id, invoice_id, bill_id, amount,
         payment_date, method, reference, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        partyType,
        customerId,
        vendorId,
        invoiceId,
        billId,
        amt.toFixed(2),
        payDate,
        method,
        reference,
        notes,
        recordedBy,
      ]
    );

    const amountPaid = await sumPayments(q, { invoiceId, billId });
    const newStatus =
      partyType === 'customer'
        ? deriveCustomerStatus(amountPaid, grandTotal, currentStatus)
        : deriveVendorStatus(amountPaid, grandTotal, currentStatus);

    if (partyType === 'customer') {
      await q.query(
        `UPDATE customer_invoices
         SET amount_paid = $1, status = $2,
             paid_at = CASE WHEN $2 = 'paid' THEN NOW() ELSE paid_at END,
             payment_reference = COALESCE($3, payment_reference),
             updated_at = NOW()
         WHERE invoice_id = $4`,
        [amountPaid.toFixed(2), newStatus, reference, invoiceId]
      );
    } else {
      await q.query(
        `UPDATE vendor_monthly_bills
         SET amount_paid = $1, status = $2,
             payment_date = CASE WHEN $2 = 'paid' THEN COALESCE($3::date, CURRENT_DATE) ELSE payment_date END,
             payment_reference = COALESCE($4, payment_reference),
             updated_at = NOW()
         WHERE bill_id = $5`,
        [amountPaid.toFixed(2), newStatus, payDate, reference, billId]
      );
    }

    if (ownTx) await client.query('COMMIT');
    return { payment: ins.rows[0], amount_paid: amountPaid, status: newStatus };
  } catch (err) {
    if (ownTx) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
  }
}

async function recordFullPayment(db, { partyType, invoiceId, billId, reference, recordedBy, method = 'adjustment' }) {
  const q = db;
  let grandTotal = 0;
  let amountPaid = 0;

  if (partyType === 'customer') {
    const inv = await q.query(
      `SELECT grand_total, amount_paid FROM customer_invoices WHERE invoice_id = $1`,
      [invoiceId]
    );
    if (!inv.rows.length) throw new Error('Invoice not found');
    grandTotal = parseFloat(inv.rows[0].grand_total || 0);
    amountPaid = parseFloat(inv.rows[0].amount_paid || 0);
  } else {
    const bill = await q.query(
      `SELECT total_payable, amount_paid FROM vendor_monthly_bills WHERE bill_id = $1`,
      [billId]
    );
    if (!bill.rows.length) throw new Error('Bill not found');
    grandTotal = parseFloat(bill.rows[0].total_payable || 0);
    amountPaid = parseFloat(bill.rows[0].amount_paid || 0);
  }

  const remaining = parseFloat((grandTotal - amountPaid).toFixed(2));
  if (remaining <= 0) {
    return { skipped: true, reason: 'Already fully paid' };
  }

  return recordPayment(db, {
    partyType,
    invoiceId,
    billId,
    amount: remaining,
    reference,
    method,
    recordedBy,
  });
}

async function listPayments({ invoiceId, billId }) {
  if (invoiceId) {
    const r = await pool.query(
      `SELECT * FROM payment_records WHERE invoice_id = $1 ORDER BY payment_date DESC, payment_id DESC`,
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

module.exports = {
  deriveCustomerStatus,
  deriveVendorStatus,
  recordPayment,
  recordFullPayment,
  listPayments,
  sumPayments,
};
