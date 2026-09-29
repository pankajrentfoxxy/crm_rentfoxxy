/**
 * Customer Access scope for /api/customer-billing (claude/carret-money.md).
 *
 * Every other customer-touching API narrows to the caller's customer_access
 * (req.allowedCustomerTypes, set by middleware/customerScope). Customer billing
 * did not, so a sales-only user with customer_billing view saw every rental
 * customer's invoices, credit notes and deposits. These helpers apply the same
 * rule: lists get a customer_type condition, single records are checked by the
 * customer they belong to (404 when missing, 403 when out of scope).
 */
const pool = require('../config/db');
const { isRestricted, isCustomerTypeAllowed } = require('./customerAccessScope');

class ScopeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const OUT_OF_SCOPE = 'Access denied: this customer is outside your Customer Access scope';

/** The allowed types when the caller is restricted, else null (no filter). */
function scopedTypes(req) {
  return isRestricted(req?.allowedCustomerTypes) ? req.allowedCustomerTypes : null;
}

/** Push "COALESCE(<col>, 'both') = ANY($n)" when restricted. */
function appendScope(req, where, params, column = 'c.customer_type') {
  const types = scopedTypes(req);
  if (!types) return;
  params.push(types);
  where.push(`COALESCE(${column}, 'both') = ANY($${params.length}::text[])`);
}

async function assertCustomer(req, customerId, db = pool) {
  const id = Number(customerId);
  if (!Number.isInteger(id) || id <= 0) throw new ScopeError('A valid customer is required', 400);
  const { rows } = await db.query('SELECT customer_id, customer_type, closed_at FROM customers WHERE customer_id = $1', [id]);
  if (!rows.length) throw new ScopeError('Customer not found', 404);
  if (!isCustomerTypeAllowed(req?.allowedCustomerTypes, rows[0].customer_type)) throw new ScopeError(OUT_OF_SCOPE, 403);
  return rows[0];
}

async function assertByOwner(req, sql, id, notFound) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new ScopeError(notFound, 404);
  const { rows } = await pool.query(sql, [n]);
  if (!rows.length) throw new ScopeError(notFound, 404);
  if (!isCustomerTypeAllowed(req?.allowedCustomerTypes, rows[0].customer_type)) throw new ScopeError(OUT_OF_SCOPE, 403);
  return rows[0];
}

const assertInvoice = (req, id) => assertByOwner(
  req,
  `SELECT ci.invoice_id, ci.customer_id, c.customer_type
     FROM customer_invoices ci LEFT JOIN customers c ON c.customer_id = ci.customer_id
    WHERE ci.invoice_id = $1`,
  id,
  'Invoice not found'
);

const assertCreditNote = (req, id) => assertByOwner(
  req,
  `SELECT cn.credit_note_id, cn.customer_id, c.customer_type
     FROM customer_credit_notes cn LEFT JOIN customers c ON c.customer_id = cn.customer_id
    WHERE cn.credit_note_id = $1`,
  id,
  'Credit note not found'
);

const assertDeposit = (req, id) => assertByOwner(
  req,
  `SELECT sd.deposit_id, sd.customer_id, c.customer_type
     FROM customer_security_deposits sd LEFT JOIN customers c ON c.customer_id = sd.customer_id
    WHERE sd.deposit_id = $1`,
  id,
  'Deposit not found'
);

/**
 * Express helper: run the check, answer 4xx on a scope failure and return
 * false; otherwise return the row.
 */
async function guard(res, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ScopeError) {
      res.status(err.status).json({ success: false, message: err.message });
      return false;
    }
    throw err;
  }
}

module.exports = {
  ScopeError,
  OUT_OF_SCOPE,
  scopedTypes,
  appendScope,
  assertCustomer,
  assertInvoice,
  assertCreditNote,
  assertDeposit,
  guard,
};
