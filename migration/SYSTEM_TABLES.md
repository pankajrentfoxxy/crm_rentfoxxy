# CRM System & Configuration Tables

> **Policy:** These tables configure CRM application behavior. Migration scripts must **NOT** truncate or bulk-replace them from ERP.  
> Where noted, **additive merge** or **monotonic sequence bump** is allowed.

---

## 1. Protection Rules

| Rule | Description |
| --- | --- |
| **No truncate** | Never `TRUNCATE` any table in this document |
| **CRM config wins** | On conflict, existing CRM configuration is authoritative |
| **Additive masters** | ERP reference data may be inserted only when no matching CRM row exists |
| **Sequence bump only** | Document sequences may be raised to ERP max; never lowered |
| **Schema migrations sacred** | `schema_migrations` tracks CRM deploy history — never modify |

---

## 2. Migration & Deploy Tracking

| Table | Purpose | Migration Action |
| --- | --- | --- |
| `public.schema_migrations` | CRM SQL migration history (`backend/migrations/*.sql`) | **NEVER MODIFY** |
| `public.erp_id_map` | ERP→CRM ID remapping (created by migration toolkit) | **CREATE IF NOT EXISTS**; append mappings only |
| `public.migration_runs` | Per-module checkpoint status | **CREATE IF NOT EXISTS**; append/update status only |

---

## 3. Company & Application Settings

| Table | Source migration | Purpose | Migration Action |
| --- | --- | --- | --- |
| `public.companies` | `076_company_seller_details.sql` | Legal entity / seller GST, address, invoice header | **PRESERVE** — ERP `business_settings` must not overwrite |
| `public.support_settings` | `026_support_redesign.sql` | Support module toggles and defaults | **PRESERVE** |
| `public.lead_auto_assign_config` | `059_lead_auto_assign_config.sql` | Lead round-robin assignment rules | **PRESERVE** |
| `public.sm_document_sequences` | `042_sales_management_module.sql` | PO/SO/Invoice/DC number sequences | **PRESERVE values**; allow `MAX(crm_seq, erp_seq)` bump from ERP `last_unique_number` |

### Document sequence special rule

ERP `last_unique_number` holds counters for RFX-INV, DC, PO, etc.

```
FOR EACH document_type:
  new_seq = GREATEST(crm_current, erp_current)
  UPDATE sm_document_sequences SET last_value = new_seq WHERE ...  -- only if erp > crm
```

Never reset sequences to 1.

---

## 4. Workflow Pipeline Configuration (QC / Floor)

| Table | Source migration | Purpose | Migration Action |
| --- | --- | --- | --- |
| `public.stages` | `056_phase2_floor_pipeline.sql` | QC floor stage definitions | **PRESERVE** — do not import ERP `qc` stage names as replacements |
| `public.stage_checklists` | `046_qc_check_parity.sql` | Per-stage checklist items | **PRESERVE** |
| `public.stage_transition_rules` | `056_phase2_floor_pipeline.sql` | Allowed stage transitions | **PRESERVE** |
| `public.qc_round_robin_state` | QC migrations | QC assignee round-robin pointer | **PRESERVE** runtime state |

**Historical QC results** (`public.qc_results`, `public.qc_photos`) are **business data** — migrate from ERP `qc` / `qc_logs` by mapping to existing CRM stage IDs via lookup, not by replacing stage definitions.

---

## 5. Asset Configuration Catalog

CRM asset dropdowns (migrations `104_asset_configuration.sql`). ERP `brands`, `attributes`, `bundle_management` are **reference only**.

| Table | Purpose | Migration Action |
| --- | --- | --- |
| `public.asset_config_brands` | Brand master | **ADDITIVE MERGE** — insert ERP brands not in CRM |
| `public.asset_config_models` | Models per brand | **ADDITIVE MERGE** |
| `public.asset_config_processors` | Processor master | **ADDITIVE MERGE** |
| `public.asset_config_generations` | Generation per processor | **ADDITIVE MERGE** |
| `public.asset_config_ram` | RAM options | **ADDITIVE MERGE** |
| `public.asset_config_storage` | Storage options | **ADDITIVE MERGE** |
| `public.asset_config_gpu` | GPU options | **ADDITIVE MERGE** |
| `public.asset_config_screen_sizes` | Screen size options | **ADDITIVE MERGE** |
| `public.laptop_catalog` | SKU / bundle catalog | **ADDITIVE MERGE** from ERP `bundle_management` |
| `public.vendor_inventory_asset_sequence` | Vendor asset ID sequence | **PRESERVE**; bump only if ERP higher |

**Never** truncate asset config tables to “sync from ERP”.

---

## 6. Support Configuration

| Table | Purpose | Migration Action |
| --- | --- | --- |
| `public.support_settings` | Support workflow config | **PRESERVE** |
| `public.support_issue_categories` | Issue type taxonomy | **ADDITIVE MERGE** from ERP `issue_types` (insert missing names only) |

---

## 7. Courier & Delivery Masters

| Table | Purpose | Migration Action |
| --- | --- | --- |
| `public.sm_courier_details` | Courier partner list | **ADDITIVE MERGE** from ERP `courier_details` |
| `public.delivery_technicians` | Field technicians | **Business data** — migrate ERP `delivery_men` additively (not auth) |

---

## 8. TTSPL / Config Audit (preserve history)

| Table | Purpose | Migration Action |
| --- | --- | --- |
| `public.ttspl_config_history` | TTSPL ID config change log | **PRESERVE** — append ERP history only if explicitly required |
| `public.ttspl_audit_log` | Operational audit | Business audit — migrate ERP logs additively |

---

## 9. CRM-Native Modules (preserve existing CRM rows)

Lead CRM was built in CRM, not ERP. **Do not import over existing leads.**

| Table | Migration Action |
| --- | --- |
| `public.leads` | **PRESERVE** |
| `public.lead_activities` | **PRESERVE** |
| `public.lead_addresses` | **PRESERVE** |
| `public.lead_assignments` | **PRESERVE** |
| `public.lead_company_research` | **PRESERVE** |
| `public.lead_followup_notifications` | **PRESERVE** |
| `public.lead_import_logs` | **PRESERVE** |
| `public.lead_orders` | **PRESERVE** |
| `public.lead_remarks` | **PRESERVE** |

Optional: ERP `contacts` → new `leads` rows only where email/phone not already present (off by default).

---

## 10. ERP System Tables (never imported)

| ERP Table | Reason |
| --- | --- |
| `business_settings` | Key-value CMS; map selectively to `companies` only if CRM field empty |
| `migrations` | Laravel migration log |
| `cache`, `jobs`, `failed_jobs` | Infrastructure |
| `currencies` | CRM assumes INR |

---

## 11. Business Data (NOT system — safe to migrate)

These are **operational/business** tables, not configuration. They receive ERP data additively (see `migration/lib/preserve.js` → `BUSINESS_TABLES`):

- Customers, vendors, inventory, serial numbers, POs, GRNs  
- Sales orders, quotations, delivery challans, invoices, credit notes  
- Support tickets, QC results, rent devices, allocation logs, inward/outward  
- Financial documents, GRN access tokens (per GRN business records)

---

## 12. Verification Queries (post-migration)

```sql
-- Config tables must not shrink vs baseline
SELECT 'schema_migrations' AS tbl, COUNT(*) FROM schema_migrations
UNION ALL SELECT 'stages', COUNT(*) FROM stages
UNION ALL SELECT 'stage_checklists', COUNT(*) FROM stage_checklists
UNION ALL SELECT 'roles', COUNT(*) FROM roles
UNION ALL SELECT 'asset_config_brands', COUNT(*) FROM asset_config_brands;

-- Document sequences must be >= pre-migration baseline
SELECT * FROM sm_document_sequences ORDER BY doc_type;
```

---

## 13. Reference

- Canonical list: `migration/lib/preserve.js` → `SYSTEM_PROTECTED`, `CRM_NATIVE_PRESERVE`, `ADDITIVE_MASTER_TABLES`
- Auth tables: `migration/AUTH_TABLES.md`
- Pre-migration baseline: `node validate-migration.js --baseline`
