# Support V2 — Field Execution, Warehouse Receipt & the Repair Loop

**Execution prompt for Cursor — Phase 2.**
Repo: `pankajrentfoxxy/crm_rentfoxxy` · Branch: `support_revamp` · Written against `af5a565` ("Support_changes").
Follows on from `SUPPORT_V2_FLOW_FIX_PROMPT.md` (WP-1…WP-7, now merged).

---

## 0. Mission

Phase 1 fixed the desk. This phase fixes **everything after the desk**: what the technician sees on their phone, what the warehouse does when the machine lands, and how a picked-up laptop travels through the floor and comes back to the customer without anyone chasing it on WhatsApp.

Three things are wrong today, and they compound:

1. **The technician app was never rebuilt.** `JobExecutionPage.jsx` is still a flat list of steps with underlined-text actions. Worse, the API does not send the technician the two facts they need most — *what is wrong with this laptop* and *which laptop is it* — so they arrive at a site and improvise.
2. **The technician can see the whole support console.** Ticket queue, New ticket, Warehouse receipt, Issue taxonomy. They should see two things: their jobs, and their parts.
3. **The repair loop is open at both ends.** The warehouse receipt screen cannot be searched and does not show serials. And once a machine reaches the floor, the floor has no idea what the customer complained about, and support is never told when it is fixed.

There is also a **live security bug** you must fix in WP-10: the work-order API returns `customer_otp` in the JSON payload the technician's browser receives. The OTP that is supposed to prove the customer handed over the machine is readable in devtools.

### Non-negotiable rules

Same as Phase 1, restated because they still bind:

1. Never delete or rename existing tables/columns. Add, extend, soft-deactivate. All migrations idempotent, in the style of `backend/migrations/202_support_v2_groups.sql`.
2. **Next free migration number is 219.** 218 (`218_support_v2_site_key.sql`) is the highest today.
3. Do not touch the frozen legacy support module (`frontend/src/components/support/**`, `backend/controllers/supportController.js`).
4. Every new route gets a permission guard; every new screen gets a `PermissionGate`.
5. Keep `supportPrimitives.jsx` as the only visual vocabulary. Extend it rather than inventing components.
6. Anything a field device calls goes through `withIdempotency` and must survive a retry.
7. **The floor / production module (`tickets`, `stages`, `activities`, `ticketController.js`) is shared with the refurbishment business.** You may add columns and add a hook. Do not change its stage machine or its existing behaviour for non-support tickets.

---

## 1. Root causes found in the code — do not re-diagnose, just fix

| Symptom you reported | Actual cause | File |
|---|---|---|
| Technician sees Ticket queue & New ticket | `LEGACY_ROLE_SECTIONS.support_tech` includes `'support_tickets'`, and that legacy fallback fires whenever `effectivePermissions` is empty (first paint, refresh, cache miss) | `frontend/src/utils/permissionHelper.js` |
| Technician sees Warehouse receipt | `role_permissions` grants `support_tech` → `support_pickup_return` `can_view = true`; the nav item is gated on exactly that section | `migrations/197_support_v2_rbac.sql:127`, `SupportV2Shell.jsx` |
| Technician sees Issue taxonomy | `role_permissions` grants `support_tech` → `support_taxonomy` `can_view = true` | `migrations/197_support_v2_rbac.sql:209` |
| Technician cannot see the issue | `getOne` selects `SELECT a.*` from `support_ticket_assets`, which holds `reported_issue_id` as an **integer FK only**. No join to `support_issue_catalog`, so no name ever reaches the client | `controllers/supportV2WorkOrderController.js:60-66` |
| Technician cannot see the TTSPL | `ttspl_id` **is** in the payload — the page simply never renders it. `JobExecutionPage` uses it once, as the hidden `expected` value for the scan check | `pages/JobExecutionPage.jsx:55` |
| Work-order page not step-by-step | The redesign in Phase 1 WP-6b was not applied; the page is still the original flat map with `underline` buttons | `pages/JobExecutionPage.jsx` |
| Warehouse receipt has no search / no serials | The queue renders only `wo_number` + `customer_name` + `document_number`; the detail list shows `ttspl_id || serial_number` — never both | `pages/WarehouseReceiptPage.jsx` |

Also note, and fix as you go:

- `permissionHelper.js` defines `support_lead` and `support_tech` **twice** in `LEGACY_ROLE_SECTIONS`. The second definition silently wins. Collapse to one entry per role.
- `loadWo()` does `SELECT w.*`, so `customer_otp` and `otp_verified_at` are serialised to every client that can open a work order. See WP-10.

### What already exists — build on it, do not rebuild

- `services/supportTicketScope.js` — already scopes ticket queries to a technician's own work orders. It is correct; it is simply not applied everywhere.
- `services/workOrderEffects/repairPickup.js` + `returnPickup.js` — both already call `createFloorTicketFromSupportPickup()` on the `WH_RECEIPT` step. **The bridge to the floor exists.** It just carries no issue context.
- `services/grnTicketService.js:669` — `createFloorTicketFromSupportPickup()` creates a `tickets` row at the `Floor Manager` stage with `ticket_type = 'grn_qc'` and assigns the first active `floor_manager`. Exactly the behaviour you asked for; it only needs richer context.
- `controllers/ticketController.js:930` — the floor-ticket completion hook (`applyGrnVendorQcPassOnTicketComplete`). This is where "notify support the laptop is ready" belongs.
- `services/supportNotificationService.js` — template-driven INAPP / EMAIL / PUSH / WhatsApp fan-out with `support_notification_templates` and `support_notification_log`. Every notification in this document goes through it. Do not call `whatsappService` directly.
- `support_work_order_type_config` — the step machine, seeded in `201_support_v2_core.sql:241`.
- `support_technician_attendance` (migration 213), `user_shifts`, `user_leaves`, `support_wo_slots` (migration 215).

---

## 2. Decisions taken (implement as written)

| # | Decision |
|---|---|
| **D8** | A `support_tech` sees exactly two areas: **My jobs** (their bucket + the job runner) and **My parts** (request + track their own requests). Nothing else in the support console. |
| **D9** | The technician **is** shown the TTSPL, the serial, the model, the assigned user and the full reported issue. Evidence of the right machine comes from a **mandatory photo of the serial sticker** at the scan step, not from hiding the ID. A `support_settings` flag `mask_ttspl_for_tech` (default `false`) can switch to masked-last-4 for customers who demand it. |
| **D10** | **The OTP belongs to the customer, not the technician.** It is sent to the customer's contact when the technician marks *On site* — never at work-order creation. Support does not routinely share it. There is an audited reveal and an approved-bypass path for the real-world failures. Full design in WP-10. |
| **D11** | Steps that concern a specific machine (scan, photos, grade, accessories) become **per-asset**. A work order covering three laptops needs three scans, not one. |
| **D12** | A `COURIER`-method work order gets its **own step set** (AWB, dispatch, transit, POD) instead of the technician step set. Today a courier WO is given GPS and OTP steps it can never complete. |
| **D13** | The warehouse **e-signs the receipt** against the Return DC. That signature — not the scan alone — is what moves inventory and creates the floor ticket. |
| **D14** | A support-origin floor ticket carries the **customer complaint, the technician's on-site diagnosis, and the pickup photos** into the floor UI, and is visibly tagged as customer-owned so nobody scraps or re-sells it. |
| **D15** | When a support-origin floor ticket completes, the support lead is notified and a **`SERVICE_RETURN` work order is drafted automatically** in `DRAFT` for the lead to schedule. It is never auto-dispatched. |
| **D16** | The support SLA clock **pauses** while a machine is on the floor (`PENDING` / reason `AT_REPAIR_CENTRE`) and resumes on service-return dispatch. A separate **Repair TAT** clock measures floor time. Support's SLA must not be burned by the floor's queue. |

---

## 3. Migrations to add (219 → 222)

### `219_support_v2_tech_access.sql`

```sql
-- D8: a technician's console is My jobs + My parts. Nothing else.
UPDATE role_permissions SET can_view = FALSE
 WHERE role IN ('support_tech','technician')
   AND section IN ('support_taxonomy','support_pickup_return','support_tickets','support_dashboard');

-- They still need to READ the work orders assigned to them, scoped to assigned rows.
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope) VALUES
  ('support_tech', 'support_bucket',        true,  false, true,  false, 'assigned'),
  ('support_tech', 'support_work_orders',   true,  false, false, false, 'assigned'),
  ('support_tech', 'support_parts_request', true,  true,  false, false, 'assigned'),
  ('technician',   'support_bucket',        true,  false, true,  false, 'assigned'),
  ('technician',   'support_work_orders',   true,  false, false, false, 'assigned'),
  ('technician',   'support_parts_request', true,  true,  false, false, 'assigned')
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete,
      data_scope = EXCLUDED.data_scope;

-- Warehouse receipt is a warehouse job, not a field job.
INSERT INTO permission_sections (section, description, sort_order) VALUES
  ('support_warehouse_receipt', 'Support — Warehouse receipt & goods-in', 320)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope) VALUES
  ('super_admin','support_warehouse_receipt', true, true, true, true, 'all'),
  ('admin','support_warehouse_receipt',       true, true, true, true, 'all'),
  ('warehouse','support_warehouse_receipt',   true, true, true, false,'all'),
  ('support_lead','support_warehouse_receipt',true, false,true, false,'all'),
  ('support_manager','support_warehouse_receipt', true, true, true, false,'all'),
  ('floor_manager','support_warehouse_receipt', true, false, false, false,'all')
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit, data_scope = EXCLUDED.data_scope;
```

### `220_support_v2_wo_execution.sql`

```sql
-- D11: steps become per-asset where the step is about one machine.
ALTER TABLE support_work_order_steps
  ADD COLUMN IF NOT EXISTS line_id INT REFERENCES support_ticket_assets(line_id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS serial_id INT,
  ADD COLUMN IF NOT EXISTS asset_seq INT NOT NULL DEFAULT 0;

ALTER TABLE support_work_order_type_config
  ADD COLUMN IF NOT EXISTS per_asset BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS method_scope VARCHAR(20),   -- NULL = all methods; else TECHNICIAN|COURIER|REMOTE
  ADD COLUMN IF NOT EXISTS help_text TEXT,
  ADD COLUMN IF NOT EXISTS offline_safe BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE support_work_order_type_config SET per_asset = TRUE
 WHERE step_code IN ('SERIAL_SCAN','PHOTO_CONDITION','ACCESSORIES','GRADE','PART_SCAN','DIAGNOSIS');
UPDATE support_work_order_type_config SET offline_safe = FALSE
 WHERE step_code IN ('CUSTOMER_OTP','WH_RECEIPT');

-- The old unique key was (wo_id, step_code); per-asset needs the line in the key.
DROP INDEX IF EXISTS support_work_order_steps_wo_id_step_code_key;
ALTER TABLE support_work_order_steps DROP CONSTRAINT IF EXISTS support_work_order_steps_wo_id_step_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_step_asset
  ON support_work_order_steps (wo_id, step_code, COALESCE(line_id, 0));

-- D12: courier work orders get their own steps.
INSERT INTO support_work_order_type_config
  (wo_type, step_code, step_label, step_kind, is_mandatory, min_count, sort_order, per_asset, method_scope, help_text)
VALUES
  ('REPAIR_PICKUP','AWB_BOOKED','Courier booked — AWB captured','FORM',true,1,15,false,'COURIER','Enter the AWB after booking the pickup.'),
  ('REPAIR_PICKUP','PACKED_PHOTO','Packed-parcel photos','PHOTO',true,2,25,true,'COURIER','Photograph the packed box and the label.'),
  ('REPAIR_PICKUP','COURIER_HANDOVER','Handed to courier','CONFIRM',true,1,35,false,'COURIER',NULL),
  ('REPAIR_PICKUP','POD_UPLOAD','Proof of delivery','PHOTO',true,1,85,false,'COURIER','Upload the courier POD or delivery screenshot.'),
  ('RETURN_PICKUP','AWB_BOOKED','Courier booked — AWB captured','FORM',true,1,15,false,'COURIER',NULL),
  ('RETURN_PICKUP','PACKED_PHOTO','Packed-parcel photos','PHOTO',true,2,25,true,'COURIER',NULL),
  ('RETURN_PICKUP','COURIER_HANDOVER','Handed to courier','CONFIRM',true,1,35,false,'COURIER',NULL),
  ('RETURN_PICKUP','POD_UPLOAD','Proof of delivery','PHOTO',true,1,85,false,'COURIER',NULL),
  ('SERVICE_RETURN','AWB_BOOKED','Courier booked — AWB captured','FORM',true,1,15,false,'COURIER',NULL),
  ('SERVICE_RETURN','COURIER_HANDOVER','Handed to courier','CONFIRM',true,1,25,false,'COURIER',NULL),
  ('SERVICE_RETURN','POD_UPLOAD','Proof of delivery','PHOTO',true,1,60,false,'COURIER',NULL),
  ('REPLACEMENT_DELIVERY','AWB_BOOKED','Courier booked — AWB captured','FORM',true,1,15,false,'COURIER',NULL),
  ('REPLACEMENT_DELIVERY','COURIER_HANDOVER','Handed to courier','CONFIRM',true,1,25,false,'COURIER',NULL),
  ('REPLACEMENT_DELIVERY','POD_UPLOAD','Proof of delivery','PHOTO',true,1,70,false,'COURIER',NULL),
  ('PART_DELIVERY','AWB_BOOKED','Courier booked — AWB captured','FORM',true,1,5,false,'COURIER',NULL),
  ('PART_DELIVERY','POD_UPLOAD','Proof of delivery','PHOTO',true,1,50,false,'COURIER',NULL)
ON CONFLICT (wo_type, step_code) DO UPDATE
  SET step_label = EXCLUDED.step_label, step_kind = EXCLUDED.step_kind,
      is_mandatory = EXCLUDED.is_mandatory, min_count = EXCLUDED.min_count,
      sort_order = EXCLUDED.sort_order, per_asset = EXCLUDED.per_asset,
      method_scope = EXCLUDED.method_scope, help_text = EXCLUDED.help_text;

-- Technician-only steps must not be seeded onto a courier WO.
UPDATE support_work_order_type_config SET method_scope = 'TECHNICIAN'
 WHERE step_code IN ('ON_SITE_GPS','CUSTOMER_OTP','TECH_ESIGN','ACCESSORIES');

-- D10: OTP lifecycle.
ALTER TABLE support_work_orders
  ADD COLUMN IF NOT EXISTS otp_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_sent_to VARCHAR(20),
  ADD COLUMN IF NOT EXISTS otp_send_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_bypassed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS otp_bypass_approval_id INT REFERENCES support_approvals(approval_id),
  ADD COLUMN IF NOT EXISTS custody_user_id INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS custody_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eway_bill_number VARCHAR(30);

CREATE TABLE IF NOT EXISTS support_otp_audit (
  audit_id    SERIAL PRIMARY KEY,
  wo_id       INT NOT NULL REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  action      VARCHAR(20) NOT NULL CHECK (action IN ('SENT','RESENT','REVEALED','BYPASS_REQUESTED','BYPASS_APPROVED','VERIFIED','FAILED')),
  actor_id    INT REFERENCES users(user_id),
  channel     VARCHAR(12),
  recipient   VARCHAR(120),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_audit_wo ON support_otp_audit(wo_id);

ALTER TABLE support_approvals DROP CONSTRAINT IF EXISTS support_approvals_approval_type_check;
ALTER TABLE support_approvals ADD CONSTRAINT support_approvals_approval_type_check
  CHECK (approval_type IN (
    'REPLACEMENT','DAMAGE_CHARGE','CHARGEABLE_PART','PART_VALUE','EARLY_TERMINATION',
    'RATE_CHANGE','SLA_WAIVER','PRIORITY_OVERRIDE','OTP_BYPASS','SITE_OVERRIDE','BER_WRITE_OFF'));
```

### `221_support_v2_warehouse_receipt.sql`

```sql
-- D13: the receipt is a signed document, not a checkbox.
CREATE TABLE IF NOT EXISTS support_warehouse_receipts (
  receipt_id        SERIAL PRIMARY KEY,
  receipt_number    VARCHAR(30) NOT NULL UNIQUE,
  wo_id             INT NOT NULL REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  ticket_id         INT REFERENCES support_tickets_v2(ticket_id) ON DELETE SET NULL,
  dc_number         VARCHAR(40),
  received_by       INT REFERENCES users(user_id),
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handover_by_user  INT REFERENCES users(user_id),      -- technician who handed over
  handover_courier  VARCHAR(40),                         -- or the courier that delivered
  signature_attachment_id INT,
  signer_name       VARCHAR(120),
  signer_role       VARCHAR(40),
  status            VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','SIGNED','DISPUTED','CANCELLED')),
  short_shipment_reason TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wh_receipt_wo ON support_warehouse_receipts(wo_id);

CREATE TABLE IF NOT EXISTS support_warehouse_receipt_lines (
  receipt_line_id   SERIAL PRIMARY KEY,
  receipt_id        INT NOT NULL REFERENCES support_warehouse_receipts(receipt_id) ON DELETE CASCADE,
  line_id           INT REFERENCES support_ticket_assets(line_id) ON DELETE SET NULL,
  serial_id         INT,
  ttspl_id          VARCHAR(40),
  serial_number     VARCHAR(120),
  scanned_value     VARCHAR(120),
  received          BOOLEAN NOT NULL DEFAULT FALSE,
  condition_matches_pickup BOOLEAN,
  new_damage_found  BOOLEAN NOT NULL DEFAULT FALSE,
  new_damage_note   TEXT,
  photo_attachment_ids JSONB NOT NULL DEFAULT '[]',
  accessories_expected JSONB NOT NULL DEFAULT '[]',   -- copied from the pickup ACCESSORIES step
  accessories_received JSONB NOT NULL DEFAULT '[]',
  floor_ticket_id   INT,
  UNIQUE (receipt_id, COALESCE(line_id, 0), COALESCE(serial_id, 0))
);
CREATE INDEX IF NOT EXISTS idx_wh_receipt_lines_serial ON support_warehouse_receipt_lines(serial_id);

-- Receipt number sequence, mirroring the existing support sequences (198_support_v2_sequences.sql).
CREATE SEQUENCE IF NOT EXISTS support_wh_receipt_seq START 1;
```

### `222_support_v2_repair_loop.sql`

```sql
-- D14: the floor ticket must carry the customer complaint.
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS support_ticket_id INT,
  ADD COLUMN IF NOT EXISTS support_wo_id INT,
  ADD COLUMN IF NOT EXISTS support_line_id INT,
  ADD COLUMN IF NOT EXISTS support_origin VARCHAR(20),      -- REPAIR_PICKUP | RETURN_PICKUP
  ADD COLUMN IF NOT EXISTS customer_owned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS support_customer_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS support_reported_issue TEXT,
  ADD COLUMN IF NOT EXISTS support_field_diagnosis TEXT,
  ADD COLUMN IF NOT EXISTS support_photo_attachment_ids JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS support_target_tat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS support_notified_ready_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_support_ticket ON tickets(support_ticket_id)
  WHERE support_ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_customer_owned ON tickets(customer_owned)
  WHERE customer_owned = TRUE;

-- D16: pause the support SLA while the machine sits on the floor.
ALTER TABLE support_tickets_v2 DROP CONSTRAINT IF EXISTS support_tickets_v2_pending_reason_check;
ALTER TABLE support_tickets_v2 ADD CONSTRAINT support_tickets_v2_pending_reason_check
  CHECK (pending_reason IS NULL OR pending_reason IN (
    'PENDING_CUSTOMER','PENDING_PART','PENDING_APPROVAL','PENDING_VENDOR',
    'AT_REPAIR_CENTRE','IN_TRANSIT','PENDING_SCHEDULE'));

ALTER TABLE support_tickets_v2
  ADD COLUMN IF NOT EXISTS repair_tat_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS repair_tat_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS repair_tat_ended_at TIMESTAMPTZ;

-- New notification events for the loop.
INSERT INTO support_notification_templates (event_code, channel, audience, subject, body, active)
SELECT v.* FROM (VALUES
  ('OTP_SENT_CUSTOMER','WHATSAPP','CUSTOMER',
    'Rentfoxxy handover code',
    'Your Rentfoxxy handover code is {{otp}}. Share it with our engineer {{assignee_name}} only after you have handed over / received the laptop. Valid 15 minutes.', TRUE),
  ('OTP_BYPASS_REQUESTED','INAPP','LEAD',
    'OTP bypass requested — {{wo_number}}',
    '{{assignee_name}} cannot get the OTP for {{wo_number}} ({{customer_name}}). Reason: {{reason}}.', TRUE),
  ('WAREHOUSE_RECEIVED','INAPP','LEAD',
    'Received at warehouse — {{ticket_number}}',
    '{{ttspl_id}} received against {{wo_number}}. Floor ticket {{floor_ticket_id}} created.', TRUE),
  ('REPAIR_READY_FOR_DISPATCH','INAPP','LEAD',
    'Ready for dispatch — {{ttspl_id}}',
    '{{ttspl_id}} ({{customer_name}}, ticket {{ticket_number}}) has cleared the floor and is ready to go back. A draft service return is waiting.', TRUE),
  ('REPAIR_READY_FOR_DISPATCH','EMAIL','LEAD',
    'Ready for dispatch — {{ttspl_id}}',
    '{{ttspl_id}} for {{customer_name}} is repaired and QC-passed. Support ticket {{ticket_number}}. Draft work order {{wo_number}} is ready to schedule.', TRUE),
  ('CUSTODY_AGEING','INAPP','LEAD',
    'Machine still with technician — {{wo_number}}',
    '{{ttspl_id}} was picked up {{days}} day(s) ago by {{assignee_name}} and has not reached the warehouse.', TRUE),
  ('ASSET_BER','INAPP','LEAD',
    'Beyond economic repair — {{ttspl_id}}',
    'The floor has marked {{ttspl_id}} BER. {{customer_name}} needs a replacement, not a return.', TRUE)
) AS v(event_code, channel, audience, subject, body, active)
WHERE NOT EXISTS (
  SELECT 1 FROM support_notification_templates t
   WHERE t.event_code = v.event_code AND t.channel = v.channel AND t.audience = v.audience);
```

Add `'CUSTOMER'` to the `ROLE_FOR_AUDIENCE` handling in `supportNotificationService.js` — it must resolve to the ticket's `contact_phone` / `contact_email` rather than a user row.

---

## 4. WP-8 — Lock the technician down to their own work

### Target behaviour

**Navigation.** Introduce a role-aware nav in `SupportV2Shell.jsx`. A `support_tech` / `technician` sees exactly:

```
FIELD
  My jobs          → /support/bucket        (badge: today's open jobs)
  My parts         → /support/my-parts      (badge: awaiting approval)
```

Nothing else. No Command centre, no Ticket queue, no New ticket, no Warehouse receipt, no Taxonomy, no Dispatch, no Settings, no Design system. Do this by **fixing the permission data**, not by hard-coding a role check in the nav array — the nav must stay `hasPermission`-driven so an admin can still grant an exception.

**Three layers, all required:**

1. **Data** — migration 219 revokes the four sections.
2. **Legacy fallback** — in `permissionHelper.js`, collapse the duplicate `support_tech` / `support_lead` keys and set `support_tech: ['support_bucket', 'support_parts_request', 'customer_inventory']`. Remove `'support_tickets'`. This is what leaks access on first paint before `effectivePermissions` loads.
3. **Route guard** — `supportTechnicianMayAccessPath()` in `utils/supportAccess.js` currently returns `true` for **any** path starting with `/support`. Replace with an allow-list: `/support/bucket`, `/support/jobs/:woId`, `/support/my-parts`, `/support/attendance` (own record only). Everything else redirects to `/support/bucket`.

**New page — `pages/MyPartsPage.jsx`** at `/support/my-parts`, section `support_parts_request`:
- Their own part requests only (`requested_by = me`), grouped `Awaiting approval` / `Approved — collect from warehouse` / `In transit to me` / `With me` / `Fitted` / `Returned`.
- Each card: part name, machine TTSPL, WO number, status pill, age, and the reject reason when rejected.
- Primary action per state: `Mark collected`, `Mark fitted` (deep-links into the job), `Return unused`.
- A `Request a part` button that asks which of their open jobs it is for.

**Backend scoping.** `data_scope = 'assigned'` must actually be enforced, not just stored:
- `GET /support/v2/work-orders` — apply `applyTechnicianTicketScope` (it exists, it is not called here).
- `GET /support/v2/work-orders/:woId` — return 404, not 403, if the WO is not assigned to the caller and the caller is a field technician. 403 leaks existence.
- `GET /support/v2/parts/requests` — filter to `requested_by = req.user.user_id` for field roles.
- Add a small `assertOwnWorkOrder(db, user, woId)` helper in `services/supportTicketScope.js` and call it from every WO route that a technician can reach. `requireOwnWo()` middleware already exists in `middleware/supportWoAccess.js` — verify it is on **every** technician-reachable route, including `getOne`.

**Bucket page.** Keep the existing `BucketPage.jsx` design (it is good) but make it the technician's landing page: `SupportV2IndexRedirect` sends field roles to `/support/bucket`.

### Acceptance
- [ ] Log in as `support_tech`: the sidebar has exactly two items.
- [ ] Typing `/support/queue`, `/support/tickets/new`, `/support/taxonomy` or `/support/returns/receipt` in the URL bar redirects to `/support/bucket`.
- [ ] Hard-refreshing on `/support/bucket` never flashes the full nav before settling (the legacy-fallback fix).
- [ ] `GET /support/v2/work-orders/:id` for a WO assigned to someone else returns 404.
- [ ] A `support_lead` and a `warehouse` user see no change in their nav except that Warehouse receipt now sits under the new `support_warehouse_receipt` section.
- [ ] `/support/my-parts` shows only that technician's requests.

---

## 5. WP-9 — Rebuild the technician job runner

This is the centrepiece. Replace `pages/JobExecutionPage.jsx` wholesale.

### 9a. The API must send what the technician needs

Extend `GET /support/v2/work-orders/:woId` (`supportV2WorkOrderController.getOne`). The assets query must join the taxonomy:

```sql
SELECT a.*, l.wo_asset_id,
       rt.name AS reported_type_name,
       rs.name AS reported_subtype_name,
       ri.name AS reported_issue_name,
       ri.help_text AS issue_help_text,
       ri.skill_required,
       vsn.brand, vsn.model, vsn.processor, vsn.ram, vsn.storage,
       vsn.extra->>'assigned_employee' AS assigned_employee,
       vsn.warranty_end_date
  FROM support_work_order_assets l
  JOIN support_ticket_assets a       ON a.line_id = l.line_id
  LEFT JOIN support_issue_catalog rt ON rt.catalog_id = a.reported_type_id
  LEFT JOIN support_issue_catalog rs ON rs.catalog_id = a.reported_subtype_id
  LEFT JOIN support_issue_catalog ri ON ri.catalog_id = a.reported_issue_id
  LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = a.serial_id
 WHERE l.wo_id = $1
 ORDER BY a.line_code
```

Also return, in the same payload:
- `ticket`: `ticket_number`, `priority`, `sla_resolution_due_at`, `customer_name`, `contact_name`, `contact_phone`, `site_label`, `site_pincode`, `internal_note`.
- `attachments`: the customer-supplied photos for each line (kind `PHOTO_CUSTOMER`) so the technician can see what the customer photographed **before** they arrive.
- `history`: last 3 closed work orders for the same serial — `wo_number`, `wo_type`, `completed_at`, `found_issue_name`, `resolution_name`. A technician walking into a repeat failure must know it is a repeat.
- `part_requests`: all requests on this WO, not just the latest one (`getOne` currently does `LIMIT 1`).

**Strip `customer_otp`, `otp_verified_at` and `otp_expires_at` from the serialised work order.** See WP-10.

### 9b. Screen design

Mobile-first, 360 px minimum, 44 px touch targets. Three regions.

**1 — Sticky header (always visible, ~120 px)**

```
┌──────────────────────────────────────────────────────┐
│ ← WO-000071          REPAIR PICKUP        ⏱ P2       │
│ ●━━━━━━━━━━●━━━━━━━━○──────○──────○──────○           │
│ Step 3 of 8 · Scan machine serial                    │
│ TTSPL-04412 · Dell Latitude 5420 · Rohit Sharma      │
└──────────────────────────────────────────────────────┘
```

- A **segmented progress bar**, one segment per mandatory step: filled = done, pulsing = current, hollow = locked. Tapping a done segment scrolls to it (read-only).
- `Step 3 of 8 · <current step label>` in words. This is the "step completion in the header" you asked for.
- The machine identity line — **TTSPL, model, and the employee it is assigned to** (D9). When more than one machine is on the WO, this becomes a machine switcher chip row.
- SLA chip turns amber at 75%, red past due.

**2 — Job brief card (collapsible, expanded until the job starts)**

Everything the technician needs before touching anything:

```
┌─ What you are going to fix ──────────────────────────┐
│ Hardware › Display › Screen flickering               │
│                                                       │
│ "Screen flickers when the lid is moved. Started       │
│  three days ago. Gets worse after an hour."           │
│                       — Priya Nair, reported 22 Aug   │
│                                                       │
│ 📷 3 customer photos          [ view ]                │
│                                                       │
│ ⚠ Repeat — same issue fixed 12 Jul (WO-000318,        │
│   'display cable reseated'). Consider replacement.    │
│                                                       │
│ 🔧 Skill: HARDWARE_BASIC    🛡 Warranty: In warranty   │
│ 📦 Part pre-booked: Display panel 14" — collect       │
│    from warehouse before you leave                    │
└───────────────────────────────────────────────────────┘
```

Plus a **Where & who** strip: site address with a `Navigate` deep link, contact name with a `Call` button, the booked slot(s) from `support_wo_slots`, and the desk owner's name with a `Message support` action.

This card is the direct fix for *"they can't see the issue of that laptop"*.

**3 — The step runner**

One card per step, in `sort_order`. Exactly three visual states:

- **Done** — collapsed to a single row: `✓ Arrived on site · 10:42 · Rakesh`. Tap to expand the saved payload read-only (photos as thumbnails, GPS as a mini map link).
- **Current** — expanded, full-width, elevated. Step label, `help_text` from the config, the input widget, and one large primary button. Nothing else on screen competes with it.
- **Locked** — dimmed, with the reason: `Complete "Scan machine serial" first`.

**The gate is strict and server-enforced.** A step can only be completed when every mandatory step before it is `DONE`. `isPrevDone()` on the client is a hint; add the same check in `supportWorkOrderService.completeStep()` and return `409 STEP_OUT_OF_ORDER` with the blocking step's label.

**Per-asset steps (D11).** When `per_asset = true` and the WO covers three machines, render the step as a sub-list:

```
┌─ Scan machine serial ────────────────── 1 of 3 ──────┐
│ ✓ TTSPL-04412  ·  scanned 10:44                      │
│ ▸ TTSPL-04455  ·  Dell Latitude 5430  [ scan ▸ ]     │
│ ○ TTSPL-04501  ·  HP ProBook 440                     │
└───────────────────────────────────────────────────────┘
```

The step is `DONE` only when every asset row is done. `instantiateWoSteps` must fan out per-asset config rows into one `support_work_order_steps` row per `line_id`, and skip config rows whose `method_scope` does not match the WO's `method` (D12).

### 9c. The serial-match gate

This is the specific behaviour you asked for. Rework the `SCAN` step:

1. The header already shows the TTSPL (D9). The scan step shows the machine's **model, colour and assigned employee** to help them find it among six identical laptops on a desk.
2. Two inputs, in this order: a large **`Scan barcode`** button opening `CameraScanner`, and a **`Type it instead`** field underneath. Auto-uppercase, trim whitespace, strip spaces and hyphens before comparing.
3. On submit, match the entered value against `ttspl_id`, `serial_number`, or `inventory_asset_code` (normalised). On success:
   ```
   ✓ Matched TTSPL-04412 · Dell Latitude 5420
   ```
   and the next step unlocks with a short animation so the progression is felt.
4. On mismatch, do **not** just say "not matched". Say what happened:
   > **This is a different machine.**
   > You scanned `TTSPL-04455`. This job is for `TTSPL-04412` (Dell Latitude 5420, Rohit Sharma).
   > `[ Scan again ]` `[ This job is for the machine I scanned ]`
   The second button raises a `WRONG_ASSET` flag to the desk owner rather than letting the technician improvise — the desk can amend the work order or create the right one.
5. **A photo of the serial sticker is mandatory** on the scan step (`min_count = 1`). This is the real evidence and it is what lets D9 safely show the TTSPL.
6. Three consecutive mismatches locks the step for 60 seconds and notifies the desk owner.

### 9d. The rest of the runner

- **Start gate.** `Accept → En route → On site → Start work` becomes a single prominent state button at the top of the runner that names the next transition. Grey out `Start work` until the technician is checked in for the day (`support_technician_attendance`), with an inline `Check in now`.
- **Diagnosis step (`FORM`)** becomes a real form: `Found issue` via the taxonomy tree picker (same component as classify), `Root cause`, free notes, and a `Matches the reported issue` shortcut that copies the reported classification in one tap.
- **Complete job** — replace the raw-ID modal for good: taxonomy picker for `found_issue_id`, grouped multi-select for `action_code_ids`, three large outcome cards, a time stepper, and a live character counter on the 20-char notes rule.
- **Fail visit** — the sheet from Phase 1 WP-6b (radio reasons, mandatory note, optional photo, retry toggle). Additionally: a failed visit sets the ticket `PENDING` with the right `pending_reason` and fires a customer notification.
- **Request a part** — always available from a sticky footer action while the job is open, not buried.
- **Offline.** Steps with `offline_safe = true` queue through `offlineQueue.js` and show a `Saved offline · will sync` chip. `CUSTOMER_OTP` and `WH_RECEIPT` are `offline_safe = false` — show `Needs signal` and disable, with the reason. Never let an OTP appear to succeed offline.
- **Reassignment.** If the WO is reassigned mid-job, completed steps stay completed and are attributed to the original technician; the new assignee sees a banner naming who did what.

### Acceptance
- [ ] The job page shows the reported issue as `Type › Subtype › Issue` plus the customer's description and photos, before any step is started.
- [ ] TTSPL, model and assigned employee are visible in the sticky header at all times.
- [ ] The header reads `Step N of M · <label>` and the segmented bar advances as steps complete.
- [ ] Steps below the current one are visibly locked and cannot be completed; the API rejects an out-of-order completion with `409 STEP_OUT_OF_ORDER`.
- [ ] Scanning a wrong serial produces the two-machine comparison message, not a generic error.
- [ ] A WO with three machines requires three scans and three photo sets; the step shows `2 of 3`.
- [ ] A courier-method WO shows AWB / packed photo / handover / POD steps and **no** GPS, OTP or signature step.
- [ ] The whole page is usable one-handed at 360 px.
- [ ] `customer_otp` appears nowhere in any network response visible to a technician.

---

## 6. WP-10 — OTP: delivery, recovery, and the answer to "how does support share it?"

### The short answer

**Support does not share it — the customer does.** The OTP exists to prove the customer was present and consented to the handover. If support reads it out to the technician, the proof is worthless and you have no defence in a "we never gave you that laptop" dispute.

What you actually need is a **reliable delivery path to the customer** plus **three graded fallbacks** for when that path fails. That is what this WP builds.

### Current state

`customer_otp` is generated in `workOrderEffects/repairPickup.js`, `returnPickup.js`, `replacement.js` and `serviceReturn.js` at **work-order creation**, stored on the row, and **never sent to anybody**. It is then returned to the browser by `loadWo()`'s `SELECT w.*`. So today the only way anyone gets the OTP is by reading it out of the API response — which is why this feels unsolved.

### Target design

**1. Generate late, send late.** Move OTP generation out of `onCreate` and into the **On site** transition (for `TECHNICIAN` method) or the **out-for-delivery** transition (for `COURIER`). A code created three days before the visit is stale by the time it is needed.

**2. Send to the customer, two channels.** On generation, fire `OTP_SENT_CUSTOMER` through `supportNotificationService` on `WHATSAPP` and `SMS` to `support_tickets_v2.contact_phone`. Record `otp_sent_at`, `otp_sent_to` (masked, `••••••3421`), `otp_expires_at = now() + 15 min`, `otp_send_count += 1`, and an `SENT` row in `support_otp_audit`.

**3. The technician never sees the code.** Strip `customer_otp`, `otp_expires_at` from every API response. Add a `serializeWorkOrder()` function in `supportWorkOrderService.js` that whitelists fields, and route **every** WO response through it. Instead the technician sees:
```
Code sent to Priya Nair ••••••3421 · WhatsApp + SMS · expires in 14:32
[ 6-digit input ]                          [ Didn't get it? ]
```

**4. `Didn't get it?` — three graded fallbacks**

| Tier | Action | Who can | Guardrail |
|---|---|---|---|
| 1 | **Resend** | Technician | 60 s cooldown, max 3 sends, regenerates the code and restarts the 15-min window |
| 2 | **Send to a different number at this site** | Technician requests, **desk owner approves in-app** | Number must belong to a `customer_addresses` contact for this customer, or the lead types it with a reason. Audited. |
| 3 | **Bypass OTP** | Technician requests, **support lead approves** | Creates an `OTP_BYPASS` approval. On approval the step unlocks but the technician **must** capture a customer signature **and** a handover photo as substitute evidence. `otp_bypassed = true` on the WO, shown permanently on the ticket, the DC and every report. |

Tier 3 is how a real handover completes when the customer's phone is dead. It keeps the audit trail honest instead of pretending an OTP happened.

**5. The support-lead OTP panel.** On `TicketDetailPage` → Work orders tab, and on the dispatch board, a lead with `support_work_orders.edit` sees per WO:

```
┌─ Handover code ──────────────────────────────────────┐
│ Sent to Priya Nair ••••••3421 · WhatsApp, SMS        │
│ 10:41 · expires 10:56 · 1 of 3 sends used            │
│                                                       │
│ [ Resend ]  [ Send to another number ]  [ Reveal ]   │
│ [ Approve bypass ]                                    │
└───────────────────────────────────────────────────────┘
```

`Reveal` is the escape hatch you were reaching for. It requires a typed reason, shows the code for 30 seconds, writes a `REVEALED` row to `support_otp_audit` with the lead's identity, and surfaces on the ticket timeline as a customer-visible event. Use it when the customer says *"just tell your engineer, I'm in a meeting"* — and it is on the record that they did.

**6. Rate limiting & lockout.** 5 wrong attempts locks the step for 10 minutes and notifies the desk owner. Never reveal whether a wrong code was close. Log every `FAILED`.

**7. Courier work orders.** No OTP. Proof of delivery is the courier POD (`POD_UPLOAD` step) plus AWB tracking. The `CUSTOMER_OTP` step is not seeded for `method = 'COURIER'` (handled by `method_scope` in migration 220).

### Backend

- `POST /support/v2/work-orders/:woId/otp/send` — generate + dispatch. Idempotent, rate-limited. Technician-callable for their own WO.
- `POST /support/v2/work-orders/:woId/otp/resend` — same, increments `otp_send_count`, 409 past 3.
- `POST /support/v2/work-orders/:woId/otp/alternate` — body `{ phone, reason }`, lead-only.
- `POST /support/v2/work-orders/:woId/otp/reveal` — body `{ reason }`, lead-only, returns the code once and audits.
- `POST /support/v2/work-orders/:woId/otp/bypass-request` — technician, body `{ reason }`, creates the approval.
- The existing `POST /work-orders/:woId/verify-otp` stays; it must also accept a bypassed step when the approval is `APPROVED` and signature + photo payloads are present.

### Acceptance
- [ ] `curl` the work-order endpoint as a technician — no `customer_otp` in the response, on any route.
- [ ] Marking *On site* sends a WhatsApp and an SMS to the contact and starts a visible 15-minute countdown in the app.
- [ ] Resend is blocked for 60 s and hard-stops after 3 attempts.
- [ ] A lead reveal requires a reason, shows the code for 30 s, and writes an audit row plus a timeline event.
- [ ] Bypass requires lead approval, then forces signature + photo before the step closes, and the WO shows `OTP bypassed` on the ticket and the DC.
- [ ] A courier work order has no OTP step at all.
- [ ] 5 wrong codes locks the step and notifies the desk owner.

---

## 7. WP-11 — Warehouse receipt, rebuilt

### Problem

The screenshot you sent is the whole problem: eight identical cards reading `WO-0000xx · Customer · no DC`. No search, no serial, no age, no way to know which box in front of you matches which card. And the detail screen shows `ttspl_id || serial_number` — one or the other, never both — so a warehouse operator holding a laptop with a serial sticker cannot find the row.

### 11a. The queue

Route moves to `/support/warehouse/receipts`, section `support_warehouse_receipt` (warehouse + lead, **not** technician).

```
┌────────────────────────────────────────────────────────────────┐
│ Warehouse receipt                        12 awaiting · 3 aged  │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ 🔍 Scan or type TTSPL, serial, WO number, AWB or customer  │ │
│ └────────────────────────────────────────────────────────────┘ │
│ [ All 12 ] [ Repair 7 ] [ Return 5 ] [ By courier 4 ]          │
│ [ Aged > 2 days 3 ]                       Sort: Oldest first ▾ │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ WO-000071   REPAIR PICKUP        picked up 3 days ago  ⚠ aged  │
│ URBANLOGIX GLOBAL INDIA PRIVATE LIMITED                        │
│ RDC/2026/00412 · handed over by Rakesh Kumar                   │
│                                                                 │
│ TTSPL-04412  ·  SN 5CD1234ABC  ·  Dell Latitude 5420           │
│ TTSPL-04455  ·  SN 5CD9876XYZ  ·  Dell Latitude 5430           │
│                                                                 │
│ Charger, bag expected                          [ Receive ▸ ]   │
└────────────────────────────────────────────────────────────────┘
```

Every element there is something the operator needs and currently cannot see: **both identifiers per machine**, the model, the DC number, who is bringing it, how old it is, and what accessories to expect.

**The search box is the primary control and is auto-focused.** Scanning a serial with a USB barcode gun anywhere on the page jumps straight into that work order's receipt screen — that is the fastest possible path and it is how the room actually works. Search matches: TTSPL, serial number, WO number, DC number, AWB, customer name.

`listWorkOrders` must be extended to return the asset list (`ttspl_id`, `serial_number`, `brand`, `model`) per WO, plus `expected_accessories` from the pickup `ACCESSORIES` step payload, `handover_by`, `age_days`, and `courier_partner` / `courier_awb`. Add a `?q=` parameter that searches across all of the above.

**Aged items.** Any pickup completed more than 2 days ago with no receipt is flagged and fires `CUSTODY_AGEING` to the desk owner daily. This closes the custody gap where a machine sits in a technician's car for a week.

### 11b. The receipt screen

```
┌─ Receive WO-000071 ─────────── 1 of 2 received ───────┐
│ URBANLOGIX · RDC/2026/00412 · from Rakesh Kumar        │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 🔍 Scan or type serial                     [ OK ]  │ │
│ └────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────┤
│ ✓ TTSPL-04412 · SN 5CD1234ABC · Dell Latitude 5420     │
│   Received 11:04 · condition matches pickup            │
│   Accessories: ☑ Charger  ☑ Bag  ☐ Mouse  ⚠ missing   │
│   [ view pickup photos ]  [ flag new damage ]          │
├────────────────────────────────────────────────────────┤
│ ○ TTSPL-04455 · SN 5CD9876XYZ · Dell Latitude 5430     │
│   Expected — not yet scanned                           │
└────────────────────────────────────────────────────────┘
```

Requirements:

1. **Both identifiers on every row, always.** TTSPL and serial number and model. Never `a || b`.
2. Scanning accepts TTSPL **or** serial, normalised (uppercase, strip spaces/hyphens). A value belonging to a *different* open receipt offers `This belongs to WO-000068 — open that instead?` rather than "Not on this work order".
3. **Accessory reconciliation.** The pickup `ACCESSORIES` checklist payload is copied into `accessories_expected`. The operator ticks what actually arrived. Any shortfall requires a note and raises a `DAMAGE_CHARGE`-class approval draft to the support lead (customer may be chargeable for a missing charger).
4. **Condition comparison.** A side-by-side of the pickup condition photos and a fresh set the warehouse takes. `Condition matches pickup` / `New damage found`. New damage opens a note + photos and raises a dispute item on the ticket for the lead to adjudicate — technician says it left clean, warehouse says it arrived cracked, and someone has to decide. Do not let this be settled in WhatsApp.
5. **Short shipment.** Existing reason field stays, but the receipt can now be saved as **partial**: received machines proceed, missing ones stay open on the same WO with an ageing flag.

### 11c. The signature (D13)

Below the list, a **`Sign and receive`** block:

- `SignaturePad` canvas (the component already exists in `StepRenderers.jsx` — extract it into `components/SignatureCapture.jsx` and reuse).
- `Received by` — pre-filled with the logged-in warehouse user, editable.
- `Handed over by` — the technician (pre-filled from the WO) or the courier name + AWB.
- Signing is the commit point. **Nothing moves until the signature is saved.**

On submit, in one transaction:
1. Create `support_warehouse_receipts` (`status = 'SIGNED'`, number `WHR/2026/00xxx` from the new sequence) and its lines.
2. Stamp the signature onto the **Return DC PDF** as a receipt endorsement — extend `supportWoDocuments.js` / the return-DC PDF service with a `Received at warehouse` block: receipt number, date, signature image, received-by name, per-line received/short status.
3. Complete the `WH_RECEIPT` step, which triggers the existing `onStep` effects → inventory move + floor ticket (WP-12).
4. Fire `WAREHOUSE_RECEIVED` to the support lead.

Generate a downloadable **Goods Receipt Note** PDF from the same data so the warehouse has its own record.

### Acceptance
- [ ] The queue has an auto-focused search that matches TTSPL, serial, WO, DC, AWB and customer.
- [ ] Every queue card lists each machine's TTSPL **and** serial **and** model.
- [ ] Scanning a serial with a barcode gun from the queue jumps into the right receipt screen.
- [ ] A serial belonging to another WO offers to switch rather than erroring.
- [ ] Accessory shortfall requires a note and drafts an approval.
- [ ] New damage captures photos and raises a dispute on the ticket.
- [ ] Nothing moves in inventory until the signature is saved.
- [ ] The Return DC PDF gains a signed "Received at warehouse" block; a GRN PDF is downloadable.
- [ ] Technicians cannot open this page at all.

---

## 8. WP-12 — Warehouse → floor: the production ticket

`createFloorTicketFromSupportPickup()` already does the mechanical work. This WP makes the resulting ticket **useful to the floor** (D14).

### 12a. Carry the context across

Extend the call site in `repairPickup.onStep` and `returnPickup.onWarehouseReceipt` to pass, and `grnTicketService` to persist into the new `tickets` columns:

- `support_ticket_id`, `support_wo_id`, `support_line_id`, `support_origin`
- `customer_owned = true`, `support_customer_name`
- `support_reported_issue` — `"Hardware › Display › Screen flickering — 'Screen flickers when the lid is moved…'"`
- `support_field_diagnosis` — the technician's `DIAGNOSIS` step payload and, if the WO completed, the `found_issue` + notes
- `support_photo_attachment_ids` — pickup condition photos + customer photos
- `support_target_tat_at` — now + the repair TAT from `support_settings` (default 72 working hours; make it a setting)

`initial_condition` keeps its existing string for backward compatibility, but the real detail now lives in the new columns.

### 12b. Make the floor see it

In the floor/production UI (`frontend/src/features/...` ticket detail and the Floor Manager queue), when `customer_owned = true`:

- A **distinct banner** at the top: `CUSTOMER MACHINE — URBANLOGIX · Support ticket TKT-002841 · return by 26 Aug 18:00`. Different colour from refurbishment tickets so nobody confuses it with stock.
- A **`Reported problem`** card showing `support_reported_issue`, `support_field_diagnosis`, and the photo thumbnails. This is your *"they can see what the issue is"*.
- A link back to the support ticket (permission-gated; falls back to a read-only summary drawer for floor users without support access).
- Sort customer-owned tickets to the top of the Floor Manager queue and badge them with the TAT countdown.
- **Block** the actions that must never happen to a customer's machine: scrap, sell, allocate to a sales order, return-to-vendor. Guard in the API too, not just the UI.

### 12c. Return pickups vs repair pickups

Both create a floor ticket, correctly — but they mean different things and the floor must be told which:

- **`RETURN_PICKUP`** — the customer is giving the machine back. It goes through grading and QC and re-enters rentable stock. `customer_owned = false` once the credit note is raised and `removeFromCustomerInventory` has run. Existing behaviour; just tag `support_origin = 'RETURN_PICKUP'`.
- **`REPAIR_PICKUP`** — the machine stays the customer's, on rent, on a billing hold. It must come back to the same customer. `customer_owned = true`, and the blocks in 12b apply.

Add an assertion: a `customer_owned` floor ticket cannot be closed into rentable stock. It can only complete into `ready for dispatch` (WP-13) or `BER`.

### 12d. Pause the support SLA (D16)

When the floor ticket is created, set the support ticket to `PENDING` with `pending_reason = 'AT_REPAIR_CENTRE'`, call the existing `pauseTicket` path so the SLA clock stops, and start `repair_tat_started_at` / `repair_tat_due_at`. Resume on service-return dispatch. Surface both clocks separately on the ticket header: `SLA paused · Repair TAT 41 h left`.

### Acceptance
- [ ] Signing a warehouse receipt for a repair pickup creates a floor ticket at the Floor Manager stage, assigned to an active floor manager.
- [ ] That floor ticket shows the customer complaint, the field diagnosis and the pickup photos.
- [ ] It is visually marked as a customer machine and sorts to the top of the floor queue with a TAT countdown.
- [ ] Scrap / sell / allocate are blocked on it, in the API as well as the UI.
- [ ] The support ticket goes `PENDING · AT_REPAIR_CENTRE`, its SLA pauses, and the repair TAT starts.
- [ ] A return pickup produces a floor ticket that is **not** customer-owned and follows the existing refurbishment path unchanged.

---

## 9. WP-13 — Closing the loop: repaired → back to the customer

### 13a. The floor tells support

Hook into `controllers/ticketController.js` at the completion path (around line 930, where `applyGrnVendorQcPassOnTicketComplete` runs). Add a new service `services/supportRepairLoopService.js` with `onFloorTicketCompleted(db, ticket, userId)`:

```
if (!ticket.support_ticket_id) return;          // not ours, do nothing

1. stamp tickets.support_notified_ready_at
2. set support_tickets_v2.repair_tat_ended_at
3. resume the support SLA (clear PENDING / AT_REPAIR_CENTRE)
4. log a SUPPORT event: REPAIR_COMPLETED, customer-visible
5. create a DRAFT SERVICE_RETURN work order on the support ticket,
   pre-filled with the same line, the original site, and the contact  (D15)
6. fire REPAIR_READY_FOR_DISPATCH to the support lead (INAPP + EMAIL)
7. notify the customer via the portal + WhatsApp: "repaired, we'll schedule delivery"
```

Everything in one transaction with the floor-ticket completion, so a failure rolls both back.

**The work order is created as `DRAFT`, never dispatched.** The lead opens it, picks technician-or-courier and a slot in the WO wizard (already built in Phase 1 WP-5), and confirms. Auto-dispatching a delivery nobody has confirmed with the customer is how you get a failed visit.

### 13b. QC sees the complaint, and the complaint gets answered

You asked that the QC ticket show the issue. Beyond WP-12b's display:

- The floor's completion form gains a **`Resolution against the reported problem`** block when `customer_owned = true`: which of the reported symptoms were reproduced, what was actually done, which parts were replaced, and a mandatory `Verified fixed` confirmation with a test note. Blank-completing a customer machine is not allowed.
- That text flows straight back onto the support ticket timeline and into the customer's portal view. The customer asked "why does my screen flicker" and eventually gets a real answer, not "closed".
- QC failure on a customer machine does **not** silently loop — it notifies the support lead so they can manage the customer's expectation on the delay.

### 13c. Beyond economic repair

A real case with no path today. If the floor marks a customer machine BER:
- Fire `ASSET_BER` to the support lead.
- Create a `BER_WRITE_OFF` approval.
- On approval, the support ticket switches from "return the repaired unit" to the **replacement** flow (`InitiateReplacementModal` already exists) and the billing hold converts to a swap.
- The customer is told they are getting a different unit, with its new TTSPL, before it ships.

### 13d. The service return closes the money

On `SERVICE_RETURN` completion:
- End the billing hold — set `asset_billing_holds.hold_to = today`. **This is currently never set anywhere**, so a machine that goes for repair has its rent waived forever. Fix it here and write a backfill for any open hold whose asset is back with the customer.
- Set the customer inventory state back to `DEPLOYED`.
- Resolve the support ticket line, and close the ticket if it was the last open line.
- Any chargeable parts fitted on the floor flow to the Accounts charges queue built in Phase 1 WP-6d.

### Acceptance
- [ ] Completing a customer-owned floor ticket notifies the support lead by in-app and email within the same transaction.
- [ ] A `DRAFT` `SERVICE_RETURN` work order appears on the support ticket, pre-filled, unscheduled.
- [ ] The support SLA resumes and the repair TAT stops.
- [ ] The floor's resolution text is visible on the support ticket timeline and in the customer portal.
- [ ] A customer machine cannot be completed on the floor without the resolution block filled.
- [ ] Marking BER routes the ticket into the replacement flow after approval.
- [ ] Completing the service return sets `hold_to`, restores `DEPLOYED`, and resolves the line. Backfill exists for stuck open holds.

---

## 10. WP-14 — Gaps you have not hit yet, but will

I walked the whole flow looking for places where an operator would have to leave the system to get their job done. These are the ones that matter, ordered by how soon they will bite. Build P0 in this phase; put P1 on the board.

| # | Gap | Why it bites | Priority |
|---|---|---|---|
| 1 | **Courier WOs have technician steps** | A courier pickup is given GPS, OTP and signature steps it can never complete, so it can never close. Created the moment Phase 1 WP-5 shipped. | **P0 — in WP-9/220** |
| 2 | **Billing hold never ends** | `startBillingHold` is called on repair pickup; nothing sets `hold_to`. Rent silently stops forever. | **P0 — in WP-13d** |
| 3 | **Custody gap** | Between "WO completed at site" and "warehouse receipt" the machine is in a car with no owner and no clock. | **P0 — in WP-11a** |
| 4 | **Multi-machine steps** | One scan for three laptops means two were never verified. | **P0 — in WP-9/D11** |
| 5 | **No standby unit while under repair** | The customer is down for 3 days. `customer_buffer_stock` exists and is unused. Offer a buffer unit at repair-pickup time; ship it with the pickup visit. | P1 |
| 6 | **Part arrives after the visit** | Line goes `PENDING_PART` with no resume path — no second-visit WO is drafted when the part lands. | P1 |
| 7 | **Failed visit does not pause SLA** | A retry WO is created but the clock keeps burning against a customer who was not there. Pause with `PENDING_CUSTOMER` and notify. | P1 |
| 8 | **e-Way bill number never captured** | `requires_eway_bill` is computed on return pickups; nobody records the number. Column added in 220 — wire the input into the WO wizard when the flag is set. | P1 |
| 9 | **No customer-facing status trail** | The customer has a portal but sees nothing between "raised" and "closed". Emit portal + WhatsApp events at: picked up, received, under repair, ready, dispatched, delivered. | P1 |
| 10 | **Attendance does not gate work** | A technician on leave can accept and start jobs. Block `Start work` unless checked in; let a lead override. | P1 |
| 11 | **Reassignment loses attribution** | Steps completed by technician A show as the current assignee's. Attribute per step (`completed_by` is already stored — just render it). | P1 |
| 12 | **Lost in transit** | No write-off path when a machine never reaches the warehouse. Needs an approval type, an inventory write-off, and an insurance/claim record. | P2 |
| 13 | **Repeat-failure escalation** | `complaint_count_90d` is computed and shown but nothing acts on it. Auto-raise a replacement recommendation at 3 in 90 days. | P2 |
| 14 | **No technician performance view** | First-time-fix rate, average job time, failed-visit rate, parts-per-job. The data is all in `support_work_orders` already. | P2 |

Implement 1–4 in this phase. For 5–14, add a short `support-revamp-prompts/BACKLOG.md` capturing each with its acceptance criteria so nothing is re-discovered later.

---

## 11. WP-15 — Consistency pass

1. **One step-runner component.** `JobExecutionPage` (technician), the warehouse receipt, and the WO wizard all render progress. Build one `<StepRunner />` and one `<ProgressSegments />` in `supportPrimitives.jsx` and use them in all three. Three different progress bars is how a product starts to feel untrustworthy.
2. **One scan input.** `ScanStep`, the warehouse receipt search, and the part-fit input each parse serials differently. Extract `<SerialScanInput />` with one normalisation rule (uppercase, strip whitespace and hyphens) and one match helper `matchesAsset(value, asset)`. Use everywhere.
3. **One signature component.** Extract `SignatureCapture` out of `StepRenderers.jsx`; use it for tech e-sign, warehouse receipt, and customer handover.
4. **`serializeWorkOrder()`** — a single whitelist used by every endpoint that returns a work order. No more `SELECT w.*` reaching a browser.
5. Extend the `LABELS` map from Phase 1 WP-7 with the new step codes, methods, pending reasons, fault attributions and receipt statuses. No raw enum reaches a screen.
6. Every new screen: skeleton loading, actionable empty state, error toasts that name the fix.

---

## 12. Test plan

**Backend**
- `support-v2-tech-access.test.js` — a `support_tech` gets 404 on another technician's WO, 403 on the taxonomy and warehouse-receipt endpoints, and sees only their own part requests.
- `support-v2-otp.test.js` — `customer_otp` absent from every serialised response; send/resend/expiry/lockout; reveal writes audit; bypass requires approval **and** signature **and** photo; courier WOs have no OTP step.
- `support-v2-wo-steps.test.js` — per-asset fan-out for a 3-machine WO; out-of-order completion returns 409; `method_scope` filtering seeds the right step set for `TECHNICIAN` vs `COURIER`.
- `support-v2-warehouse-receipt.test.js` — nothing moves before signature; signed receipt creates the receipt + lines, completes `WH_RECEIPT`, creates the floor ticket, fires the notification; partial receipt leaves the rest open.
- `support-v2-repair-loop.test.js` — floor completion notifies support, drafts the `SERVICE_RETURN`, resumes SLA, stops repair TAT; service-return completion sets `hold_to` and restores `DEPLOYED`; a customer-owned floor ticket cannot be scrapped or sold.
- Migration idempotency: run 219–222 twice on a fresh DB; assert no error, no duplicate rows, and that the new unique index on `support_work_order_steps` does not break existing single-asset WOs.
- **Regression:** a non-support refurbishment ticket must behave exactly as before through `ticketController` completion. Assert it explicitly.

**Frontend**
- Render tests: locked/current/done step states; per-asset sub-list; wrong-serial comparison message; OTP countdown and `Didn't get it?` tiers.
- `matchesAsset()` unit tests: `ttspl-04412`, `TTSPL 04412`, `TTSPL04412` all match `TTSPL-04412`.
- Nav test: `support_tech` renders exactly two nav items, with and without `effectivePermissions` loaded.

**Manual QA** — append to `support-revamp-prompts/QA_FLOW_FIX.md`:
1. Log in as technician → confirm two nav items, try the four blocked URLs.
2. Open a job → confirm issue, TTSPL, model, photos, history all visible before starting.
3. Run all 8 steps of a repair pickup, wrong serial once, correct once, OTP resend once, complete.
4. Run a 3-machine field visit → confirm 3 scans and 3 photo sets.
5. Run a courier repair pickup → confirm the AWB/POD step set and no OTP.
6. Warehouse: scan from the queue with a barcode gun, receive partially, flag missing accessory, flag new damage, sign.
7. Confirm the floor ticket appears with the complaint and the TAT badge; complete it with the resolution block.
8. Confirm the lead gets "ready for dispatch", opens the draft service return, schedules it, and completes it; check `hold_to` is set.

---

## 13. Delivery order

| PR | Contains | Notes |
|---|---|---|
| 1 | Migrations 219–222 + `serializeWorkOrder()` + OTP leak fix | Security fix ships first and alone |
| 2 | WP-8 (technician access) + `MyPartsPage` | Small, visible, unblocks technician testing |
| 3 | WP-9a (API context) + per-asset step fan-out + courier step sets | Backend for the runner |
| 4 | WP-9b–d (the job runner UI) | Largest frontend PR |
| 5 | WP-10 (OTP delivery, fallbacks, lead panel) | Depends on PR 1 and 4 |
| 6 | WP-11 (warehouse receipt + signature + GRN) | Independent of 3–5; can run in parallel |
| 7 | WP-12 + WP-13 (floor bridge and loop closure) | Depends on 6 |
| 8 | WP-14 P0 leftovers + WP-15 consistency + backlog doc | Polish |

Each PR: green lint, green tests, a screen recording of the changed flow on a 360 px viewport where the UI changed, and an explicit note on anything deliberately deferred.

---

## 14. Do not break

- **The refurbishment floor.** `tickets`, `stages`, `activities` and `ticketController` are shared. Adding columns and one guarded hook is the whole permitted change. Every non-support ticket must behave identically.
- Existing work orders created before migration 220 have one step row per step code with `line_id IS NULL`. They must continue to open and complete. The new unique index uses `COALESCE(line_id, 0)` precisely for this — test it.
- Existing return pickups mid-flight must be receivable through the new warehouse screen.
- Do not regress the Phase 1 work: the ticket wizard, the WO wizard, the charges queue and the parts pricing all stay as shipped.
- Permissions: no new screen, route or action ships ungated.

---

## 15. If something here conflicts with the code

Written against `support_revamp` @ `af5a565`. If a behaviour described as missing already exists, or a file has moved, implement the intent and note the deviation in the PR. If a decision in §2 cannot be built on the current schema, stop and raise it rather than inventing a third pattern.
