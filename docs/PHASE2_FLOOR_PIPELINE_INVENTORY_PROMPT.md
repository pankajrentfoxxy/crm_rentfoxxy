# RENTFOXXY CRM — PHASE 2 BUILD PROMPT
## Floor Pipeline + Inventory — Complete Implementation
### For Claude Code / Cursor — Branch: new_crm_rentfoxxy

---

## AGENT RULES — READ FIRST

- You are extending the existing codebase. Do NOT rewrite working code.
- Branch: `new_crm_rentfoxxy`
- Every new DB table or permission section must be added to the migrations folder AND
  registered in the RBAC permission_sections table.
- Naming conventions (DO NOT change these):
  - Stages: `Floor Manager`, `Diagnosis`, `Assembly & Software`, `Final Testing`,
    `Chip Level Repair`, `Body & Paint`, `QC1`, `QC2`, `Inventory`
  - Ticket priority values: `normal`, `high`, `sales_order` (not "Sales Order Priority")
  - Ticket status values: `in_progress`, `on_hold`, `completed`, `qc_failed_return_vendor`
  - TTSPL ID format: `TTSPL` + zero-padded 3-digit number (e.g. `TTSPL001`)
  - Permission sections use snake_case (e.g. `floor_tickets`, `floor_pipeline`,
    `inventory_management`, `parts_inventory`)
- Design system (same as Phase 1):
  - Primary: `#2563EB`, Success: `#16A34A`, Warning: `#D97706`, Danger: `#DC2626`
  - Cards: `rounded-xl border border-gray-100 shadow-sm`
  - Badges: `rounded-full px-2.5 py-0.5 text-xs font-semibold`
  - All pages mobile-responsive (min 375px)

---

## SECTION 1 — DATABASE MIGRATIONS

### Migration `056_phase2_floor_pipeline.sql`

```sql
-- Phase 2: Floor pipeline enhancements, TTSPL audit trail,
-- config history, stage rules, parts tracking enhancements

-- 1. Add missing columns to tickets table
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS ticket_type VARCHAR(50) DEFAULT 'grn_qc'
    CHECK (ticket_type IN ('grn_qc', 'sales_order_qc', 'support', 'general')),
  ADD COLUMN IF NOT EXISTS qc_fail_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qc1_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc2_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc1_fail_reason TEXT,
  ADD COLUMN IF NOT EXISTS qc2_fail_reason TEXT,
  ADD COLUMN IF NOT EXISTS qc1_passed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc2_passed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS body_paint_required BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS chip_repair_required BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS highlighted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS highlighted_reason TEXT,
  ADD COLUMN IF NOT EXISTS floor_manager_qc_failed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS floor_manager_qc_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS floor_manager_qc_fail_reason TEXT,
  ADD COLUMN IF NOT EXISTS return_to_vendor_dc_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS sales_order_id INT,
  ADD COLUMN IF NOT EXISTS sales_order_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 2. TTSPL config history (every config change logged)
CREATE TABLE IF NOT EXISTS ttspl_config_history (
  history_id SERIAL PRIMARY KEY,
  ttspl_id VARCHAR(50) NOT NULL,
  vendor_serial_id INT REFERENCES vendor_serial_numbers(serial_id),
  ticket_id INT REFERENCES tickets(ticket_id),
  changed_by INT REFERENCES users(user_id),
  change_type VARCHAR(50) NOT NULL
    CHECK (change_type IN ('upgrade', 'replacement', 'correction', 'initial')),
  field_name VARCHAR(50) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  notes TEXT,
  part_used_id INT,
  part_cost NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ttspl_config_history_ttspl
  ON ttspl_config_history (ttspl_id);
CREATE INDEX IF NOT EXISTS idx_ttspl_config_history_ticket
  ON ttspl_config_history (ticket_id);

-- 3. TTSPL master audit log (full lifecycle events per laptop)
CREATE TABLE IF NOT EXISTS ttspl_audit_log (
  log_id SERIAL PRIMARY KEY,
  ttspl_id VARCHAR(50) NOT NULL,
  vendor_serial_id INT REFERENCES vendor_serial_numbers(serial_id),
  event_type VARCHAR(80) NOT NULL,
  -- event_type values: received_grn, ticket_created, stage_changed, parts_used,
  -- config_updated, qc1_passed, qc1_failed, qc2_passed, qc2_failed,
  -- qc_failed_return_vendor, inventory_ready, dispatched, returned,
  -- support_ticket, chip_repair_started, body_paint_started
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  actor_user_id INT REFERENCES users(user_id),
  actor_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ttspl_audit_ttspl ON ttspl_audit_log (ttspl_id);
CREATE INDEX IF NOT EXISTS idx_ttspl_audit_created ON ttspl_audit_log (created_at DESC);

-- 4. Stage transition rules (enforced in backend)
CREATE TABLE IF NOT EXISTS stage_transition_rules (
  rule_id SERIAL PRIMARY KEY,
  from_stage_name VARCHAR(100) NOT NULL,
  to_stage_name VARCHAR(100) NOT NULL,
  condition VARCHAR(100),
  is_backward BOOLEAN DEFAULT FALSE,
  notes TEXT,
  UNIQUE(from_stage_name, to_stage_name)
);

-- Seed stage transition rules
INSERT INTO stage_transition_rules
  (from_stage_name, to_stage_name, condition, is_backward, notes)
VALUES
  ('Floor Manager',        'Diagnosis',             NULL,            FALSE, 'Auto on assign'),
  ('Diagnosis',            'Assembly & Software',   'no_chip_no_body',FALSE,'Normal flow'),
  ('Diagnosis',            'Chip Level Repair',     'chip_required', FALSE, 'Chip issue found'),
  ('Diagnosis',            'Body & Paint',          'body_required', FALSE, 'Body issue only'),
  ('Chip Level Repair',    'Assembly & Software',   NULL,            FALSE, 'After chip repair'),
  ('Body & Paint',         'Assembly & Software',   NULL,            FALSE, 'After body work'),
  ('Assembly & Software',  'Final Testing',         NULL,            FALSE, 'Normal flow'),
  ('Final Testing',        'QC1',                   NULL,            FALSE, 'Normal flow'),
  ('QC1',                  'QC2',                   'qc1_passed',    FALSE, 'QC1 passed'),
  ('QC1',                  'Assembly & Software',   'qc1_failed',    TRUE,  'QC1 failed — back to tech'),
  ('QC2',                  'Inventory',             'qc2_passed',    FALSE, 'QC2 passed — inventory ready'),
  ('QC2',                  'QC1',                   'qc2_failed',    TRUE,  'QC2 failed — back to QC1')
ON CONFLICT (from_stage_name, to_stage_name) DO NOTHING;

-- 5. Add Chip Level Repair and Body & Paint stages if missing
-- (stages table already exists from previous migrations)
INSERT INTO stages (stage_name, stage_order, stage_category)
VALUES
  ('Chip Level Repair', 35, 'Hardware & Software'),
  ('Body & Paint',      36, 'Hardware & Software')
ON CONFLICT (stage_name) DO NOTHING;

-- 6. Register new permission sections for Phase 2
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('floor_pipeline',    'Floor Pipeline & Ticket Management', 25),
  ('floor_tickets',     'Floor Tickets (view own/team)',       26),
  ('chip_level_repair', 'Chip Level Repair',                  27),
  ('parts_inventory',   'Parts & Inventory',                  28),
  ('ttspl_history',     'TTSPL Laptop History & Audit',       29)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

-- 7. Seed default role permissions for new Phase 2 sections
-- floor_pipeline: floor_manager + admin + manager get full access
-- floor_tickets: floor_manager, technician, qc_team get view+edit
-- chip_level_repair: chip_repair_tech, floor_manager, admin
-- parts_inventory: warehouse, floor_manager, admin, manager
-- ttspl_history: all internal roles get view access

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',          'floor_pipeline',    TRUE,TRUE,TRUE,TRUE),
  ('manager',        'floor_pipeline',    TRUE,TRUE,TRUE,FALSE),
  ('floor_manager',  'floor_pipeline',    TRUE,TRUE,TRUE,FALSE),
  ('technician',     'floor_pipeline',    TRUE,FALSE,TRUE,FALSE),
  ('qc',             'floor_pipeline',    TRUE,FALSE,TRUE,FALSE),
  ('admin',          'floor_tickets',     TRUE,TRUE,TRUE,TRUE),
  ('manager',        'floor_tickets',     TRUE,FALSE,TRUE,FALSE),
  ('floor_manager',  'floor_tickets',     TRUE,TRUE,TRUE,FALSE),
  ('technician',     'floor_tickets',     TRUE,FALSE,TRUE,FALSE),
  ('qc',             'floor_tickets',     TRUE,FALSE,TRUE,FALSE),
  ('admin',          'chip_level_repair', TRUE,TRUE,TRUE,TRUE),
  ('floor_manager',  'chip_level_repair', TRUE,TRUE,TRUE,FALSE),
  ('technician',     'chip_level_repair', TRUE,FALSE,TRUE,FALSE),
  ('admin',          'parts_inventory',   TRUE,TRUE,TRUE,TRUE),
  ('manager',        'parts_inventory',   TRUE,TRUE,TRUE,FALSE),
  ('floor_manager',  'parts_inventory',   TRUE,TRUE,TRUE,FALSE),
  ('technician',     'parts_inventory',   TRUE,FALSE,FALSE,FALSE),
  ('warehouse',      'parts_inventory',   TRUE,TRUE,TRUE,FALSE),
  ('admin',          'ttspl_history',     TRUE,FALSE,FALSE,FALSE),
  ('manager',        'ttspl_history',     TRUE,FALSE,FALSE,FALSE),
  ('floor_manager',  'ttspl_history',     TRUE,FALSE,FALSE,FALSE),
  ('technician',     'ttspl_history',     TRUE,FALSE,FALSE,FALSE),
  ('warehouse',      'ttspl_history',     TRUE,FALSE,FALSE,FALSE),
  ('accounts',       'ttspl_history',     TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
```

---

## SECTION 2 — BACKEND: NEW & UPDATED FILES

### 2.1 New service: `backend/services/ttsplAuditService.js`

Create this service. It is called from ticket, QC, and inventory controllers
to log every lifecycle event for a TTSPL ID.

```javascript
const pool = require('../config/db');

/**
 * Log a lifecycle event for a TTSPL ID.
 * @param {object} params
 * @param {string} params.ttsplId       - e.g. 'TTSPL001'
 * @param {number} [params.vendorSerialId]
 * @param {string} params.eventType     - see ttspl_audit_log.event_type CHECK constraint
 * @param {string} params.description   - human-readable description
 * @param {object} [params.metadata]    - extra JSON data
 * @param {number} [params.actorUserId]
 * @param {string} [params.actorName]
 * @param {object} [params.db]          - pool or client (defaults to pool)
 */
async function logTtsplEvent({ ttsplId, vendorSerialId, eventType,
  description, metadata = {}, actorUserId, actorName, db }) {
  const client = db || pool;
  await client.query(
    `INSERT INTO ttspl_audit_log
      (ttspl_id, vendor_serial_id, event_type, description, metadata,
       actor_user_id, actor_name)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [ttsplId, vendorSerialId || null, eventType,
     description, JSON.stringify(metadata),
     actorUserId || null, actorName || null]
  );
}

/**
 * Log a config change for a TTSPL ID.
 */
async function logConfigChange({ ttsplId, vendorSerialId, ticketId,
  changedBy, changeType, fieldName, oldValue, newValue,
  notes, partUsedId, partCost = 0, db }) {
  const client = db || pool;
  await client.query(
    `INSERT INTO ttspl_config_history
      (ttspl_id, vendor_serial_id, ticket_id, changed_by, change_type,
       field_name, old_value, new_value, notes, part_used_id, part_cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [ttsplId, vendorSerialId || null, ticketId || null, changedBy || null,
     changeType, fieldName, oldValue || null, newValue || null,
     notes || null, partUsedId || null, partCost]
  );
}

/**
 * Get full audit trail for a TTSPL ID.
 */
async function getTtsplHistory(ttsplId) {
  const [auditRes, configRes] = await Promise.all([
    pool.query(
      `SELECT l.*, u.name AS actor_name_resolved
       FROM ttspl_audit_log l
       LEFT JOIN users u ON u.user_id = l.actor_user_id
       WHERE l.ttspl_id = $1
       ORDER BY l.created_at ASC`,
      [ttsplId]
    ),
    pool.query(
      `SELECT h.*, u.name AS changed_by_name
       FROM ttspl_config_history h
       LEFT JOIN users u ON u.user_id = h.changed_by
       WHERE h.ttspl_id = $1
       ORDER BY h.created_at ASC`,
      [ttsplId]
    )
  ]);
  return {
    auditLog: auditRes.rows,
    configHistory: configRes.rows
  };
}

module.exports = { logTtsplEvent, logConfigChange, getTtsplHistory };
```

### 2.2 Update `backend/controllers/ticketController.js`

**Add these new exported functions** (do not remove existing ones):

```
exports.getTicketsByTtsplId      GET — fetch all tickets for a TTSPL ID
exports.moveToStage              POST — controlled stage transition with rules enforcement
exports.markChipRepairRequired   PATCH — set chip_repair_required = true, move to Chip Level Repair stage
exports.markBodyPaintRequired    PATCH — set body_paint_required = true, move to Body & Paint stage
exports.markQcFailed             PATCH — floor manager force-fails QC (sets qc_failed_return_vendor status)
exports.updateTtsplConfig        PATCH — update laptop config fields, logs to ttspl_config_history
exports.getTtsplHistory          GET   — returns full audit trail via ttsplAuditService
```

**`moveToStage` logic (enforce these rules):**
- Validate the transition exists in `stage_transition_rules`
- If moving to `QC1` from `Assembly & Software` with a previous QC1 fail:
  - Set `highlighted = true`, `highlighted_reason = 'QC1 previously failed: [reason]'`
  - Log audit event `qc1_failed`
- If moving to `Assembly & Software` from `QC1` (fail path):
  - Increment `qc_fail_count`, set `qc1_failed_at = NOW()`, `qc1_fail_reason = req.body.reason`
  - Set `highlighted = true`
  - Log audit event `qc1_failed`
- If moving to `QC1` from `QC2` (fail path):
  - Set `qc2_failed_at = NOW()`, `qc2_fail_reason = req.body.reason`
  - Set `highlighted = true`, `highlighted_reason = 'QC2 failed: [reason]'`
  - Log audit event `qc2_failed`
- If moving to `Inventory`:
  - Set ticket status = `completed`, `completed_at = NOW()`
  - Update `vendor_serial_numbers.qc_status = 'passed'`
  - Update inventory status to `qc_passed`
  - Log audit event `qc2_passed` then `inventory_ready`
  - Call `ttsplAuditService.logTtsplEvent`
- `highlighted` is cleared to `false` when a technician starts work on that stage

**`markQcFailed` (floor manager force fail):**
- Sets `floor_manager_qc_failed = true`
- Sets `floor_manager_qc_fail_reason = req.body.reason`
- Sets ticket status = `qc_failed_return_vendor`
- Updates `vendor_serial_numbers.qc_status = 'qc_failed_return_vendor'`
- Logs audit event `qc_failed_return_vendor`
- Returns instructions to initiate vendor return DC

**`updateTtsplConfig`:**
- Accepts fields: `processor`, `ram`, `storage`, `gpu`, `screen_size`, `os`
- For each changed field: reads current value, logs to `ttspl_config_history`
- Also updates `vendor_serial_numbers.extra` JSONB with new config
- Logs audit event `config_updated`

### 2.3 New route: `GET /api/tickets/ttspl/:ttsplId/history`
Add to `backend/routes/tickets.js`:
```javascript
router.get('/ttspl/:ttsplId/history', authMiddleware, ticketController.getTtsplHistory);
```

### 2.4 New route: `PATCH /api/tickets/:id/config`
Add to `backend/routes/tickets.js`:
```javascript
router.patch('/:id/config', authMiddleware, ticketController.updateTtsplConfig);
```

### 2.5 New routes for stage control
Add to `backend/routes/tickets.js`:
```javascript
router.post('/:id/move-stage',          authMiddleware, ticketController.moveToStage);
router.patch('/:id/chip-repair',        authMiddleware, ticketController.markChipRepairRequired);
router.patch('/:id/body-paint',         authMiddleware, ticketController.markBodyPaintRequired);
router.patch('/:id/floor-manager-fail', authMiddleware, checkRole(['admin','manager','floor_manager']), ticketController.markQcFailed);
```

### 2.6 New API endpoint: `GET /api/tickets/floor-dashboard`
Returns data for the floor dashboard:
```javascript
{
  byStage: [{ stage_name, count, highlighted_count }],
  priorityCounts: { normal, high, sales_order },
  technicianLoad: [{ user_id, name, active_tickets }],
  avgStageDuration: [{ stage_name, avg_hours }]  // from work_logs
}
```

### 2.7 Update `backend/services/grnTicketService.js`
When creating the ticket from GRN receive, add:
- Set `ticket_type = 'grn_qc'`
- Set `priority = 'normal'`
- After ticket creation, call `ttsplAuditService.logTtsplEvent` with
  `eventType = 'ticket_created'`, `description = 'QC ticket created from GRN receive'`

### 2.8 Update `backend/controllers/ticketController.js` — `addPartToTicket`
After adding part to ticket, call:
```javascript
await ttsplAuditService.logTtsplEvent({
  ttsplId: ticket.ttspl_id,
  vendorSerialId: ticket.vendor_serial_id,
  eventType: 'parts_used',
  description: `Part used: ${part.part_name} × ${quantity} (₹${totalCost})`,
  metadata: { part_id, part_name, quantity, unit_cost, total_cost },
  actorUserId: req.user.user_id
});
```

Also call `ttsplAuditService.logConfigChange` if the part is an upgrade
(RAM, storage — detected by part_category from parts table).

---

## SECTION 3 — FRONTEND: FLOOR PIPELINE (CRM)

### 3.1 New feature folder: `frontend/src/features/floor-pipeline/`

Structure:
```
floor-pipeline/
  FloorPipelineApp.jsx       ← router root, tabs, navigation
  floorPipelineApi.js        ← all API calls
  pages/
    FloorTicketListPage.jsx  ← main list (kanban + table toggle)
    TicketDetailPage.jsx     ← single ticket full detail
    FloorDashboardPage.jsx   ← floor manager dashboard
  components/
    TicketCard.jsx           ← kanban card component
    StageTimeline.jsx        ← visual stage progress
    TtsplHistoryDrawer.jsx   ← full audit trail drawer
    ConfigUpdateModal.jsx    ← update laptop config
    PartsRequestModal.jsx    ← request/attach parts
    QcChecklistPanel.jsx     ← QC1 + QC2 checklist
    ChipRepairPanel.jsx      ← chip level repair form
    BodyPaintPanel.jsx       ← body & paint form
    WorkLogFeed.jsx          ← chronological work log
```

### 3.2 `FloorTicketListPage.jsx`

**Header:**
- Title "Floor Pipeline" + subtitle based on role
  (Floor Manager: "All tickets" | Technician: "My tickets" | QC: "QC queue")
- View toggle: Kanban | Table (save preference to localStorage)
- Filter bar: Stage | Priority | Assigned To | Ticket Type | Search (TTSPL ID / serial)

**Kanban view:**
- Columns (one per stage): Floor Manager | Diagnosis | Assembly & Software |
  Final Testing | Chip Level Repair | Body & Paint | QC1 | QC2 | Inventory Ready
- Each column header: stage name + count badge
- Card: `TicketCard` component (see below)
- Columns are horizontally scrollable on mobile
- QC columns (QC1, QC2) highlighted with different border color (indigo)
- Chip Repair column: amber border
- Body & Paint column: pink border

**Table view:**
- Columns: # | TTSPL ID | Brand+Config | Stage | Priority | Assigned | QC Fails | Highlighted | Age (days) | Actions
- Highlighted tickets show a yellow warning icon + reason tooltip
- Priority `sales_order`: red badge "Sales Order"
- Priority `high`: amber badge "High"
- Clicking row → opens TicketDetailPage

**Role-based visibility:**
- Technician: only sees tickets assigned to themselves
- Floor Manager: sees all, can reassign, can force-fail
- QC team: only sees tickets in QC1 / QC2 stages
- Manager/Admin: sees all, read-only actions unless also floor_manager

### 3.3 `TicketCard.jsx`

```
[PRIORITY BADGE]              [STAGE BADGE]
TTSPL001                      ← ttspl_id bold monospace
Dell Core i5 | 8GB | 256 SSD  ← brand + config
[HIGHLIGHTED WARNING BANNER if highlighted=true]
  "⚠ QC1 previously failed: keyboard issue"
──────────────────────────────
👤 Ravi Kumar    ⏱ 2d 4h
[Parts needed badge if procurement_requests pending]
```

Clicking card → navigate to TicketDetailPage.

### 3.4 `TicketDetailPage.jsx`

Route: `/floor-pipeline/tickets/:id`

**Layout:** Two-column on desktop (left 65% main, right 35% sidebar).
Full-width single column on mobile.

**Left: Tab navigation**
- Tab 1: Overview
- Tab 2: Work Log
- Tab 3: Diagnosis
- Tab 4: Parts
- Tab 5: Config History
- Tab 6: QC Checklist
- Tab 7: Chip Repair (shown only if chip_repair_required = true)
- Tab 8: Body & Paint (shown only if body_paint_required = true)
- Tab 9: TTSPL History

**Right sidebar (always visible):**
```
Ticket: #[id]
TTSPL: TTSPL001  [view history button]
Brand: Dell
Config: i5 10th | 8GB | 256 SSD
Condition: Minor scratches
PO: PO-0023 (Rental)
Vendor: ABC Laptops

Status: [badge]
Priority: [badge]
Highlighted: [⚠ yellow banner if true]
QC Fails: [count]

[STAGE ACTION BUTTONS — role-based]
```

**Stage Action Buttons (right sidebar, role-based):**

For TECHNICIAN on Diagnosis stage:
- `Move to Assembly & Software` (blue, primary action)
- `Mark Chip Repair Required` (amber) → opens confirmation dialog
- `Mark Body & Paint Required` (pink) → opens confirmation dialog
- `Parts Required` (gray) → opens PartsRequestModal

For TECHNICIAN on Assembly & Software / Final Testing:
- `Move to Next Stage` (blue)
- `Parts Required` (gray)

For QC TEAM on QC1:
- `QC1 Pass — Move to QC2` (green)
- `QC1 Fail — Send back to technician` (red) → requires reason input

For QC TEAM on QC2:
- `QC2 Pass — Move to Inventory` (green)
- `QC2 Fail — Send back to QC1` (red) → requires reason input

For FLOOR MANAGER (any stage):
- All above buttons visible
- Plus: `Force QC Fail — Return to Vendor` (dark red, destructive)
  → confirmation dialog with mandatory reason → sets status to qc_failed_return_vendor

**Tab 1 — Overview:**
- TTSPL ID, Ticket ID, Type, Priority, Stage, Status
- Assigned To + Assign button (floor manager only)
- Created date, Completed date
- Linked PO number (click → opens PO)
- Sales Order number if sales_order type
- Stage duration summary table:
  | Stage | Entered | Exited | Duration | Technician |

**Tab 2 — Work Log:**
Chronological feed. Each entry shows:
- Datetime + technician name
- Action (stage changed / part added / note added / config updated / QC result)
- Description
- If parts: show part name + quantity + cost
- If QC fail: show fail reason in red
- If highlighted: show yellow warning icon

**Tab 3 — Diagnosis:**
Render `DiagnosisForm` component (already exists at
`frontend/src/components/DiagnosisForm.jsx`).
Display read-only if already submitted. Show auto-calculated flags.

**Tab 4 — Parts:**
Two sub-sections:
- "Parts Used": table of ticket_parts with part name, quantity, unit cost,
  total cost, added by, date. Sum row at bottom.
- "Parts Requested": list of procurement_requests linked to this ticket,
  status (Required / Requested / Fulfilled), action to mark fulfilled.
- `+ Request / Attach Part` button → opens PartsRequestModal

**Tab 5 — Config History:**
Table from `ttspl_config_history`:
| Date | Changed By | Field | Before | After | Change Type | Notes |
Each row with color coding: upgrade = green, replacement = amber, correction = gray.

**Tab 6 — QC Checklist:**
Render `QcChecklistPanel` with:
- QC1 section (Hardware checks):
  Display, Keyboard, Trackpad, USB ports, HDMI, Audio, Camera, Battery, RAM
  (verified vs config), Storage (verified vs config), Processor, WiFi, Bluetooth,
  Hinge, Body condition. Each: Pass ✓ / Fail ✗ / N/A
- QC1 section (Software checks):
  OS installed + activated, All drivers, Virus scan result, Benchmark score (input),
  Battery health % (input)
- QC2 section: same checklist, labeled as QC2 verification
- Save draft button + Submit (Pass/Fail) button
- On submit fail: show mandatory reason input

**Tab 9 — TTSPL History:**
Full audit trail from `ttspl_audit_log`. Vertical timeline:
- Event icon (color coded by event type)
- Date + time
- Actor name
- Description
- Metadata (expandable)

### 3.5 `ConfigUpdateModal.jsx`

Triggered from Overview tab or config badge:
- Fields: Processor | RAM | Storage | GPU | Screen Size | OS
- Pre-filled with current values from vendor_serial_numbers.extra
- Change type: Upgrade / Replacement / Correction
- Notes field (required)
- On save: calls `PATCH /api/tickets/:id/config`
- Shows diff: "RAM: 8 GB → 16 GB"

### 3.6 `PartsRequestModal.jsx`

Two modes triggered from Parts tab:
**Mode A — Part available in inventory:**
- Search parts inventory (calls `GET /api/parts?search=...`)
- Shows: Part Name | Category | Qty Available | Unit Cost
- Select quantity
- On confirm: calls `POST /api/tickets/:id/parts` (existing endpoint)
- On success: deducts from inventory, logs to ttspl_audit_log

**Mode B — Part not available:**
- Part name (text input) | Category (dropdown) | Quantity | Notes
- On submit: calls `POST /api/tickets/:id/request-part` (existing endpoint)
- Creates procurement_request linked to this ticket
- Shows "Procurement request raised — Parts team notified"

### 3.7 `TtsplHistoryDrawer.jsx`

Right-side overlay drawer (540px wide, full screen mobile).
Can be opened from any page that shows a TTSPL ID.
Calls `GET /api/tickets/ttspl/:ttsplId/history`.

Timeline sections:
1. **Procurement** — received from vendor X on date, PO number, GRN number
2. **Floor Processing** — all ticket stages with durations and technicians
3. **Parts & Config** — all config changes and parts used with costs
4. **QC Results** — QC1/QC2 pass/fail history
5. **Inventory & Dispatch** — when added to inventory, when dispatched, to which customer
6. **Support** — support tickets raised for this unit

**Cost summary at bottom:**
- Base cost (from PO rate)
- Parts cost (sum of all parts used)
- Total cost of ownership

### 3.8 `FloorDashboardPage.jsx`

Accessible only to floor_manager, manager, admin roles.
Route: `/floor-pipeline/dashboard`

**Widgets:**
- 4 KPI cards: Total Active Tickets | In QC | Highlighted (⚠) | Sales Order Priority
- Stage distribution: Horizontal bar chart (recharts) — count per stage
- Technician load table: Technician | Active Tickets | Avg Resolution Time
- Parts alerts: Parts requested but not fulfilled (count + list)
- Recent completions: last 10 tickets moved to Inventory today
- QC fail rate: Pie chart — Pass vs Fail (last 30 days)

---

## SECTION 4 — FRONTEND: INVENTORY MANAGEMENT (enhancements)

### 4.1 Update `frontend/src/features/inventory-management/pages/InventoryListPage.jsx`

**Add to each inventory row:**
- TTSPL ID badge (monospace blue, clickable → opens TtsplHistoryDrawer)
- "Mark as Rental" / "Mark as Sales" tag button
  (calls `PATCH /api/inventory-management/:id/tag` with `{ tag: 'rental' | 'sales' }`)
- View full history button (drawer)

**Add summary stat cards at top:**
```
[QC Passed Available] [Currently Rented] [Sold] [In Repair] [In QC] [QC Failed]
```

**Add search by TTSPL ID** to the existing search bar.

### 4.2 Update `frontend/src/features/inventory-management/pages/ReadyToRentOrSellPage.jsx`

Add column: `Tagged As` showing Rental / Sales / Untagged badge.
Add bulk action: Select → Tag as Rental / Tag as Sales.

### 4.3 Add `PATCH /api/inventory-management/:id/tag` backend endpoint

In `backend/controllers/inventoryManagement/` add handler:
- Validates `tag` is `rental` or `sales`
- Updates `vendor_serial_numbers.extra` JSONB: `{ ..., inventory_tag: 'rental' }`
- Logs to `ttspl_audit_log` event_type `inventory_tagged`

---

## SECTION 5 — RBAC: SETTINGS PAGE UPDATES

### 5.1 Update `backend/migrations/056_phase2_floor_pipeline.sql` (already includes)

The migration above inserts all new permission_sections. No additional
migration needed — it's already in Section 1 of this prompt.

### 5.2 Update `frontend/src/config/menuConfig.js`

**Add floor pipeline to sidebar navigation:**

```javascript
// Add to MENU_GROUPS (after vendor management, before QC management):
{
  label: 'Floor Pipeline',
  icon: Wrench,
  section: 'floor_pipeline',
  children: [
    { label: 'Floor Dashboard', path: '/floor-pipeline/dashboard',
      section: 'floor_pipeline' },
    { label: 'All Tickets',     path: '/floor-pipeline/tickets',
      section: 'floor_pipeline' },
    { label: 'Chip Level Repair', path: '/floor-pipeline/tickets?stage=Chip+Level+Repair',
      section: 'chip_level_repair' },
    { label: 'Body & Paint',    path: '/floor-pipeline/tickets?stage=Body+%26+Paint',
      section: 'floor_pipeline' },
    { label: 'QC Queue',        path: '/floor-pipeline/tickets?stage=QC1,QC2',
      section: 'floor_pipeline' },
  ]
}
```

**Add to settingsAccordionChildren:**
```javascript
{ label: 'Floor Permissions', path: '/settings/role-permissions?filter=floor',
  section: 'role_permissions' }
```

### 5.3 Update `frontend/src/routes/settingsRoutes.jsx`

The existing RolePermissionsPage already shows all permission_sections.
Since we inserted new sections in migration 056, they will automatically
appear in the permissions matrix. No route change needed.

**BUT: verify that RolePermissionsPage fetches sections from API**
(not a hardcoded list). If it has a hardcoded list, update it to call
`GET /api/role-permissions/sections` and render dynamically.

### 5.4 Add new routes

In `frontend/src/routes/index.jsx` (or `appRoutes.js`), add:
```javascript
{ path: '/floor-pipeline/*',
  element: <ProtectedRoute section="floor_pipeline" action="view">
    <Layout><FloorPipelineApp /></Layout>
  </ProtectedRoute>
}
```

Import `FloorPipelineApp` from the new feature folder.

In `FloorPipelineApp.jsx` (nested React Router):
```javascript
<Routes>
  <Route index element={<FloorTicketListPage />} />
  <Route path="dashboard" element={<FloorDashboardPage />} />
  <Route path="tickets" element={<FloorTicketListPage />} />
  <Route path="tickets/:id" element={<TicketDetailPage />} />
</Routes>
```

---

## SECTION 6 — NOTIFICATION: HIGHLIGHTED TICKET ALERTS

When a ticket is marked `highlighted = true` (QC fail scenario), the system
must notify the assigned technician.

Add to `backend/services/emailQueueService.js` (or create a new function):
```javascript
async function sendHighlightedTicketAlert({ technicianEmail, technicianName,
  ttsplId, ticketId, reason }) {
  // Email subject: "⚠ Ticket [TTSPL-ID] needs your attention — [reason]"
  // Body: QC failed reason, link to ticket in CRM
  // Only send if SMTP is configured
}
```

Call from `ticketController.moveToStage` when highlighted is set to true.

---

## SECTION 7 — BUILD ORDER

Build in this exact order:

1. Run migration `056_phase2_floor_pipeline.sql`
2. Create `backend/services/ttsplAuditService.js`
3. Update `backend/controllers/ticketController.js` — new exports
4. Update `backend/routes/tickets.js` — new routes
5. Add `PATCH /api/inventory-management/:id/tag` endpoint
6. Create `frontend/src/features/floor-pipeline/floorPipelineApi.js`
7. Create `frontend/src/features/floor-pipeline/components/` — all 8 components
8. Create `frontend/src/features/floor-pipeline/pages/` — all 3 pages
9. Create `frontend/src/features/floor-pipeline/FloorPipelineApp.jsx`
10. Update `frontend/src/routes/index.jsx` — add floor pipeline routes
11. Update `frontend/src/config/menuConfig.js` — add Floor Pipeline section
12. Update `frontend/src/features/inventory-management/pages/InventoryListPage.jsx`
13. Update `frontend/src/features/inventory-management/pages/ReadyToRentOrSellPage.jsx`
14. Verify `RolePermissionsPage` is dynamic (not hardcoded sections)
15. Verify all new permission sections appear in Settings → Role Permissions

---

## SECTION 8 — QUALITY CHECKLIST

Before marking Phase 2 complete, verify each item:

**Database:**
- [ ] Migration 056 runs without errors
- [ ] `ttspl_config_history` table created
- [ ] `ttspl_audit_log` table created
- [ ] `stage_transition_rules` table created and seeded
- [ ] `Chip Level Repair` and `Body & Paint` stages exist in `stages` table
- [ ] New permission sections visible in Settings → Role Permissions matrix

**Backend:**
- [ ] `GET /api/tickets/ttspl/:ttsplId/history` returns audit log + config history
- [ ] `POST /api/tickets/:id/move-stage` enforces transition rules, sets highlighted
- [ ] `PATCH /api/tickets/:id/floor-manager-fail` restricted to floor_manager/admin
- [ ] `PATCH /api/tickets/:id/config` logs to ttspl_config_history
- [ ] QC1 fail → sends ticket back to Assembly & Software + sets highlighted = true
- [ ] QC2 fail → sends ticket back to QC1 + sets highlighted = true
- [ ] QC2 pass → sets ticket completed + vendor_serial qc_status = 'passed'
- [ ] Every part added to ticket → logged in ttspl_audit_log

**Frontend:**
- [ ] Kanban board shows all stages as columns
- [ ] Highlighted tickets show ⚠ warning banner in kanban card
- [ ] TicketDetailPage has all 9 tabs (7 base + Chip Repair if required + Body Paint if required)
- [ ] Stage action buttons are role-based (technician vs QC vs floor manager)
- [ ] TtsplHistoryDrawer shows full lifecycle from procurement to current state
- [ ] ConfigUpdateModal shows before/after diff and requires notes
- [ ] PartsRequestModal handles both available and unavailable parts
- [ ] FloorDashboardPage shows all 6 widgets
- [ ] Inventory pages show TTSPL badge + rental/sales tag
- [ ] Settings → Role Permissions shows floor_pipeline, floor_tickets,
      chip_level_repair, parts_inventory, ttspl_history sections
- [ ] All pages mobile-responsive at 375px
- [ ] Technician sees only their own tickets (role enforcement works)
- [ ] Floor manager sees all tickets + reassign + force-fail buttons

---

## SECTION 9 — NAMING REFERENCE (DO NOT DEVIATE)

| Concept               | Correct Name                        | Wrong (do not use)          |
|-----------------------|-------------------------------------|-----------------------------|
| Stage 1               | `Floor Manager`                     | Floor, Floor Mgr            |
| Stage 2               | `Diagnosis`                         | Diagnose, Diagnostic        |
| Stage 3               | `Assembly & Software`               | Assembly, Software           |
| Stage 4               | `Final Testing`                     | Final Test, Testing          |
| Stage 5               | `Chip Level Repair`                 | Chip Repair, Chip-Level      |
| Stage 6               | `Body & Paint`                      | Body Paint, Cosmetic         |
| Stage 7               | `QC1`                               | QC 1, Quality Check 1        |
| Stage 8               | `QC2`                               | QC 2, Quality Check 2        |
| Stage 9               | `Inventory`                         | Done, Complete, Warehouse    |
| Ticket type           | `grn_qc`                            | grn, qc_grn                  |
| Ticket type           | `sales_order_qc`                    | sales_qc, dispatch_qc        |
| Priority              | `sales_order`                       | Sales Order, urgent, priority|
| TTSPL prefix          | `TTSPL`                             | ttspl, TTSP                  |
| Config change type    | `upgrade`/`replacement`/`correction`| changed, modified            |
| Audit event           | `qc1_failed`/`qc2_failed`           | qc_fail, failed_qc           |
| Audit event           | `inventory_ready`                   | qc_passed, complete          |
| Permission section    | `floor_pipeline`                    | floor, floor_management      |
| Permission section    | `chip_level_repair`                 | chip_repair, chip             |
| Permission section    | `ttspl_history`                     | laptop_history, audit_trail   |

---

*End of Phase 2 prompt. Build Sections 1–6 in the order given in Section 7.*
*After completion, confirm each item in Section 8 checklist before moving to Phase 3.*
