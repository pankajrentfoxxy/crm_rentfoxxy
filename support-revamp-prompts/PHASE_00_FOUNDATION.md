# PHASE 0 — Foundation: branch, access control, design system, module shell

> Read `00_MASTER_CONTEXT.md` first. Everything below assumes it.
> **Scope:** no business logic in this phase. We are building the skeleton, the access control and
> the design system, so that every later phase is assembly rather than invention.
> **Estimated size:** ~25 files, 2 migrations.

---

## 0.1 Branch

```bash
git checkout new_crm_rentfoxxy
git pull
git checkout -b support-revamp
git push -u origin support-revamp
git checkout -b support-revamp/phase-00
```

Create `docs/support-revamp/` and copy `SUPPORT_REVAMP_PLAN.md` and `support-ui-mockup.html` into it,
so the design lives with the code.

Add `.cursor/rules/support-revamp.md` = the contents of `00_MASTER_CONTEXT.md`.

---

## 0.2 Migration `192_support_v2_rbac.sql`

Create all 20 permission sections from MASTER §7 and seed the default role matrix from §7.1.

```sql
-- ============================================================
-- Migration 192: Support revamp — RBAC sections + default role matrix
--   20 granular sections so access can be granted flow by flow.
-- Idempotent: safe to re-run.
-- ============================================================

INSERT INTO permission_sections (section, description, sort_order) VALUES
  ('support_tickets',         'Support — Ticket queue & detail',              300),
  ('support_dashboard',       'Support — Command centre',                     301),
  ('support_triage',          'Support — Triage & classification',            302),
  ('support_work_orders',     'Support — Work orders (all types)',            303),
  ('support_pickup_repair',   'Support — Repair pickup & service return',     304),
  ('support_pickup_return',   'Support — Return pickup',                      305),
  ('support_replacement',     'Support — Replacement',                        306),
  ('support_field_visit',     'Support — Field visit & remote fix',           307),
  ('support_parts_request',   'Support — Raise part requests',                308),
  ('support_parts_approve',   'Support — Approve & issue parts (warehouse)',  309),
  ('support_bucket',          'Support — My technician bucket',               310),
  ('support_dispatch',        'Support — Dispatch board & assignment',        311),
  ('support_approvals',       'Support — Approvals inbox',                    312),
  ('support_charges',         'Support — Chargeable lines & liability',       313),
  ('support_sla_admin',       'Support — SLA policies & calendars',           314),
  ('support_taxonomy',        'Support — Issue taxonomy & codes',             315),
  ('support_groups',          'Support — Groups, zones, skills, shifts',      316),
  ('support_reports',         'Support — Reports & breach register',          317),
  ('support_settings',        'Support — Module settings & templates',        318),
  ('support_customer_portal', 'Support — Customer portal administration',     319)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;
```

Then the role matrix. **Write out every row explicitly** from the table in MASTER §7.1 — do not try
to be clever with a loop. Example of the shape (this is only the first block; produce all of them):

```sql
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  -- support_tickets
  ('super_admin','support_tickets',      true,  true,  true,  true ),
  ('admin','support_tickets',            true,  true,  true,  true ),
  ('support_manager','support_tickets',  true,  true,  true,  true ),
  ('support_lead','support_tickets',     true,  true,  true,  true ),
  ('support_agent','support_tickets',    true,  true,  true,  false),
  ('warehouse','support_tickets',        true,  false, false, false),
  ('dispatch','support_tickets',         true,  false, false, false),
  ('accounts','support_tickets',         true,  false, false, false),
  -- support_bucket  (technician's own jobs)
  ('super_admin','support_bucket',       true,  false, true,  false),
  ('admin','support_bucket',             true,  false, true,  false),
  ('support_manager','support_bucket',   true,  false, false, false),
  ('support_lead','support_bucket',      true,  false, false, false),
  ('support_tech','support_bucket',      true,  false, true,  false),
  ('warehouse','support_bucket',         true,  false, true,  false),
  ('dispatch','support_bucket',          true,  false, false, false)
  -- … continue for all 20 sections exactly as MASTER §7.1 specifies
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete;
```

### New roles
Add `support_agent` and `support_manager`:

```sql
-- If users.role has a CHECK constraint, widen it. Inspect first:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'users'::regclass AND contype='c';
-- Then drop-and-recreate with the two new values appended.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  /* every existing value, unchanged, PLUS: */ 'support_agent','support_manager'
));
```
> Read the existing constraint definition before writing this. Do **not** guess the existing list —
> copy it verbatim and append. If no constraint exists, skip the ALTER entirely.

Also update `backend/services/roleDefaultsSeed.js` to include the two new roles.

### Grandfather existing support users
So nobody loses access on deploy day:
```sql
-- Anyone who can currently view support_tickets keeps equivalent access in the new sections.
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT up.user_id, s.section, true, false, false, false
  FROM user_permissions up
  CROSS JOIN (VALUES ('support_dashboard'),('support_triage'),('support_work_orders'),
                     ('support_pickup_repair'),('support_pickup_return'),('support_replacement'),
                     ('support_field_visit'),('support_reports')) AS s(section)
 WHERE up.section = 'support_tickets' AND up.can_view = true
ON CONFLICT (user_id, section) DO NOTHING;
```

---

## 0.3 Migration `193_support_v2_sequences.sql`

```sql
-- ============================================================
-- Migration 193: Support revamp — document sequences
-- ============================================================
INSERT INTO sm_document_sequences (doc_type, last_value, prefix) VALUES
  ('support_ticket_v2',  0, 'STK-'),
  ('support_work_order', 0, 'WO-')
ON CONFLICT (doc_type) DO NOTHING;
```

---

## 0.4 Frontend — `constants/sections.js`

Append all 20 keys to `APPLICATION_SECTIONS`, add labels, and **replace** the existing 3-item
Support group:

```js
// SECTION_LABELS — add
support_tickets:         'Support — Ticket Queue',
support_dashboard:       'Support — Command Centre',
support_triage:          'Support — Triage & Classification',
support_work_orders:     'Support — Work Orders',
support_pickup_repair:   'Support — Repair Pickup',
support_pickup_return:   'Support — Return Pickup',
support_replacement:     'Support — Replacement',
support_field_visit:     'Support — Field Visit',
support_parts_request:   'Support — Part Requests',
support_parts_approve:   'Support — Part Approval (Warehouse)',
support_bucket:          'Support — My Technician Bucket',
support_dispatch:        'Support — Dispatch Board',
support_approvals:       'Support — Approvals',
support_charges:         'Support — Charges & Liability',
support_sla_admin:       'Support — SLA Administration',
support_taxonomy:        'Support — Issue Taxonomy',
support_groups:          'Support — Groups, Zones & Skills',
support_reports:         'Support — Reports',
support_settings:        'Support — Settings',
support_customer_portal: 'Support — Customer Portal',

// SECTION_GROUPS — replace the Support entry
Support: [
  'support_dashboard','support_tickets','support_triage','support_work_orders',
  'support_field_visit','support_pickup_repair','support_pickup_return','support_replacement',
  'support_parts_request','support_parts_approve','support_bucket','support_dispatch',
  'support_approvals','support_charges','support_sla_admin','support_taxonomy',
  'support_groups','support_reports','support_settings','support_customer_portal',
  // keep the legacy keys until Phase 11 so existing grants still render:
  'support_technician',
],
```

**Result:** the existing Role Permissions and User Permissions admin screens now show all 20 support
sections with view/create/edit/delete checkboxes. That is the whole "give access module by module"
requirement — no new admin UI needed.

---

## 0.5 Frontend — `tailwind.config.js`

Replace the file with the token config in **MASTER §6**. Nothing else in the app uses these names,
so this is purely additive.

---

## 0.6 Frontend — support primitives

Create `frontend/src/components/ui/supportPrimitives.jsx`. These are used by every screen from
Phase 3 onward. Build them now, once, correctly.

### Required exports

```
Modal              generic modal shell (the codebase has none)
PriorityChip       P1..P4 pill
PrioritySpine      helper returning the border-l class for a priority
SlaChip            countdown + depleting bar  ← the signature element
StatusPill         ticket / work order status
TypeTag            work order type tag
ClassificationChain  Type › Subtype › Issue
Mono               monospace tabular identifier
Timeline / TimelineItem
WorkOrderCard
AssetLineCard
FilterBar / FilterSelect / ViewChip
KpiTile
SectionDivider
```

### Reference implementation — copy this exactly

```jsx
// frontend/src/components/ui/supportPrimitives.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

/* ───────────────────────── Mono ───────────────────────── */
export function Mono({ children, className = '', bold = false }) {
  return (
    <span className={`font-mono tabular-nums tracking-tight ${bold ? 'font-semibold' : ''} ${className}`}>
      {children}
    </span>
  );
}

/* ───────────────────────── Priority ───────────────────── */
export const PRIORITY_META = {
  1: { label: 'Critical', short: 'P1', chip: 'text-pri1 bg-pri1-bg', spine: 'border-pri1' },
  2: { label: 'High',     short: 'P2', chip: 'text-pri2 bg-pri2-bg', spine: 'border-pri2' },
  3: { label: 'Moderate', short: 'P3', chip: 'text-pri3 bg-pri3-bg', spine: 'border-pri3' },
  4: { label: 'Low',      short: 'P4', chip: 'text-pri4 bg-pri4-bg', spine: 'border-pri4' },
};

export function PriorityChip({ priority, showLabel = false }) {
  const m = PRIORITY_META[Number(priority)] || PRIORITY_META[4];
  return (
    <span className={`inline-flex items-center gap-1 h-[19px] px-1.5 rounded font-mono text-[10.5px] font-bold whitespace-nowrap ${m.chip}`}>
      <span className="w-[5px] h-[5px] rounded-full bg-current" />
      {m.short}{showLabel ? ` ${m.label}` : ''}
    </span>
  );
}

export const prioritySpine = (priority) =>
  `border-l-[3px] ${(PRIORITY_META[Number(priority)] || PRIORITY_META[4]).spine}`;

/* ───────────────────────── SLA chip ────────────────────
   THE signature element. Countdown in mono + a 2.5px depleting bar.
   states: paused | breached | risk(>=75%) | warn(>=50%) | ok
   ------------------------------------------------------- */
export function SlaChip({ dueAt, startedAt, paused = false, className = '' }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused || !dueAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [dueAt, paused]);

  const state = useMemo(() => {
    if (paused) return { key: 'paused', text: '‖ paused', pct: 40 };
    if (!dueAt) return { key: 'none', text: '—', pct: 0 };
    const due = new Date(dueAt).getTime();
    const start = startedAt ? new Date(startedAt).getTime() : due - 24 * 3600 * 1000;
    const total = Math.max(due - start, 1);
    const left = due - now;
    const pct = Math.min(100, Math.max(0, ((total - left) / total) * 100));
    const sign = left < 0 ? '−' : '';
    const abs = Math.abs(left);
    const d = Math.floor(abs / 86400000);
    const h = Math.floor((abs % 86400000) / 3600000);
    const m = Math.floor((abs % 3600000) / 60000);
    const text = d > 0 ? `${sign}${d}d ${String(h).padStart(2, '0')}h`
                       : `${sign}${h}h ${String(m).padStart(2, '0')}m`;
    if (left < 0) return { key: 'breached', text, pct: 100 };
    if (pct >= 75) return { key: 'risk', text, pct };
    if (pct >= 50) return { key: 'warn', text, pct };
    return { key: 'ok', text, pct };
  }, [dueAt, startedAt, paused, now]);

  const tone = {
    ok:       ['text-sup-ok',    'bg-sup-ok'],
    warn:     ['text-sup-warn',  'bg-sup-warn'],
    risk:     ['text-pri2',      'bg-pri2'],
    breached: ['text-pri1',      'bg-pri1'],
    paused:   ['text-sup-faint', 'bg-sup-faint'],
    none:     ['text-sup-faint', 'bg-sup-faint'],
  }[state.key];

  return (
    <span className={`inline-flex flex-col gap-[3px] min-w-[76px] ${className}`}>
      <span className={`font-mono tabular-nums text-[11.5px] font-semibold tracking-tight ${tone[0]}`}>{state.text}</span>
      <span className="h-[2.5px] rounded-sm bg-sup-canvas2 overflow-hidden">
        <i className={`block h-full rounded-sm ${tone[1]}`} style={{ width: `${state.pct}%` }} />
      </span>
    </span>
  );
}

/* ─────────────────── Classification chain ─────────────── */
export function ClassificationChain({ type, subtype, issue, className = '' }) {
  if (!issue && !type) return <span className="text-sup-faint text-[11.5px]">Not classified</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap text-[11.5px] ${className}`}>
      <span className="text-sup-muted">{type}</span>
      <span className="text-sup-faint text-[9px]">›</span>
      <span className="text-sup-muted">{subtype}</span>
      <span className="text-sup-faint text-[9px]">›</span>
      <span className="text-sup-ink font-semibold">{issue}</span>
    </span>
  );
}

/* ───────────────────────── Modal ───────────────────────── */
export function Modal({ open = true, title, subtitle, onClose, footer, size = 'lg', children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <button type="button" className="fixed inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className={`relative bg-white rounded-xl shadow-supLg w-full ${w} my-8`} role="dialog" aria-modal="true">
        <div className="flex items-start gap-3 px-4 py-3.5 border-b border-sup-lineSoft">
          <div className="flex-1">
            <h3 className="text-[13px] font-semibold text-sup-ink">{title}</h3>
            {subtitle && <p className="text-[11.5px] text-sup-muted mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-sup-canvas2" aria-label="Close">
            <X className="w-4 h-4 text-sup-muted" />
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-sup-lineSoft bg-sup-canvas rounded-b-xl flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
```

Build the remaining exports (`StatusPill`, `TypeTag`, `Timeline`, `WorkOrderCard`, `AssetLineCard`,
`FilterBar`, `ViewChip`, `KpiTile`, `SectionDivider`) in the same spirit — small, presentational,
no data fetching, Tailwind classes from the token set only. Match the markup in
`support-ui-mockup.html`: search the HTML for `.pill`, `.tag`, `.wo`, `.aline`, `.tl`, `.kpi`,
`.chipf` and port each one.

### Status vocabularies for `StatusPill`
```js
export const TICKET_STATUS_META = {
  NEW:        { label: 'New',         tone: 'bg-sup-canvas2 text-sup-ink2' },
  TRIAGED:    { label: 'Triaged',     tone: 'bg-sup-canvas2 text-sup-ink2' },
  ASSIGNED:   { label: 'Assigned',    tone: 'bg-sup-accentSoft text-sup-accent' },
  IN_PROGRESS:{ label: 'In progress', tone: 'bg-pri2-bg text-pri2' },
  PENDING:    { label: 'Pending',     tone: 'bg-white border border-sup-line text-sup-muted' },
  RESOLVED:   { label: 'Resolved',    tone: 'bg-sup-okBg text-sup-ok' },
  CLOSED:     { label: 'Closed',      tone: 'bg-sup-canvas2 text-sup-muted' },
  CANCELLED:  { label: 'Cancelled',   tone: 'bg-sup-canvas2 text-sup-faint line-through' },
};
export const WO_STATUS_META = {
  DRAFT:'Draft', PENDING_ASSIGNMENT:'Pending assignment', ASSIGNED:'Assigned', ACCEPTED:'Accepted',
  EN_ROUTE:'En route', ON_SITE:'On site', IN_PROGRESS:'In progress', COMPLETED:'Completed',
  FAILED:'Failed', CANCELLED:'Cancelled',
};
export const WO_TYPE_META = {
  FIELD_VISIT:'Field visit', REPAIR_PICKUP:'Repair pickup', RETURN_PICKUP:'Return pickup',
  SERVICE_RETURN:'Service return', REPLACEMENT_DELIVERY:'Replacement delivery',
  PART_DELIVERY:'Part delivery', PART_RETURN:'Part return', REMOTE_FIX:'Remote fix',
};
```

---

## 0.7 Frontend — module shell and empty routes

### `frontend/src/features/support-v2/SupportV2App.jsx`
```jsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';
import SupportV2Shell from './SupportV2Shell';
import Placeholder from './pages/Placeholder';

const g = (section, node) => <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>;

export default function SupportV2App() {
  return (
    <Routes>
      <Route element={<SupportV2Shell />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard"      element={g('support_dashboard',  <Placeholder screen="S1"  title="Command centre" />)} />
        <Route path="queue"          element={g('support_tickets',    <Placeholder screen="S2"  title="Ticket queue" />)} />
        <Route path="tickets/new"    element={g('support_tickets',    <Placeholder screen="S3–S6" title="New ticket" />)} />
        <Route path="tickets/:id"    element={g('support_tickets',    <Placeholder screen="S7"  title="Ticket detail" />)} />
        <Route path="dispatch"       element={g('support_dispatch',   <Placeholder screen="S10" title="Dispatch board" />)} />
        <Route path="bucket"         element={g('support_bucket',     <Placeholder screen="S11" title="My bucket" />)} />
        <Route path="parts"          element={g('support_parts_approve', <Placeholder screen="S14" title="Parts queue" />)} />
        <Route path="approvals"      element={g('support_approvals',  <Placeholder screen="S16" title="Approvals" />)} />
        <Route path="sla"            element={g('support_sla_admin',  <Placeholder screen="S17" title="SLA & breaches" />)} />
        <Route path="taxonomy"       element={g('support_taxonomy',   <Placeholder screen="S18" title="Issue taxonomy" />)} />
        <Route path="reports"        element={g('support_reports',    <Placeholder screen="S20" title="Reports" />)} />
        <Route path="settings"       element={g('support_settings',   <Placeholder screen="S19" title="Settings" />)} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Route>
    </Routes>
  );
}
```

### `frontend/src/features/support-v2/SupportV2Shell.jsx`
Left sub-nav exactly as in the mockup's rail (grouped **Work / Create / Field / Manage**), rendered
with `NavLink`. **Every nav item is hidden unless the user can view its section** — this is the
visible proof that access is module-by-module.

```jsx
const NAV = [
  { group: 'Work', items: [
    { to: 'dashboard', label: 'Command centre', icon: LayoutDashboard, section: 'support_dashboard' },
    { to: 'queue',     label: 'Ticket queue',   icon: ListChecks,      section: 'support_tickets', countKey: 'open_tickets' },
    { to: 'dispatch',  label: 'Dispatch board', icon: CalendarRange,   section: 'support_dispatch', countKey: 'unassigned_wos', danger: true },
    { to: 'parts',     label: 'Parts queue',    icon: Boxes,           section: 'support_parts_approve', countKey: 'parts_pending' },
    { to: 'approvals', label: 'Approvals',      icon: CheckCircle2,    section: 'support_approvals', countKey: 'approvals_pending', danger: true },
  ]},
  { group: 'Create', items: [
    { to: 'tickets/new', label: 'New ticket', icon: Plus, section: 'support_tickets', action: 'create' },
  ]},
  { group: 'Field', items: [
    { to: 'bucket', label: 'My bucket', icon: Smartphone, section: 'support_bucket' },
  ]},
  { group: 'Manage', items: [
    { to: 'sla',      label: 'SLA & breaches',   icon: Timer,    section: 'support_sla_admin' },
    { to: 'taxonomy', label: 'Issue taxonomy',   icon: Network,  section: 'support_taxonomy' },
    { to: 'reports',  label: 'Reports',          icon: BarChart3,section: 'support_reports' },
    { to: 'settings', label: 'Settings',         icon: Settings, section: 'support_settings' },
  ]},
];
```
Filter with `usePermission()`:
```jsx
const { hasPermission } = usePermission();
const visible = NAV
  .map(g => ({ ...g, items: g.items.filter(i => hasPermission(i.section, i.action || 'view')) }))
  .filter(g => g.items.length > 0);
```
Badge counts come from a single call `GET /api/support/v2/badges` (Phase 0 returns zeros; later
phases fill it in), re-fetched on `location.pathname` change — same pattern as the existing
`SupportShell.jsx`.

### `pages/Placeholder.jsx`
```jsx
export default function Placeholder({ screen, title }) {
  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold">Screen {screen}</div>
      <h1 className="text-[19px] font-bold tracking-tight text-sup-ink">{title}</h1>
      <div className="mt-6 border border-dashed border-sup-line rounded-xl p-10 text-center text-sup-muted text-[12px]">
        Not built yet — see <code className="font-mono">docs/support-revamp/support-ui-mockup.html</code>
      </div>
    </div>
  );
}
```

### `frontend/src/routes/supportV2Routes.jsx`
```jsx
import React from 'react';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import SupportV2App from '../features/support-v2/SupportV2App';

export const supportV2Routes = [{
  path: '/support-v2/*',
  element: (
    <ProtectedRoute
      sections={['support_dashboard','support_tickets','support_bucket','support_dispatch',
                 'support_parts_approve','support_approvals','support_reports']}
      action="view"
    >
      <Layout><SupportV2App /></Layout>
    </ProtectedRoute>
  ),
}];
```
Spread it in `frontend/src/routes/index.jsx`.

### `frontend/src/config/menuConfig.js`
Add **one** entry to the existing `support` group — do not remove the existing ones yet:
```js
{ icon: LifeBuoy, label: 'Support (new)', path: '/support-v2', section: 'support_dashboard', countKey: 'open_tickets' },
```

---

## 0.8 Backend — the v2 router skeleton

### `backend/routes/supportV2.js`
```js
'use strict';
const router = require('express').Router();
const { authMiddleware, checkAnySectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/supportV2Controller');

router.use(authMiddleware);

router.get('/badges', checkAnySectionPermission(
  ['support_dashboard','support_tickets','support_bucket','support_dispatch'], 'view'), ctrl.getBadges);
router.get('/health', ctrl.health);

module.exports = router;
```

### `backend/controllers/supportV2Controller.js`
```js
'use strict';
const pool = require('../config/db');

exports.health = async (_req, res) => res.json({ success: true, module: 'support-v2', phase: 0 });

// Badge counts for the module sub-nav. Phase 0 returns zeros; later phases fill these in.
exports.getBadges = async (req, res) => {
  try {
    res.json({ success: true, badges: {
      open_tickets: 0, unassigned_wos: 0, parts_pending: 0, approvals_pending: 0, my_jobs: 0,
    }});
  } catch (e) {
    console.error('getBadges:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};
```

Mount in `server.js` next to the other support routes:
```js
app.use('/api/support/v2', require('./routes/supportV2'));
```

---

## 0.9 Backend — demo seed script skeleton

`backend/scripts/seed-support-demo.js`

```js
'use strict';
require('dotenv').config();
const pool = require('../config/db');

if (process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Refusing to run: set ALLOW_DEMO_SEED=true');
  process.exit(1);
}
const RESET = process.argv.includes('--reset');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (RESET) { /* delete only rows tagged demo_seed = true */ }
    // Phase 0: seed the 4 support users + 2 new roles only.
    // Each later phase EXTENDS this file.
    await client.query('COMMIT');
    console.log('Support demo seed complete.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('seed-support-demo:', e);
    process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
}
main();
```

Every demo row gets a `demo_seed BOOLEAN DEFAULT FALSE` column (added per-table by the phase that
creates the table) so `--reset` can clean up without touching real data.

---

## 0.10 Backend — smoke test

`backend/test/support-v2-phase0.test.js` using `node:test` (already wired into `npm test`):
```js
const { test } = require('node:test');
const assert = require('node:assert');
// Assert the 20 sections exist and the role matrix is seeded.
```
At minimum assert: all 20 sections present in `permission_sections`; `support_tech` has
`can_view` on `support_bucket` and **not** on `support_dispatch`.

---

## VERIFICATION CHECKLIST — Phase 0

Run through every item before opening the PR.

**Migrations**
- [ ] `node scripts/run-all-migrations.js` prints `APPLIED 192_…` and `APPLIED 193_…`, no `FAILED`
- [ ] Re-running it prints nothing new (idempotent)
- [ ] `npm run prisma:sync` succeeds and `npm run check:prisma-drift` passes

**Access control — the important one**
- [ ] Log in as `super_admin` → Settings → Role Permissions: all 20 `Support — …` sections appear
      under the **Support** group with four checkboxes each
- [ ] Create a test user with role `support_tech`. Confirm they can reach `/support-v2/bucket`
      and are redirected away from `/support-v2/dispatch` and `/support-v2/queue`
- [ ] In User Permissions, tick only `support_parts_approve · view` for a `warehouse` user.
      Log in as them: the sub-nav shows **only** "Parts queue" — nothing else
- [ ] Untick it. The user now gets bounced out of `/support-v2` entirely
- [ ] `curl` `GET /api/support/v2/badges` with that user's token → 200; with a token lacking all
      four sections → **403**, not 200-with-empty

**UI**
- [ ] `/support-v2` renders inside the normal CRM `Layout` with its own left sub-nav
- [ ] Sub-nav groups read Work / Create / Field / Manage and match the mockup rail
- [ ] Every placeholder page shows its S-number
- [ ] The old `/support/*` module is untouched and still fully works

**Design system**
- [ ] In a scratch page, render `<PriorityChip priority={1..4} />` — colours match the mockup exactly
- [ ] `<SlaChip dueAt={...} />` shows a countdown that ticks, and turns amber → orange → crimson
- [ ] `<SlaChip paused />` shows `‖ paused` in grey
- [ ] `<Modal>` closes on Escape, on backdrop click and on the X

**Build**
- [ ] `npm test` green
- [ ] `npm run build` compiles with no new warnings

---

## PHASE 0 REPORT
Write `docs/support-revamp/PHASE_00_REPORT.md` with: files added/changed, the exact list of
permission sections created, the role matrix as applied, and screenshots of the Role Permissions
screen showing the Support group.
