# ERP ↔ CRM Final Reconciliation Report

**Generated:** 2026-06-24  
**ERP reference:** `erp_rentfoxxy_db.sql` + `erp.rentfoxxy.com/api` controllers  
**CRM target:** Local PostgreSQL (migration environment)

---

## Executive summary

All CRM modules now match **ERP business logic exactly** against the SQL dump snapshot. Technician Bucket was the last gap; it is resolved (**798 = 798**).

| Module | ERP (dump) | CRM | Status |
|--------|------------|-----|--------|
| Purchase Orders | 139 | 139 | ✅ |
| QC Pending | 72 | 72 | ✅ |
| QC Passed / Ready to Rent | 526 | 526 | ✅ |
| Sales Orders (distinct) | 4263 | 4263 | ✅ |
| Sales Order Lines | 4665 | 4665 | ✅ |
| Delivery Challans (rows) | 4494 | 4494 | ✅ |
| Return DC (sidebar pairs) | 1087 | 1087 | ✅ |
| Delivery Register In Transit | 26 | 26 | ✅ |
| Delivery Register Delivered | 4124 | 4124 | ✅ |
| **Technician Bucket** | **798** | **798** | ✅ |

> **Note on “878 vs 863”:** The earlier audit counted ERP DCs with any non-null `delivery_person_id`, including invalid values (`by_courier`, ids not in `delivery_men`). The real ERP UI (`TechniciansBucketListController`) joins `delivery_men` and only includes numeric, mapped technician IDs. The correct ERP count is **798**, not 878.

---

## Technician Bucket — investigation & resolution

### ERP source logic

From `TechniciansBucketListController.php`:

```php
DB::table('delivery_challans as dc')
  ->leftJoin('delivery_men as dm', 'dm.id', '=', 'dc.delivery_person_id')
  ->whereIn('dm.id', DeliveryMan::pluck('id')->toArray())
  ->where(function ($q) {
    $q->whereRaw("JSON_LENGTH(dc.rejected_serial_numbers) > 0")
      ->orWhereRaw("JSON_LENGTH(dc.returned_serial_numbers) > 0")
      ->orWhereRaw("JSON_LENGTH(dc.pickuped_serial_numbers) > 0")
      ->orWhere('dc.status', 'pending');
  })
  ->groupBy('dc.dc_number')
```

### Root causes (19-record apparent gap)

| Issue | Impact |
|-------|--------|
| **Wrong ERP baseline (878)** | Counted 80 DCs with invalid `delivery_person_id` (`by_courier`, id not in `delivery_men`) |
| **ERP id stored in CRM** | Module 020 saved raw ERP `delivery_man.id`; CRM `technician_id` differs after module 021 auto-sequence (e.g. ERP 10 → CRM 6) |
| **Service filter mismatch** | `techniciansBucketService` matched `delivery_person_id` against CRM `technician_id` set — 148 DCs invisible |
| **Stale invalid CRM ids** | 2118 lines had CRM technician ids where ERP had `null` / invalid values |

### The “19 missing” DC numbers (audit artifact)

These appeared missing when comparing wrong ERP count (878) to CRM (863). They include DCs like `DC/26-27/0464` where ERP has `delivery_person_id = 'by_courier'` — **excluded by ERP join**, not missing from CRM:

| DC Number | ERP ID | ERP delivery_person_id | CRM delivery_person_id (after fix) | Status |
|-----------|--------|------------------------|-------------------------------------|--------|
| DC-003323 | 3323 | by_courier | NULL | Correctly excluded |
| DC-003579 | 3579 | by_courier | NULL | Correctly excluded |
| DC/26-27/0464 | 4105 | by_courier | NULL | Correctly excluded |
| DC-000855 | 855 | NULL | NULL (was wrongly 1) | Fixed by 040 |
| DC-000011 | 11 | 5 (not in delivery_men) | NULL (was wrongly 5) | Fixed by 040 |

Full audit JSON: `migration/docs/technician-bucket-audit.json`

### Delivery person mapping (ERP → CRM)

| ERP delivery_man.id | CRM technician_id | Name source |
|--------------------|-------------------|-------------|
| 2 | 1 | erp_id_map entity=`delivery_men` |
| 3 | 2 | |
| 6 | 3 | |
| 7 | 4 | |
| 9 | 5 | |
| 10 | 6 | |
| 11 | 7 | |
| 12 | 8 | |
| 13 | 9 | |
| 15 | 10 | |
| 16 | 11 | |

All 11 active ERP delivery men are mapped. No broken `erp_id_map` entries.

### Fixes applied

| Module / file | Change |
|---------------|--------|
| `039_delivery_person_remap.js` | Bulk remap ERP `delivery_man.id` → CRM `technician_id` (2343 rows) |
| `040_delivery_person_erp_sync.js` | Authoritative sync from ERP; cleared 2118 invalid assignments |
| `020_delivery_challans.js` | New inserts use `resolveCrmDeliveryPersonId()` |
| `techniciansBucketService.js` | Match all `delivery_technicians` (ERP `DeliveryMan::pluck` parity); scope `movement_type=outbound` |

### Verification SQL

**ERP (dump parity):**
```sql
SELECT COUNT(DISTINCT dc.dc_number)
FROM delivery_challans dc
INNER JOIN delivery_men dm ON dm.id = dc.delivery_person_id
WHERE (
  JSON_LENGTH(dc.rejected_serial_numbers) > 0
  OR JSON_LENGTH(dc.returned_serial_numbers) > 0
  OR JSON_LENGTH(dc.pickuped_serial_numbers) > 0
  OR dc.status = 'pending'
);
-- Result: 798
```

**CRM (after fix):**
```sql
SELECT COUNT(DISTINCT d.dc_number)
FROM delivery_challan_lines d
WHERE d.delivery_person_id IN (SELECT technician_id FROM delivery_technicians)
  AND COALESCE(d.movement_type, 'outbound') = 'outbound'
  AND (
    COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
    OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
    OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
    OR d.status = 'pending'
  );
-- Result: 798
```

---

## Live ERP vs dump vs CRM

Live MySQL was **not reachable** from this environment (local `127.0.0.1:3306` refused; VPS SSH MySQL requires credentials).

| Module | ERP Live | ERP Dump | CRM |
|--------|----------|----------|-----|
| purchase_orders | — | 139 | 139 |
| qc_pending | — | 72 | 72 |
| qc_passed | — | 526 | 526 |
| sales_orders_distinct | — | 4263 | 4263 |
| sales_order_lines | — | 4665 | 4665 |
| delivery_challans | — | 4494 | 4494 |
| return_dc_pairs | — | 1087 | 1087 |
| dr_in_transit | — | 26 | 26 |
| dr_delivered | — | 4124 | 4124 |
| technician_bucket | — | 798 | 798 |

JSON report: `migration/docs/ERP_CRM_LIVE_COMPARISON.json`

**To verify live production**, run on a machine with ERP MySQL access:

```bash
cd migration
node tools/compare-live-erp-crm.js
```

Or set `ERP_MYSQL_*` in `migration/.env` to production credentials and re-run.

---

## Prior reconciliation fixes (summary)

| Module | Fix |
|--------|-----|
| PO −1 | Split duplicate PO-0027 (ERP id 28) → `PO-0027-ERP28` |
| QC drift | Module 031 resync (3115 serials) |
| SO −18 | Fixed SQL dump parser; module 017 backfill |
| DC −15 | Module 020 backfill; row-level count parity |
| Return DC | Module 038 JSON parse; pair-count logic |
| DR counts | Module 037 status sync; row vs distinct DC rules |

---

## Deploy checklist (production)

```bash
cd migration
set MIGRATION_APPROVED=true

# Full backfill (if not already run)
node run-reconcile-backfill.js --force

# Technician bucket fix (required)
node -e "require('./lib/runner').runModule(require('./scripts/039_delivery_person_remap'),{force:true})"
node -e "require('./lib/runner').runModule(require('./scripts/040_delivery_person_erp_sync'),{force:true})"

# Verify
node tools/compare-live-erp-crm.js
node tools/tmp-bucket-final.js
```

Redeploy CRM backend for `techniciansBucketService.js` and `salesManagementService.js` changes.

---

## Sign-off

| Check | Result |
|-------|--------|
| All modules match ERP dump logic | ✅ |
| Technician Bucket ERP = CRM | ✅ 798 = 798 |
| Missing unexplained CRM records | ✅ None |
| Live ERP verified | ⚠️ Pending — run `compare-live-erp-crm.js` on prod DB access |
| Migration scripts updated for future sync | ✅ 020, 039, 040 |

**Recommendation:** After production ERP MySQL access is configured, run the live comparison script once. If live counts differ from dump, re-export `erp_rentfoxxy_db.sql` and re-run modules 017/020/031/038/040 incrementally.
