# RENTFOXXY CRM — PHASE 11 BUILD PROMPT
## Floor Pipeline Team Flow + Teams Deprecation
### Branch: new_crm_rentfoxxy

---

## AGENT RULES

- This phase fixes the core ticket-flow gap and deprecates the old Teams page.
- Minimal backend changes — one targeted fix to moveToStage.
- No DB migrations needed.
- Do NOT remove teams table or team data — teams are still used for
  auto-assignment round-robin logic. Only the UI management is deprecated.

---

## THE PROBLEM (read carefully)

### Current behavior (broken)

```
Floor Manager assigns to H&S tech
    ↓
Diagnosis → Assembly & Software → Final Testing
(same technician throughout — correct)
    ↓ (technician clicks "Move to QC1")
QC1 ← auto-assigned to QC1 Team via round-robin ✅
    ↓ (QC1 person clicks "QC1 PASS — Move to QC2")
QC2 ← STILL assigned to the QC1 person ❌  ← BUG
    ↓
QC2 PASS → Inventory
```

Also broken:
- `Diagnosis → Assembly & Software`: ticket stays with same tech ✅ (correct,
  same team), but if H&S team has multiple members, it should stay with the
  SAME tech who started Diagnosis, not re-round-robin.
- `Assembly & Software → Final Testing`: same — keep same tech.
- `QC2 → QC1` (fail): should auto-assign back to a QC1 team member
  via round-robin (not keep the QC2 person).

### The correct behavior

```
FLOOR MANAGER assigns to H&S tech (person-specific assignment)
    ↓
Diagnosis → Assembly & Software → Final Testing
(SAME technician throughout — because same team, keep assignment)
    ↓ tech clicks "Move to QC1"
QC1 ← auto-assigned to QC1 Team round-robin ✅
    ↓ QC1 person clicks "QC1 PASS"
QC2 ← auto-assigned to QC2 Team round-robin (NEW FIX)
    ↓ QC2 person clicks "QC2 PASS"
Inventory ← ticket complete ✅

ON FAIL:
QC1 FAIL → back to Assembly & Software
  Keep assignment to same H&S tech
  (so the person who built it gets it back)

QC2 FAIL → back to QC1
  auto-assign to QC1 Team round-robin (NEW FIX)
  (fresh QC1 eyes — may be different QC1 person)
```

### Team → Stage auto-assignment rules (complete)

| Transition | Auto-assign behaviour |
|---|---|
| Floor Manager → Diagnosis | Floor manager manually assigns (already works) |
| Diagnosis → Assembly & Software | Keep current assigned_user_id (same tech) |
| Assembly & Software → Final Testing | Keep current assigned_user_id (same tech) |
| Final Testing → QC1 | Round-robin to QC1 Team (already works ✅) |
| QC1 pass → QC2 | Round-robin to QC2 Team (FIX THIS) |
| QC2 fail → QC1 | Round-robin to QC1 Team (FIX THIS) |
| QC1 fail → Assembly & Software | Keep same H&S tech (VERIFY) |
| QC2 pass → Inventory | ticket complete (already works ✅) |
| Chip Level Repair → Assembly & Software | Keep current assigned_user_id |
| Body & Paint → Assembly & Software | Keep current assigned_user_id |

---

## TASK A — BACKEND FIX: moveToStage auto-assignment

File: `backend/controllers/ticketPhase2Controller.js`

Find the block starting at:
```javascript
let assignedUserId = ticket.assigned_user_id;
if (to_stage_name === 'QC1' && currentStageName === 'Final Testing' && nextStage.team_id) {
  try {
    assignedUserId = await pickNextAssigneeForTeamPool(client, nextStage.team_id);
  } catch {
    assignedUserId = null;
  }
}
```

**REPLACE this entire block** with:

```javascript
let assignedUserId = ticket.assigned_user_id;

// ── Stage-transition assignment rules ──────────────────────────────────
// Round-robin to the target stage's team when crossing team boundaries.
// Keep same technician when staying within the same team.

const KEEP_SAME_TECH_TRANSITIONS = new Set([
  'Diagnosis→Assembly & Software',
  'Assembly & Software→Final Testing',
  'Chip Level Repair→Assembly & Software',
  'Body & Paint→Assembly & Software',
  'QC1→Assembly & Software',   // QC1 fail — back to same H&S tech
]);

const ROUND_ROBIN_TRANSITIONS = new Set([
  'Final Testing→QC1',   // cross from H&S to QC1 team
  'QC1→QC2',             // cross from QC1 to QC2 team
  'QC2→QC1',             // QC2 fail — round-robin QC1 (fresh eyes)
]);

const transitionKey = `${currentStageName}→${to_stage_name}`;

if (ROUND_ROBIN_TRANSITIONS.has(transitionKey) && nextStage.team_id) {
  try {
    assignedUserId = await pickNextAssigneeForTeamPool(client, nextStage.team_id);
  } catch {
    assignedUserId = null; // leave unassigned if team has no members
  }
} else if (KEEP_SAME_TECH_TRANSITIONS.has(transitionKey)) {
  // Keep the same technician — do not change assignedUserId
  assignedUserId = ticket.assigned_user_id;
}
// All other transitions: keep existing assignedUserId unchanged
// (floor_manager can always override via AssignmentModal)
// ───────────────────────────────────────────────────────────────────────
```

After this fix:
- `Final Testing → QC1`: round-robin QC1 Team ✅ (unchanged)
- `QC1 → QC2`: round-robin QC2 Team ✅ (NEW)
- `QC2 → QC1` (fail): round-robin QC1 Team ✅ (NEW)
- `QC1 → Assembly & Software` (fail): keeps same H&S tech ✅
- All H&S internal transitions: keeps same tech ✅

---

## TASK B — FRONTEND: Ticket Detail — show who will receive the ticket

When a QC person is about to click "QC1 PASS — Move to QC2", they should
see who the ticket will be assigned to.

### B.1 Update `floorPipelineApi.js`

Add a preview function:
```javascript
export const getNextAssignee = (ticketId, toStageName) =>
  api.get(`${base}/${ticketId}/next-assignee`, {
    params: { to_stage_name: toStageName }
  });
```

### B.2 Add backend endpoint: `GET /api/tickets/:id/next-assignee`

Add to `ticketController.js`:
```javascript
exports.getNextAssignee = async (req, res) => {
  const { to_stage_name } = req.query;
  if (!to_stage_name) return res.status(400).json({ message: 'to_stage_name required' });

  const ROUND_ROBIN_TARGETS = new Set([
    'Final Testing→QC1', 'QC1→QC2', 'QC2→QC1'
  ]);

  const ticket = await pool.query(
    'SELECT t.*, s.stage_name AS current_stage_name FROM tickets t JOIN stages s ON s.stage_id = t.current_stage_id WHERE t.ticket_id = $1',
    [req.params.id]
  );
  if (!ticket.rows.length) return res.status(404).json({ message: 'Not found' });
  const t = ticket.rows[0];
  const key = `${t.current_stage_name}→${to_stage_name}`;

  if (!ROUND_ROBIN_TARGETS.has(key)) {
    // Keep same assignee
    if (!t.assigned_user_id) return res.json({ assignee: null });
    const u = await pool.query('SELECT user_id, name, role FROM users WHERE user_id=$1', [t.assigned_user_id]);
    return res.json({ assignee: u.rows[0] || null, keep_same: true });
  }

  // Get next round-robin assignee (read-only — don't update state)
  const stageRes = await pool.query('SELECT * FROM stages WHERE stage_name=$1', [to_stage_name]);
  if (!stageRes.rows.length) return res.json({ assignee: null });
  const teamId = stageRes.rows[0].team_id;
  if (!teamId) return res.json({ assignee: null });

  const members = await pool.query(
    `SELECT DISTINCT u.user_id, u.name, u.role,
       COUNT(tkt.ticket_id) FILTER (WHERE tkt.status='in_progress') AS active_tickets
     FROM users u
     LEFT JOIN user_teams ut ON ut.user_id = u.user_id AND ut.team_id = $1
     LEFT JOIN tickets tkt ON tkt.assigned_user_id = u.user_id AND tkt.status='in_progress'
     WHERE (u.team_id = $1 OR ut.team_id = $1) AND u.active = true
     GROUP BY u.user_id, u.name, u.role
     ORDER BY active_tickets ASC, u.user_id ASC`,
    [teamId]
  );

  // Peek at round-robin state without updating it
  const rrState = await pool.query(
    'SELECT last_assigned_user_id FROM qc_round_robin_state WHERE team_id=$1', [teamId]
  );
  const ids = members.rows.map(r => r.user_id);
  if (!ids.length) return res.json({ assignee: null, team_has_no_members: true });

  let nextIdx = 0;
  if (rrState.rows.length && rrState.rows[0].last_assigned_user_id) {
    const lastIdx = ids.indexOf(rrState.rows[0].last_assigned_user_id);
    nextIdx = (lastIdx + 1) % ids.length;
  }
  const next = members.rows.find(r => r.user_id === ids[nextIdx]);
  return res.json({ assignee: next || null, team_members: members.rows });
};
```

Add route to `backend/routes/tickets.js`:
```javascript
router.get('/:id/next-assignee', authMiddleware, ticketController.getNextAssignee);
```

### B.3 Update `TicketDetailPage.jsx` stage action buttons

In the sidebar stage actions, when rendering QC pass buttons,
show a "Will be assigned to:" preview:

```jsx
// Add state:
const [nextAssignee, setNextAssignee] = useState(null);

// When QC1 or QC2 stage is active, fetch next assignee on mount:
useEffect(() => {
  if (!ticket) return;
  const stage = ticket.stage_name;
  if (stage === 'QC1') {
    getNextAssignee(ticket.ticket_id, 'QC2')
      .then(r => setNextAssignee(r.data?.assignee))
      .catch(() => {});
  } else if (stage === 'QC2') {
    // QC2 has no "next" — goes to Inventory
    setNextAssignee(null);
  }
}, [ticket]);

// In the QC1 stage buttons section, below the Pass button:
{stage === 'QC1' && nextAssignee && (
  <p className="text-xs text-slate-500 mt-1 text-center">
    Will assign to: <span className="font-medium text-slate-700">{nextAssignee.name}</span>
  </p>
)}
{stage === 'QC1' && !nextAssignee && (
  <p className="text-xs text-amber-600 mt-1 text-center">
    ⚠ QC2 team has no members — ticket will be unassigned
  </p>
)}
```

---

## TASK C — FRONTEND: Teams page deprecation

### C.1 Deprecate `/teams` route

The old Teams page at `/teams` managed creating users and assigning them
to teams. This is now done via:
- Users: `/settings/users`
- Team membership: the "Team" field in the User form in `/settings/users`

**Replace** `frontend/src/pages/Teams.jsx` content entirely with a
deprecation redirect page:

```jsx
import React, { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function Teams() {
  const navigate = useNavigate();

  useEffect(() => {
    // Auto-redirect after 3 seconds
    const t = setTimeout(() => navigate('/settings/users', { replace: true }), 3000);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 max-w-md">
        <div className="text-4xl mb-4">🔄</div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">
          Teams has moved
        </h2>
        <p className="text-gray-500 text-sm mb-6">
          User and team management is now in <strong>Settings → Users</strong>.
          You can assign users to teams from the User edit drawer.
        </p>
        <Link
          to="/settings/users"
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Go to User Management
        </Link>
        <p className="text-xs text-gray-400 mt-4">Redirecting automatically in 3 seconds...</p>
      </div>
    </div>
  );
}
```

### C.2 Remove Teams from sidebar

In `frontend/src/config/menuConfig.js`:

Find the settingsAccordionChildren array. Remove:
```javascript
{ label: 'Teams', path: '/teams', section: 'teams' },
```
(This is currently at line 96 in menuConfig.js — inside settingsAccordionChildren.)

Also remove the standalone `teams` section from the Settings accordion
`sections` array (used for visibility check):
```javascript
// Find:
sections: ['users', 'user_permissions', 'role_permissions', 'teams', 'roles'],
// Change to:
sections: ['users', 'user_permissions', 'role_permissions', 'roles'],
```

### C.3 Update UserManagementPage — Team membership in user form

The Add/Edit User drawer currently shows a "Team" field.
Ensure it properly saves to both `users.team_id` AND `user_teams` table.

In the Add/Edit user form (in `UserManagementPage.jsx`), update the team
assignment to support multi-team (some floor users can be in both QC1 and QC2 teams):

For roles: `team_member`, `team_lead`, `floor_manager`, `qc`:
  Show: "Teams" multi-select dropdown
  Fetches teams from `GET /api/auth/teams` (add this endpoint)
  Shows checkboxes for: Hardware & Software | QC1 Team | QC2 Team |
    Chip Level Repair Team | Body & Paint Team | Inventory Team

For roles: `sales`, `procurement`, `warehouse`, `dispatch`, `accounts`,
  `support_lead`, `support_tech`:
  Hide team field (these roles don't use floor teams)

Backend — add `GET /api/auth/teams`:
```javascript
// In authController.js
exports.getTeams = async (req, res) => {
  const result = await pool.query(
    `SELECT team_id, team_name FROM teams ORDER BY team_name ASC`
  );
  res.json({ success: true, teams: result.rows });
};
```

Add route in `backend/routes/auth.js`:
```javascript
router.get('/teams', authMiddleware, getTeams);
```

Then in `updateUser` controller, when saving team assignments:
```javascript
if (Array.isArray(team_ids) && team_ids.length > 0 && FLOOR_ROLES.includes(role)) {
  // Update primary team_id to first in list
  // Delete existing user_teams entries, insert new ones
  await pool.query('DELETE FROM user_teams WHERE user_id=$1', [id]);
  for (const tid of team_ids) {
    await pool.query(
      'INSERT INTO user_teams (user_id, team_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [id, tid]
    );
  }
  await pool.query('UPDATE users SET team_id=$1 WHERE user_id=$2', [team_ids[0], id]);
}
```

Import `getTeams` in routes/auth.js.

---

## TASK D — FLOOR PIPELINE UI: Show team context

### D.1 Update `FloorTicketListPage.jsx` — show team name on ticket cards

In `TicketCard.jsx`, below the technician name, show their team:

```jsx
// Add to the bottom of the card:
{ticket.assigned_team_name && (
  <span className="text-xs text-slate-400">{ticket.assigned_team_name}</span>
)}
```

Update the ticket list API to include `assigned_team_name`:
In `ticketController.js` `getTickets` query, add:
```sql
LEFT JOIN teams tm ON t.assigned_team_id = tm.team_id
```
And select `tm.team_name AS assigned_team_name`.

### D.2 Update `AssignmentModal.jsx` — show correct teams

Currently AssignmentModal shows two hardcoded tabs:
`Hardware & Software Team` and `QC Team`.

Update to show the correct team based on the ticket's CURRENT stage:

```javascript
// Determine which team to default to based on current stage
function getRelevantTeams(stageName) {
  if (['Floor Manager'].includes(stageName)) {
    return [
      { key: 'hw', label: 'Hardware & Software', teamName: 'Hardware & Software' },
      { key: 'qc', label: 'QC1 Team', teamName: 'QC1 Team' },
    ];
  }
  if (['Diagnosis','Assembly & Software','Final Testing',
       'Chip Level Repair','Body & Paint'].includes(stageName)) {
    return [{ key: 'hw', label: 'Hardware & Software', teamName: 'Hardware & Software' }];
  }
  if (stageName === 'QC1') {
    return [{ key: 'qc1', label: 'QC1 Team', teamName: 'QC1 Team' }];
  }
  if (stageName === 'QC2') {
    return [{ key: 'qc2', label: 'QC2 Team', teamName: 'QC2 Team' }];
  }
  return [
    { key: 'hw', label: 'Hardware & Software', teamName: 'Hardware & Software' },
    { key: 'qc1', label: 'QC1 Team', teamName: 'QC1 Team' },
    { key: 'qc2', label: 'QC2 Team', teamName: 'QC2 Team' },
  ];
}
```

Use `getRelevantTeams(ticket?.stage_name)` to build the TEAMS array
instead of the hardcoded one.

For QC1 and QC2 stages, show a read-only note:
```
"Auto-assignment active — ticket will be assigned via round-robin
 when moved to this stage. Use manual assignment to override."
```

---

## TASK E — FLOOR DASHBOARD: Team workload view

### E.1 Update `FloorDashboardPage.jsx`

Replace the generic "Technician load" section with a team-grouped view:

```
┌─ TEAM WORKLOAD ──────────────────────────────────────────────────────┐
│                                                                       │
│  HARDWARE & SOFTWARE TEAM          QC TEAMS                          │
│  ┌──────────────────────────┐     ┌──────────────────────────────┐  │
│  │ Ravi Kumar  2 active     │     │ QC1 Team                     │  │
│  │ Priya Sharma 0 active    │     │   Anita Singh    1 active    │  │
│  │ Suresh Verma 1 active    │     │   Mohan Kumar    0 active    │  │
│  └──────────────────────────┘     │ QC2 Team                     │  │
│                                   │   Rajesh Gupta   0 active    │  │
│                                   └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

Fetch from `GET /api/tickets/team-members?team_name=Hardware+%26+Software`
and `GET /api/tickets/team-members?team_name=QC1+Team` etc.

---

## SECTION — BUILD ORDER

1. Backend: fix moveToStage auto-assignment block (TASK A)
2. Backend: add getNextAssignee endpoint + route (TASK B)
3. Backend: add getTeams endpoint + route (TASK C)
4. Backend: update getTickets to include assigned_team_name (TASK D)
5. Backend: update updateUser to handle multi-team in user_teams (TASK C)
6. Frontend: update TicketDetailPage — next assignee preview (TASK B)
7. Frontend: update AssignmentModal — stage-aware team tabs (TASK D)
8. Frontend: update TicketCard — show team name (TASK D)
9. Frontend: update UserManagementPage — multi-team select for floor roles (TASK C)
10. Frontend: replace Teams.jsx with deprecation redirect (TASK C)
11. Frontend: remove Teams from sidebar in menuConfig.js (TASK C)
12. Frontend: update FloorDashboardPage team workload section (TASK E)

---

## SECTION — QUALITY CHECKLIST

Backend:
  [ ] QC1 pass (QC1→QC2): ticket auto-assigned to QC2 Team round-robin
  [ ] QC2 fail (QC2→QC1): ticket auto-assigned to QC1 Team round-robin
  [ ] QC1 fail (QC1→Assembly & Software): ticket keeps same H&S tech
  [ ] H&S internal transitions: ticket keeps same tech
  [ ] GET /api/tickets/:id/next-assignee returns correct next person
  [ ] GET /api/auth/teams returns all teams list

Frontend:
  [ ] TicketDetailPage QC1 stage: shows "Will assign to: [name]" under Pass button
  [ ] TicketDetailPage: warning shown if QC2 team has no members
  [ ] AssignmentModal: shows only H&S team tabs when in H&S stages
  [ ] AssignmentModal: shows only QC1 tab when in QC1 stage
  [ ] AssignmentModal: shows only QC2 tab when in QC2 stage
  [ ] AssignmentModal: auto-assignment note shown for QC stages
  [ ] TicketCard: shows team name under technician name
  [ ] UserManagementPage: floor/qc roles show multi-team checkbox list
  [ ] UserManagementPage: sales/accounts/dispatch hide team field
  [ ] /teams page: shows deprecation message + redirect after 3s
  [ ] Sidebar: "Teams" entry removed from Settings accordion
  [ ] FloorDashboardPage: team workload grouped by H&S / QC1 / QC2

---

## SECTION — SUMMARY OF FLOW AFTER THIS PHASE

```
GRN Receive → Ticket Created (Floor Manager stage)
    ↓
Floor Manager opens ticket → AssignmentModal shows H&S team
Floor Manager selects "Ravi Kumar" → clicks Assign
    ↓
Ticket: Stage=Diagnosis, Assigned=Ravi Kumar, Team=H&S

Ravi opens ticket → does Diagnosis → clicks "Move to Assembly & Software"
Ticket: Stage=Assembly & Software, Assigned=STILL Ravi Kumar ✅ (same tech)

Ravi does repair → clicks "Move to Final Testing"
Ticket: Stage=Final Testing, Assigned=STILL Ravi Kumar ✅ (same tech)

Ravi does final test → clicks "Move to QC1"
Ticket: Stage=QC1, Assigned=Anita Singh (round-robin QC1 Team) ✅

Anita opens ticket → runs QC1 checklist → clicks "QC1 PASS — Move to QC2"
  [preview shows: "Will assign to: Rajesh Gupta"]
Ticket: Stage=QC2, Assigned=Rajesh Gupta (round-robin QC2 Team) ✅ (NEW)

Rajesh runs QC2 → PASS → clicks "QC2 PASS — Mark Inventory Ready"
Ticket: COMPLETE, laptop → Inventory ✅

IF QC1 FAILS:
Anita clicks "QC1 FAIL" + reason
Ticket: Stage=Assembly & Software, Assigned=STILL Ravi Kumar ✅ (same tech)
Ticket: highlighted=true, banner shows "QC1 failed: [reason]"

IF QC2 FAILS:
Rajesh clicks "QC2 FAIL" + reason
Ticket: Stage=QC1, Assigned=Anita Singh (round-robin QC1 Team) ✅ (NEW)
Ticket: highlighted=true, banner shows "QC2 failed: [reason]"
```
