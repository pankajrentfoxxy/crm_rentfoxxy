# Billing Activation Report

Generated: 2026-06-29T20:48:58.201Z
Mode: dry-run

## Before

```json
{
  "customer": {
    "total_deployed": 59,
    "eligible_status": 55,
    "needs_returned_status": 1,
    "needs_rented_status": 2,
    "missing_rent_start": 0,
    "missing_rate": 0,
    "missing_rent_start_deployed": 2,
    "missing_rate_deployed": 0,
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

## Customer status normalization (legacy ERP → rented/returned)

- Set to **returned**: **1**
- Set to **rented**: **2**

## Customer NULL-fill plan

- Serial updates planned: **2**
- Low-confidence start dates (created_at fallback): **2**
- Needs manual rate (excluded from billing): **0**
- Orphan customer_id (report only, not auto-fixed): **0**

### Low-confidence rent_start_date

| serial_id | serial_number | date | source |
|-----------|---------------|------|--------|
| 4 | SN-DELL-3510-004 | Sun Jun 14 | created_at |
| 5 | SN-DELL-3510-005 | Sun Jun 14 | created_at |

## Vendor PO rate backfill

- PO line_items rate updates: **0**
- Serial received_at / rental_start_date updates: **15**

## Next step

Review this report, then run `node scripts/activate-rental-billing-fields.js --commit`.
