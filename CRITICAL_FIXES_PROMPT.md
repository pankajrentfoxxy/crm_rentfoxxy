# RENTFOXXY CRM — CRITICAL FIXES PROMPT (do this BEFORE redesign)

**Repo:** `github.com/pankajrentfoxxy/crm_rentfoxxy` · **Branch:** `new_crm_rentfoxxy`
**Purpose:** Close the money/data-integrity and reliability flaws found in a CTO-level audit. These are backend/data fixes only — **no UI redesign here, and no change to business rules, GST, pro-rata, or existing flows.** Everything is additive and reversible.

> Order matters. Ship Tier 1 first (money safety), then Tier 2 (reliability). The redesign happens only after these land.

---

## GROUND RULES
- Additive and idempotent. Every migration uses `IF NOT EXISTS` and is safe to re-run.
- **Never** modify protected tables (auth, RBAC, roles, permissions, passwords, stages, asset_config, companies, leads).
- Do **not** rewrite `billingSchedulerService.js` logic — only wrap it in safety (transactions) and extend it (payment + normalized lines).
- Keep the existing JSONB `line_items` snapshot on invoices/bills (legal immutability). Add a normalized mirror alongside — do not remove the snapshot.
- Money math stays consistent with current code: `NUMERIC` columns, 2-decimal rounding, GST 18% on goods subtotal only (Haryana state 06 → CGST+SGST, else IGST).

---

## TIER 1 — MONEY & DATA INTEGRITY (highest priority)

### FIX 1 — Make vendor bill generation transactional
- **Problem:** `services/billingSchedulerService.js → generateVendorBill()` runs the existence check, serial fetch, debit-note fetch, INSERT, and the debit-note "adjusted" UPDATE as **separate `pool.query` calls with no transaction**. A crash between the INSERT and the debit-note UPDATE leaves the debit note open → double-counted next month. (`generateCustomerInvoice` already does this correctly with `BEGIN/COMMIT` — mirror that.)
- **Fix:** Refactor `generateVendorBill()` to acquire a client, `BEGIN`, run the INSERT + debit-note UPDATE inside the transaction, `COMMIT`, and `ROLLBACK` on error in `finally`. No logic change — just the transaction boundary. Match the existing customer-invoice pattern exactly.
- **Acceptance:** Killing the process mid-function leaves either a complete bill+adjustment or nothing — never a partial state.

### FIX 2 — Payment ledger + partial payments (migration `118_payments_ledger.sql`)
- **Problem:** `customerBillingController.markPaid` just flips `status → 'paid'` with a single `payment_reference`. No amount, no history, no partial/short payments, no reconciliation. Same gap on vendor bills.
- **Schema (new table):**
  ```sql
  CREATE TABLE IF NOT EXISTS payment_records (
    payment_id        SERIAL PRIMARY KEY,
    party_type        VARCHAR(10) NOT NULL CHECK (party_type IN ('customer','vendor')),
    customer_id       INT REFERENCES customers(customer_id),
    vendor_id         INT REFERENCES vendors(vendor_id),
    invoice_id        INT,         -- customer_invoices.invoice_id when party_type='customer'
    bill_id           INT,         -- vendor_monthly_bills.bill_id when party_type='vendor'
    amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    method            VARCHAR(40),         -- bank_transfer, upi, cheque, cash, adjustment
    reference         VARCHAR(120),
    notes             TEXT,
    recorded_by       INT REFERENCES users(user_id),
    created_at        TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_payment_records_invoice ON payment_records(invoice_id) WHERE invoice_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_payment_records_bill ON payment_records(bill_id) WHERE bill_id IS NOT NULL;
  ```
- **Add to `customer_invoices` / `vendor_monthly_bills`:** `amount_paid NUMERIC(12,2) DEFAULT 0`. Derive status from payments: `paid` when `amount_paid >= grand_total/total_payable`, `partially_paid` (extend CHECK constraint to include it) when `0 < amount_paid < total`, else current status.
- **Backend:**
  - New `POST /api/customer-billing/invoices/:id/payments` and `POST /api/vendor-billing/bills/:id/payments` → insert a `payment_records` row, recompute `amount_paid` and `status` in a transaction. Permission `cp('customer_billing','edit')` / `cp('vendor_billing','edit')`.
  - `GET .../:id/payments` to list history.
  - Keep `markPaid` working (treat it as a full-amount payment record for backward compatibility).
- **Acceptance:** Recording ₹40k against a ₹50k invoice sets `amount_paid=40000`, `status='partially_paid'`, and a second ₹10k payment flips it to `paid`. Payment history is queryable.

### FIX 3 — Normalized invoice/bill line items (migration `119_invoice_lines_normalized.sql`)
- **Problem:** Line items exist only as JSONB on `customer_invoices` (migration 067) and `vendor_monthly_bills` (053). Revenue cannot be aggregated by SKU/brand/product in SQL — this is the root cause of missing MRR/aging/line-level reporting.
- **Fix:** Add normalized mirror tables, populated at generation time **in the same transaction** that writes the JSONB snapshot (keep the snapshot).
  ```sql
  CREATE TABLE IF NOT EXISTS customer_invoice_lines (
    line_id          SERIAL PRIMARY KEY,
    invoice_id       INT NOT NULL REFERENCES customer_invoices(invoice_id) ON DELETE CASCADE,
    serial_id        INT,
    ttspl_id         VARCHAR(60),
    brand            VARCHAR(80),
    model            VARCHAR(120),
    period_label     VARCHAR(10),       -- e.g. 2026-07
    rent_start       DATE,
    rent_end         DATE,
    days_billed      INT,
    days_in_month    INT,
    monthly_rate     NUMERIC(12,2),
    daily_rate       NUMERIC(12,2),
    amount           NUMERIC(12,2),
    is_catchup       BOOLEAN DEFAULT FALSE,
    is_returned      BOOLEAN DEFAULT FALSE
  );
  CREATE INDEX IF NOT EXISTS idx_cil_invoice ON customer_invoice_lines(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_cil_serial  ON customer_invoice_lines(serial_id);
  -- mirror table vendor_bill_lines (bill_id, serial_id, days_in_month, monthly_rate, daily_rate, amount)
  ```
- **Backfill:** one-time script `backend/scripts/backfill-invoice-lines.js` unnesting existing JSONB `line_items` into the new tables.
- **Wire-in:** in `generateCustomerInvoice` / `generateVendorBill`, after building `lineItems`, insert the same rows into the normalized table within the existing transaction.
- **Acceptance:** `SELECT brand, SUM(amount) FROM customer_invoice_lines GROUP BY brand` returns sensible revenue-by-brand; totals reconcile with the JSONB snapshot per invoice.

---

## TIER 2 — RELIABILITY

### FIX 4 — Test harness for the billing engine (highest reliability priority)
- **Problem:** No automated tests anywhere; a money engine is verified by hand.
- **Fix:** Add a lightweight test runner (node's built-in `node:test` + `assert`, zero new heavy deps) under `backend/test/`. Cover **pure functions first** (no DB): extract and unit-test `monthSegments`, `daysInclusive`, daily-rate/pro-rata math, and the return-credit-note day count. Then add integration tests against a disposable test DB for: prepaid full month, mid-month start catch-up, mid-month return + credit note, replacement (old returned + new rented), leap-Feb, credit note larger than invoice.
- Add `npm test` script. Acceptance: `npm test` runs green and covers the scenarios in `scripts/verify-billing-edge-cases.js`.

### FIX 5 — Structured logging + cron failure alerts
- **Problem:** 405 `console.*` calls, no logger, no alerting. A failed invoice/bill cron run is invisible.
- **Fix:** Introduce one small logger (`pino` — minimal, fast) wrapped in `backend/utils/logger.js`. Replace `console.*` in the billing + cron + worker paths first (don't boil the ocean — start with `services/*Scheduler*`, `services/*Worker*`, billing controllers). On any cron run, log a structured summary (`{ run, processed, skipped, errors }`); if `errors > 0`, send an alert via the existing email queue (`emailQueueService`) to an ops address.
- **Acceptance:** A forced failure in a customer-invoice run emits an error log and an ops email; success emits a summary line.

### FIX 6 — SQL safety hardening pass
- **Problem:** Pervasive dynamic SQL assembly (`\`...${where}\``). Mostly parameterized, but no enforced discipline.
- **Fix:** Audit every interpolated query in `controllers/` + `services/` (start from the grep list: partRequest, customerManagement, salesManagement, warehouse, qcManagement, vendorManagement, vendorPortal, ticket, inventory controllers). Confirm interpolated fragments are **only** column/join/whitelisted-sort identifiers, never raw user values. Where a sort/column comes from `req.query`, map it through an allowlist. Document the pattern in `backend/docs/SQL_SAFETY.md`.
- **Acceptance:** No query interpolates a request value; all values are `$N` params; sort/column inputs pass through allowlists.

### FIX 7 — Resolve the dual-ORM drift (Prisma vs raw pg)
- **Problem:** Hand-written SQL migrations + Prisma client both in use → schema drift risk.
- **Fix (low-risk, decision-first):** Do **not** rip out either. Instead: (a) run `prisma db pull` to sync `schema.prisma` with the real DB, (b) add a CI check that fails if `schema.prisma` is stale vs migrations, (c) document the rule — raw SQL migrations remain the source of truth, Prisma is read-model/typing only. This stops drift without a risky migration rewrite.
- **Acceptance:** CI flags any schema/Prisma mismatch; doc states the ownership rule.

---

## DELIVERABLES
- [ ] `generateVendorBill` wrapped in a transaction (FIX 1).
- [ ] `118_payments_ledger.sql` + payment endpoints + status derivation (FIX 2).
- [ ] `119_invoice_lines_normalized.sql` + backfill + generation wire-in (FIX 3).
- [ ] `backend/test/` harness + `npm test` green on billing scenarios (FIX 4).
- [ ] `utils/logger.js` (pino) + cron summary/alerts on billing & workers (FIX 5).
- [ ] SQL safety audit + `SQL_SAFETY.md` (FIX 6).
- [ ] Prisma sync + CI drift check + ownership doc (FIX 7).

## CONSTRAINTS
- No business-rule, GST, or pro-rata changes. No UI redesign in this prompt.
- All migrations idempotent; protected ERP/auth/RBAC tables untouched.
- Keep JSONB invoice snapshots; normalized lines are additive.
- Backward compatible: existing endpoints keep working.
