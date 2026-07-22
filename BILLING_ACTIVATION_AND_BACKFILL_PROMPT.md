# RENTFOXXY CRM — BILLING ACTIVATION & HISTORICAL BACKFILL (run BEFORE Phase 2 dashboards)

**Repo:** `github.com/pankajrentfoxxy/crm_rentfoxxy` · **Branch:** `new_crm_rentfoxxy`
**Why this exists:** Customer invoices and vendor bills generate **nothing** today. The billing engine is correct — the migrated rental data is missing the fields the engine filters on, so every record is (correctly) skipped. This prompt (1) diagnoses coverage, (2) backfills the missing trigger fields, then (3) generates one correctly-dated invoice/bill per past month up to last month. **Do this before the Phase 2 reporting work** — dashboards need data to show.

> No engine rewrite. No business-rule, GST, or pro-rata change. Everything additive, idempotent, and dry-runnable first.

---

## ROOT CAUSE (confirmed in code)

`generateCustomerInvoice()` filters serials with:
```
current_customer_id IS NOT NULL
AND inventory_status IN ('rented','returned')
AND rent_start_date IS NOT NULL
AND rent_start_date <= monthEnd
AND (rent_billed_until IS NULL OR rent_billed_until < monthEnd)
AND rent_monthly_rate  -> the billed amount
```
Migration `035_normalize_out_stock_customer_assets.sql` sets `inventory_status='rented'` for customer-held assets but **does not set `rent_start_date` or `rent_monthly_rate`** → every migrated rental fails `rent_start_date IS NOT NULL` → **0 invoices**.

Vendor side: `generateVendorBill()` reads the rate from `vpo.line_items->0->>'rate'` and the start from `extra->>'received_at' / rental_start_date / created_at`. Migrated POs that lack a `line_items[0].rate` produce ₹0/skipped bills.

---

## STEP 1 — PRE-FLIGHT DIAGNOSTIC (read-only, run first)

Script: `backend/scripts/billing-readiness-report.js`. Output a coverage table so we see the gap before changing anything.

**Customer side** — over `vendor_serial_numbers` where `current_customer_id IS NOT NULL AND deleted_at IS NULL`:
- total deployed serials
- count with `inventory_status IN ('rented','returned')`
- count missing `rent_start_date`
- count missing/zero `rent_monthly_rate`
- count with `current_customer_id` pointing to a non-existent customer (orphans)
- distinct customers affected

**Vendor side** — over rental/rent_to_own POs:
- total serials on `purchase_order_type IN ('rental_purchase','rent_to_own')`
- count missing a derivable rate (`vpo.line_items->0->>'rate'` NULL)
- count missing a derivable start date

**Acceptance:** prints `{customer: {...}, vendor: {...}}` with counts. This is the go/no-go gate for Step 2.

---

## STEP 2 — DATA ACTIVATION BACKFILL (populate the trigger fields)

Script: `backend/scripts/activate-rental-billing-fields.js` with `--dry-run` (default) and `--commit`. All writes in a transaction. **Never** overwrite a non-NULL value — only fill NULLs (additive, re-runnable).

### 2a. `rent_start_date` (per serial) — derive from the best available source, in priority order:
1. **Delivery challan**: the delivered/POD date of the DC line that carried this serial to the customer (join `delivery_challan_lines` → `delivery_challans` on serial; use delivered/completed date).
2. **Sales order**: the SO line / SO date for that serial if no DC date.
3. **ERP source**: the rental start from the migration source (e.g. `migration/scripts/019_customer_rentals.js` source data / `extra->>'erp_rental_start'` if stored).
4. **Fallback**: `created_at::date` of the serial (flag these as `low_confidence` in a report so they can be reviewed).

### 2b. `rent_monthly_rate` (per serial) — derive in priority order:
1. SO line rate for that serial (the agreed customer rate).
2. Rental agreement rate for that customer, if present.
3. ERP monthly rate from migration source.
4. If none: leave NULL and add to a `needs_rate` exceptions report — **do not guess a rate**. These serials are excluded from generation until a rate is set.

### 2c. `current_customer_id` integrity:
- Report (don't auto-fix) any serial whose `current_customer_id` has no matching `customers` row.

### 2d. Vendor side:
- For rental/rent_to_own POs missing `line_items[0].rate`, backfill the rate from the ERP PO source into the PO `line_items` JSON (or a new `rent_rate` column if cleaner) — dry-run + exceptions report first.
- Ensure a derivable start date (`extra->>'received_at'` or `rental_start_date`) exists; backfill from GRN received date where missing.

**Outputs:** `backend/docs/BILLING_ACTIVATION_REPORT.md` — counts updated, `low_confidence` start dates, `needs_rate` exceptions, orphan customers. **Acceptance:** after `--commit`, the Step 1 diagnostic shows ~0 serials missing `rent_start_date` (except intentionally excluded), and `needs_rate` is an explicit, reviewable list.

---

## STEP 3 — HISTORICAL BACKFILL RUNNER (one invoice per month, up to last month)

Script: `backend/scripts/backfill-historical-invoices.js` with `--dry-run` / `--commit`, `--from=YYYY-MM` (optional), `--until=YYYY-MM` (default: current month for customers/prepaid; last completed month for vendors/postpaid).

**Why a runner is needed:** calling `generateCustomerInvoice(c, month, year)` once with a late month **lumps all prior unbilled months into a single invoice**. To get clean, separate, correctly-dated monthly invoices, generate **month-by-month in chronological order** so each call bills exactly one month and advances `rent_billed_until` one step.

### Customer logic (PREPAID):
1. For each customer with eligible serials, find the **earliest** `rent_start_date` across their serials → `startMonth`.
2. `endMonth` = `--until` (default current month, since prepaid bills the current month on the 1st).
3. Loop `m` from `startMonth` to `endMonth` **in order**:
   - call the existing `generateCustomerInvoice(customerId, m.month, m.year)`
   - it is idempotent (skips if an invoice already exists for that customer+month+year)
   - each iteration advances `rent_billed_until` by one month
4. Collect per-month results (generated / skipped / amount).

### Vendor logic (POSTPAID):
- Same month-by-month loop calling `generateVendorBill(vendorId, m.month, m.year)` from each vendor's earliest received date up to `--until` (default last completed month).

### Safety:
- Wrap each month in try/catch; one failing customer/month must not abort the run.
- `--dry-run` prints the full plan: per customer/vendor, which months would be generated and the projected totals, **without writing**.
- Idempotent: re-running only fills gaps (existing invoices are skipped by the engine's existing check).
- Emit `backend/docs/HISTORICAL_BACKFILL_REPORT.md`: invoices created per month, totals per entity (Rentfoxxy vs gorefurbo), skipped count, errors.

**Acceptance:**
- After `--commit`, every eligible customer has one invoice per month from their rental start through the until-month, correctly dated, with `rent_billed_until` advanced to the until-month end.
- Re-running the runner generates 0 new invoices (full idempotency).
- Spot-check 2 customers: sum of their monthly invoice subtotals = months × (serials × monthly_rate), with correct pro-rata on the first month if they started mid-month.

---

## STEP 4 — VERIFY, THEN HAND OFF TO PHASE 2

- Re-run Step 1 diagnostic → coverage ~100% (minus the explicit `needs_rate` exceptions).
- Confirm `customer_invoices` and `vendor_monthly_bills` are now populated for all past months.
- Confirm the live crons (`generateAllCustomerInvoices` on the 1st, `generateAllVendorBills` month-end) will now pick these serials up going forward — because the trigger fields exist.
- **Only now** start the Phase 2 dashboards prompt (MRR, aging, cash-flow, fleet) — they will have real data.

---

## DELIVERABLES
- [ ] `billing-readiness-report.js` (Step 1) + go/no-go counts.
- [ ] `activate-rental-billing-fields.js` (Step 2) + `BILLING_ACTIVATION_REPORT.md`, dry-run default, NULL-fill only.
- [ ] `backfill-historical-invoices.js` (Step 3) + `HISTORICAL_BACKFILL_REPORT.md`, month-by-month, idempotent, dry-run default.
- [ ] Vendor PO rate/start backfill (Step 2d).
- [ ] Post-run verification (Step 4).

## CONSTRAINTS
- Dry-run is the default for every write script; `--commit` is explicit.
- NULL-fill only — never overwrite an existing `rent_start_date` / `rent_monthly_rate`.
- Never guess a monthly rate; missing rates go to a reviewable exceptions list and are excluded.
- No engine logic change; reuse `generateCustomerInvoice` / `generateVendorBill` as-is.
- Protected ERP/auth/RBAC tables untouched; all scripts re-runnable and transactional.
- Money math unchanged: NUMERIC, 2-decimal, GST 18% on goods subtotal only (Haryana 06 → CGST+SGST else IGST).
