# RENTFOXXY CRM — PHASE 9 BUILD PROMPT
## Floor Pipeline — Complete Rebuild + Bug Fixes
### Branch: new_crm_rentfoxxy

---

## AGENT RULES

- This phase fixes bugs and rebuilds the floor pipeline into a world-class
  ticket management system.
- Existing backend routes and controllers work — only add to them.
- All existing DB tables (tickets, stages, teams, work_logs, ticket_parts,
  diagnosis_results, diagnosis_parts_required, ttspl_audit_log,
  ttspl_config_history, stage_transition_rules) are correct — no schema
  changes needed, only two small ALTER TABLE additions.
- Design system: same as all previous phases.

---

## SECTION 1 — DATABASE

### Migration 071_phase9_floor_fixes.sql

```sql
-- 1. Add min_threshold to parts table (for low stock alerts)
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS min_threshold INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS description   TEXT,
  ADD COLUMN IF NOT EXISTS category      VARCHAR(100) DEFAULT 'general'
    CHECK (category IN ('ram','storage','display','battery','keyboard',
                        'motherboard','cooling','power','body','general','other'));

-- 2. Add cost tracking to ticket_parts (was missing, needed for reports)
ALTER TABLE ticket_parts
  ADD COLUMN IF NOT EXISTS unit_cost  NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_upgrade BOOLEAN DEFAULT FALSE;

-- 3. Update sm_document_sequences with ticket sequence if missing
INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('support_ticket', 0, 'TKT-')
ON CONFLICT (doc_type) DO NOTHING;
```

---

## SECTION 2 — BUG FIX: DiagnosisForm api prop

### Fix frontend/src/features/floor-pipeline/pages/TicketDetailPage.jsx

ROOT CAUSE: DiagnosisForm requires an `api` prop but TicketDetailPage
passes none. DiagnosisForm uses the old Laravel-parity api pattern.

FIX — change line 195 from:
  {tab === 'diagnosis' && <DiagnosisForm ticket={ticket} onComplete={load} />}
TO:
  {tab === 'diagnosis' && <DiagnosisForm api={api} ticket={ticket} onComplete={load} />}

Then add the api import at the top of TicketDetailPage.jsx:
  import api from '../../../utils/api';

This is a one-line fix. Verify it resolves the error.

---

## SECTION 3 — COMPLETE FLOOR PIPELINE ARCHITECTURE

### 3.1 The complete ticket lifecycle

```
GRN Receive
    │
    ▼
[TICKET CREATED] ─── ticket_type = 'grn_qc', priority = 'normal'
    │               OR ticket_type = 'sales_order_qc', priority = 'sales_order'
    │
    ▼
[Floor Manager stage]
    │  Floor Manager assigns to Hardware & Software TEAM (not a person yet)
    │  OR assigns directly to a specific technician
    │
    ▼
[Diagnosis stage] ─── Assigned to: one technician
    │  Technician fills DiagnosisForm (all hardware checks)
    │  If chip issue found → branch to [Chip Level Repair]
    │  If body issue only → branch to [Body & Paint]
    │  Normal → [Assembly & Software]
    │
    ▼
[Assembly & Software stage] ─── same technician OR reassigned
    │  Technician does repair work, installs OS, drivers
    │  Can add parts from inventory (updates ticket_parts + reduces parts.quantity)
    │  Config changes logged to ttspl_config_history
    │
    ▼
[Final Testing stage] ─── same technician
    │  All functional tests
    │
    ▼
[QC1 stage] ─── assigned to QC TEAM member (different from repair tech)
    │  QC1 checklist (hardware + software verification)
    │  PASS → [QC2]
    │  FAIL → back to [Assembly & Software], highlighted = true
    │
    ▼
[QC2 stage] ─── assigned to senior QC or QC lead
    │  Full re-verification
    │  PASS → [Inventory] — laptop is ready, qc_status = 'qc_passed'
    │  FAIL → back to [QC1], highlighted = true
    │
    ▼
[Inventory stage] ─── TICKET COMPLETE
    vendor_serial_numbers.qc_status = 'qc_passed'
    ttspl_audit_log event: 'inventory_ready'
```

### 3.2 Floor Manager assignment flow

When a ticket is in 'Floor Manager' stage, the floor manager sees it in their
queue. They can:
1. Assign to H&S TEAM → round-robin to next available technician
2. Assign directly to a specific technician
3. When QC stage is reached → system auto-assigns to QC team round-robin
   OR floor manager manually assigns to a QC technician

### 3.3 Sales Order QC ticket flow

When a DC is created and "Initiate Pre-Dispatch QC" is clicked:
- Creates ticket with ticket_type = 'sales_order_qc', priority = 'sales_order'
- Stage starts at 'Floor Manager' with the floor manager as assignee
- Floor manager sees red "Sales Order" badge — knows it's high priority
- They assign to QC team directly (skip repair stages since laptop already passed QC once)
- QC team runs the checklist, passes → DC can be dispatched

---

## SECTION 4 — BACKEND ADDITIONS

### 4.1 Add to backend/controllers/ticketController.js

**`exports.getFloorManagerQueue`**
GET /api/tickets/floor-manager-queue
Role: floor_manager, admin, manager

Returns tickets in 'Floor Manager' stage that need assignment:
```javascript
SELECT t.*, s.stage_name, vsn.ttspl_id, vsn.brand,
  vsn.extra->>'processor' AS processor,
  vsn.extra->>'ram' AS ram,
  vsn.extra->>'storage' AS storage
FROM tickets t
JOIN stages s ON s.stage_id = t.current_stage_id
LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id
WHERE s.stage_name = 'Floor Manager'
  AND t.status != 'completed'
ORDER BY
  CASE t.priority WHEN 'sales_order' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
  t.created_at ASC
```

**`exports.getTeamMembers`**
GET /api/tickets/team-members?team_name=Hardware+%26+Software
Returns users in a team with their current active ticket count:
```javascript
SELECT u.user_id, u.name, u.role,
  COUNT(t.ticket_id) FILTER (WHERE t.status = 'in_progress') AS active_tickets
FROM users u
JOIN teams tm ON tm.team_id = (SELECT team_id FROM teams WHERE team_name = $team_name)
-- NOTE: This assumes users have team membership. If not, return all technicians/qc users.
LEFT JOIN tickets t ON t.assigned_user_id = u.user_id AND t.status = 'in_progress'
WHERE u.role IN ('technician', 'floor_manager') -- or 'qc' for QC team
  AND u.active = true
GROUP BY u.user_id, u.name, u.role
ORDER BY active_tickets ASC
```

If the teams→users relationship doesn't have a direct join table, fall back to:
```javascript
SELECT u.user_id, u.name, u.role,
  COUNT(t.ticket_id) FILTER (WHERE t.status='in_progress') AS active_tickets
FROM users u
LEFT JOIN tickets t ON t.assigned_user_id = u.user_id AND t.status='in_progress'
WHERE u.role IN ($roles) AND u.active = true
GROUP BY u.user_id, u.name, u.role
ORDER BY active_tickets ASC
```

**`exports.addPartToTicketWithConfig`**
POST /api/tickets/:id/parts-with-config
Body: { part_id, quantity, notes, is_upgrade, config_field, old_value, new_value }

This extends the existing addPartToTicket to also:
1. Insert into ticket_parts (with unit_cost from parts.cost, is_upgrade)
2. Deduct from parts.quantity
3. If is_upgrade = true AND config_field provided:
   - Call ttsplAuditService.logConfigChange with changeType='upgrade'
   - Update vendor_serial_numbers.extra JSONB with new config value
4. Call ttsplAuditService.logTtsplEvent with eventType='parts_used'
5. Return: { ticket_part_id, new_parts_quantity, config_updated }

Add route:
  router.post('/:id/parts-with-config',
    authMiddleware,
    checkRole('technician','floor_manager','admin','manager'),
    ticketController.addPartToTicketWithConfig
  );

### 4.2 Update floorPipelineApi.js (frontend)

Add:
```javascript
export const getFloorManagerQueue = () =>
  api.get(`${base}/floor-manager-queue`);
export const getTeamMembers = (teamName) =>
  api.get(`${base}/team-members`, { params: { team_name: teamName } });
export const addPartWithConfig = (id, body) =>
  api.post(`${base}/${id}/parts-with-config`, body);
```

---

## SECTION 5 — FLOOR TICKET LIST PAGE (complete rebuild)

### 5.1 Complete rewrite of FloorTicketListPage.jsx

The current version works but needs two critical additions:
1. Hardware & Software grouping header in kanban
2. Better assignment workflow

KEEP all existing state, hooks, and API calls.
ADD these enhancements:

**KANBAN VIEW — add category groupings:**

The kanban columns should be visually grouped under section headers:

```
┌─────────────────────────────────────────────────────────────────────┐
│  FLOOR MANAGER                                                       │
│  [Floor Manager column]                                              │
├─────────────────────────────────────────────────────────────────────┤
│  HARDWARE & SOFTWARE                                                 │
│  [Diagnosis] [Assembly & Software] [Final Testing]                  │
│  [Chip Level Repair] [Body & Paint]                                 │
├─────────────────────────────────────────────────────────────────────┤
│  QUALITY CONTROL                                                     │
│  [QC1] [QC2]                                                        │
├─────────────────────────────────────────────────────────────────────┤
│  COMPLETE                                                            │
│  [Inventory]                                                        │
└─────────────────────────────────────────────────────────────────────┘
```

Implementation: wrap kanban columns in section dividers.
In the horizontal-scroll kanban container, insert labeled dividers between
stage groups. Use a thin vertical separator with a rotated label:

```jsx
const STAGE_GROUPS = [
  {
    label: 'FLOOR MANAGER',
    color: 'text-slate-500',
    stages: ['Floor Manager']
  },
  {
    label: 'HARDWARE & SOFTWARE',
    color: 'text-blue-600',
    stages: ['Diagnosis', 'Assembly & Software', 'Final Testing',
             'Chip Level Repair', 'Body & Paint']
  },
  {
    label: 'QUALITY CONTROL',
    color: 'text-indigo-600',
    stages: ['QC1', 'QC2']
  },
  {
    label: 'COMPLETE',
    color: 'text-green-600',
    stages: ['Inventory']
  }
];
```

Replace the flat KANBAN_STAGES.map() render with a STAGE_GROUPS.map() that:
1. Shows a group header div (text-xs uppercase tracking-wide colored label)
2. Then maps the stages within that group

**ADD: Floor Manager Assignment Panel**

When any ticket card in the "Floor Manager" column is clicked, instead of
navigating to ticket detail immediately, show an assignment panel FIRST
if the user is floor_manager/admin:

```
Slide-up modal or inline panel:
Title: "Assign Ticket — TTSPL001"
Subtitle: Dell i5 10th | 8GB | 256GB | Priority: Sales Order

Who to assign to?

[Hardware & Software Team] tab  |  [QC Team] tab

Team members list (from getTeamMembers API):
  👤 Ravi Kumar        — 2 active tickets   [Assign]
  👤 Priya Sharma      — 1 active ticket    [Assign]
  👤 Suresh Verma      — 0 active tickets   [Assign ★ recommended]

OR: Assign to QC Directly (for sales_order_qc tickets)
  👤 QC Member 1       — 1 active ticket   [Assign]

[Cancel]
```

On "Assign" click:
- Calls POST /api/tickets/:id/assign with { user_id, team_id }
- On success: refreshes ticket list, shows toast "Assigned to [name]"
- Ticket moves from Floor Manager column to the stage of that technician's team

### 5.2 TABLE VIEW enhancements

Add column: "Stage Category" showing Hardware & Software / QC Team badge.

---

## SECTION 6 — TICKET DETAIL PAGE (complete rebuild)

File: frontend/src/features/floor-pipeline/pages/TicketDetailPage.jsx

This is the most important page. Rebuild it completely with this structure:

### 6.1 Page layout

```
┌─ HEADER BAR ────────────────────────────────────────────────────────┐
│ ← Back  |  #TICKET-123  TTSPL001  [stage badge]  [priority badge]  │
│ Dell i5 10th Gen | 8GB | 256GB SSD                                  │
└────────────────────────────────────────────────────────────────────┘

┌─ MAIN (65%) ─────────────────┐  ┌─ SIDEBAR (35%) ──────────────────┐
│                              │  │                                   │
│  [TAB BAR]                   │  │  TTSPL Info                       │
│                              │  │  TTSPL001 · Dell Latitude         │
│  [TAB CONTENT]               │  │  i5 10th | 8GB | 256 SSD          │
│                              │  │  Condition: Minor scratches        │
│                              │  │  PO: PO-0023 (Rental)             │
│                              │  │  Vendor: ABC Laptops               │
│                              │  │                                   │
│                              │  │  Current Assignment               │
│                              │  │  Stage: Diagnosis                 │
│                              │  │  Team: Hardware & Software        │
│                              │  │  Assigned: Ravi Kumar             │
│                              │  │  [Reassign] (floor manager only)  │
│                              │  │                                   │
│                              │  │  STAGE ACTIONS                    │
│                              │  │  [role-based buttons]             │
│                              │  │                                   │
│                              │  │  QC Fail History                  │
│                              │  │  (shown if qc_fail_count > 0)     │
└──────────────────────────────┘  └───────────────────────────────────┘
```

### 6.2 Tab structure (role-based)

```
Always visible:
  Overview | Work Log | Parts & Config | TTSPL History

Shown when in Diagnosis stage:
  Diagnosis (shows DiagnosisForm — WITH api prop fix)

Shown when in Assembly/Final/Chip/Body stages:
  Work Notes (technician log their work)

Shown when in QC1 or QC2 stage:
  QC Checklist

Shown if chip_repair_required:
  Chip Repair

Shown if body_paint_required:
  Body & Paint
```

### 6.3 Tab 1: Overview

```
Two-column grid:

Left column:
  Ticket Details card:
    Ticket ID | Created | Status | Priority
    Ticket Type (GRN QC / Sales Order QC)
    Sales Order # (if sales_order_qc)
    QC Fails: N (red if > 0)
    Highlighted: ⚠ [reason] (amber banner if highlighted = true)

  Stage Timeline card:
    Vertical timeline of all stages this ticket has been through:
    Each entry: Stage name | Entered | Exited | Duration | Technician
    Current stage highlighted in blue

Right column:
  Activity Feed (last 5 events):
    [datetime] [actor] [description]
    Link: "View full work log →"
```

### 6.4 Tab 2: Work Log

Chronological feed of all activity on this ticket.
Data: from work_logs joined with ttspl_audit_log for this ticket.

Each entry shows:
```
[icon] [relative time]  ·  [actor name]
[description]
[stage badge]  [event type badge]
```

Event types with icons:
  stage_changed: ArrowRight (blue)
  parts_used: Package (amber)
  config_updated: Settings (purple)
  qc1_failed: XCircle (red)
  qc2_failed: XCircle (red)
  qc1_passed: CheckCircle (green)
  qc2_passed: CheckCircle (green)
  assigned: User (gray)
  note_added: MessageSquare (gray)

Load from: GET /api/tickets/ttspl/:ttsplId/history (existing endpoint)
Combined with ticket's work_logs.

### 6.5 Tab 3: Parts & Config (NEW — most important tab)

This tab has two sub-sections:

**Sub-section A: Attach Part / Config Update**

```
"Add Part Used"
  Search parts inventory: [search input → autocomplete]
  Select part from results: shows Part Name | Category | Available: N | Unit Cost
  
  Fields:
    Quantity*: number (min 1, max available qty)
    
    Is this an upgrade? [toggle]
    
    If upgrade = YES, show:
      What did this replace?
      Config Field*: dropdown [RAM | Storage | Processor | GPU | Screen | OS | Other]
      Old Value: [pre-filled from current config if possible]
      New Value*: [text input]
      
    Notes: textarea (optional)
    
  [Attach Part] button

  On submit: calls POST /api/tickets/:id/parts-with-config
    If is_upgrade: also shows in Config History tab
    Shows toast: "Part attached. Stock updated: [part_name] — [N remaining]"
```

**Sub-section B: Config History table**

```
Table from ttspl_config_history for this TTSPL ID:

Columns:
  Date | Changed By | Field | Before | After | Type | Part Used | Cost

  Type badge: upgrade (green) | replacement (amber) | correction (gray)
  Part Used: part name if linked, else "—"
  Cost: ₹XXX if part has cost, else "—"

Empty state: "No config changes recorded"

Below table:
  Current Config summary:
    Processor: [value]
    RAM: [value]
    Storage: [value]
    GPU: [value]
    OS: [value]
```

**Sub-section C: Parts Used on this ticket**

```
Table from ticket_parts for this ticket_id:

Columns:
  Part Name | Category | Quantity | Unit Cost | Total Cost | Upgrade? | Added By | Date

  Upgrade badge: green "✓ Upgrade" if is_upgrade
  Total Cost: quantity × unit_cost

Summary row: Total parts cost: ₹X,XXX
```

### 6.6 Tab 4: Diagnosis (only in Diagnosis stage)

Keep existing DiagnosisForm component.
FIX: pass api prop: <DiagnosisForm api={api} ticket={ticket} onComplete={load} />

The DiagnosisForm already handles:
- All hardware section checkboxes (Power, Display, Keyboard, Battery, etc.)
- Parts required section
- Image upload
- Submit / save draft

No changes needed inside DiagnosisForm itself — just pass the api prop.

### 6.7 Tab 5: Work Notes (Assembly/Final/Chip/Body stages)

Simple work log entry form for technicians:

```
"Log work done"
  What did you do?*: textarea (min 20 chars)
  Time spent: [hours] h [minutes] m (optional)
  [Add Note] button

  On submit: POST /api/tickets/:id/log-note
    body: { note_text, time_spent_minutes }
    → Inserts into ttspl_audit_log: event_type='note_added', description=note_text
    → Returns updated activity feed

Work Notes History:
  List of notes already logged, newest first.
  Each: datetime | technician | note text
```

Add backend endpoint:
POST /api/tickets/:id/log-note
```javascript
exports.logNote = async (req, res) => {
  const { note_text, time_spent_minutes } = req.body;
  if (!note_text?.trim() || note_text.length < 3) {
    return res.status(400).json({ message: 'Note text required' });
  }
  const ticket = await pool.query('SELECT * FROM tickets WHERE ticket_id=$1',[req.params.id]);
  if (!ticket.rows.length) return res.status(404).json({message:'Not found'});
  const t = ticket.rows[0];
  await ttsplAuditService.logTtsplEvent({
    ttsplId: t.ttspl_id,
    vendorSerialId: t.vendor_serial_id,
    eventType: 'note_added',
    description: note_text,
    metadata: { time_spent_minutes: time_spent_minutes || null },
    actorUserId: req.user.user_id,
    actorName: req.user.name,
  });
  res.json({ success: true });
};
```

Add route:
  router.post('/:id/log-note', authMiddleware, ticketController.logNote);

### 6.8 Tab 6: QC Checklist (QC1/QC2 stages)

Keep existing QcChecklistPanel component. No changes needed.
The panel already handles pass/fail with reason.

### 6.9 Sidebar: Stage Action Buttons

Based on current stage AND user role:

**If Floor Manager stage + role is floor_manager/admin:**
```
[Assign to Technician] button (blue, full width)
→ Opens assignment modal (Section 5.1)
```

**If Diagnosis stage + role is technician/floor_manager:**
```
[Move to Assembly & Software] button (blue)
[Mark Chip Repair Required] button (amber) — if chip issue in diagnosis
[Mark Body & Paint Required] button (pink) — if body issue
```

**If Assembly & Software / Final Testing + role is technician/floor_manager:**
```
[Move to Next Stage] button (blue)
  → Assembly & Software → Final Testing
  → Final Testing → QC1
```

**If Chip Level Repair / Body & Paint + role is technician/floor_manager:**
```
[Complete — Move to Assembly & Software] button (blue)
```

**If QC1 stage + role is qc/floor_manager/admin:**
```
[QC1 PASS — Move to QC2] button (green, large)
[QC1 FAIL — Send back] button (red, requires reason input)
```

**If QC2 stage + role is qc/floor_manager/admin:**
```
[QC2 PASS — Mark Inventory Ready] button (green, large)
[QC2 FAIL — Send back to QC1] button (red, requires reason input)
```

**Floor Manager override (any stage, role = floor_manager/admin):**
```
[Force Fail — Return to Vendor] button (dark red, destructive)
→ Confirmation dialog → reason required
[Reassign Technician] button
```

**QC Fail reason modal:**
```
Modal: "QC Failed — Reason Required"
Reason for failure*: textarea (min 10 chars)
  Examples shown: "RAM mismatch (expected 8GB, found 4GB)"
                  "Display has dead pixel at bottom right"
                  "Battery health below 60%"
[Cancel] [Confirm Fail]
```

---

## SECTION 7 — FLOOR DASHBOARD PAGE (enhance)

File: frontend/src/features/floor-pipeline/pages/FloorDashboardPage.jsx

ADD: "Floor Manager Queue" widget at the top.

```
"Needs Assignment" section (shown only to floor_manager/admin):

Fetches GET /api/tickets/floor-manager-queue

If empty: green banner "All tickets assigned"
If has items: amber banner with count + table

Table:
  TTSPL ID | Brand/Config | Priority | Created | Ticket Type | [Assign Now] button

[Assign Now] → opens assignment modal inline
```

Existing dashboard widgets (stage bar chart, technician load, QC fail rate) — keep as-is.

---

## SECTION 8 — TTSPL HISTORY DRAWER (enhance Parts display)

File: frontend/src/features/floor-pipeline/components/TtsplHistoryDrawer.jsx

ADD a new "Parts & Cost" section in the drawer:

After the timeline, show:
```
Parts & Upgrades
  Table from ttspl_config_history:
    Date | Change Type | Field | Before → After | Cost
  
  Cost Summary:
    Base cost (from PO rate): ₹X,XXX
    Parts cost (all ticket_parts): ₹X,XXX
    Total cost of ownership: ₹X,XXX
```

This requires one additional API call:
GET /api/tickets/ttspl/:ttsplId/history already returns configHistory.
The parts cost can be calculated from configHistory[].part_cost.
Add base cost from vendor_serial_numbers.vendor_purchase_order.unit_price.

In backend getTtsplHistory, add:
```javascript
// Also fetch parts total cost
const costRes = await pool.query(
  `SELECT
     COALESCE(SUM(tp.quantity_used * tp.unit_cost), 0) AS parts_cost,
     COALESCE(vpo.unit_price, 0) AS base_cost
   FROM vendor_serial_numbers vsn
   LEFT JOIN tickets t ON t.vendor_serial_id = vsn.serial_id
   LEFT JOIN ticket_parts tp ON tp.ticket_id = t.ticket_id
   LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
   WHERE vsn.ttspl_id = $1
   GROUP BY vpo.unit_price`,
  [ttsplId]
);
return {
  auditLog: auditRes.rows,
  configHistory: configRes.rows,
  costSummary: costRes.rows[0] || { parts_cost: 0, base_cost: 0 }
};
```

---

## SECTION 9 — TECHNICIAN REPORTS (enhance)

The existing Reports component (/reports/technician) calls
GET /api/reports/technician-performance which is already comprehensive.
It tracks: work_logs with start_time/end_time per stage per technician.

ADD to reportsController.getTechnicianPerformance response:
- parts_used_count per technician (from ticket_parts joined with work_logs)
- upgrades_done count (ticket_parts WHERE is_upgrade = true)

This adds two lines to the existing SQL:
```sql
COUNT(DISTINCT tp.id) AS parts_used_count,
COUNT(DISTINCT tp.id) FILTER (WHERE tp.is_upgrade = true) AS upgrades_done
```
Joined via:
```sql
LEFT JOIN ticket_parts tp ON tp.ticket_id = wl.ticket_id
  AND tp.added_at BETWEEN wl.start_time AND COALESCE(wl.end_time, NOW())
```

ADD to TechnicianReportPage.jsx: show these two new columns in the table.

---

## SECTION 10 — BUILD ORDER

1. Run migration 071_phase9_floor_fixes.sql
2. FIX TicketDetailPage.jsx — add api import + pass api prop to DiagnosisForm (ONE LINE FIX)
3. Add getFloorManagerQueue to ticketController.js
4. Add getTeamMembers to ticketController.js
5. Add addPartToTicketWithConfig to ticketController.js
6. Add logNote to ticketController.js
7. Add all 4 new routes to backend/routes/tickets.js
8. Add getTtsplHistory cost summary to ticketPhase2Controller.js
9. Update floorPipelineApi.js — add 3 new functions
10. Rebuild FloorTicketListPage.jsx — add STAGE_GROUPS grouping + assignment modal
11. Rebuild TicketDetailPage.jsx — all 6 tabs, sidebar, role-based actions
12. Enhance FloorDashboardPage.jsx — add Floor Manager Queue widget
13. Enhance TtsplHistoryDrawer.jsx — add Parts & Cost section
14. Update TechnicianReportPage.jsx — show parts_used + upgrades columns
15. Update reportsController getTechnicianPerformance SQL — add parts stats

---

## SECTION 11 — QUALITY CHECKLIST

Bug fix:
  [ ] /floor-pipeline/tickets/:id → Diagnosis tab — NO error "Cannot read properties of undefined"
  [ ] DiagnosisForm loads existing diagnosis data correctly
  [ ] DiagnosisForm can be submitted/saved

Floor Pipeline UI:
  [ ] Kanban shows 4 grouped sections (Floor Manager / HW&SW / QC / Complete)
  [ ] Each section has colored label header
  [ ] Hardware & Software group shows: Diagnosis, Assembly & Software,
      Final Testing, Chip Level Repair, Body & Paint columns
  [ ] QC group shows QC1, QC2 columns with indigo styling
  [ ] Assignment modal opens when clicking ticket in Floor Manager column (if floor_manager role)
  [ ] Team members list shows active ticket count
  [ ] Assigning → ticket moves to next stage, toast shows

Ticket Detail:
  [ ] Tab 3 (Parts & Config) loads correctly — no errors
  [ ] Search parts autocomplete works (calls /api/parts with search param)
  [ ] Attach part: quantity validated against available stock
  [ ] Attach part with is_upgrade = true: shows config fields
  [ ] On submit: ttspl_config_history record created, vendor_serial config updated
  [ ] Parts Used table shows all parts with total cost
  [ ] Config History table shows before/after values
  [ ] Work Notes tab: add note → appears in work log immediately
  [ ] Stage action buttons correct per role + stage
  [ ] QC Fail: reason modal appears, reason required, highlighted=true set
  [ ] Floor Manager Force Fail: confirmation dialog, sets qc_failed_return_vendor

TTSPL History:
  [ ] Drawer shows Parts & Cost section
  [ ] Cost summary: base cost + parts cost + total
  [ ] All lifecycle events shown in order

Technician Report:
  [ ] New columns visible: Parts Used | Upgrades Done

---

## SECTION 12 — NAMING REFERENCE

  Stage groups in kanban:     STAGE_GROUPS (not KANBAN_GROUPS)
  Assignment modal:           AssignmentModal (not AssignModal)
  Parts tab name:             'parts' (id) / 'Parts & Config' (label)
  Work notes tab name:        'notes' (id) / 'Work Notes' (label)
  New API endpoint:           POST /api/tickets/:id/parts-with-config
  New API endpoint:           POST /api/tickets/:id/log-note
  New API endpoint:           GET /api/tickets/floor-manager-queue
  New API endpoint:           GET /api/tickets/team-members
  Config change type values:  upgrade | replacement | correction | initial
  Parts is_upgrade flag:      is_upgrade (boolean, default false)
  Unit cost column:           unit_cost (on ticket_parts)
  Cost summary response key:  costSummary: { parts_cost, base_cost }
