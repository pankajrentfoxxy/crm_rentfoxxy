# ERP ↔ CRM Reconciliation Report

Generated after full audit against `erp_rentfoxxy_db.sql` and local CRM PostgreSQL.

## Summary (post-fix)

| Module | ERP (dump) | CRM (after fix) | Match |
|--------|------------|-----------------|-------|
| Purchase Orders | 139 | 139 | ✅ |
| QC Pending | 72 | 72 | ✅ |
| QC Passed / Ready to Rent | 526 | 526 | ✅ |
| Sales Orders (distinct) | 4263 | 4263 | ✅ |
| Sales Order lines | 4665 | 4665 mapped | ✅ |
| Delivery Challans (rows) | 4494 | 4494 | ✅ |
| Return DC (sidebar pairs) | 1087 | 1087 | ✅ (dump) |
| DR In Transit (rows, `status=pending`) | 26 | 26 | ✅ |
| DR Delivered (distinct `dc_number`) | 4124 | 4124 | ✅ |
| Technician Bucket (distinct DC) | 878 | 863 | ⚠️ 19 missing |

> **Note:** User-reported ERP counts (4266 SO, 1302 Return DC) reflect **live production** data. This dump snapshot differs slightly (4263 SO, 1087 Return DC pairs). Re-run reconciliation against live MySQL after deploy for exact production parity.

---

## 1. Purchase Orders

| | Count |
|--|-------|
| ERP | 139 |
| CRM (before) | 138 |
| CRM (after) | 139 |

**Root cause:** ERP PO ids **27** and **28** share the same `purchase_order_number` (`PO-0027`). Migration `010` deduped by number and mapped both ERP ids → one CRM `po_id=26`.

**Missing ERP id:** 28 (mapped to shared CRM row)

**Fix applied:**
- Inserted separate CRM PO `po_id=139` (`PO-0027-ERP28`) and remapped ERP 28
- Updated `010_purchase_orders.js` to skip number-dedupe when an existing PO belongs to a different ERP id

**Verification SQL:**
```sql
-- ERP
SELECT COUNT(*) FROM purchase_orders;

-- CRM
SELECT COUNT(*) FROM vendor_purchase_orders WHERE deleted_at IS NULL;
```

---

## 2. QC Pending

| | Count |
|--|-------|
| ERP | 72 |
| CRM (before) | 71 |
| CRM (after) | 72 |

**Root cause:** `vendor_serial_numbers.qc_status` drifted from ERP (`serial_numbers.status`). Example: ERP ids **6**, **2879** were `pending` in ERP but `out_stock` in CRM. CRM id **3852** was `pending` in CRM but not pending in ERP.

**Fix applied:** Re-ran module **031** (`qc_process_resync`) — 3115 serial rows updated.

**Verification SQL:**
```sql
-- ERP
SELECT COUNT(*) FROM serial_numbers WHERE status = 'pending';

-- CRM (matches inventoryManagementService qc_process filter)
SELECT COUNT(*) FROM vendor_serial_numbers s
INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
  AND COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') = 'pending';
```

---

## 3. QC Passed / Ready to Rent

| | Count |
|--|-------|
| ERP | 526 |
| CRM (before) | 534 (+8) |
| CRM (after) | 526 |

**Root cause:** Same QC status drift — 13 CRM serials marked `passed` while ERP was not; 5 ERP `passed` serials had wrong CRM status.

**Fix applied:** Module **031** resync (same run as above).

**Verification SQL:**
```sql
-- ERP
SELECT COUNT(*) FROM serial_numbers WHERE status = 'passed';

-- CRM
SELECT COUNT(*) FROM vendor_serial_numbers s
INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
  AND COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') = 'passed';
```

---

## 4. Sales Orders

| | Count |
|--|-------|
| ERP distinct SO | 4263 |
| CRM distinct SO (before) | 4248 |
| CRM distinct SO (after) | 4263 |
| ERP lines | 4665 |
| CRM mapped lines (after) | 4665 |

**Missing line ids:** 4648–4665 (18 lines)

**Root cause:** SQL-dump parser in `erpSqlDumpSource.js` stripped columns from `SELECT id, sales_order_number, … customer_id …` queries, leaving `customer_id` undefined → migration skipped all 18 newest lines.

**Fix applied:**
- Fixed `erpSqlDumpSource.js` column handling
- Re-ran module **017** — 18 lines inserted

**Verification SQL:**
```sql
-- ERP
SELECT COUNT(DISTINCT sales_order_number) FROM sales_orders;

-- CRM
SELECT COUNT(DISTINCT sales_order_number) FROM sales_order_lines;
```

---

## 5. Delivery Challans

| | Count |
|--|-------|
| ERP rows | 4494 |
| CRM rows (before) | 4479 |
| CRM rows (after) | 4494 |

**Root cause:** 15 ERP DC rows never migrated (customer mapped; rows added after initial migration). CRM UI counted `DISTINCT dc_number` (4133) while ERP DataTables counts **all rows** (4494).

**Fix applied:**
- Re-ran module **020** — 15 lines inserted
- Changed `salesManagementService.listDeliveryChallansGrouped` + `getOperationCounts` to count **rows** (ERP parity)
- Module **037** — resynced `status` from ERP (6 rows corrected)
- Module **038** — re-parsed escaped Laravel JSON arrays (`pickuped_serial_numbers`, etc.) for all 4494 lines

**Verification SQL:**
```sql
-- ERP
SELECT COUNT(*) FROM delivery_challans;

-- CRM
SELECT COUNT(*) FROM delivery_challan_lines WHERE COALESCE(movement_type, 'outbound') = 'outbound';
```

---

## 6. Return DC

| | Count |
|--|-------|
| ERP sidebar (`getAllSerialPairsFromChallan`) | 1087 |
| CRM (before, movement_type=return) | 1272 |
| CRM pairs (after JSON resync) | 1087 |

**Root cause:** ERP sidebar counts **unique serial+TTSPL pairs** from `pickuped_serial_numbers` on outbound DCs, not `complaints_ticket.return_dc_number`. CRM badge used distinct RDC headers. Escaped JSON in dump caused empty `pickuped_serial_numbers` in CRM (361 pairs before fix).

**Fix applied:**
- Fixed `parseJson()` for escaped dump JSON (`helpers.js`)
- Module **038** backfilled all serial JSON arrays
- `getOperationCounts().return_dc` now uses ERP-equivalent pair counting

**Verification SQL (CRM):**
```sql
-- Count unique serial|unique pairs from pickuped_serial_numbers on outbound DC lines
-- (see countReturnDcPickupPairs() in salesManagementService.js)
```

---

## 7. Delivery Register

| Tab | ERP | CRM (after) |
|-----|-----|-------------|
| In Transit (`status=pending`, row count) | 26 | 26 |
| Delivered (distinct `dc_number`) | 4124 | 4124 |

**Root cause:** CRM `in_transit` badge used `COUNT(DISTINCT dc_number)` (17–22) instead of ERP row count (26). Some DC statuses drifted from ERP.

**Fix applied:**
- `deliveryRegisterService.getDeliveryRegisterCounts()` — in_transit uses **row count** with `movement_type=outbound` + `status=pending`
- Module **037** status resync

**ERP logic reference:** `DeliveryRegisterController.php` maps route `in_transit` → DB `status='pending'`.

---

## 8. Technician Bucket

| | Count |
|--|-------|
| ERP distinct DC (bucket filter) | 878 |
| CRM distinct DC | 863 |

**ERP source:** `TechniciansBucketListController` — outbound DCs with active `delivery_person_id` and (rejected/returned/pickuped JSON **or** `status=pending`), grouped by `dc_number`.

**Remaining gap (19 DCs):** Mostly new-format DC numbers (`DC/26-27/…`) — likely `delivery_person_id` not linked to an active `delivery_technicians` row in CRM. CRM service mirrors ERP filter in `techniciansBucketService.js`; data exists after module 038 but technician linkage needs `delivery_technicians` / user mapping review.

---

## Tools & scripts added/updated

| Path | Purpose |
|------|---------|
| `migration/tools/reconcile-erp-crm-all.js` | Full module audit |
| `migration/run-reconcile-backfill.js` | One-shot backfill runner |
| `migration/scripts/037_dc_status_resync.js` | DC status sync |
| `migration/scripts/038_dc_json_fields_resync.js` | DC JSON array backfill |
| `migration/lib/erpSqlDumpSource.js` | Extended dump query support |
| `migration/lib/helpers.js` | Escaped JSON parse fix |
| `backend/services/salesManagementService.js` | DC row counts, Return DC pair count |
| `backend/services/deliveryRegisterService.js` | In-transit row count, JSON parse |

## Deploy steps (production)

```bash
cd migration
set MIGRATION_APPROVED=true
node run-reconcile-backfill.js --force
node -e "require('./lib/runner').runModule(require('./scripts/037_dc_status_resync'),{force:true})"
node -e "require('./lib/runner').runModule(require('./scripts/038_dc_json_fields_resync'),{force:true})"
node tools/reconcile-erp-crm-all.js --fix-report
```

Then redeploy CRM backend for count/query fixes.
