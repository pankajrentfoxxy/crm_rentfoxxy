# QC Process & Spare Parts Migration

## Root cause analysis

### Issue 1: QC Process (3556 vs 74)

| Source | Filter | Count (from `erp_rentfoxxy_db.sql`) |
|--------|--------|-------------------------------------|
| ERP `/admin/qc/orders/qc-orders/pending` | `serial_numbers.status = 'pending'` | **71** (live ~74) |
| CRM `/inventory-management/qc-process` (before fix) | `effective_qc_status <> 'passed'` | **3556** (= 4090 − 534 passed) |

**Why CRM showed 3556**

1. **Wrong list filter** — CRM counted every laptop serial that was not QC-passed, including `out_stock` (3456), `out_for_repare`, `failed`, etc.
2. **ERP only shows `pending`** — units actively waiting in the QC queue.
3. **Not duplicate rows** — the 3556 are real migrated serials with legacy statuses; they are not duplicates, but most belong on other inventory tabs (Ready to Rent, Out for Repair, Customer Assets), not QC Process.

**Fix**

1. Change CRM list filter to `status = 'pending'` (ERP parity) — `backend/services/inventoryManagementService.js`
2. Run module **031** to resync `qc_status` / `inventory_status` / `extra.status` from ERP for all mapped serials

### Issue 2: Parts (empty vs 476)

| CRM URL | Table | Expected content |
|---------|-------|------------------|
| `/inventory-management/parts` | `parts` | Floor warehouse catalog (RAM, SSD, etc.) — **never seeded from ERP** |
| `/vendor-management/spare-parts-po` | `vendor_spare_parts_purchase_orders` | Spare Parts PO headers (476 in ERP) |
| `/inventory-management/spare-parts` | `vendor_serial_numbers` where `spo_id IS NOT NULL` | Received spare part units |

**Why CRM parts were empty**

1. Migration **015** targets `vendor_spare_parts_*` but may not have run on production, or skipped rows when vendors were unmapped.
2. **015 is insert-only** — does not update existing SPOs; re-runs skip completed module.
3. **`serial_number_parts` (1511 rows) was never migrated** — only laptop `serial_numbers` were migrated in 013.
4. **`parts` floor table** is separate from SPO; ERP `spare_parts` catalog was not copied into `parts`.

**Fix — module 032**

1. Upsert spare parts catalog + all 476 SPOs
2. Migrate parts GRNs + part serials
3. Seed `parts` from ERP `spare_parts` for `/inventory-management/parts`

---

## Files added

| File | Purpose |
|------|---------|
| `migration/scripts/031_qc_process_resync.js` | Resync QC statuses from ERP |
| `migration/scripts/032_spare_parts_full_resync.js` | Full spare parts import |
| `migration/lib/erpSqlDumpSource.js` | Read ERP from SQL dump (no MySQL) |
| `migration/lib/erpSource.js` | MySQL or dump unified source |
| `migration/lib/qcStatusHelpers.js` | Shared QC status mapping |
| `migration/tools/reconcile-qc-parts.js` | Before/after count report |
| `migration/run-qc-parts-resync.js` | Orchestrator (031 + 032) |
| `migration/sql/031_qc_validation.sql` | CRM validation queries |
| `migration/sql/032_parts_validation.sql` | CRM validation queries |
| `migration/sql/rollback_031_qc.sql` | Restore QC from backup table |
| `migration/sql/rollback_032_parts.sql` | Restore SPO snapshots |

---

## Local execution (SQL dump)

```powershell
cd C:\rentfoxxy\crm_rentfoxxy\migration

# Copy and configure .env
# CRM_PG_* or DATABASE_URL → local PostgreSQL
# ERP_USE_SQL_DUMP=true
# ERP_SQL_DUMP_PATH=../erp_rentfoxxy_db.sql
# MIGRATION_APPROVED=true

npm install

# 1. Baseline report
node tools/reconcile-qc-parts.js

# 2. Run migrations (transactional per module)
node run-qc-parts-resync.js

# 3. Validate SQL
psql -U postgres -d crm_rentfoxxy -f sql/031_qc_validation.sql
psql -U postgres -d crm_rentfoxxy -f sql/032_parts_validation.sql
```

---

## Production execution

```bash
cd /var/www/crm_rentfoxxy/migration

# .env — use live ERP MySQL + production CRM PostgreSQL
# ERP_MYSQL_HOST=...
# CRM via DATABASE_URL or CRM_PG_*
# MIGRATION_APPROVED=true
# Do NOT set ERP_USE_SQL_DUMP on production

# 1. Backup CRM tables
pg_dump -U postgres -d crm_rentfoxxy \
  -t vendor_serial_numbers \
  -t vendor_spare_parts_purchase_orders \
  -t parts \
  > /tmp/crm_qc_parts_backup_$(date +%Y%m%d).sql

# 2. Baseline
node tools/reconcile-qc-parts.js | tee /tmp/reconcile_before.txt

# 3. Run resync
node run-qc-parts-resync.js --force 2>&1 | tee /tmp/qc_parts_migration.log

# 4. After report
node tools/reconcile-qc-parts.js | tee /tmp/reconcile_after.txt

# 5. Deploy backend (qc_process filter fix)
cd /var/www/crm_rentfoxxy/backend
git pull
pm2 restart crm-backend   # or your process manager

# 6. Validate in UI
#    /inventory-management/qc-process  → should match ERP pending (~74)
#    /vendor-management/spare-parts-po → should show ~476 POs
#    /inventory-management/parts       → should show spare parts catalog
```

---

## Idempotency

- **031** — skips rows already matching ERP; backup rows use `ON CONFLICT DO NOTHING`
- **032** — upserts SPOs by `erp_id_map` + PO number; skips mapped GRN/serials
- Safe to re-run with `--force`

---

## Rollback

```bash
psql -U postgres -d crm_rentfoxxy -f migration/sql/rollback_031_qc.sql
psql -U postgres -d crm_rentfoxxy -f migration/sql/rollback_032_parts.sql
```

Restore full tables from `pg_dump` backup if needed.

---

## Expected reconciliation (from SQL dump)

| Metric | ERP | CRM target after migration |
|--------|-----|----------------------------|
| QC Processing (pending) | 71–74 | Same |
| spare_parts_po | 476 | 476 |
| spare_parts catalog | 89 | 89 |
| serial_number_parts | 1511 | 1511 (as spo_id serials) |
| parts (floor) | 89 (from catalog) | ≥ 89 |

---

## ERP reference SQL

```sql
-- ERP QC Processing count
SELECT COUNT(*) FROM serial_numbers WHERE status = 'pending';

-- ERP Spare Parts PO count
SELECT COUNT(*) FROM spare_parts_po;
```
