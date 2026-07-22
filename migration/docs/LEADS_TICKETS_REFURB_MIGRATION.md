# Leads + Tickets Migration — revemp_backend → new_crm_rentfoxxy

## 1. Database analysis report

### Source identity

| Item | Value |
|------|-------|
| Backup file | `laptop_refurbishment_backup.sql` (repo root) |
| Format | PostgreSQL 15+ dump (`public` schema) |
| Origin project | **revemp_backend** (same codebase lineage as CRM; branch name in git) |
| **Not** ERP MySQL | This migration is PostgreSQL → PostgreSQL |

There is **no separate folder** `C:/rentfoxxy/revemp_backend`. Source code for both modules lives in `crm_rentfoxxy`; the backup is the **data** from the old production/refurb database.

### Source row counts (from backup analysis)

| Table | Rows | Module |
|-------|------|--------|
| `leads` | **802** | Leads |
| `lead_activities` | 3,142 | Lead status / follow-up history |
| `lead_assignments` | 1,063 | Lead assignments |
| `lead_remarks` | 1,913 | Lead notes |
| `lead_company_research` | 770 | Lead research |
| `lead_followup_notifications` | 164 | Follow-up emails |
| `lead_addresses` | 0 | — |
| `lead_orders` | 0 | — |
| `tickets` | **1,144** | Floor tickets |
| `activities` | 8,986 | Ticket comments + stage history |
| `work_logs` | 4,623 | Ticket time logs |
| `ticket_parts` | 18 | Parts used |
| `part_requests` | 1 | Part requests |
| `photos` | 0 | Ticket attachments (none in backup) |
| `users` | (see backup) | Owner references |

### Target state (local CRM before migration)

| Table | Rows |
|-------|------|
| `leads` | 1 |
| `tickets` | 0 |
| `users` | 27 |

### Schema comparison summary

**Leads:** Source and target share the same core tables. Target (`new_crm_rentfoxxy`) adds Phase 3 columns (`whatsapp_number`, `gst_number`, `customer_id`, `inquiry_type`, …) and status `Repeat` (migration 083). Migration upserts source columns and applies defaults for new columns.

**Tickets:** Source has a **simpler** `tickets` table (20 columns, 4 statuses). Target adds Phase 2 QC pipeline columns (`ticket_type`, `qc_fail_count`, `vendor_serial_id`, …) and statuses `qc_failed_return_vendor`, `cancelled`. Migration preserves source data and defaults new fields.

**Status history:** No dedicated `ticket_status_history` / `lead_status_history` tables. History lives in `lead_activities` (leads) and `activities` (tickets).

**Attachments:** `photos` table exists but is **empty** in backup. No file copy required for this migration.

### Related tables (not in scope unless extended)

- `support_tickets`, `support_ticket_items` — customer support (separate module; see `migration/scripts/023_support_tickets.js` for ERP)
- `email_lead_ingestion_log` — runtime log
- `lead_auto_assign_config` — **CRM config — preserved, not overwritten**

---

## 2. Migration modules

| Module | Script | Description |
|--------|--------|-------------|
| **033** | `scripts/033_refurb_leads.js` | Leads + all child tables |
| **034** | `scripts/034_refurb_tickets.js` | Tickets + activities, work_logs, ticket_parts, part_requests |

Orchestrator: `run-leads-tickets-resync.js`

### Idempotency

- Upsert by primary key (`ON CONFLICT DO UPDATE`)
- `erp_id_map` entities: `refurb_leads`, `refurb_tickets`
- Pre-migration backup tables: `leads_refurb_backup_033`, `tickets_refurb_backup_034`
- Safe to re-run with `--force`

### User / owner mapping

- Source `users.user_id` → target `users.user_id` by **email match**
- Unmatched users → FK set to NULL (logged in migration output)

### Stage mapping (tickets)

- `stages.stage_id` remapped by **stage_name** (case-insensitive)
- CRM stage definitions are **not replaced** (see `SYSTEM_TABLES.md`)

---

## 3. Production deployment steps

### Step 1 — Restore source database

On a host reachable from the migration runner (local or server):

```powershell
createdb -U postgres laptop_refurbishment
psql -U postgres -d laptop_refurbishment -f C:\rentfoxxy\crm_rentfoxxy\laptop_refurbishment_backup.sql
```

### Step 2 — Configure migration/.env

```env
REFURB_DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/laptop_refurbishment
DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5433/postgres
MIGRATION_APPROVED=true
MIGRATION_BATCH_SIZE=500
```

Ensure CRM target has all SQL migrations applied (`backend/migrations/*.sql`).

### Step 3 — Baseline reconciliation

```powershell
cd C:\rentfoxxy\crm_rentfoxxy\migration
npm install
npm run reconcile:leads-tickets
```

Record **Source Lead Count** and **Source Ticket Count**.

### Step 4 — Run migration

```powershell
npm run migrate:leads-tickets:force
```

### Step 5 — Validate

```powershell
npm run reconcile:leads-tickets
psql $DATABASE_URL -f sql/033_leads_validation.sql
psql $DATABASE_URL -f sql/034_tickets_validation.sql
```

**Expected after successful migration:**

| Metric | Expected |
|--------|----------|
| Target leads | ≥ 802 (may be higher if CRM had existing leads) |
| Target tickets | ≥ 1,144 |
| Orphan `lead_activities` | 0 |
| Orphan ticket `activities` | 0 |

### Step 6 — Application smoke test

1. Open `/lead-crm/leads` — list shows migrated leads with status/stage
2. Open a lead detail — activities, remarks, research visible
3. Open `/floor-pipeline/tickets` or `/inventory-management/qc-process` — tickets list
4. Open a ticket — stage, notes (activities), work logs

### Step 7 — Rollback (if needed)

```powershell
psql $DATABASE_URL -f sql/rollback_034_tickets.sql
psql $DATABASE_URL -f sql/rollback_033_leads.sql
```

---

## 4. Validation queries

See:

- `sql/033_leads_validation.sql`
- `sql/034_tickets_validation.sql`
- `tools/reconcile-leads-tickets.js` (automated before/after)

### Quick checks

```sql
SELECT COUNT(*) FROM leads;
SELECT COUNT(*) FROM tickets;
SELECT COUNT(*) FROM lead_activities la
  LEFT JOIN leads l ON l.lead_id = la.lead_id WHERE l.lead_id IS NULL;
```

---

## 5. API compatibility report

| Area | Status | Notes |
|------|--------|-------|
| `GET/POST /api/leads` | Compatible | Same controller (`leadController.js`) |
| Lead status workflow | Compatible | Target supports all source statuses + `Repeat` |
| Lead follow-ups | Compatible | `follow_up_date` migrated; `follow_up_time` NULL unless set in CRM |
| `GET/POST /api/tickets` | Compatible | Extra nullable QC columns on target |
| Ticket notes | Compatible | Stored in `activities` |
| Ticket attachments | N/A | No photos in source backup |
| RBAC sections | `leads`, `floor_tickets` | Unchanged |

---

## 6. File index

| File | Purpose |
|------|---------|
| `lib/refurbSource.js` | PostgreSQL source connection |
| `lib/refurbUserMap.js` | User ID remap by email |
| `lib/refurbRunner.js` | Module runner |
| `scripts/033_refurb_leads.js` | Leads migration |
| `scripts/034_refurb_tickets.js` | Tickets migration |
| `run-leads-tickets-resync.js` | Orchestrator |
| `tools/reconcile-leads-tickets.js` | Count validation |
| `docs/LEADS_TICKETS_FIELD_MAPPING.md` | Column mapping |
| `sql/033_leads_validation.sql` | SQL validation |
| `sql/034_tickets_validation.sql` | SQL validation |
| `sql/rollback_033_leads.sql` | Rollback leads |
| `sql/rollback_034_tickets.sql` | Rollback tickets |

---

## 7. Important constraints

1. **Do not truncate** `lead_auto_assign_config`, `stages`, or `stage_transition_rules` on target.
2. Migration **upserts** leads/tickets by ID — existing CRM row with same ID will be **overwritten** (backup table created first).
3. Ensure **users exist in CRM with same emails** as source for correct assignment attribution.
4. `customers.source_lead_id` is **not** auto-backfilled; run lead→customer linking separately if needed.
