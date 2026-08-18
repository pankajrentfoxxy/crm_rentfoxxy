# MASTER CONTEXT — Rentfoxxy CRM Support Revamp

> **HOW TO USE THIS FILE**
>
> Save it as `.cursor/rules/support-revamp.md` in the repo so Cursor loads it automatically on every request.
> If your Cursor version does not support rules files, paste this whole file at the top of **every** phase prompt.
>
> Every phase prompt assumes you have read this file. Phase prompts will say things like
> "follow the house style in MASTER §4" — that means this document.

---

## 1. PROJECT

| | |
|---|---|
| Repo | `crm_rentfoxxy` |
| Base branch | `new_crm_rentfoxxy` |
| **Work branch** | `support-revamp` (created in Phase 0) |
| Business | Rentfoxxy — B2B laptop rental · gorefurbo — refurbished laptop sales |
| Backend | Node.js 24 + Express 4, PostgreSQL via raw `pg` pool |
| Frontend | React 18 (CRA, `react-scripts` 5), React Router v6, Tailwind 3, axios, lucide-react, react-hot-toast, recharts |
| Other apps | `vendor-portal/`, `customer-portal/` — same backend |

### What we are building
A complete replacement for the support module. The design is fully specified in two documents that
must be treated as the source of truth:

- **`SUPPORT_REVAMP_PLAN.md`** — data model, state machines, taxonomy, SLA rules, flows
- **`support-ui-mockup.html`** — the exact UI for all 21 screens. Open it in a browser. Toggle
  "Design notes" bottom-left to see the rationale for each decision.

**The UI must match the mockup.** Not "inspired by" — the same layout, the same components, the
same information density, the same colours. When in doubt, open the mockup and copy it.

---

## 2. THE ONE IDEA BEHIND THE REVAMP

Read this until it is obvious, because every phase depends on it.

> The current module stores **Complaint**, **Pickup** and **Replacement** as three values of one
> column (`support_tickets.ticket_category`). They are not three kinds of ticket. A complaint is a
> ticket. A pickup and a replacement are **jobs that a ticket creates**.

The new shape:

```
TICKET (STK-)                  one customer problem
  └── TICKET ASSET LINE        one machine on that ticket  (mandatory 3-level classification)
        └── WORK ORDER (WO-)   one physical job: one owner, one place, one day
              ├── STEPS        typed checkpoints (GPS, scan, photo, OTP, signature)
              └── PART LINES
```

Eight work order types, all in one table with one lifecycle:
`FIELD_VISIT` · `REPAIR_PICKUP` · `RETURN_PICKUP` · `SERVICE_RETURN` · `REPLACEMENT_DELIVERY` ·
`PART_DELIVERY` · `PART_RETURN` · `REMOTE_FIX`

**Never** add a work-order-type-specific value to `support_work_orders.status`. Type-specific
progress belongs in `support_work_order_steps`.

---

## 3. HARD GUARDRAILS

These are non-negotiable. Violating any of them fails the phase review.

### 3.1 Do not touch
- **Do not modify** the existing `support_tickets`, `support_ticket_items`, `support_replacement_orders`,
  `support_part_challans` tables or their controllers/routes until Phase 11 (cutover). The old module
  must keep working in parallel the whole time.
- **Do not modify** the floor pipeline (`tickets`, `stages`, `production_*`). We link to it, we do not
  change it.
- **Do not change** any document number prefix or sequence: `EST- SO- DC- RDC- SDC- PDC- RPDC- SPC- INV- CN- VB- DN-`.
  These appear on GST documents. New work orders get a **new** prefix `WO-`; everything else is reused as-is.
- **Do not rename or delete** existing permission sections. New sections are added; old ones are
  retired only in Phase 11.

### 3.2 Always
- Every migration is **idempotent** (`IF NOT EXISTS`, `ON CONFLICT`, `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`).
- Every new endpoint is behind a permission check. No exceptions, not even GETs.
- Every new table with a status column has a **DB `CHECK` constraint** listing the allowed values.
- Every state change writes a row to `support_ticket_events`.
- Every list endpoint supports `page`, `limit`, and returns `{ success:true, rows:[], pagination:{page,totalPages,total,limit} }`.
- After adding migrations, run `npm run prisma:sync` in `backend/` (the drift check compares
  `schema.prisma`'s `Last synced migration: NNN` marker against the highest migration number).

### 3.3 Never
- Never use Prisma for new code. `PrismaClient` is used only by the three lead modules. Use raw `pool.query`.
- Never introduce a new HTTP client, state manager, form library, component library, CSS framework,
  date library or icon set. Use what is listed in §1.
- Never use `utils/logger.js` (pino) — the codebase logs with `console.error('handlerName:', e)`.
- Never write TypeScript. The frontend is plain JSX.
- Never use `localStorage` for domain data (auth token handling already exists — do not change it).

---

## 4. BACKEND HOUSE STYLE — copy these patterns exactly

### 4.1 Database access
```js
const pool = require('../config/db');          // module.exports = pool  (a pg.Pool)
const r = await pool.query('SELECT ... WHERE id = $1', [id]);
```

### 4.2 Transactions
```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const r = await client.query('SELECT * FROM support_work_orders WHERE wo_id = $1 FOR UPDATE', [woId]);
  if (!r.rows.length) {
    await client.query('ROLLBACK');
    return res.status(404).json({ success: false, message: 'Work order not found' });
  }
  // ...
  await client.query('COMMIT');
  res.json({ success: true, work_order: r.rows[0] });
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('completeWorkOrder:', e);
  res.status(e.status || 500).json({ success: false, message: e.message });
} finally {
  client.release();
}
```

### 4.3 Services take the open client as their first argument
Services never open their own transaction. They are pure functions the controller composes.
```js
'use strict';
async function computeTicketStatus(client, ticketId) { /* ... */ }
async function recalcSla(client, ticketId) { /* ... */ }
module.exports = { computeTicketStatus, recalcSla };
```

### 4.4 Controllers
```js
'use strict';
const pool = require('../config/db');

// ── LIST TICKETS ────────────────────────────────────────────
exports.listTickets = async (req, res) => {
  try {
    // ...
    res.json({ success: true, rows, pagination });
  } catch (e) {
    console.error('listTickets:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};
```

Response envelope is **always** `{ success: true, ... }` or `{ success: false, message }`.
Errors that need a status carry it: `throw Object.assign(new Error('Ticket not found'), { status: 404 });`

### 4.5 Routes and permissions
```js
'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/supportTicketController');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const cp = checkSectionPermission;

router.use(authMiddleware);

router.get('/tickets',              cp('support_tickets', 'view'),   ctrl.listTickets);
router.post('/tickets',             cp('support_tickets', 'create'), ctrl.createTicket);
router.get('/tickets/:id',          cp('support_tickets', 'view'),   ctrl.getTicket);
router.post('/tickets/:id/classify', cp('support_triage', 'edit'),   ctrl.classifyTicket);

module.exports = router;
```

When a route must allow "any of several sections":
```js
router.get('/dashboard', checkAnySectionPermission(['support_tickets','support_dispatch'], 'view'), ctrl.dashboard);
```

For a role-first fallback (rare — prefer plain sections):
```js
const { hasPermission } = require('../services/permissionService');
async function may(req, section, action = 'can_view') {
  if (!req.user) return false;
  if (req.user.role === 'super_admin') return true;
  if (!req.permissionCache) req.permissionCache = {};
  return hasPermission(req.user.user_id, req.user.role, section, action, req.permissionCache);
}
```

### 4.6 Mounting a router
Add one line to `backend/server.js` in the flat list, next to the other support routes:
```js
app.use('/api/support/v2', require('./routes/supportV2'));
```

### 4.7 Migrations
- File name: `backend/migrations/NNN_snake_case.sql`. **The next free number is `192`.** Increment from there.
- Applied manually: `cd backend && node scripts/run-all-migrations.js`
- Tracked in `schema_migrations(name, applied_at)`; the runner skips already-applied files.
- Header style:
```sql
-- ============================================================
-- Migration 192: Support taxonomy — issue catalogue, resolution
--   codes, root causes, action codes.
-- Idempotent: safe to re-run.
-- ============================================================
```

### 4.8 Registering a permission section (do this in the migration)
```sql
INSERT INTO permission_sections (section, description, sort_order)
VALUES ('support_triage', 'Support — Triage & classification', 302)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES ('super_admin','support_triage',true,true,true,true),
       ('admin','support_triage',true,true,true,true),
       ('support_lead','support_triage',true,true,true,false),
       ('support_agent','support_triage',true,false,false,false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete;
```

### 4.9 Document numbers
Reuse `backend/services/salesManagementService.js`:
- `nextFinancialYearNumber(kind, client)` → `SO/26-27/0779` style, for `sales_order | delivery_challan | service_dc | part_dc | part_return_dc`. **Pass the open client** to join the caller's transaction.
- For the new `WO-` sequence, add a local helper in the work-order service following the `nextSprNumber` pattern:
```js
async function nextWoNumber(db = pool) {
  const r = await db.query(
    `UPDATE sm_document_sequences SET last_value = last_value + 1, updated_at = NOW()
     WHERE doc_type = 'support_work_order' RETURNING last_value`);
  return `WO-${String(r.rows[0].last_value).padStart(6, '0')}`;
}
```

### 4.10 Boot-time schema ensure
If a phase needs an idempotent guard at boot, follow the existing pattern inside `server.listen`:
```js
const { ensureSupportV2Schema } = require('./services/supportV2Schema');
ensureSupportV2Schema().catch((err) => console.error('Support v2 schema ensure failed:', err.message));
```

---

## 5. FRONTEND HOUSE STYLE — copy these patterns exactly

### 5.1 Feature folder layout
```
frontend/src/features/support-v2/
  SupportV2App.jsx          nested <Routes> + shell
  SupportV2Shell.jsx        left sub-nav + <Outlet/>
  supportV2Api.js           thin axios wrappers
  supportV2Utils.js         formatters, constants
  pages/                    one file per screen
  components/               shared within the feature
```

### 5.2 API layer
Always `frontend/src/utils/api.js` (default export axios instance). Never create a new axios instance.
```js
import api from '../../utils/api';
const BASE = '/support/v2';
export const listTickets   = (params) => api.get(`${BASE}/tickets`, { params });
export const getTicket     = (id)     => api.get(`${BASE}/tickets/${id}`);
export const createTicket  = (data)   => api.post(`${BASE}/tickets`, data);
```
Callers destructure the axios response: `const res = await listTickets({...}); setRows(res.data?.rows || []);`

### 5.3 Permissions in components
```js
import { usePermission } from '../../hooks/usePermission';
const { canView, canCreate, canEdit, canDelete } = usePermission();
if (canCreate('support_tickets')) { /* show the button */ }
```
```jsx
import PermissionGate from '../../components/PermissionGate';
<PermissionGate section="support_dispatch" action="edit" fallback={null}>
  <Button>Assign</Button>
</PermissionGate>
```

### 5.4 Route guarding
```jsx
// frontend/src/routes/supportV2Routes.jsx
import ProtectedRoute from '../router/ProtectedRoute';
export const supportV2Routes = [{
  path: '/support-v2/*',
  element: (
    <ProtectedRoute sections={['support_tickets','support_bucket']} action="view">
      <Layout><SupportV2App /></Layout>
    </ProtectedRoute>
  ),
}];
```
Then spread it in `frontend/src/routes/index.jsx`.

Per-page guard inside the module app:
```jsx
const g = (section, node) => <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>;
<Route path="queue" element={g('support_tickets', <TicketQueuePage />)} />
```

### 5.5 Existing primitives — use them, do not re-invent
`frontend/src/components/ui/primitives.jsx` exports:
`Button`, `Badge`, `PageHeader`, `Card`, `StatCard`, `EmptyState`, `SectionLoader`,
`ResponsiveTable`, `SearchField`, `DateRangeFilter`, `ListPagination`

```jsx
<Button variant="primary|secondary|ghost|success|danger|subtle" size="sm|md|lg" icon={Plus} loading disabled />
<Badge tone="gray|blue|green|amber|red|purple|orange" />
<ResponsiveTable columns={columns} rows={rows} keyField="ticket_id" loading={loading}
  renderCard={renderCard} onRowClick={r => nav(`/support-v2/tickets/${r.ticket_id}`)}
  empty={<EmptyState icon={Inbox} title="No tickets" hint="Adjust your filters" />} />
<ListPagination page={p.page} totalPages={p.totalPages} total={p.total} pageSize={p.limit} onPageChange={n => setFilters({page:n})} />
```
Column shape: `{ key, header, render?(row), align?, className?, sortable? }`

### 5.6 List page skeleton — copy this structure
```jsx
const PAGE_SIZE = 25;
const DEFAULTS = { page: 1, search: '', priority: '', status: '', view: 'all_open' };

const { filters, setFilters } = useUrlFilters(DEFAULTS);
const { searchInput, setSearchInput, debouncedSearch: search } = useDebouncedUrlSearch(filters, setFilters);
const [rows, setRows] = useState([]);
const [loading, setLoading] = useState(true);
const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });

const load = useCallback(async () => {
  setLoading(true);
  try {
    const res = await listTickets({ page: filters.page, limit: PAGE_SIZE, search: search.trim() || undefined, ... });
    setRows(res.data?.rows || []);
    setPagination(res.data?.pagination || { page:1, totalPages:1, total:0, limit:PAGE_SIZE });
  } catch { toast.error('Failed to load tickets'); }
  finally { setLoading(false); }
}, [filters, search]);
useEffect(() => { load(); }, [load]);
```
**Sorting and paging happen on the server.** Never re-sort a server page on the client — that is
an existing bug in `SupportTicketList.jsx:265` we are deliberately fixing.

### 5.7 Modal shell (no Modal primitive exists — Phase 0 adds one; until then use this)
```jsx
<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
  <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
  <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full">…</div>
</div>
```

### 5.8 Toasts
```js
import toast from 'react-hot-toast';
toast.success('Ticket created');
toast.error(err.response?.data?.message || 'Something went wrong');
```

### 5.9 Page container
```jsx
<div className="p-4 md:p-6 max-w-[1600px] mx-auto">
  <PageHeader title="Ticket queue" subtitle="One list. Everything else is a saved view of it." icon={ListChecks} />
  …
</div>
```

---

## 6. DESIGN TOKENS — mapping the mockup to Tailwind

`frontend/tailwind.config.js` is currently bare. **Phase 0 extends it** with the token set below.
Use these class names everywhere in the support module. Do not substitute stock Tailwind
`red-500`/`orange-500` for priority — the priority ramp is a closed system and must never collide
with interactive chrome.

```js
// frontend/tailwind.config.js  (Phase 0 replaces the file with this)
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Priority ramp — used ONLY for priority. Never for buttons, links or status.
        pri1: { DEFAULT: '#B32A45', bg: '#FCEBEE', ring: '#F0C9D1' },
        pri2: { DEFAULT: '#C2660F', bg: '#FDF0E3', ring: '#F0D9BB' },
        pri3: { DEFAULT: '#8F6D0A', bg: '#FBF4DE', ring: '#EDDFAE' },
        pri4: { DEFAULT: '#5A6472', bg: '#EEF0F3', ring: '#DFE3E9' },
        // Interactive chrome — deliberately petrol/teal so it can't be read as a priority
        sup:  { ink: '#0E1116', ink2: '#39414F', muted: '#6B7382', faint: '#98A0AE',
                canvas: '#F4F6F8', canvas2: '#EDF0F3', line: '#DFE3E9', lineSoft: '#EAEDF1',
                accent: '#134B60', accent2: '#0D7C86', accentSoft: '#E4F1F3',
                ok: '#1B7A4D', okBg: '#E5F3EC', warn: '#B4780C' },
      },
      fontFamily: {
        mono: ['ui-monospace','SFMono-Regular','SF Mono','Menlo','Consolas','Liberation Mono','monospace'],
      },
      boxShadow: {
        sup: '0 1px 2px rgba(14,17,22,.06), 0 4px 12px rgba(14,17,22,.05)',
        supLg: '0 8px 32px rgba(14,17,22,.14)',
      },
    },
  },
  plugins: [],
};
```

### 6.1 Typography rule
**Every identifier is monospace with tabular numerals.** Ticket numbers, WO numbers, TTSPL IDs,
serials, document numbers, SLA countdowns, amounts, counts.
```jsx
<span className="font-mono tabular-nums tracking-tight">STK-26-27-00412</span>
```
Rationale: in an ops console identifiers are *scanned*, not read. This is the single most
recognisable thing about the new UI — do not skip it.

### 6.2 The priority spine
Every ticket row, work order card and job card gets a 3px coloured left edge:
```jsx
<tr className="border-l-[3px] border-pri1">…</tr>
```

### 6.3 The SLA countdown chip — the signature element
```jsx
<SlaChip dueAt={row.sla_resolution_due_at} pausedMinutes={row.sla_paused_minutes} />
// renders: mono countdown + a 2.5px depleting bar
// states: ok (green) → warn (amber, ≥50%) → risk (orange, ≥75%) → breached (crimson, negative) → paused (grey, "‖ paused")
```

---

## 7. RBAC — THE ACCESS MATRIX

You asked for module-by-module access. Every flow gets its **own** section, so you can grant a
person exactly one flow. All sections are created in Phase 0 with `sort_order` 300–330.

| # | Section key | Controls | view | create | edit | delete |
|---|---|---|---|---|---|---|
| 300 | `support_tickets` | Ticket queue + ticket detail | see queue | raise a ticket | edit ticket fields, assign | cancel |
| 301 | `support_dashboard` | Command centre S1 | see dashboard | — | — | — |
| 302 | `support_triage` | Classify, change impact/urgency, override priority | see triage view | — | reclassify & override | — |
| 303 | `support_work_orders` | Work orders generally | see WOs | create WOs | edit slot/method/notes | cancel WOs |
| 304 | `support_pickup_repair` | **Repair pickup + service return flow** | see | raise | execute/edit | cancel |
| 305 | `support_pickup_return` | **Return pickup flow** | see | raise | execute/edit | cancel |
| 306 | `support_replacement` | **Replacement flow** | see | initiate | edit | cancel |
| 307 | `support_field_visit` | Field visit + remote fix | see | raise | execute | cancel |
| 308 | `support_parts_request` | Raise / view part requests | see | raise | edit own | cancel |
| 309 | `support_parts_approve` | Warehouse approval, challan, issue | see queue | — | approve/issue/reject | — |
| 310 | `support_bucket` | **My technician bucket** (own jobs only) | see own bucket | — | act on own jobs | — |
| 311 | `support_dispatch` | Dispatch board, assignment, auto-assign | see board | — | assign/reassign | — |
| 312 | `support_approvals` | Approvals inbox | see | — | decide | — |
| 313 | `support_charges` | Chargeable lines, damage, liability | see | raise | approve/waive | — |
| 314 | `support_sla_admin` | SLA policies, calendars, holidays | see | create | edit | delete |
| 315 | `support_taxonomy` | Issue catalogue, resolution/root-cause codes | see | create | edit | delete |
| 316 | `support_groups` | Assignment groups, zones, skills, shifts | see | create | edit | delete |
| 317 | `support_reports` | Reports + breach register | see | — | — | — |
| 318 | `support_settings` | Module settings, notification templates | see | — | edit | — |
| 319 | `support_customer_portal` | Portal admin (what customers can see/do) | see | — | edit | — |

### 7.1 Default role matrix (seeded in Phase 0)

| Section | super_admin | admin | support_manager | support_lead | support_agent | support_tech | warehouse | dispatch | accounts |
|---|---|---|---|---|---|---|---|---|---|
| support_tickets | VCED | VCED | VCED | VCE**D** | VC**E** | — | V | V | V |
| support_dashboard | V | V | V | V | V | — | — | V | — |
| support_triage | VE | VE | VE | VE | V | — | — | — | — |
| support_work_orders | VCED | VCED | VCED | VCED | V | V | V | VCE | — |
| support_pickup_repair | VCED | VCED | VCED | VCE | V | VE | VE | VE | — |
| support_pickup_return | VCED | VCED | VCED | VCE | V | VE | VE | VE | — |
| support_replacement | VCED | VCED | VCED | VC | V | VE | V | VE | — |
| support_field_visit | VCED | VCED | VCED | VCE | VC | VE | — | VE | — |
| support_parts_request | VCED | VCED | VCE | VCE | VC | VC | VCE | — | — |
| support_parts_approve | VE | VE | VE | VE | — | — | VE | — | — |
| support_bucket | VE | VE | V | V | — | **VE** | VE | V | — |
| support_dispatch | VE | VE | VE | VE | — | — | — | **VE** | — |
| support_approvals | VE | VE | **VE** | VE | — | — | — | — | V |
| support_charges | VCE | VCE | VCE | VC | — | C | — | — | **VE** |
| support_sla_admin | VCED | VCED | VE | V | — | — | — | — | — |
| support_taxonomy | VCED | VCED | VCE | V | V | V | V | V | — |
| support_groups | VCED | VCED | VCE | V | — | — | — | V | — |
| support_reports | V | V | V | V | V | — | — | V | V |
| support_settings | VE | VE | V | — | — | — | — | — | — |
| support_customer_portal | VE | VE | VE | V | — | — | — | — | — |

`V`=can_view `C`=can_create `E`=can_edit `D`=can_delete. Blank = no access.

### 7.2 Two new roles
`support_agent` and `support_manager` do not exist yet. Phase 0 adds them to the role list wherever
roles are enumerated (`users.role` check constraint if one exists, `roleDefaultsSeed.js`, the
frontend role dropdown). Existing `support_lead` and `support_tech` are kept as-is.

### 7.3 Data scoping — separate from permissions
`support_bucket` grants access to **your own** jobs only. This is enforced in the query
(`WHERE assigned_to = $userId`), not by permissions. A technician with `support_bucket` view can
never see another technician's bucket, regardless of role.

### 7.4 The frontend must mirror the backend
Every section in §7 must be added to `frontend/src/constants/sections.js`:
- appended to `APPLICATION_SECTIONS`
- given a human label in `SECTION_LABELS`
- listed under a new `SECTION_GROUPS.Support` group (replace the existing 3-item Support group)
- `GROUP_COLORS.Support` stays `'text-pink-600 border-pink-200'`

This is what makes the sections appear in the existing Role Permissions and User Permissions admin
screens — **no new admin UI is needed for granting access**, it plugs into what you already have.

---

## 8. NAMING CONVENTIONS

| Thing | Convention | Example |
|---|---|---|
| New tables | `support_*`, snake_case | `support_work_orders` |
| Enum-ish values in DB | UPPER_SNAKE | `'REPAIR_PICKUP'`, `'PENDING_CUSTOMER'` |
| API base | `/api/support/v2` | `/api/support/v2/tickets` |
| Backend files | `supportV2*.js` | `controllers/supportTicketController.js`, `services/supportWorkOrderService.js` |
| Frontend feature | `features/support-v2/` | `pages/TicketQueuePage.jsx` |
| Frontend routes | `/support-v2/*` during build | `/support-v2/queue` |
| Permission sections | `support_*` | `support_pickup_repair` |
| Migration files | `NNN_support_v2_*.sql` | `192_support_v2_taxonomy.sql` |

**Route path note:** we build at `/support-v2/*` so the live `/support/*` module keeps working.
Phase 11 swaps them: `/support/*` points at the new module, `/support-legacy/*` at the old one for
30 days, then the old one is deleted.

---

## 9. PER-PHASE WORKFLOW — follow this every single time

1. `git checkout support-revamp && git pull`
2. `git checkout -b support-revamp/phase-NN`
3. Implement everything in the phase prompt. Do not start work from a later phase.
4. `cd backend && node scripts/run-all-migrations.js` — must print `APPLIED` for each new file, no `FAILED`.
5. `cd backend && npm run prisma:sync`
6. `cd backend && npm test` — must pass.
7. `cd frontend && npm run build` — must compile with **zero** warnings introduced by your changes.
8. Run the phase's **Verification checklist** manually in the browser. Every box must tick.
9. `git add -A && git commit -m "phase NN: <summary>"` and open a PR into `support-revamp`.
10. Write `docs/support-revamp/PHASE_NN_REPORT.md` listing: files added, files changed, endpoints
    added, migrations added, anything you could not do and why.
11. **Stop. Wait for review.** Do not begin phase NN+1.

---

## 10. DEFINITION OF DONE (applies to every phase)

- [ ] All new endpoints permission-checked with the section from §7
- [ ] All new tables have `CHECK` constraints on status/enum columns
- [ ] All migrations idempotent and applied cleanly on a fresh DB **and** on a copy of production
- [ ] No changes to legacy support tables/controllers/routes
- [ ] No document number prefix changed
- [ ] Frontend matches `support-ui-mockup.html` for the screens in scope
- [ ] All identifiers rendered `font-mono tabular-nums`
- [ ] Priority rendered only with the `pri1..pri4` tokens
- [ ] Loading, empty and error states present on every list and every form
- [ ] Mobile: usable at 375px width (technician screens are mobile-first)
- [ ] Keyboard focus visible on every interactive element
- [ ] `npm test` green, `npm run build` clean
- [ ] Phase report written

---

## 11. SEED & TEST DATA

Phase 0 creates `backend/scripts/seed-support-demo.js`. Every later phase **extends** it so the
whole flow can be demoed on a clean database:

```
node scripts/seed-support-demo.js --reset
```
It must create: 3 customers (one Platinum with 2 sites), ~40 assets, 4 support users
(agent/lead/tech/manager), 6 zones+groups+skills, the full issue catalogue, SLA policies, a
business calendar with holidays, and 25 tickets spread across every status, priority and
work-order type — including one breached, one paused, one repeat-offender asset and one
chargeable-awaiting-approval.

**Never seed into production.** The script must refuse to run unless
`process.env.ALLOW_DEMO_SEED === 'true'`.

---

## 12. ANSWERS TO QUESTIONS CURSOR WILL ASK

**"Should I refactor the existing support module?"** No. Build alongside it. Phase 11 removes it.

**"The old code does X differently — should I match it?"** Match the *conventions* (§4, §5).
Do not match the *defects* — the plan document lists 33 of them (D1–D33) that we are deliberately fixing.

**"Can I add a library for this?"** No. See §3.3.

**"Where does business logic live?"** In `services/`. Controllers do request parsing, permission-
adjacent checks, transaction management and response shaping. No SQL in routes. No business rules in components.

**"How do I know what a screen should look like?"** Open `support-ui-mockup.html`, find the screen
by its S-number (given in every phase prompt), and copy it.

**"Two places could own this logic."** One place. The plan's principle P7: ticket status is computed
by exactly one function, `computeTicketStatus()`. The same rule applies to every derivation.
