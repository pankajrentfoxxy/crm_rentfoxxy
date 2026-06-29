# Historical Backfill Report

Generated: 2026-06-29T20:23:07.326Z
Mode: dry-run
Customer until: 2026-06
Vendor until: 2026-05
From override: (entity earliest start)

## Summary

| Side | Entities | Generated | Skipped | Would generate | Errors |
|------|----------|-----------|---------|----------------|--------|
| Customer | 10 | 0 | 17 | 5 | 0 |
| Vendor | 2 | 0 | 2 | 0 | 0 |

## By month (customer)

| Month | Generated | Skipped | Would generate |
|-------|-----------|---------|----------------|
| 2026-04 | 0 | 4 | 1 |
| 2026-05 | 0 | 6 | 1 |
| 2026-06 | 0 | 7 | 3 |

## By month (vendor)

| Month | Generated | Skipped | Would generate |
|-------|-----------|---------|----------------|
| 2026-04 | 0 | 1 | 0 |
| 2026-05 | 0 | 1 | 0 |

## Next step

Run `node scripts/backfill-historical-invoices.js --commit` after activation.
