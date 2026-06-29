# Billing Activation Report

Generated: 2026-06-29T20:23:07.154Z
Mode: dry-run

## Before

```json
{
  "customer": {
    "total_deployed": 59,
    "eligible_status": 55,
    "missing_rent_start": 0,
    "missing_rate": 0,
    "orphan_customer": 0,
    "distinct_customers": 11
  },
  "vendor": {
    "total_serials": 59,
    "missing_po_rate": 0,
    "missing_start_date": 0,
    "distinct_vendors": 2
  }
}
```

## Customer NULL-fill plan

- Serial updates planned: **0**
- Low-confidence start dates (created_at fallback): **0**
- Needs manual rate (excluded from billing): **0**
- Orphan customer_id (report only, not auto-fixed): **0**

## Vendor PO rate backfill

- PO line_items rate updates: **0**
- Serial received_at / rental_start_date updates: **15**

## Next step

Review this report, then run `node scripts/activate-rental-billing-fields.js --commit`.
