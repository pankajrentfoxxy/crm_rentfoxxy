# Phase 11 report — Reports, billing hooks, cutover

Branch: `support-revamp`.  
Depends on: Phase 00–10.  
**Not applied to Railway from this machine.** Decommission (table rename, delete legacy code) is a later PR after 30 clean days.

## What shipped

### Billing hooks (off by default)

`BILLING_READ_SUPPORT_HOOKS=true` makes the invoice cron:

- subtract waived rent days from `asset_billing_holds` (`waive_rent`, last `held − free_repair_days` days)
- add `customer_invoice_extra_lines` in `APPROVED` with no invoice, then stamp `BILLED` in the same transaction

Flag off = previous behaviour. Reconcile:

```bash
node scripts/reconcile-billing-hooks.js --month 2026-07
```

Any unexplained delta exits 2 and blocks cutover.

### Reports (S20)

SQL views `support_v2_rpt_*`. Controllers only `SELECT` from views.

`GET /api/support/v2/reports/:name` and `/export` (xlsx) for  
`volume` · `sla` · `quality` · `field` · `assets` · `parts` · `commercial`.

Definitions are comments in `supportReportsService.js`.

### Settings (S19)

`support_settings_v2` JSONB + cached accessor. SLA worker, reopen window, free repair days, part lead threshold, accept window all read it. Screen at Support → Settings.

### Cutover (code only — not production)

- `/support/*` → new module (standalone page)
- `/support-v2/*` → redirect to `/support`
- `/support-legacy/*` → old module, admin menu item
- Legacy **writes** → 410 unless `SUPPORT_LEGACY_WRITES=true`
- Legacy **GETs** still work
- Nightly `dual-run-compare.js` (2:15 IST when workers are on)

### Not in this PR (30 days later)

- Delete legacy controllers / four replacement functions
- Drop `delivery_person_id`
- Rename `support_tickets_v2` → `support_tickets`
- Retire old permission sections
- Archive legacy tables

## Migrations

`212_support_v2_reports_cutover.sql`

## How to apply later (production / staging)

```bash
cd backend
node scripts/run-all-migrations.js
node scripts/migrate-support-to-v2.js --dry-run
node scripts/migrate-support-to-v2.js --apply
node scripts/reconcile-billing-hooks.js --month YYYY-MM
```

Do not set `ALLOW_DEMO_SEED`. Turn `BILLING_READ_SUPPORT_HOOKS` on only after a clean reconcile month.

## Files added

- `backend/migrations/212_support_v2_reports_cutover.sql`
- `backend/services/supportSettingsService.js`
- `backend/services/supportBillingHooks.js`
- `backend/services/supportReportsService.js`
- `backend/services/supportDualRunWorker.js`
- `backend/controllers/supportV2ReportsController.js`
- `backend/controllers/supportV2SettingsController.js`
- `backend/middleware/supportLegacyFreeze.js`
- `backend/scripts/reconcile-billing-hooks.js`
- `backend/scripts/dual-run-compare.js`
- `backend/test/support-v2-phase11.test.js`
- `frontend/src/features/support-v2/pages/ReportsPage.jsx`
- `frontend/src/features/support-v2/pages/SettingsPage.jsx`
- `docs/support-revamp/USER_GUIDE.md`
- `docs/support-revamp/API_MIGRATION.md`
- `docs/support-revamp/CUTOVER_ROLLBACK.md`
