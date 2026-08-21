# Support V2 — Flow, Sync & Work-Order Redesign

**Execution prompt for Cursor.**
Repo: `pankajrentfoxxy/crm_rentfoxxy` · Branch: `support_revamp` · Stack: React 18 + Tailwind (CRA) frontend, Express + PostgreSQL backend.

---

## 0. Mission

Support V2 is functionally built but the **operator flow is broken**. Data does not follow the operator's mental model, state does not re-sync when inputs change, and the work-order area is a wall of controls with no order. Field staff and the support lead are guessing.

Your job is **not** to add features. Your job is to make the existing flow **correct, in-sync, and obvious** — so that a new support executive on day 2 can run a ticket end-to-end without asking anyone what a field means.

Ship in the 7 work packages below, in order. Each WP is independently mergeable and must leave the app green.

### Non-negotiable rules

1. **Never delete or rename existing tables/columns.** Add columns, add tables, soft-deactivate rows. All migrations idempotent (`IF NOT EXISTS`, `DO $$ ... $$` guards) — match the style of `backend/migrations/202_support_v2_groups.sql`.
2. **Next free migration numbers are 214+.** 213 (`213_support_v2_attendance.sql`) is the highest today. Do not reuse a number.
3. Do not touch the legacy support module (`frontend/src/components/support/**`, `backend/controllers/supportController.js`, `supportPartsController.js`, `ticketController.js`). It is frozen behind `supportLegacyFreeze.js`. All work is in `frontend/src/features/support-v2/**` and the `supportV2*` backend files.
4. Respect the existing permission model — `usePermission()` / `PermissionGate` on the frontend, `checkSectionPermission` + `requireWoType` middleware in `backend/routes/supportV2.js`. Every new endpoint gets a permission guard. New UI is wrapped in a gate.
5. Every state-changing endpoint you add follows the existing `withIdempotency` pattern where the mobile/field client can retry.
6. Keep the existing design tokens (`sup-ink`, `sup-line`, `sup-lineSoft`, `sup-accent`, `sup-canvas2`, `pri1/pri2`) and the primitives in `frontend/src/components/ui/supportPrimitives.jsx` (`Button`, `Modal`, `PageHeader`, `StatusPill`, `TypeTag`, `Mono`, `PriorityChip`, `SlaChip`, `WorkOrderCard`). **Do not introduce a second visual language.** Extend `supportPrimitives.jsx` when you need a new primitive.
7. Write a migration + a backfill for anything that changes the meaning of existing rows.

### Decisions already taken (product owner has signed off — implement as written)

| # | Decision |
|---|---|
| D1 | **Delivery site is derived from the machine, not chosen before it.** One ticket = one delivery site. |
| D2 | Assignment groups visible to the desk are **Remote**, **Inhouse**, and **city-wise field groups** only. "Chip-level Repair" and "Remote L2" are deactivated for now (rows kept, `is_active = FALSE`). |
| D3 | Ticket-level `assigned_to` means **desk owner**, not the technician. The technician/courier is assigned **on the work order**. Scheduling controls are removed from the ticket wizard. |
| D4 | Technician working window is **09:30–19:00**, 30-minute slots, and a work order can hold **multiple slots**. |
| D5 | Part chargeability is decided by **fault attribution**, not by a free-text toggle. Customer-attributed faults need support-lead approval before the part moves. |
| D6 | Part selling price lives on the `parts` master. The charge is derived from it, not typed from memory. |
| D7 | A customer-chargeable fitted part produces a charge that Accounts either **bills immediately** or **rides on the monthly invoice** — accounts chooses, support does not. |

---

## 1. What already exists (do not rebuild this)

Read these before writing a line. Most of the plumbing you need is present.

**Frontend — `frontend/src/features/support-v2/`**

```
pages/NewTicketPage.jsx          4-step wizard host (Customer → Machines → Classify → Confirm)
components/wizard/StepCustomer.jsx   customer search + site select + contact fields
components/wizard/StepMachines.jsx   asset table filtered by site
components/wizard/StepClassify.jsx   taxonomy pickers + description + attach
components/wizard/StepConfirm.jsx    group/owner/slot + SLA preview
pages/TicketDetailPage.jsx       tabbed detail (Overview/Machines/Work orders/Timeline/…)
components/CreateWorkOrderModal.jsx  WO creation modal
pages/JobExecutionPage.jsx       technician step runner
components/RequestPartSheet.jsx  part request modal
components/steps/StepRenderers.jsx   GPS/SCAN/PHOTO/OTP/SIGNATURE/CHECKLIST renderers
pages/DispatchBoardPage.jsx      dispatch board
pages/PartsQueuePage.jsx         parts approval queue
supportV2Api.js                  all axios calls
supportV2Utils.js                priority math, WO_TYPES, labels
```

**Backend**

```
routes/supportV2.js                       all /support/v2/* routes with permission middleware
controllers/supportV2TicketController.js  customerContext, customerAssets, create, classify…
controllers/supportV2WorkOrderController.js  create/getOne/assign/accept/steps…
services/supportWorkOrderService.js       createWorkOrder, step seeding, state machine
services/supportDeliverySite.js           LATEST_DC_SQL, decorateSerialRow, assertSerialMatchesSite
services/supportPartsService.js           part request lifecycle → CONSUMED → extra invoice line
services/supportBillingHooks.js           pullApprovedExtraLines / stampExtraLinesBilled (monthly)
services/supportAssignmentEngine.js       group + assignee suggestion
migrations/201..213_support_v2_*.sql
```

**Schema you will build on**

- `support_tickets_v2` — has `site_id`, `site_key`, `site_pincode`, `site_label`, `assignment_group_id`, `assigned_to`.
- `support_ticket_assets` (`line_id`) — one row per machine on the ticket.
- `support_work_orders` — has `wo_type`, `status`, `assigned_to`, `assignment_group_id`, `scheduled_start`, `scheduled_end`, `method VARCHAR(20)`, `document_number`, `outcome`.
- `support_assignment_groups` (`group_type IN FIELD|REMOTE|WAREHOUSE|REPAIR`, `zone_id`), `support_zones`, `support_zone_pincodes` (pincode ranges per city).
- `user_shifts` (per-user day-of-week window, default 09:30–18:30, `max_jobs_per_day`), `user_leaves`.
- `part_requests` extended with `context='FIELD'`, `support_ticket_id`, `support_line_id`, `work_order_id`, `status_v2`, `liability`, `charge_amount`, `fulfilment_mode`, `collect_old_part`, `photo_attachment_ids`.
- `parts` — `part_id, part_name, part_type, quantity, vendor, cost, part_sku, compatible_brands[], compatible_models[], warranty_months`. **No selling price today.**
- `customer_invoice_extra_lines` — the bridge to billing, already consumed by `supportBillingHooks.js`.
- `support_approvals` — `approval_type IN (…,'CHARGEABLE_PART','PART_VALUE','DAMAGE_CHARGE',…)`.
- Delivery truth: `delivery_challan_lines` + `dc_shipment_units`, joined by `LATEST_DC_SQL` in `supportDeliverySite.js`.

---

## 2. Migrations to add

Create these four files. Each idempotent, each with a header comment explaining why.

### `214_support_v2_flow_fix.sql`

```sql
-- Ticket: remember how the site was derived, and allow an audited override.
ALTER TABLE support_tickets_v2
  ADD COLUMN IF NOT EXISTS site_source VARCHAR(20),           -- 'DERIVED_FROM_ASSET' | 'CRM_ADDRESS' | 'MANUAL_OVERRIDE'
  ADD COLUMN IF NOT EXISTS site_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS site_dc_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS photos_deferred BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contact_source VARCHAR(20);        -- 'CUSTOMER' | 'SITE_CONTACT' | 'MANUAL'

-- Line: photo obligations tracked per machine, not per ticket.
ALTER TABLE support_ticket_assets
  ADD COLUMN IF NOT EXISTS photos_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS photos_deferred BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS photo_count INT NOT NULL DEFAULT 0;

-- D2: retire the two groups the desk must not see, keep history intact.
UPDATE support_assignment_groups SET is_active = FALSE
 WHERE name IN ('Remote L2', 'Chip-level Repair');
UPDATE support_assignment_groups SET name = 'Remote'
 WHERE name = 'Remote L1'
   AND NOT EXISTS (SELECT 1 FROM support_assignment_groups WHERE name = 'Remote');

-- 'Inhouse' bench group (warehouse repair done at our facility).
INSERT INTO support_assignment_groups (name, group_type, zone_id)
SELECT 'Inhouse', 'WAREHOUSE', z.zone_id FROM support_zones z WHERE z.code = 'NCR'
ON CONFLICT (name) DO UPDATE SET group_type = EXCLUDED.group_type, is_active = TRUE;

-- City field groups readable as cities: display_name for the picker.
ALTER TABLE support_assignment_groups
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(80),
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 100;
UPDATE support_assignment_groups
   SET display_name = COALESCE(display_name, REPLACE(name, ' Field', ''))
 WHERE group_type = 'FIELD';
UPDATE support_assignment_groups SET sort_order = 10 WHERE group_type = 'REMOTE';
UPDATE support_assignment_groups SET sort_order = 20 WHERE group_type = 'WAREHOUSE';
UPDATE support_assignment_groups SET sort_order = 30 WHERE group_type = 'FIELD';
```

### `215_support_v2_wo_logistics.sql`

```sql
-- Method is now a first-class, validated concept with its own payload.
ALTER TABLE support_work_orders
  ADD COLUMN IF NOT EXISTS courier_partner   VARCHAR(40),   -- BLUEDART|DELHIVERY|DTDC|PORTER|OTHER
  ADD COLUMN IF NOT EXISTS courier_other_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS courier_direction VARCHAR(20),   -- PICKUP_FROM_CUSTOMER | DELIVER_TO_CUSTOMER
  ADD COLUMN IF NOT EXISTS courier_awb       VARCHAR(60),
  ADD COLUMN IF NOT EXISTS courier_pickup_date DATE,
  ADD COLUMN IF NOT EXISTS courier_declared_value NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS courier_packaging_note TEXT,
  ADD COLUMN IF NOT EXISTS remote_contact_window VARCHAR(40),
  ADD COLUMN IF NOT EXISTS batch_group_id    VARCHAR(40);    -- several WOs served in one visit

ALTER TABLE support_work_orders DROP CONSTRAINT IF EXISTS support_work_orders_method_check;
ALTER TABLE support_work_orders ADD CONSTRAINT support_work_orders_method_check
  CHECK (method IS NULL OR method IN ('TECHNICIAN','COURIER','REMOTE'));
UPDATE support_work_orders SET method = UPPER(method) WHERE method IS NOT NULL;

-- Multi-slot booking (D4).
CREATE TABLE IF NOT EXISTS support_wo_slots (
  slot_id     SERIAL PRIMARY KEY,
  wo_id       INT NOT NULL REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  slot_date   DATE NOT NULL,
  slot_start  TIME NOT NULL,
  slot_end    TIME NOT NULL,
  user_id     INT REFERENCES users(user_id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (wo_id, slot_date, slot_start)
);
CREATE INDEX IF NOT EXISTS idx_wo_slots_user_date ON support_wo_slots(user_id, slot_date);
CREATE INDEX IF NOT EXISTS idx_wo_slots_wo ON support_wo_slots(wo_id);

-- Backfill: existing scheduled_start/end become one slot row.
INSERT INTO support_wo_slots (wo_id, slot_date, slot_start, slot_end, user_id)
SELECT wo_id, (scheduled_start AT TIME ZONE 'Asia/Kolkata')::date,
       (scheduled_start AT TIME ZONE 'Asia/Kolkata')::time,
       (COALESCE(scheduled_end, scheduled_start + INTERVAL '1 hour') AT TIME ZONE 'Asia/Kolkata')::time,
       assigned_to
  FROM support_work_orders
 WHERE scheduled_start IS NOT NULL
ON CONFLICT DO NOTHING;

-- Working window config, so 09:30–19:00 is data not a constant.
ALTER TABLE user_shifts ALTER COLUMN end_time SET DEFAULT TIME '19:00';
UPDATE user_shifts SET end_time = TIME '19:00' WHERE end_time = TIME '18:30';
```

### `216_support_v2_part_pricing.sql`

```sql
-- D6: selling price on the part master.
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2) DEFAULT 18,
  ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS price_updated_by INT REFERENCES users(user_id);

-- D5: fault attribution drives chargeability.
ALTER TABLE part_requests
  ADD COLUMN IF NOT EXISTS fault_attribution VARCHAR(30),
    -- COMPANY_FAULT | WEAR_AND_TEAR | CUSTOMER_DAMAGE | CUSTOMER_BREAKAGE | VENDOR_WARRANTY | UNKNOWN
  ADD COLUMN IF NOT EXISTS unit_selling_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS price_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS approval_id INT REFERENCES support_approvals(approval_id),
  ADD COLUMN IF NOT EXISTS needs_lead_approval BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requested_before_visit BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE part_requests DROP CONSTRAINT IF EXISTS part_requests_fault_attr_check;
ALTER TABLE part_requests ADD CONSTRAINT part_requests_fault_attr_check
  CHECK (fault_attribution IS NULL OR fault_attribution IN
    ('COMPANY_FAULT','WEAR_AND_TEAR','CUSTOMER_DAMAGE','CUSTOMER_BREAKAGE','VENDOR_WARRANTY','UNKNOWN'));

-- Backfill from existing liability so old rows read correctly.
UPDATE part_requests SET fault_attribution = CASE liability
  WHEN 'CUSTOMER_CHARGEABLE' THEN 'CUSTOMER_DAMAGE'
  WHEN 'VENDOR_WARRANTY'     THEN 'VENDOR_WARRANTY'
  WHEN 'COMPANY'             THEN 'COMPANY_FAULT'
  ELSE 'UNKNOWN' END
WHERE fault_attribution IS NULL;
```

### `217_support_v2_charge_billing.sql`

```sql
-- D7: accounts decides how a support charge reaches the customer.
ALTER TABLE customer_invoice_extra_lines
  ADD COLUMN IF NOT EXISTS billing_mode VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',  -- MONTHLY | IMMEDIATE
  ADD COLUMN IF NOT EXISTS source_part_request_id INT,
  ADD COLUMN IF NOT EXISTS source_wo_id INT REFERENCES support_work_orders(wo_id),
  ADD COLUMN IF NOT EXISTS challan_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS accounts_note TEXT,
  ADD COLUMN IF NOT EXISTS raised_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raised_by INT REFERENCES users(user_id);

ALTER TABLE customer_invoice_extra_lines DROP CONSTRAINT IF EXISTS cie_billing_mode_check;
ALTER TABLE customer_invoice_extra_lines ADD CONSTRAINT cie_billing_mode_check
  CHECK (billing_mode IN ('MONTHLY','IMMEDIATE'));

CREATE INDEX IF NOT EXISTS idx_extra_lines_mode ON customer_invoice_extra_lines(billing_mode, status);
```

Also add the RBAC rows for the two new sections (follow the pattern in `197_support_v2_rbac.sql` / `199_part_management_rbac.sql`):
`support_charges_billing` (accounts) and `parts_pricing` (parts master price edit).

---

## 3. WP-1 — Customer switch must re-sync everything

### Problem
On the New Ticket wizard, search a customer, select them, their details fill in. Change to a different customer — **Contact name, Mobile and Email keep the first customer's values.** The ticket gets created against customer B with customer A's contact.

### Root cause
`frontend/src/features/support-v2/components/wizard/StepCustomer.jsx`, `pick()`:

```js
contact_name:  s.contact_name  || c.name  || '',
contact_phone: s.contact_phone || c.phone || '',
contact_email: s.contact_email || c.email || '',
```

The `||` preserves the previous customer's value because it is already truthy. The same function clears `site_*`, `selectedSerials` and `link`, but **not** `lines`, so a classified machine list from customer A also survives into customer B.

### Target behaviour

1. **Selecting a different customer resets the whole downstream draft.** Fields cleared: `contact_name`, `contact_phone`, `contact_email`, `contact_is_vip`, `contact_source`, `site_*`, `selectedSerials`, `unknownAsset`, `lines`, `sameIssue`, `link`, `assignment_group_id`, `assigned_to`, `internal_note`.
2. Re-selecting **the same** `customer_id` is a no-op — do not wipe typed work.
3. If the user has already reached Classify (`state.lines.length > 0`) or typed a contact override, show a confirm dialog before wiping:
   > **Change customer?**
   > You have 2 machines and their issues entered for *Acme Pvt Ltd*. Changing the customer will clear them.
   > `[Keep Acme]` `[Change customer]`
4. **Contact is picked, not typed.** After a customer is selected, load their contacts and render a `Reporting contact *` picker:
   - Options come from `customers` (primary name/phone/email) plus every `customer_addresses` row that has `concern_person` / `mobile_no`, plus `＋ Someone else`.
   - Picking an option sets `contact_source = 'CUSTOMER' | 'SITE_CONTACT'` and fills the three fields (read-only, with an `Edit` link).
   - `＋ Someone else` sets `contact_source = 'MANUAL'` and opens the three fields blank and editable.
   - Manual edits inside one customer are preserved. They are dropped when `customer_id` changes.
5. Show the customer identity persistently in the wizard header (`Acme Pvt Ltd · #1042 · Tier GOLD · 84 machines`) so the operator can never lose track of who the ticket is for.
6. Mobile validation stays `indianMobile()`. Show the error inline under the field with text, not just a red border: *"Enter a 10-digit Indian mobile number."*

### API
`GET /support/v2/customers/:id/contacts` → `{ rows: [{ contact_id, name, phone, email, source, site_label, is_primary }] }`.
Add to `routes/supportV2.js` under `viewTickets`. Implement in `supportV2TicketController.js` by unioning `customers` and `customer_addresses`. De-duplicate on normalised phone.

### Acceptance
- [ ] Select customer A → contact fills. Select customer B → all three contact fields show B's values, never A's.
- [ ] Select A, type a custom mobile, click A again from search → typed mobile is preserved.
- [ ] Select A, classify 2 machines, select B → confirm dialog fires; on confirm, Machines and Classify steps are empty and `state.step` returns to 0.
- [ ] Created ticket's `contact_phone` always belongs to `customer_id` on the payload. Add a backend guard in `tickets.create`: if `contact_phone` matches no contact of that customer and `contact_source !== 'MANUAL'`, reject with 400.
- [ ] Unit test on the reducer: `applyCustomer(state, customerB)` produces a fully reset draft.

---

## 4. WP-2 — Delivery site is derived from the machine (D1)

### Problem
Today the operator must choose the delivery site **before** seeing any machine (`StepCustomer.jsx` lines 69–98), then the machine list is filtered to that site (`StepMachines.jsx` filters by `site_key` / pincode). That is backwards. In a rental fleet the caller says *"TTSPL-04412 is dead"* — they do not know or care which of the customer's twelve delivery addresses that unit went to. Large customers have laptops spread across offices; the operator ends up guessing the site, getting an empty machine list, and going back.

### Target behaviour — the flow inverts

**New wizard shape (4 steps, renamed):**

| Step | Name | Contains |
|---|---|---|
| 1 | **Customer & contact** | customer search, reporting contact picker, channel, VIP, link-to-existing-ticket. **No site field.** |
| 2 | **Machines & location** | machine search across the whole fleet → site derives → add more machines at that site |
| 3 | **Issue & evidence** | taxonomy, description, photos (WP-3) |
| 4 | **Assign & review** | group, desk owner, SLA preview, create |

**Step 2 in detail:**

1. Primary control is a **search box**: *"Search TTSPL ID, serial number, or the user's name"*. It searches the customer's entire fleet — `GET /support/v2/customers/:id/assets?q=` — no site filter.
   Below it, `Browse all 84 machines` expands the full table (same columns as today, sortable, with a location column).
2. On selecting the first machine, resolve its delivery site from the latest delivered DC (`loadSerialDelivery()` in `supportDeliverySite.js`) and render a **locked location banner**:

   ```
   ┌───────────────────────────────────────────────────────────────┐
   │ 📍 Delivery location                        [ Change location ]│
   │ Plot 27, Udyog Vihar Phase IV, Gurugram — 122015              │
   │ Delivered 12 Mar 2026 · DC/2026/00871 · 6 machines here       │
   └───────────────────────────────────────────────────────────────┘
   ```
   Persist `site_id`, `site_key`, `site_pincode`, `site_label`, `site_dc_number`, `site_source = 'DERIVED_FROM_ASSET'`.
3. Under the banner, **"Other machines at this location"** — the remaining machines delivered to the same `site_key`, each a row with a checkbox, TTSPL, model, assigned user, warranty, and a 90-day complaint count. This is the "select another laptop with that location" requirement. Include `Select all 6`.
4. Selecting a machine **from a different site** does not silently change the location. Block it with an actionable message:
   > TTSPL-04980 was delivered to **Whitefield, Bengaluru — 560066**, not this location.
   > A ticket covers one location. `[Start a separate ticket for Bengaluru]` `[Switch this ticket to Bengaluru]` (switching clears the current machine selection).
5. **Edge cases, all first-class:**
   - *No DC found for the machine* → banner shows `Location unknown — no delivery challan matched` and falls back to a `customer_addresses` dropdown. `site_source = 'CRM_ADDRESS'`.
   - *Machine has physically moved* → `Change location` opens a picker of the customer's other sites + free-text pincode, requires a reason (min 10 chars), sets `site_source = 'MANUAL_OVERRIDE'`, writes `site_override_reason`, and logs a `SITE_OVERRIDDEN` event on the ticket. Gate behind `support_tickets.edit`.
   - *Machine not in the fleet at all* (customer-owned, or not yet tagged) → `Machine not listed` checkbox → sets `unknownAsset`, requires the operator to pick a site manually and type an identifier.
6. **Backend must stop rejecting overrides.** `assertSerialMatchesSite()` in `services/supportDeliverySite.js` throws whenever pincodes differ. Change it to accept an options bag: when `site_source === 'MANUAL_OVERRIDE'` and a reason is present, log a warning event instead of throwing. Keep the throw for the default path.
7. `StepMachines`' current filter (`a.site_key === state.site_key || pincode match`) inverts: the **first selected machine sets** `site_key`; subsequent selections are validated against it.

### Acceptance
- [ ] Step 1 has no site control.
- [ ] Typing `04412` in Step 2 finds the machine regardless of which of the customer's sites it sits at.
- [ ] Selecting it shows the derived address, pincode, DC number and delivery date, and lists the other machines at the same pincode with checkboxes.
- [ ] Selecting a machine from another pincode raises the block dialog and does not corrupt `site_key`.
- [ ] `Change location` requires a reason and produces a timeline event on the created ticket.
- [ ] A customer with zero delivered DCs still lets you raise a ticket via the CRM-address fallback.
- [ ] `support_tickets_v2.site_source` is populated for every new ticket.

---

## 5. WP-3 — Evidence capture that the support lead actually sees

### Problem
`StepClassify.jsx` line 472: the attach control is a 12px text link `＋ Attach` in a row of `Impact`/`Urgency` selects, and the only feedback is `3 file(s)`. Nobody notices it; nobody uploads. Photos then do not exist when a charge has to be justified, and `RequestPartSheet` hard-blocks on a photo the operator never took.

### Target behaviour

Replace the text link with an **Evidence block** on each machine's classify card — the second-most prominent element after the issue picker.

```
┌─ Evidence ──────────────────────────── 3 photos ────────────────┐
│ ┌──────┐ ┌──────┐ ┌──────┐  ┌ ─ ─ ─ ─┐                          │
│ │ img  │ │ img  │ │ 63%  │  │   ＋   │   Drag files, paste,     │
│ │  ✕   │ │  ✕   │ │ ▓▓░  │  │ Add    │   or use the camera      │
│ └──────┘ └──────┘ └──────┘  └ ─ ─ ─ ─┘                          │
│                                                                  │
│ ⚠ This issue is usually chargeable — photos are required before  │
│   a charge can be raised.        [ Skip — customer will send ]   │
└──────────────────────────────────────────────────────────────────┘
```

Requirements:

1. **New component** `components/EvidenceUploader.jsx`, used in three places: classify card, `RequestPartSheet`, and `PhotoStep` in `StepRenderers.jsx`. One implementation, three call sites.
2. Accepts: click-to-browse, drag-and-drop onto the block, clipboard paste, and `capture="environment"` on touch devices (a distinct **Take photo** button on mobile).
3. **Thumbnail grid.** Each tile shows an object-URL preview immediately (before upload finishes), an upload progress ring, a remove `✕`, and a retry on failure. Click a tile → lightbox with prev/next arrows, keyboard `←/→/Esc`, filename, size, and `Delete`.
4. **Count is always visible** in the block header — `3 photos` — and mirrored as a badge on the step chip in the wizard rail so the lead can see coverage at a glance.
5. **Client-side downscale before upload**: longest edge 1600px, JPEG q0.8, target < 1.5 MB. Field staff shoot 8 MB photos on 4G. Use a canvas; keep EXIF orientation. Convert HEIC via `heic2any` only if the browser cannot decode it, else fall back to the original file.
6. **Required vs optional is explicit.**
   - When `line.requires_photo` or `line.chargeable_default`, set `photos_required = true`, show the amber note, and **disable Continue** until at least one photo exists **or** the operator clicks `Skip — customer will send later`.
   - `Skip` sets `photos_deferred = true` on the line and the ticket, and is only available to `support_tickets.create` holders.
7. **Deferral has teeth.** A ticket with `photos_deferred = true`:
   - shows a persistent amber strip on `TicketDetailPage`: *"Photos pending from customer — a chargeable outcome cannot be approved without them"*, with an `Add photos now` button;
   - appears in a `Photos pending` filter chip on `TicketQueuePage`;
   - **blocks** approval of any `CHARGEABLE_PART` / `DAMAGE_CHARGE` approval on that ticket (backend check in `supportApprovalRules.js`), with the message telling the approver exactly what is missing.
8. Raise the multer limit from 8 to **12** files on both attachment routes in `routes/supportV2.js`, and enforce a 15 MB per-file cap with a clear 413 message.
9. Attachments already uploaded during the wizard are staged (`/attachments/staging`); on ticket create they must be re-parented to the ticket + line. Verify `tickets.create` does this for every `attachment_ids` array and add it if missing — today's staging upload passes `null` as ticket id and nothing re-parents it. **This is a live bug; fix it here.**

### Acceptance
- [ ] Attach block is visible without scrolling on a 1366×768 screen when a classify card is open.
- [ ] Dropping 4 photos shows 4 thumbnails with progress, then 4 previews; header reads `4 photos`.
- [ ] Clicking a thumbnail opens the lightbox; arrows move between images; `Esc` closes.
- [ ] A chargeable issue with 0 photos blocks Continue; clicking `Skip` unblocks it and marks the ticket `Photos pending`.
- [ ] A `Photos pending` ticket cannot have a chargeable-part approval approved; the approver sees why.
- [ ] Photos uploaded during the wizard are queryable on the created ticket's Attachments tab, linked to the right line.
- [ ] An 8 MB phone photo arrives on the server under 1.5 MB.

---

## 6. WP-4 — Assignment that matches how the team is organised (D2, D3)

### Problem
`StepConfirm.jsx` shows a flat `Assignment group` dropdown listing all nine seeded groups — including `Remote L2` and `Chip-level Repair`, which are not in use — plus an `Assign to` dropdown of every owner and two raw `datetime-local` slot inputs. Scheduling a technician here is wrong: the work order is what gets scheduled, and it does not exist yet.

### Target behaviour

**Step 4 becomes "Assign & review" and contains exactly three decisions:**

1. **Route to** — segmented control, not a dropdown, ordered by `sort_order`:

   ```
   Route to *
   ┌──────────┬──────────┬───────────────────────────────────┐
   │  Remote  │ Inhouse  │ City team ▾  (NCR · suggested)    │
   └──────────┴──────────┴───────────────────────────────────┘
   ```
   - **Remote** — can likely be fixed on a call / remote session. Shows *"No visit needed unless remote fails."*
   - **Inhouse** — machine comes to our facility. Shows *"A pickup work order will be needed."*
   - **City team** — expands to the active `FIELD` groups, with the group matching the site's pincode zone pre-selected and badged `Suggested — 122015 is in NCR`.
   - Source: `GET /support/v2/queue-meta` must return only `is_active = TRUE` groups, with `display_name`, `group_type` and `sort_order`. Filter `Remote L2` and `Chip-level Repair` out via the migration's `is_active`, **not** a hardcoded frontend list.
   - Zone resolution uses `support_zone_pincodes` against `site_pincode`. If no zone matches, no pre-selection and a hint: *"122015 is not in any city zone — pick a team or add the pincode in Support Settings."*

2. **Desk owner (optional)** — relabel `Assign to` → **`Desk owner`**, with helper text: *"Who follows this ticket up. The technician or courier is chosen when you create the work order."* Default to the current user if they belong to the chosen group; otherwise blank. This is D3.

3. **Review panel** (right column, keep the existing SLA preview) with a plain-language summary:
   > P2 · Response by **today 4:30 PM** · Resolution by **tomorrow 6:00 PM**
   > 2 machines at *Udyog Vihar, Gurugram* · Routed to **NCR**
   > Next step after creating: **Field visit work order** *(suggested from the issue type)*

**Remove from the ticket wizard entirely:** `preferred_slot_start`, `preferred_slot_end`, the 7-day availability grid, and the free-slot chip row (`StepConfirm.jsx` lines 650–708). Keep the columns on `support_tickets_v2` for legacy rows, stop writing them from the wizard, and delete them from the create payload. The availability UI moves to the WO wizard in WP-5, where it belongs.

**Also add a `Create ticket and continue to work order` primary action**, so the operator lands directly in the WO wizard with the ticket context pre-filled instead of on a detail page they must then hunt around.

### Acceptance
- [ ] Group picker shows Remote, Inhouse, and active city teams only. `Remote L2` and `Chip-level Repair` appear nowhere in support UI (verify the dispatch board and settings too).
- [ ] A ticket at pincode 560034 pre-selects Bengaluru with a `Suggested` badge; the operator can still change it.
- [ ] No date/time control exists anywhere in the ticket wizard.
- [ ] Existing tickets that already have `preferred_slot_*` still render on the detail page without errors.
- [ ] `Create ticket and continue to work order` opens the WO wizard with ticket, lines and site already filled.

---

## 7. WP-5 — Work-order method drives everything downstream

### Problem
`CreateWorkOrderModal.jsx` is a single modal with `Method`, `Assign to`, `Slot start` and `Slot end` sitting side by side and **completely independent**. Pick `courier` and it still asks you to name a technician and a datetime. Pick `technician` and you get two raw `datetime-local` boxes with no idea who is free, no working-hours constraint, and exactly one slot. `method` is written to the DB as a lowercase free-string with no CHECK constraint.

### Target behaviour

Replace the modal with a **4-step Create Work Order wizard** (`components/wizard/wo/*`), reachable from the ticket detail, the machine card, and the post-create hand-off in WP-4.

**Step 1 — What**
- WO type as a card grid (not chips): each card shows the type name, a one-line plain-English description of what actually happens, and whether it generates a document.
  > **Repair pickup** — we collect the laptop and repair it at our facility. *Generates a Return DC.*
- Machines: checkbox list of the ticket's lines with TTSPL, model and current line status. Pre-select the line the user came from.
- The type suggested by the issue taxonomy (`default_wo_type`) is badged `Suggested`.

**Step 2 — How (method) — this is the sync fix**
Method is a three-card choice, and **the rest of the step is entirely determined by it.**

| Method | Allowed for | Step 2 shows |
|---|---|---|
| **Technician visit** | `FIELD_VISIT`, `REPAIR_PICKUP`, `RETURN_PICKUP`, `SERVICE_RETURN`, `REPLACEMENT_DELIVERY`, `PART_DELIVERY`, `PART_RETURN` | technician picker + slot grid |
| **Courier** | `REPAIR_PICKUP`, `RETURN_PICKUP`, `SERVICE_RETURN`, `REPLACEMENT_DELIVERY`, `PART_DELIVERY`, `PART_RETURN` | courier partner + logistics |
| **Remote** | `REMOTE_FIX`, `FIELD_VISIT` | remote engineer + contact window |

Methods not allowed for the chosen type are hidden, not disabled-with-no-reason.

**2a. Method = Courier**
Required: **Courier partner** (`BlueDart`, `Delhivery`, `DTDC`, `Porter`, `Other` → free-text name). Pre-select `BlueDart` since `dc_shipment_units.courier_name` already defaults to it.
Auto-derived and shown read-only: **Direction** — `Pickup from customer` for `*_PICKUP` / `PART_RETURN`, `Deliver to customer` for `SERVICE_RETURN` / `REPLACEMENT_DELIVERY` / `PART_DELIVERY`.
Also: **Pickup/dispatch date** (date only, min today), **Declared value** (default = sum of the machines' book value; drives the e-Way Bill note), **Packaging note**, **AWB** (optional now, editable later on the WO).
Assignee label changes to **`Logistics coordinator`** and the list filters to users in the `WAREHOUSE`/Inhouse group — **not** field technicians.
**No slot grid.** Instead show the expected TAT: *"BlueDart surface to 122015 — typically 2–3 working days. SLA clock accounts for this."*

**2b. Method = Technician visit**
Assignee list filters to: members of the ticket's assignment group **∩** users whose skill set covers `skill_required` on the lines **∩** users not on leave. Each row shows `Name · 3 jobs today · 2 at this pincode`. Sort by (jobs at this site desc, load asc) so batching is the natural choice.
Then the **slot grid** (D4):

```
        Mon 24   Tue 25   Wed 26   Thu 27   Fri 28
09:30    ▢        ▨ WO-812  ▢       ▢        ▢
10:00    ▢        ▨ WO-812  ▢       ▢        ▢
10:30    ▣        ▢        ▢       ▢        ▢     ▣ selected
11:00    ▣        ▢        ▢       ▨        ▢     ▨ busy
…
18:30    ▢        ▢        ▢       ▢        ▢
19:00 ── end of working day ──
```
- 30-minute cells from **09:30 to 19:00** (read the window from `user_shifts`, fall back to 09:30–19:00).
- Cells rendered from `support_wo_slots` joined with `user_leaves` and `user_shifts`: `free` / `busy (WO-xxx, click to view)` / `off-shift` / `on leave`.
- **Multi-select.** Click cells to toggle; drag to select a range. Selected slots are listed under the grid as removable chips: `Mon 24 Mar · 10:30–11:30 ✕`. Non-contiguous is allowed and normal — *"two laptops at the same location"* or *"this one will take three hours"*.
- Live footer: `2 slots selected · 1 h 30 m total`. Warn (do not block) if total time < 30 min × machine count: *"3 machines, 1 slot booked — is 30 minutes enough?"*
- **Batching:** if the same technician already has work orders at the same `site_key` on a selected day, show
  > **2 other jobs at this location on Mon 24** — WO-812 (TTSPL-04901), WO-815 (TTSPL-04933).
  > `[ Add them to this visit ]` — sets a shared `batch_group_id` and merges the slot booking.
- `scheduled_start` / `scheduled_end` are derived from min/max of the selected slots so every existing consumer keeps working.

**2c. Method = Remote**
Assignee from the `Remote` group. No travel steps (`skips_travel` already handles `REMOTE_FIX`). Ask for a **contact window** (`Now`, `Within 2 hours`, `Today 2–5 PM`, `Tomorrow morning`, custom) → `remote_contact_window`. Show the contact's phone prominently.

**Step 3 — Parts (see WP-6)**

**Step 4 — Review & create**
A single readable summary — *"Rakesh Kumar will visit Udyog Vihar, Gurugram on Mon 24 Mar, 10:30–12:00, for 2 machines. A Return DC will be generated. 1 part (Battery 45Wh) is pre-booked, chargeable ₹3,400, awaiting lead approval."* — then `Create work order`.

### Backend

- `POST /support/v2/tickets/:id/work-orders` accepts `method` (uppercase), `courier_*`, `remote_contact_window`, `slots: [{date, start, end}]`, `batch_group_id`.
- **Validate the method/type matrix server-side.** Return 400 with a specific message on mismatch — the UI hides invalid options but the API must not trust it.
- When `method = 'COURIER'`, `courier_partner` is required and `assigned_to` must not be a field technician; `scheduled_*` derive from `courier_pickup_date`.
- When `method = 'TECHNICIAN'`, at least one slot is required; reject a slot that collides with an existing `support_wo_slots` row for the same user (unique index `(user_id, slot_date, slot_start)` — add it), or that falls outside the user's shift, or on a leave date.
- `GET /support/v2/assignees/availability?group_id=&date_from=&days=7&skill=&site_key=` returns per-user, per-day, per-30-min-slot availability with the reason for every unavailable cell. Extend the existing `dispatch.assigneeAvailability`.
- Upgrade `services/supportWorkOrderService.createWorkOrder` to write the slot rows in the same transaction.

### Acceptance
- [ ] Choosing `Courier` hides the technician picker and the slot grid, and shows courier partner (required), direction (read-only, correct per type), pickup date and declared value.
- [ ] Choosing `Technician` shows the 09:30–19:00 grid for the next 7 days with real busy/leave/off-shift states.
- [ ] Selecting three non-contiguous cells creates three `support_wo_slots` rows; `scheduled_start` = earliest, `scheduled_end` = latest.
- [ ] Double-booking a technician on a taken slot is rejected by the API with a readable message.
- [ ] Creating a WO for a site where the technician already has a job offers the batch prompt, and accepting it sets the same `batch_group_id`.
- [ ] `POST` with `wo_type='REMOTE_FIX'` and `method='COURIER'` returns 400.
- [ ] All existing WOs still open correctly on `JobExecutionPage`.

---

## 8. WP-6 — Work-order area redesign, parts before the visit, and the charge (D5, D6)

### Problem
Three separate problems compound into "messy":
- `TicketDetailPage` buries work orders inside a tab, inside a machine card, under three same-weight buttons (`＋ Work order`, `Replace`, `Resolve this machine`). There is no sense of *what happens next*.
- `JobExecutionPage` is a flat list of steps with underlined-text actions, a `window.prompt()` for failure reason, and raw-ID inputs on Complete (`Found issue id`, `Action code ids (comma)`). This is unusable on a phone in a customer's office.
- Parts can only be requested *during* the job (`RequestPartSheet` is opened from `JobExecutionPage`), so a technician discovers mid-visit that he needs a battery he does not have, and the visit fails.

### 8a. Ticket detail: one clear next action

Add a **Next action** bar directly under the ticket header, above the tabs — always exactly one primary CTA, derived from ticket state:

| State | Bar |
|---|---|
| `NEW`, no WO | *"Classified, not scheduled."* → **Create work order** |
| WO `PENDING_ASSIGNMENT` | *"WO-812 has no technician."* → **Assign** |
| WO `ASSIGNED` | *"Rakesh visits Mon 24 Mar, 10:30."* → **View work order** |
| Part awaiting approval | *"Battery 45Wh — ₹3,400 chargeable, awaiting your approval."* → **Review request** |
| All lines `RESOLVED` | *"All 2 machines resolved."* → **Close ticket** |
| `photos_deferred` | amber: *"Photos pending from customer."* → **Add photos** |

Rework the **Work orders tab** into a vertical timeline grouped by machine: each WO is a `WorkOrderCard` with type, status pill, method icon (👷/📦/💻), assignee, scheduled window, step progress `4/7`, and any linked document number. Completed WOs collapse to one line.

### 8b. Job execution page: a real stepper

- Sticky header: WO number, type, customer, **address with a `Directions` link (maps deep-link)**, contact name with a `tel:` call button, and the progress bar (keep the existing one).
- Steps render as an accordion: done steps collapse to `✓ Label · 10:42 AM`; the current step is expanded with a large touch target; future steps are dimmed and locked.
- Replace every `underline text button` with `Button size="touch"`.
- Replace `window.prompt('Failure reason')` with a proper sheet: reason as a radio list (`Customer unavailable`, `Address wrong`, `Machine not ready`, `Part not available`, `Access denied`, `Other`), a mandatory note, an optional photo, and a `Create retry work order` toggle.
- Replace the Complete modal's raw ID inputs with real pickers: **Found issue** = the same taxonomy tree component used in classify; **Actions taken** = multi-select of `support_action_codes` grouped by `group_name`; **Outcome** = three large radio cards; **Time spent** = a stepper. Keep the min-20-char notes rule but show a live character counter.
- Add a **`Request a part`** button that is prominent for the assigned technician at every stage, not only mid-job.

### 8c. Part request — before the visit and during it (D5)

`RequestPartSheet.jsx` is rewritten and reachable from three places: WO wizard step 3 (pre-booking), the technician's bucket, and the job page.

Fields, in this order:

1. **Machine** (read-only when opened from a line).
2. **Part** — searchable list from `GET /support/v2/parts/compatible`, showing `part_name · SKU · in stock: 4 · ₹3,400`. Out-of-stock parts are selectable but flagged *"Not in stock — will escalate to procurement."*
3. **Quantity**.
4. **Why is it needed** — free text, min 15 chars.
5. **Fault attribution** — radio list, and **this alone decides chargeability**:

   | Option | Chargeable | Approval | Note shown |
   |---|---|---|---|
   | Manufacturing / component failure | No | — | Covered under rental |
   | Normal wear and tear | No | — | Covered under rental |
   | **Customer damage** (liquid, drop, mishandling) | **Yes** | Support lead | Photos required · customer will be billed |
   | **Breakage** (physical, screen/body) | **Yes** | Support lead | Photos required · customer will be billed |
   | Vendor warranty claim | No to customer | — | A warranty claim will be raised |
   | Cannot determine yet | No (provisional) | Support lead | Lead will decide after the visit |

   This replaces the current free `Liability` dropdown. Keep writing `liability` (mapped) so existing code keeps working, and write `fault_attribution` as the new source of truth.
6. **Evidence** — the WP-3 `EvidenceUploader`. Mandatory when chargeable.
7. **Charge** — appears only when chargeable. Auto-filled and read-only by default:
   `Battery 45Wh × 1 @ ₹3,400 = ₹3,400 + 18% GST = ₹4,012`
   Sourced from `parts.selling_price`, `parts.gst_rate`. An `Override price` link is gated behind `support_charges.edit`; overriding requires a reason and, if the variance exceeds ±15%, creates a `PART_VALUE` approval on top of the `CHARGEABLE_PART` one.
   If `selling_price` is NULL → *"No selling price set for this part. Ask Parts to set it before raising a charge."* and block the chargeable path (the free path still works).
8. **Old part expected** — keep `collect_old_part`.
9. **Needed by** — pre-filled from the WO's first slot when pre-booking.

**Parts master.** Add `Selling price`, `HSN`, `GST %` to the parts management screen, gated behind the new `parts_pricing` permission, with the last-updated stamp. Add a `Missing selling price` filter so someone can fill the gap in bulk.

**Approval loop.** A chargeable request lands in `PartsQueuePage` and `ApprovalsPage` as a `CHARGEABLE_PART` approval showing the machine, the photos, the attribution, and the amount. Approve → the part can be reserved/issued. Reject → the technician sees the reason and can re-submit with a different attribution. **A part with `needs_lead_approval = true` cannot reach `ISSUED`** — enforce in `supportPartsService.issue()`.

### 8d. From fitted part to invoice (D7)

`supportPartsService.consume()` already inserts into `customer_invoice_extra_lines` when `liability = 'CUSTOMER_CHARGEABLE'`. Extend it:

- Write `billing_mode` (default `'MONTHLY'`), `unit_price`, `quantity`, `gst_rate`, `hsn_code`, `source_part_request_id`, `source_wo_id`, `challan_number`, and `status = 'PENDING'`.
- Require the `CHARGEABLE_PART` approval to be `APPROVED` before the charge row is created; otherwise create it as `PENDING` with `approval_id` set and let the approval flip it.
- The part challan / customer DC PDF (`supportPartCustomerDcPdfService.js`, `supportPartChallanPdfService.js`) must **print the selling price, GST and total when the part is customer-chargeable**, and print `Under warranty — no charge` when it is not. This is the *"we can see the price of that challan"* requirement.

**New Accounts screen** — `pages/SupportChargesPage.jsx`, route `/support/v2/charges`, permission `support_charges_billing`:

- Table of `customer_invoice_extra_lines` where `status IN ('PENDING','APPROVED')` and `billed_in_invoice_id IS NULL`.
- Columns: customer, ticket, machine, description, qty, unit price, GST, total, raised on, evidence (thumbnails → lightbox), challan number, approval status.
- Row actions: **`Bill now`** → sets `billing_mode='IMMEDIATE'`, `status='APPROVED'`, and generates a standalone invoice against `customer_invoices` using the existing invoice creation path; **`Add to monthly`** → `billing_mode='MONTHLY'` (the existing `pullApprovedExtraLines` in `supportBillingHooks.js` picks it up on the next run); **`Waive`** → `status='WAIVED'` with a mandatory reason.
- Bulk select for `Add to monthly` and `Waive`.
- Filters: customer, month, billing mode, status. A `Total pending to bill` figure in the header.
- `supportBillingHooks.pullApprovedExtraLines` must be narrowed to `billing_mode = 'MONTHLY'` so immediately-billed charges are not billed twice. **Write a test for this.**

### Acceptance
- [ ] Ticket detail shows exactly one Next-action CTA and it changes correctly as state advances.
- [ ] A technician can request a part from the WO wizard before the visit, and it appears on the WO as `Pre-booked`.
- [ ] Choosing `Customer damage` reveals the charge block, auto-fills from `parts.selling_price`, and requires a photo.
- [ ] Choosing `Manufacturing failure` hides the charge block entirely.
- [ ] A chargeable request cannot be issued until the support lead approves it.
- [ ] Fitting an approved chargeable part creates one `customer_invoice_extra_lines` row with unit price, GST and challan number.
- [ ] The part challan PDF shows the price for a chargeable part and "Under warranty — no charge" otherwise.
- [ ] `Bill now` produces an invoice and the charge never appears again in the monthly run. `Add to monthly` does the reverse. Covered by a test.
- [ ] A part with no `selling_price` blocks the chargeable path with a clear message and does not crash.

---

## 9. WP-7 — Cross-cutting clarity pass

Apply everywhere in `features/support-v2`:

1. **Every wizard shows the same rail** — numbered steps, completed steps get a ✓ and are clickable to go back, the current step is bold, future steps are dim. Replace the plain chips in `NewTicketPage.jsx` lines 919–925.
2. **Never block silently.** A disabled `Continue` must be accompanied by a line saying what is missing: *"Add a photo, or choose Skip, to continue."* Build a `<BlockedReason />` primitive and use it on every wizard footer.
3. **Every enum the operator sees gets a human label plus a one-line explanation on first use.** Extend `supportV2Utils.js` with a single `LABELS` map — WO types, methods, statuses, liabilities, fault attributions, pending reasons — and use it everywhere. No raw `REPAIR_PICKUP` in the UI.
4. **No `window.prompt` / `window.confirm` in the module.** Replace all of them (`TicketDetailPage` reopen/cancel, `JobExecutionPage` fail) with `Modal`-based forms.
5. **Empty states say what to do**, not "No data". *"No work order yet — create one to schedule a technician or a courier."*
6. **Error toasts include the fix.** *"Could not create work order"* → *"Rakesh is already booked 10:30–11:00 on Mon 24. Pick another slot or another technician."*
7. **Loading states**: skeletons on the queue, detail, and wizard steps instead of `Loading…` text.
8. **Mobile**: `JobExecutionPage`, `RequestPartSheet` and the WO wizard must be usable at 360 px with 44 px touch targets.
9. Add `Asia/Kolkata` handling once, in a helper — all slot maths, day boundaries and "today" comparisons go through it. Do not scatter `new Date()` across components.

---

## 10. Test plan (required — do not skip)

**Backend (`backend/test/`, follow `support-v2-phase2.test.js`):**
- `support-v2-flow-fix.test.js` — contact/customer coupling guard; site derivation and override; photo-deferred blocking a chargeable approval.
- `support-v2-wo-method.test.js` — full method/type matrix, courier required fields, slot collision rejection, shift/leave rejection, multi-slot → `scheduled_start`/`end` derivation, batch grouping.
- `support-v2-part-charge.test.js` — attribution → chargeability mapping; approval gate before `ISSUED`; consume creates exactly one extra line with correct price and GST; `Bill now` excludes it from `pullApprovedExtraLines`; missing `selling_price` blocks cleanly.
- Migration idempotency: run 214–217 twice against a fresh DB, assert no error and no duplicate rows.

**Frontend:**
- Reducer/unit test for the customer-switch reset.
- Reducer/unit test for site derivation and cross-site rejection.
- Render tests for `EvidenceUploader` (add, remove, lightbox, required/skip) and the slot grid (busy, leave, off-shift, multi-select).

**Manual QA script** — write it to `support-revamp-prompts/QA_FLOW_FIX.md` and walk it before the PR:
1. Raise a ticket for a customer with machines at 2 sites; switch customers mid-way; confirm full reset.
2. Search a TTSPL directly, confirm the location banner and the "other machines here" list.
3. Attach 3 photos, view them, delete one, skip on a second machine.
4. Route to a city team, create, continue to WO.
5. Create a courier pickup — confirm no slot grid and no technician field.
6. Create a technician visit with 3 slots across 2 days; try to double-book; batch with an existing job.
7. Pre-book a chargeable part; approve it as lead; fit it as technician; confirm the charge, the challan price, and both billing routes.

---

## 11. Delivery order

| PR | Contains | Why this order |
|---|---|---|
| 1 | Migrations 214–217 + RBAC rows + `queue-meta` group filtering | Everything else depends on the schema; group cleanup is instantly visible value |
| 2 | WP-1 (customer sync) + WP-3 (evidence) | Two self-contained wizard fixes; WP-3's uploader is reused later |
| 3 | WP-2 (site from machine) | Restructures the wizard; needs WP-1's reset logic to be correct first |
| 4 | WP-4 (assignment) | Small, closes out the ticket wizard |
| 5 | WP-5 (WO wizard + method + slots) | Largest; depends on 215 and on WP-4 removing scheduling from the ticket |
| 6 | WP-6 (WO redesign, parts, charges, accounts screen) | Depends on WP-5's wizard shell and WP-3's uploader |
| 7 | WP-7 (clarity pass) + QA doc | Polish across everything above |

Each PR: green lint, green tests, a screenshot or short clip of the changed screen in the description, and a note on anything you deliberately did not do.

---

## 12. Do not break this list

- Existing tickets, work orders and part requests created before this change must open and render without errors. Where a new column is NULL, show `—`, never crash.
- The customer portal (`customer-portal/`, `supportV2PortalController.js`) reads tickets and extra lines — re-run it after the charge changes.
- `supportDualRunWorker.js` and the legacy-parity reports must still run.
- Monthly billing must not double-bill. This is the single highest-risk change in the whole set — cover it with a test, and log every extra-line state transition.
- Permissions: no new screen or action ships ungated.

---

## 13. If something here conflicts with the code

The spec was written against `support_revamp` @ `30afbd1`. If you find that a behaviour described as missing already exists, or a file has moved, **do not silently deviate** — implement the intent, and note the deviation in the PR description. If a decision in §0 turns out to be impossible with the current schema, stop and raise it rather than inventing a third pattern.
