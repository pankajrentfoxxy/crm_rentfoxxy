# RENTFOXXY CRM — PHASE 12 BUILD PROMPT
## Task 1: Dispatch QC Stage | Task 2: Full Config Header
## Task 3: Stage Task Submit Fix | Task 4: Inline Lead Status Update
### Branch: new_crm_rentfoxxy

---

## AGENT RULES — READ FIRST

- This phase has FOUR independent tasks. Build in order 1→4.
- Do NOT change existing stage flows for grn_qc tickets.
- Do NOT change stage_transition_rules for QC1→QC2 or QC2→Inventory paths.
- Design system: same as all previous phases.
- All DB changes must be additive (IF NOT EXISTS / ON CONFLICT DO NOTHING).

---

## TASK 1 — DISPATCH QC STAGE (for Sales Order laptops only)

### Business rule
When a Sales Order laptop is attached (via sales_order_serials) and a
pre-dispatch QC ticket is created (ticket_type = 'sales_order_qc'), that
ticket must go through a SEPARATE "Dispatch QC" stage instead of QC2.

Flow for sales_order_qc tickets:
  Floor Manager → Diagnosis → Assembly & Software → Final Testing
  → QC1 → Dispatch QC → [PASS: laptop is QC-passed, DC can be generated]
                       → [FAIL: back to Assembly & Software, highlighted]

Flow for grn_qc tickets (UNCHANGED):
  Floor Manager → Diagnosis → Assembly & Software → Final Testing
  → QC1 → QC2 → Inventory

### 1A — Migration: 082_dispatch_qc_stage.sql

```sql
-- ============================================================
-- Migration 082: Add Dispatch QC stage and team
-- Only used for sales_order_qc tickets
-- ============================================================

-- 1. Create Dispatch QC team
INSERT INTO teams (team_name)
VALUES ('Dispatch QC Team')
ON CONFLICT DO NOTHING;

-- 2. Add Dispatch QC stage (between QC1 and Inventory, order 10.5)
INSERT INTO stages (stage_name, stage_order, stage_category, team_id, description)
SELECT 'Dispatch QC', 10,
  'QC Team',
  (SELECT team_id FROM teams WHERE team_name = 'Dispatch QC Team' LIMIT 1),
  'Final QC before Sales Order dispatch. Only for sales_order_qc tickets.'
WHERE NOT EXISTS (SELECT 1 FROM stages WHERE stage_name = 'Dispatch QC');

-- Fix order: Dispatch QC sits at 10, QC2 stays at 10, Inventory at 11
-- (stage_order is for display only, not enforced as unique)

-- 3. Stage transition rules for Dispatch QC
INSERT INTO stage_transition_rules (from_stage_name, to_stage_name, condition, is_backward, notes)
VALUES
  ('QC1',          'Dispatch QC',           'qc1_passed_so',   false, 'QC1 passed — sales_order_qc goes to Dispatch QC'),
  ('Dispatch QC',  'Inventory',             'dispatch_qc_passed', false, 'Dispatch QC passed — DC can be generated'),
  ('Dispatch QC',  'Assembly & Software',   'dispatch_qc_failed', true, 'Dispatch QC failed — back to tech')
ON CONFLICT (from_stage_name, to_stage_name) DO NOTHING;

-- 4. QC round-robin state for Dispatch QC team
INSERT INTO qc_round_robin_state (team_id, last_assigned_user_id)
SELECT team_id, NULL FROM teams WHERE team_name = 'Dispatch QC Team'
ON CONFLICT (team_id) DO NOTHING;

-- 5. Permission for Dispatch QC team members
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('qc', 'floor_pipeline', true, false, true, false),
  ('qc', 'floor_tickets',  true, false, true, false)
ON CONFLICT (role, section) DO NOTHING;
```

### 1B — Backend: ticketPhase2Controller.js

Find the `ROUND_ROBIN_TRANSITIONS` Set and `moveToStage` logic.

**Update the conditionHint block** to handle QC1 for sales_order_qc:

```javascript
// BEFORE (existing):
if (currentStageName === 'QC1' && to_stage_name === 'QC2') conditionHint = 'qc1_passed';

// AFTER — split by ticket type:
if (currentStageName === 'QC1' && to_stage_name === 'QC2') conditionHint = 'qc1_passed';
if (currentStageName === 'QC1' && to_stage_name === 'Dispatch QC') conditionHint = 'qc1_passed_so';
if (currentStageName === 'Dispatch QC' && to_stage_name === 'Inventory') conditionHint = 'dispatch_qc_passed';
if (currentStageName === 'Dispatch QC' && to_stage_name === 'Assembly & Software') conditionHint = 'dispatch_qc_failed';
```

**Update ROUND_ROBIN_TRANSITIONS** to include Dispatch QC:
```javascript
const ROUND_ROBIN_TRANSITIONS = new Set([
  'Final Testing→QC1',
  'QC1→QC2',          // grn_qc only
  'QC1→Dispatch QC',  // sales_order_qc only — NEW
  'QC2→QC1',
  'Dispatch QC→Assembly & Software',  // fail path — NEW
]);
```

**Update KEEP_SAME_TECH_TRANSITIONS**:
```javascript
const KEEP_SAME_TECH_TRANSITIONS = new Set([
  'Diagnosis→Assembly & Software',
  'Assembly & Software→Final Testing',
  'Chip Level Repair→Assembly & Software',
  'Body & Paint→Assembly & Software',
  'QC1→Assembly & Software',
  'Dispatch QC→Assembly & Software',  // fail — keep same tech — NEW
]);
```

**Update the `to_stage_name === 'Inventory'` completion block**:
The existing block at line ~334 handles ticket completion when moving to Inventory.
It already handles both grn_qc and sales_order_qc.
Add Dispatch QC pass handling:

```javascript
// Add inside the if (to_stage_name === 'Inventory') block,
// alongside the existing sales_order_qc handling:
if (ticket.ticket_type === 'sales_order_qc') {
  // Update dc_qc_tickets and pre_dispatch_qc_passed — existing code
  // ADD: also update sales_order_serials
  await client.query(
    `UPDATE sales_order_serials SET qc_status = 'passed', updated_at = NOW()
     WHERE qc_ticket_id = $1`,
    [ticket.ticket_id]
  );
}
```

**Add Dispatch QC fail highlighting**:
```javascript
// In the fail condition checks block:
if (currentStageName === 'Dispatch QC' && to_stage_name === 'Assembly & Software') {
  const reason = req.body.reason?.trim() || '';
  if (!reason || reason.length < 5) {
    return res.status(400).json({ success: false, message: 'Dispatch QC fail reason is required' });
  }
  highlighted = true;
  highlightedReason = `Dispatch QC failed: ${reason}`;
}
```

**Key routing logic** — when QC1 moves "next", route based on ticket_type:

Find the block that handles `QC1 → QC2` and change:
```javascript
// EXISTING: QC1 → QC2 for all tickets
// REPLACE: route based on ticket_type
if (currentStageName === 'QC1') {
  if (ticket.ticket_type === 'sales_order_qc') {
    // Sales order laptops: QC1 → Dispatch QC
    // to_stage_name should be 'Dispatch QC'
    // Already handled by ROUND_ROBIN_TRANSITIONS above
  } else {
    // GRN laptops: QC1 → QC2 (existing flow)
  }
}
```

Note: The routing is handled automatically because:
- Frontend sends the correct `to_stage_name` ('QC2' vs 'Dispatch QC')
- Backend validates via stage_transition_rules
- Round-robin assigns to the correct team

### 1C — Backend: ticketController.js (getTicket)

Add `ticket.ticket_type` to be included in the getTicket SELECT so the
frontend knows which path to show.

The current SELECT already does `t.*` so ticket_type is already returned.
Verify it's being returned by checking the ticket object in the response.

### 1D — Frontend: TicketDetailPage.jsx

**Update QC1 stage buttons** to route based on ticket_type:

```javascript
// CURRENT (line ~278):
if ((qc || fm) && stage === 'QC1') {
  stageButtons.push(
    { label: 'QC1 PASS — Move to QC2', action: () => move('QC2'), success: true },
    { label: 'QC1 FAIL — Send back', action: () => move('Assembly & Software', failReason), danger: true, needsReason: true }
  );
}

// REPLACE WITH:
if ((qc || fm) && stage === 'QC1') {
  const nextQcStage = ticket.ticket_type === 'sales_order_qc' ? 'Dispatch QC' : 'QC2';
  const nextLabel = ticket.ticket_type === 'sales_order_qc'
    ? 'QC1 PASS — Move to Dispatch QC'
    : 'QC1 PASS — Move to QC2';
  stageButtons.push(
    { label: nextLabel, action: () => move(nextQcStage), success: true },
    { label: 'QC1 FAIL — Send back', action: () => move('Assembly & Software', failReason), danger: true, needsReason: true }
  );
}

// ADD Dispatch QC stage buttons (new):
if ((qc || fm) && stage === 'Dispatch QC') {
  stageButtons.push(
    { label: 'DISPATCH QC PASS — Laptop Ready for DC', action: () => move('Inventory'), success: true },
    { label: 'DISPATCH QC FAIL — Send back to tech', action: () => move('Assembly & Software', failReason), danger: true, needsReason: true }
  );
}
```

Also add 'Dispatch QC' to TIMED_WORK_STAGES and QC_STAGES constants:
```javascript
const TIMED_WORK_STAGES = [
  'Diagnosis', 'Assembly & Software', 'Final Testing',
  'Chip Level Repair', 'Body & Paint', 'QC1', 'QC2', 'Dispatch QC'  // add Dispatch QC
];
```

And in the tab logic:
```javascript
else if (['QC1', 'QC2', 'Dispatch QC'].includes(stage))
  taskTab = { id: 'qc', label: 'QC Checklist' };
```

**Show Sales Order badge on ticket** when ticket_type === 'sales_order_qc':

In the ticket header bar, alongside the priority badge, add:
```jsx
{ticket.ticket_type === 'sales_order_qc' && (
  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 border border-orange-200">
    📦 Sales Order
  </span>
)}
```

**Show "Dispatch QC" label in kanban** — update STAGE_GROUPS in floorPipelineUi.js:

In the STAGE_GROUPS array, add 'Dispatch QC' to the QC group:
```javascript
{
  label: 'QUALITY CONTROL',
  color: 'text-indigo-600',
  stages: ['QC1', 'QC2', 'Dispatch QC']
}
```

Add column styling for Dispatch QC in STAGE_COLUMN_STYLE:
```javascript
'Dispatch QC': 'border-orange-200 bg-orange-50',
```

### 1E — Settings: add Dispatch QC Team to user management

In UserManagementPage.jsx, the FLOOR_ROLES that show team picker include 'qc'.
The team picker fetches from GET /api/auth/teams which reads the teams table.
'Dispatch QC Team' will automatically appear after migration 082 runs.
No frontend changes needed for this — teams are fetched dynamically.

---

## TASK 2 — FULL CONFIG IN TICKET HEADER

### 2A — Backend: ticketController.js getTicket query

The getTicket SELECT does `t.*` but the tickets table only has:
`brand, model, processor, ram, storage`

`gpu`, `screen_size`, `generation`, `os` are in `vendor_serial_numbers.extra` JSONB.

Update the getTicket query to JOIN vendor_serial_numbers and extract all config:

```javascript
// CURRENT (around line 328):
`SELECT t.*,
        s.stage_name, s.stage_order,
        tm.team_name,
        u.name as assigned_user_name
 FROM tickets t
 LEFT JOIN stages s ON t.current_stage_id = s.stage_id
 LEFT JOIN teams tm ON t.assigned_team_id = tm.team_id
 LEFT JOIN users u ON t.assigned_user_id = u.user_id
 WHERE t.ticket_id = $1`

// REPLACE WITH:
`SELECT t.*,
        s.stage_name, s.stage_order,
        tm.team_name,
        u.name as assigned_user_name,
        -- Extended config from vendor_serial_numbers
        COALESCE(vsn.extra->>'gpu',          t.model)         AS gpu,
        COALESCE(vsn.extra->>'screen_size',  '')              AS screen_size,
        COALESCE(vsn.extra->>'generation',   '')              AS generation,
        COALESCE(vsn.extra->>'os',           '')              AS os,
        COALESCE(vsn.extra->>'model',        t.model)         AS model_name,
        COALESCE(vsn.extra->>'condition',    '')              AS condition,
        COALESCE(vsn.inventory_asset_code,   t.ttspl_id)      AS ttspl_display,
        vsn.extra                                             AS vsn_extra
 FROM tickets t
 LEFT JOIN stages s ON t.current_stage_id = s.stage_id
 LEFT JOIN teams tm ON t.assigned_team_id = tm.team_id
 LEFT JOIN users u ON t.assigned_user_id = u.user_id
 LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id
 WHERE t.ticket_id = $1`
```

### 2B — Frontend: floorPipelineUi.js — update configSummary

```javascript
// CURRENT:
export function configSummary(ticket) {
  const parts = [
    ticket.brand,
    ticket.processor,
    ticket.ram ? `${ticket.ram} RAM` : null,
    ticket.storage
  ].filter(Boolean);
  return parts.join(' | ') || '—';
}

// REPLACE WITH:
export function configSummary(ticket) {
  const parts = [
    ticket.brand,
    ticket.model_name || ticket.model || null,
    ticket.processor,
    ticket.generation || null,
    ticket.ram  ? `${ticket.ram} RAM`     : null,
    ticket.storage || null,
    ticket.gpu && ticket.gpu !== 'Integrated' ? ticket.gpu : null,
    ticket.screen_size ? `${ticket.screen_size}"` : null,
    ticket.os  ? `OS: ${ticket.os}` : null,
  ].filter(Boolean);
  return parts.join(' | ') || '—';
}

// Also add a configBadges function for richer display:
export function configBadges(ticket) {
  return [
    { label: 'Brand',      value: ticket.brand },
    { label: 'Model',      value: ticket.model_name || ticket.model },
    { label: 'CPU',        value: [ticket.processor, ticket.generation].filter(Boolean).join(' ') },
    { label: 'RAM',        value: ticket.ram },
    { label: 'Storage',    value: ticket.storage },
    { label: 'GPU',        value: ticket.gpu },
    { label: 'Screen',     value: ticket.screen_size ? `${ticket.screen_size}"` : null },
    { label: 'OS',         value: ticket.os },
    { label: 'Condition',  value: ticket.condition },
  ].filter((b) => b.value);
}
```

### 2C — Frontend: TicketDetailPage.jsx — update header bar

Import `configBadges` from floorPipelineUi.

Replace the current single-line config display in the header:
```jsx
// CURRENT (line ~305):
<span className="text-sm text-slate-600 hidden sm:inline">{configSummary(ticket)}</span>

// REPLACE WITH a chip-row layout:
<div className="flex flex-wrap gap-1 mt-1">
  {configBadges(ticket).map((b) => (
    <span key={b.label}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs">
      <span className="text-slate-400 text-[10px] uppercase tracking-wide">{b.label}:</span>
      <span className="font-medium">{b.value}</span>
    </span>
  ))}
</div>
```

Also update the right sidebar TTSPL Info section:
```jsx
// Replace the single-line configSummary with the same chip row:
<div className="flex flex-col gap-1.5">
  <p className="font-mono font-bold text-blue-700 text-sm">{ticket.ttspl_display || ticket.ttspl_id || '—'}</p>
  <div className="flex flex-wrap gap-1">
    {configBadges(ticket).map((b) => (
      <span key={b.label} className="text-xs text-slate-600">
        <span className="text-slate-400">{b.label}:</span> {b.value}
      </span>
    )).reduce((acc, el, i) => i === 0 ? [el] : [...acc, <span key={`sep-${i}`} className="text-slate-300">·</span>, el], [])}
  </div>
</div>
```

Also update TicketCard.jsx to show generation alongside processor:
```javascript
// In the config line of the card, use configSummary(ticket) which now includes generation
// No change needed if configSummary is already imported and used.
```

---

## TASK 3 — FIX STAGE TASK SUBMIT (Assembly & Software, Final Testing)

### Root cause analysis

`StageTaskPanel` calls `saveStageTask` (saves checklist to DB) then calls
`onSubmitted()` which calls `load()` (refreshes ticket data). It does NOT
move the ticket to the next stage. The "Move to next stage" button is in the
right sidebar.

The issue: when the user clicks "Move to Final Testing" from Assembly & Software,
`move('Final Testing')` is called. This calls `moveTicketStage` (POST
/api/tickets/:id/move-stage) → ticketPhase2Controller.moveToStage.

The moveToStage validates via `validateTransition('Assembly & Software', 'Final Testing', conditionHint)`.

The conditionHint is undefined (no conditionHint is set for this transition).
The rule in DB: `('Assembly & Software', 'Final Testing', NULL, false, 'Normal flow')`
The validation: `if (conditionHint && rule.condition && rule.condition !== conditionHint)` —
since conditionHint is falsy, this passes. So the DB rule check should be OK.

**Most likely real cause**: The `needsStart` check shows the verify screen,
and after the user starts work (timer running), the stage buttons appear.
BUT the buttons call `move()` which calls `moveTicketStage`. If the work timer
is STILL RUNNING (activeLog exists), the backend may be checking for that.

Check ticketPhase2Controller.moveToStage for any work-timer block:

```javascript
// In ticketPhase2Controller.js, at the start of moveToStage exports:
// CHECK if there is any code like:
// if (activeLog && !completed) return error...
// This would block the move if timer is running
```

**Fix in backend ticketPhase2Controller.js**:

In the moveToStage function, before validation runs, auto-end any open work
timer for this ticket:

```javascript
// Add at the start of moveToStage, right after the ticket fetch:
// Auto-end any open work log when moving stage
try {
  await client.query(
    `UPDATE work_logs
     SET end_time = NOW(), duration_minutes = EXTRACT(EPOCH FROM (NOW() - start_time))/60
     WHERE ticket_id = $1 AND end_time IS NULL`,
    [id]
  );
} catch (wlErr) {
  console.warn('Could not auto-end work log on stage move:', wlErr.message);
}
```

**Fix in frontend StageTaskPanel.jsx**:

After `save(true)` (Mark task complete), automatically trigger the stage move:

```javascript
// CURRENT:
const save = async (complete) => {
  setSaving(true);
  try {
    await saveStageTask(ticket.ticket_id, {
      stage_id: ticket.current_stage_id,
      checklist_data: checks,
      notes,
      completed: complete,
    });
    toast.success(complete ? 'Task marked complete' : 'Progress saved');
    onSubmitted && onSubmitted();
  } ...
};

// DO NOT auto-advance stage from StageTaskPanel.
// The fix is in the sidebar move button, not here.
// The "Mark task complete" just saves progress.
// The "Move to Final Testing" / "Submit to QC1" button in the sidebar IS the move action.
```

**Real fix in TicketDetailPage.jsx** — the move buttons may not render because
of a role check. Check the role variables:

```javascript
// Current role checks:
const tech = ['team_member', 'team_lead'].includes(user?.role);
const fm   = ['floor_manager', 'admin', 'manager'].includes(user?.role);
const qc   = user?.role === 'qc';

// HW_WORK_STAGES buttons condition:
if ((tech || fm) && HW_WORK_STAGES.includes(stage)) { ... }
```

If the user's role in the DB is stored differently (e.g. `'technician'` vs
`'team_member'`), the `tech` check fails and no buttons render.

**Fix**: Update the tech role check to include all technician role variants:

```javascript
// CHANGE:
const tech = ['team_member', 'team_lead'].includes(user?.role);
// TO:
const tech = ['team_member', 'team_lead', 'technician'].includes(user?.role);
```

Also add HW_WORK_STAGES constant if missing:
```javascript
const HW_WORK_STAGES = ['Assembly & Software', 'Final Testing', 'Chip Level Repair', 'Body & Paint'];
```

Verify this constant exists in TicketDetailPage.jsx. If not, add it.

**Additional fix**: Stage task "submit" UX improvement.
After the technician marks the task complete in StageTaskPanel, show a
prompt in the sidebar:

```jsx
// In the sidebar, after the stage buttons:
{STAGE_TASK_STAGES.includes(stage) && (
  <p className="text-xs text-slate-400 mt-2 text-center">
    ✓ Complete the task checklist above, then click the move button to advance.
  </p>
)}
```

### 3B — Fix TTSPL ID entry timing (Subtask 1 of Task 3)

The current flow is correct per spec: technician must enter TTSPL ID → startWork →
timer starts → THEN tabs and actions are visible.

However, the Diagnosis tab specifically should be visible BEFORE the timer starts
(so technician can read existing diagnosis while verifying). Only the "Move to next
stage" buttons should be blocked until the timer starts.

**Change**: Move the `needsStart` block from blocking the entire main panel to
only blocking the stage action buttons:

```jsx
// CURRENT: needsStart shows a verify block that replaces all tabs
// CHANGE: Always show tabs. Only block the stage action buttons.

// In the sidebar stage actions section:
{needsStart ? (
  <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4 mb-3">
    <h3 className="font-semibold text-blue-900 text-sm">Verify machine first</h3>
    <p className="text-xs text-blue-800 mt-1">
      Enter the TTSPL ID or Serial number to start your work timer.
      Stage actions will unlock after verification.
    </p>
    <div className="flex gap-2 mt-2">
      <input
        value={verifyInput}
        onChange={(e) => setVerifyInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleStartWork(); }}
        placeholder="TTSPL ID or Serial number"
        className="flex-1 border rounded-lg px-2 py-1.5 text-xs"
        autoFocus
      />
      <button
        type="button"
        disabled={starting}
        onClick={handleStartWork}
        className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50"
      >
        Start
      </button>
    </div>
  </div>
) : (
  // Stage action buttons render here (existing code)
  <div className="space-y-2">
    {stageButtons.map(...)}
  </div>
)}
```

Remove the `needsStart` block from the main content area (where it currently
replaces the tabs). The tabs should ALWAYS be visible once the page loads.

---

## TASK 4 — INLINE LEAD STATUS UPDATE FROM LIST PAGE

### 4A — Lead stages data (add to frontend constants)

File: `frontend/src/features/lead-crm/leadConstants.js`

Update or replace the STAGES_BY_STATUS constant to match exactly:

```javascript
export const STAGES_BY_STATUS = {
  Cold:     ['Proposal Shared', 'In Follow Up', 'Nurturing'],
  Warm:     ['Price Agreed', 'Gst Shared', 'Price Negotiation'],
  Hot:      ['Agreement Sent', 'Agreement Review', 'Asked For GST Challan'],
  Gone:     ['Taken From Another Vendor', 'Plan Cancelled', 'Need New Laptops'],
  Hold:     ['Plan On Hold'],
  Rejected: [
    'No Revenue/Less Revenue', 'No GST', 'GST Challan Not Shared',
    'No Reply/Not Picking', 'New Laptop Needed', "Configuration Doesn't Match",
    'Lesser Duration', 'Comparing the Price', 'Less Budget',
    'Not Interested/Not Needed', 'B2C', 'Looking For Mobiles',
    'Agreement Terms Not Match', 'Wrong Number/Number Not in Service',
    'Delivery/Support Charges', 'Enquiry Raised By Mistake',
    'Service Not Feasible', 'Need Local Vendor',
  ],
  Deal:   ['Deal'],
  Repeat: ['Repeat Customer'],
  // Statuses with no stage picker:
  Pending:    [],
  'Call Back': [],
  Demo:       [],
};

// Statuses that require a stage selection
export const STATUSES_WITH_STAGES = Object.entries(STAGES_BY_STATUS)
  .filter(([, stages]) => stages.length > 0)
  .map(([status]) => status);
```

Also update `backend/constants/leadStages.js` to match:

```javascript
const STAGES_BY_STATUS = {
  Cold:     ['Proposal Shared', 'In Follow Up', 'Nurturing'],
  Warm:     ['Price Agreed', 'Gst Shared', 'Price Negotiation'],
  Hot:      ['Agreement Sent', 'Agreement Review', 'Asked For GST Challan'],
  Gone:     ['Taken From Another Vendor', 'Plan Cancelled', 'Need New Laptops'],
  Hold:     ['Plan On Hold'],
  Rejected: [
    'No Revenue/Less Revenue', 'No GST', 'GST Challan Not Shared',
    'No Reply/Not Picking', 'New Laptop Needed', "Configuration Doesn't Match",
    'Lesser Duration', 'Comparing the Price', 'Less Budget',
    'Not Interested/Not Needed', 'B2C', 'Looking For Mobiles',
    'Agreement Terms Not Match', 'Wrong Number/Number Not in Service',
    'Delivery/Support Charges', 'Enquiry Raised By Mistake',
    'Service Not Feasible', 'Need Local Vendor',
  ],
  Deal:   ['Deal'],
  Repeat: ['Repeat Customer'],
};
const STATUSES_WITHOUT_STAGE_CHOICE = ['Call Back', 'Demo', 'Pending'];
```

### 4B — New component: QuickStatusUpdate.jsx

Create: `frontend/src/features/lead-crm/components/QuickStatusUpdate.jsx`

This is the inline popup that appears when user clicks the status badge in the table.

```jsx
/**
 * QuickStatusUpdate — click the status badge in the lead list to open
 * a small popup for updating status + stage without navigating to lead detail.
 *
 * Props:
 *   lead: { leadId, status, leadStage }
 *   onUpdated: () => void  — called after successful update
 */
import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { updateLeadStatus } from '../leadCrmApi';
import { LEAD_STATUSES, STAGES_BY_STATUS, STATUS_COLORS } from '../leadConstants';

export default function QuickStatusUpdate({ lead, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(lead.status);
  const [stage, setStage] = useState(lead.leadStage || '');
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // When status changes, reset stage to first available
  useEffect(() => {
    const stages = STAGES_BY_STATUS[status] || [];
    setStage(stages.length === 1 ? stages[0] : '');
  }, [status]);

  const stages = STAGES_BY_STATUS[status] || [];
  const needsStage = stages.length > 0;

  const handleSave = async () => {
    if (needsStage && !stage) {
      toast.error('Please select a stage');
      return;
    }
    setSaving(true);
    try {
      await updateLeadStatus(lead.leadId, {
        status,
        leadStage: stage || null,
        notes: `Status updated to ${status}${stage ? ` / ${stage}` : ''} via quick update`,
      });
      toast.success('Status updated');
      setOpen(false);
      onUpdated();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const st = STATUS_COLORS[lead.status] || STATUS_COLORS.Pending;

  return (
    <div className="relative" ref={ref}>
      {/* Trigger: the status badge */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer
          hover:ring-2 hover:ring-blue-300 transition-all
          ${st.bg} ${st.text}`}
        title="Click to update status"
      >
        {lead.status}
        <span className="ml-1 opacity-60">▾</span>
      </button>

      {open && (
        <div
          className="absolute z-50 left-0 top-full mt-1 w-64 rounded-xl border border-gray-200
            bg-white shadow-xl p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Update Status
          </p>

          {/* Status selector */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full border rounded-lg px-2 py-1.5 text-sm mb-2 focus:ring-2 focus:ring-blue-500"
          >
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Stage selector — only shown if this status has stages */}
          {needsStage && (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Stage
              </p>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="w-full border rounded-lg px-2 py-1.5 text-sm mb-2 focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select stage…</option>
                {stages.map((sg) => (
                  <option key={sg} value={sg}>{sg}</option>
                ))}
              </select>
            </>
          )}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 py-1.5 rounded-lg text-xs border hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || (needsStage && !stage)}
              className="flex-1 py-1.5 rounded-lg text-xs bg-blue-600 text-white
                font-semibold disabled:opacity-50 hover:bg-blue-700"
            >
              {saving ? 'Saving…' : 'Update'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

### 4C — Update LeadListPage.jsx — use QuickStatusUpdate in table

**Table view** — replace the static status badge with QuickStatusUpdate:

```jsx
// CURRENT (line ~309):
<td className="p-3">
  <span className={`px-2 py-0.5 rounded-full text-xs ${st.bg} ${st.text}`}>
    {lead.status}
  </span>
</td>
<td className="p-3 text-xs">{lead.leadStage || '—'}</td>

// REPLACE WITH:
<td className="p-3">
  <QuickStatusUpdate
    lead={lead}
    onUpdated={load}
  />
</td>
<td className="p-3 text-xs text-gray-500">{lead.leadStage || '—'}</td>
```

Import at top of LeadListPage.jsx:
```javascript
import QuickStatusUpdate from '../components/QuickStatusUpdate';
```

**Kanban view** — add a quick status action on the LeadCard:

In `LeadCard.jsx`, at the bottom of the card, add a small "Update Status" button:

```jsx
// At the bottom of the card, before the closing </div>:
<div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
  <QuickStatusUpdate lead={lead} onUpdated={onRefresh} />
  <span className="text-xs text-gray-400">{lead.leadStage || ''}</span>
</div>
```

This means QuickStatusUpdate is also used in kanban.
Pass `onRefresh` prop to LeadCard from the kanban render:
```jsx
<LeadCard key={lead.leadId} lead={lead} onRefresh={load} />
```

And update LeadCard props to accept onRefresh:
```javascript
export default function LeadCard({ lead, onRefresh }) {
```

### 4D — Backend: verify updateLeadStatus handles new statuses

In `backend/controllers/leadController.js`, find `exports.updateLeadStatus`.

Ensure it accepts the new statuses 'Deal', 'Repeat' and their stages.
The current `STATUSES_WITHOUT_STAGE_CHOICE` array may need updating:

```javascript
const STATUSES_WITHOUT_STAGE_CHOICE = ['Call Back', 'Demo', 'Pending'];
// Remove 'Deal' from this list since Deal now has stage 'Deal'
```

Also ensure the leadStage validation accepts 'Deal' and 'Repeat Customer' as valid stages.

---

## BUILD ORDER

1. Run migration `082_dispatch_qc_stage.sql`
2. Update `backend/controllers/ticketPhase2Controller.js` (Task 1 — conditionHint, transitions)
3. Update `backend/controllers/ticketController.js` getTicket query (Task 2)
4. Update `frontend/src/features/floor-pipeline/floorPipelineUi.js` (Task 2 — configSummary, configBadges)
5. Update `frontend/src/features/floor-pipeline/pages/TicketDetailPage.jsx`:
   - Task 1: Dispatch QC stage buttons, Sales Order badge, role check fix
   - Task 2: Header chip-row layout
   - Task 3: Move needsStart to sidebar only (not blocking tabs)
6. Update `frontend/src/features/floor-pipeline/components/StageTaskPanel.jsx` (Task 3 — UX guidance text)
7. Update `backend/constants/leadStages.js` (Task 4 — add Deal, Repeat stages)
8. Update `frontend/src/features/lead-crm/leadConstants.js` (Task 4)
9. Create `frontend/src/features/lead-crm/components/QuickStatusUpdate.jsx` (Task 4)
10. Update `frontend/src/features/lead-crm/pages/LeadListPage.jsx` (Task 4 — import and use)
11. Update `frontend/src/features/lead-crm/components/LeadCard.jsx` (Task 4 — onRefresh prop)

---

## QUALITY CHECKLIST

Task 1 — Dispatch QC:
  [ ] 'Dispatch QC Team' exists in teams table after migration
  [ ] 'Dispatch QC' stage exists in stages table, order ~10, team = Dispatch QC Team
  [ ] stage_transition_rules: QC1→Dispatch QC, Dispatch QC→Inventory, Dispatch QC→A&S
  [ ] sales_order_qc ticket at QC1: button shows "Move to Dispatch QC" NOT "Move to QC2"
  [ ] grn_qc ticket at QC1: button still shows "Move to QC2" (UNCHANGED)
  [ ] Dispatch QC ticket: "DISPATCH QC PASS" and "DISPATCH QC FAIL" buttons shown
  [ ] Dispatch QC fail: ticket goes back to Assembly & Software, highlighted = true
  [ ] Dispatch QC pass: ticket goes to Inventory, sales_order_serials.qc_status = 'passed'
  [ ] 'Sales Order' orange badge shown in header for sales_order_qc tickets
  [ ] 'Dispatch QC' column appears in kanban under QC group with orange border
  [ ] Dispatch QC Team assignable to users with role 'qc' in User Management

Task 2 — Full Config:
  [ ] Ticket header shows: Brand, Model, CPU, Generation, RAM, Storage, GPU, Screen, OS
  [ ] Each config item is a chip with label prefix
  [ ] Chips that are empty/null are hidden (filter(Boolean))
  [ ] Right sidebar also shows full config in chip format
  [ ] GPU 'Integrated' is NOT shown (too common, adds noise) — keep if explicit GPU
  [ ] TicketCard in kanban shows generation alongside processor

Task 3 — Stage task submit:
  [ ] Technician at Diagnosis: sees tabs IMMEDIATELY (not blocked by needsStart)
  [ ] TTSPL verify box is in the SIDEBAR, not blocking the main content area
  [ ] Stage move buttons are BLOCKED until TTSPL is verified (needsStart)
  [ ] After verifying TTSPL + starting timer, stage move buttons appear in sidebar
  [ ] "Move to Assembly & Software" from Diagnosis → works
  [ ] "Move to Final Testing" from Assembly & Software → works
  [ ] "Submit to QC1" from Final Testing → QC picker opens → works
  [ ] Work timer auto-ends when stage is moved
  [ ] Role 'technician' (as well as 'team_member', 'team_lead') sees stage buttons

Task 4 — Inline lead status:
  [ ] Table view: status badge is clickable (has ▾ indicator)
  [ ] Clicking badge opens popup with status dropdown + stage dropdown
  [ ] Stage dropdown only appears for statuses that have stages
  [ ] When status selected, stage dropdown shows ONLY stages for that status
  [ ] Deal → stage dropdown shows only 'Deal'
  [ ] Repeat → stage dropdown shows only 'Repeat Customer'
  [ ] Cold → shows 'Proposal Shared', 'In Follow Up', 'Nurturing'
  [ ] Rejected → shows all 17 rejection reasons
  [ ] Call Back, Demo, Pending → no stage picker (update status directly)
  [ ] Save → updates status + stage + logs activity → closes popup → refreshes list
  [ ] Kanban card also has QuickStatusUpdate at bottom
  [ ] Popup closes on outside click
  [ ] Popup closes on Cancel

---

## NAMING REFERENCE

  New stage:             'Dispatch QC'                (exact, case-sensitive)
  New team:              'Dispatch QC Team'            (exact)
  conditionHint:         'qc1_passed_so'              (for QC1→Dispatch QC)
  conditionHint:         'dispatch_qc_passed'         (for Dispatch QC→Inventory)
  conditionHint:         'dispatch_qc_failed'         (for Dispatch QC→Assembly)
  Config function name:  configBadges (new)           / configSummary (updated)
  Component name:        QuickStatusUpdate.jsx        (in lead-crm/components/)
  Lead status:           'Deal'                       (existing)
  Lead status:           'Repeat'                     (NEW — add to LEAD_STATUSES)
  Lead stage for Deal:   'Deal'
  Lead stage for Repeat: 'Repeat Customer'
