# Leads + Tickets Migration — Field Mapping

**Source:** `laptop_refurbishment_backup.sql` (revemp_backend / laptop refurbishment PostgreSQL)  
**Target:** `new_crm_rentfoxxy` CRM PostgreSQL

---

## Leads

### `leads` → `leads`

| Source column | Target column | Notes |
|---------------|---------------|-------|
| `lead_id` | `lead_id` | Preserved (upsert by PK) |
| `name` | `name` | Required |
| `company_name` | `company_name` | |
| `company_brand` | `company_brand` | |
| `email` | `email` | |
| `phone` | `phone` | |
| `city` | `city` | |
| `source` | `source` | |
| `status` | `status` | Target adds `Repeat` (083); source has 10 statuses |
| `lead_stage` | `lead_stage` | |
| `assigned_user_id` | `assigned_user_id` | Remapped by user email |
| `assigned_by` | `assigned_by` | Remapped by user email |
| `assigned_at` | `assigned_at` | |
| `follow_up_date` | `follow_up_date` | |
| `is_duplicate` | `is_duplicate` | |
| `duplicate_of` | `duplicate_of` | Remapped lead_id |
| `rejection_reason` | `rejection_reason` | |
| `research_status` | `research_status` | |
| `research_requested_at` | `research_requested_at` | |
| `brand` | `brand` | Laptop config |
| `processor` | `processor` | |
| `generation` | `generation` | |
| `ram` | `ram` | |
| `storage` | `storage` | |
| `personal_remarks` | `personal_remarks` | |
| `quotation_*` | `quotation_*` | All quotation columns 1:1 |
| `created_at` | `created_at` | Preserved |
| `updated_at` | `updated_at` | Preserved |
| — | `follow_up_time` | Default NULL (not in source dump) |
| — | `whatsapp_number`, `designation`, `quantity_required`, … | CRM Phase 3 columns; default NULL / `inquiry_type='rental'` |
| — | `last_activity_at` | Set from `updated_at` |
| — | `customer_id`, `converted_at`, `converted_by` | Not in source; remain NULL unless linked later |

### `lead_activities` → `lead_activities`

| Source | Target | Notes |
|--------|--------|-------|
| `activity_id` | `activity_id` | PK preserved |
| `lead_id` | `lead_id` | |
| `user_id` | `user_id` | Email remap |
| `action` | `action` | status_updated, follow_up_set, etc. |
| `status_from` / `status_to` | same | Status history |
| `stage_from` / `stage_to` | same | Sub-stage history |
| `notes` | `notes` | |
| `created_at` | `created_at` | |

### `lead_assignments` → `lead_assignments`

| Source | Target |
|--------|--------|
| `assignment_id` | `assignment_id` |
| `lead_id` | `lead_id` |
| `assigned_to` | `assigned_to` (user remap) |
| `assigned_by` | `assigned_by` (user remap) |
| `assigned_at` | `assigned_at` |
| `batch_id` | `batch_id` |

### `lead_remarks` → `lead_remarks`

| Source | Target |
|--------|--------|
| `remark_id` | `remark_id` |
| `lead_id` | `lead_id` |
| `user_id` | `user_id` |
| `note` | `note` |
| `created_at` | `created_at` |

### `lead_company_research` → `lead_company_research`

1:1 column mapping; upsert on `lead_id` (unique).

### `lead_followup_notifications` → `lead_followup_notifications`

1:1 column mapping; upsert on `notification_id`.

### Not migrated (empty in source backup)

| Table | Source rows |
|-------|-------------|
| `lead_addresses` | 0 |
| `lead_orders` | 0 |

---

## Floor Tickets

### `tickets` → `tickets`

| Source column | Target column | Notes |
|---------------|---------------|-------|
| `ticket_id` | `ticket_id` | Preserved |
| `serial_number` | `serial_number` | |
| `machine_number` | `machine_number` | |
| `ttspl_id` | `ttspl_id` | |
| `brand`, `model`, `processor`, `ram`, `storage` | same | |
| `status` | `status` | Source: 4 values; target adds `qc_failed_return_vendor`, `cancelled` |
| `priority` | `priority` | |
| — | `ticket_type` | Default `'general'` (source had no column) |
| `current_stage_id` | `current_stage_id` | Remapped by `stages.stage_name` |
| `assigned_team_id` | `assigned_team_id` | Preserved if teams unchanged |
| `assigned_user_id` | `assigned_user_id` | Email remap |
| `initial_condition`, `final_grade`, `initial_cost` | same | |
| `created_at`, `updated_at`, `completed_at` | same | |
| — | QC columns (`qc_fail_count`, …) | Default 0 / NULL |

### `activities` → `activities` (ticket comments + status/stage history)

| Source | Target |
|--------|--------|
| `activity_id` | `activity_id` |
| `ticket_id` | `ticket_id` |
| `stage_id` | `stage_id` (name remap) |
| `user_id` | `user_id` |
| `action` | `action` | note_added, stage_changed, … |
| `notes` | `notes` |
| `metadata` | `metadata` |
| `created_at` | `created_at` |

### `work_logs` → `work_logs`

1:1 mapping; user/stage remapped.

### `ticket_parts` → `ticket_parts`

| Source | Target |
|--------|--------|
| `id` | `id` |
| `ticket_id` | `ticket_id` |
| `part_id` | `part_id` |
| `quantity_used` | `quantity_used` |
| `notes` | `notes` |
| `added_at` | `added_at` |

### `part_requests` → `part_requests`

1:1 mapping (`request_id`, `ticket_id`, `part_name`, `description`, `status`, `requested_by`, timestamps).

### Not migrated (empty / attachments)

| Table | Source rows | Notes |
|-------|-------------|-------|
| `photos` | 0 | Ticket attachments — none in backup |
| `qc_results`, `qc_photos` | — | Migrate separately if needed |
| `ticket_services` | — | Not in scope |

---

## Users (reference mapping)

| Source | Target | Rule |
|--------|--------|------|
| `users.user_id` | `users.user_id` | Match on `LOWER(email)`; unmapped → NULL on FK fields |

---

## API compatibility

| Module | Source API | Target CRM API | Compatible |
|--------|------------|----------------|------------|
| Leads | `/api/leads` (revemp) | `/api/leads` | Yes — same routes & payload shape |
| Lead stages | `GET /api/leads/stages` | Same | Yes — target adds `Repeat` status |
| Tickets | `/api/tickets` | `/api/tickets` | Yes — target has extra QC/phase2 fields |
| Ticket notes | `POST /api/tickets/:id/notes` | Same → `activities` | Yes |

Frontend: `/lead-crm/leads`, `/floor-pipeline/tickets` — no route changes required after migration.
