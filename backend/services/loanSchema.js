/**
 * Is the loan-laptop schema (migrations/262_loan_laptop_workflow.sql) installed?
 *
 * Deploys do not run migrations, so code that references support_loan_requests
 * from shared paths (billing, the inventory state machine) must not assume the
 * table exists: a missing table would fail every invoice run and every return
 * to stock. Those paths only add their loan clauses once this reports ready.
 * Before the migration has run no loan can exist, so leaving them out is exact.
 *
 * A positive answer is cached for the life of the process; a negative one is
 * re-checked at most once a minute so applying the migration needs no restart.
 */
const pool = require('../config/db');

const RECHECK_MS = 60 * 1000;
let ready = false;
let checkedAt = 0;

async function loanSchemaReady(db) {
  if (ready) return true;
  if (checkedAt && Date.now() - checkedAt < RECHECK_MS) return false;
  try {
    const r = await (db || pool).query(
      `SELECT to_regclass('public.support_loan_requests') IS NOT NULL
          AND to_regclass('public.support_loan_request_events') IS NOT NULL
          AND to_regclass('public.loan_replacement_policy_rules') IS NOT NULL AS ok`
    );
    ready = Boolean(r.rows[0]?.ok);
  } catch (_) {
    ready = false;
  }
  checkedAt = Date.now();
  return ready;
}

/** Synchronous view of the last check, for SQL fragments built inline. */
function isLoanSchemaKnownReady() {
  return ready;
}

class LoanSchemaMissingError extends Error {
  constructor() {
    super('Loan laptop tables are not installed. Run migration 262_loan_laptop_workflow.sql.');
    this.status = 503;
    this.code = 'LOAN_SCHEMA_MISSING';
  }
}

async function assertLoanSchema(db) {
  if (!(await loanSchemaReady(db))) throw new LoanSchemaMissingError();
}

module.exports = {
  loanSchemaReady,
  isLoanSchemaKnownReady,
  assertLoanSchema,
  LoanSchemaMissingError,
};
