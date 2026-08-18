# PHASE 3 — Command centre and Ticket queue

> Read `00_MASTER_CONTEXT.md` first.
> **Screens:** S1 (Command centre), S2 (Ticket queue).
> **Depends on:** Phase 2.
> **This phase contains a complete reference implementation.** Build `TicketQueuePage.jsx` exactly
> as written below, then build S1 in the same style. Every later screen is assembled from the same parts.

---

## 3.1 What S2 replaces

One screen retires eight nav items. Today `/support/tickets`, `/pending-assign`, `/overdue`,
`/pickups`, `/complaints`, `/my-tickets`, `/my-resolved` and `/cancelled-tickets` are separate
routes — and six of them render a *weaker* card UI with only a search box
(`SupportTicketsViewCards`). In the new module they are **saved views** over one table.

---

## 3.2 Backend — saved views

### Migration `199_support_v2_saved_views.sql`
```sql
CREATE TABLE IF NOT EXISTS support_saved_views (
  view_id     SERIAL PRIMARY KEY,
  name        VARCHAR(60) NOT NULL,
  slug        VARCHAR(60) NOT NULL,
  owner_id    INT REFERENCES users(user_id),      -- NULL = system view, visible to all
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  filters     JSONB NOT NULL DEFAULT '{}',
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, slug)
);
```
Seed the seven system views shown in the mockup:
`all_open`, `breaching`, `unassigned`, `mine`, `pending_customer`, `field_jobs_today`, `resolved_7d`.

Example filter payloads:
```json
{ "slug":"breaching",        "filters": { "status":"OPEN", "sla":"BREACHED_OR_AT_RISK" } }
{ "slug":"unassigned",       "filters": { "status":"OPEN", "assigned_to":"NONE" } }
{ "slug":"mine",             "filters": { "status":"OPEN", "assigned_to":"ME" } }
{ "slug":"pending_customer", "filters": { "status":"PENDING", "pending_reason":"PENDING_CUSTOMER" } }
{ "slug":"field_jobs_today", "filters": { "has_wo_today": true } }
{ "slug":"resolved_7d",      "filters": { "status":"RESOLVED", "resolved_within_days":7 } }
```

### Endpoints
```
GET    /api/support/v2/views              cp('support_tickets','view')   system + own
POST   /api/support/v2/views              cp('support_tickets','view')   save my own
DELETE /api/support/v2/views/:id          cp('support_tickets','view')   own only
GET    /api/support/v2/tickets/counts     cp('support_tickets','view')   counts per view, one query
GET    /api/support/v2/dashboard          cp('support_dashboard','view')
```

`GET /tickets/counts` must return every view count in **one** round trip — the mockup shows counts
on all seven chips, and seven queries per page load is not acceptable:
```sql
SELECT
  COUNT(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED','CANCELLED'))                    AS all_open,
  COUNT(*) FILTER (WHERE ... sla at risk ...)                                                AS breaching,
  COUNT(*) FILTER (WHERE assigned_to IS NULL AND status NOT IN (...))                        AS unassigned,
  ...
FROM support_tickets_v2 t;
```

### `GET /tickets` — full filter contract
```
page, limit                 default 1, 25
search                      matches ticket_number, legacy_ticket_number, customer name,
                            TTSPL id, serial number, contact phone
view                        slug — applied first, then the explicit filters below narrow it
class                       INCIDENT | REQUEST
priority                    1|2|3|4  (repeatable)
status                      NEW|TRIAGED|... (repeatable) or OPEN (= not resolved/closed/cancelled)
pending_reason
type_id, subtype_id, issue_id      catalog ids (matched against ANY asset line)
sla                         BREACHED | AT_RISK | PAUSED | OK
group_id
assigned_to                 user id | ME | NONE
channel
customer_id
date_from, date_to          on created_at
sort                        priority_sla (default) | sla | newest | age
```

Return shape:
```json
{ "success": true,
  "rows": [ {
    "ticket_id": 412, "ticket_number": "STK-26-27-00412", "priority": 1, "status": "IN_PROGRESS",
    "ticket_class": "INCIDENT", "channel": "PHONE",
    "customer_id": 88, "customer_name": "Acme Corp", "site_label": "Sector 44, Gurugram",
    "support_tier": "PLATINUM",
    "primary_classification": { "type":"Hardware", "subtype":"Boot / POST", "issue":"Does not power on" },
    "asset_count": 3, "primary_ttspl_id": "TTSPL002187", "mixed_issues": true,
    "sla_resolution_due_at": "2026-08-13T06:12:00Z", "sla_started_at": "...",
    "sla_paused": false, "sla_breached": true,
    "assigned_to_name": "Rahul K",
    "open_wo_count": 3,
    "flags": { "repeat": false, "safety": false, "chargeable_pending": false, "kb_suggested": false }
  } ],
  "pagination": { "page":1, "totalPages":19, "total":148, "limit":25 } }
```

`primary_classification` = the classification of the **highest-priority** asset line.
`mixed_issues = true` when the ticket's lines have more than one distinct subtype — this is what
lets the queue row say "+2 more machines · mixed issues" without a second query.

### `GET /dashboard`
Returns everything S1 needs in one call:
```json
{ "success": true,
  "kpis": { "breaching_4h": 7, "breaching_4h_p1": 3, "unassigned": 12, "unassigned_field": 9,
            "open": 148, "open_delta": 14, "sla_mtd_pct": 91.4, "sla_target_pct": 95, "breaches_mtd": 19 },
  "sla_risk": [ /* top 5 rows, same shape as a queue row */ ],
  "priority_mix": { "1": 12, "2": 40, "3": 65, "4": 31 },
  "capacity": [ { "user_id":9, "name":"Rahul Kumar", "zone":"NCR", "skills":["CHIP_LEVEL","HARDWARE_BASIC"],
                  "jobs_today": 8, "max_jobs": 6, "over": true, "on_leave": false } ],
  "waiting": { "PENDING_CUSTOMER": 18, "PENDING_PART": 9, "PENDING_VENDOR": 4, "PENDING_APPROVAL": 4 },
  "quality": { "reopened_week": 6, "reopened_delta": 3, "fcr_pct": 78, "csat_30d": 4.3, "repeat_assets": 5 },
  "approvals": [ { "approval_id": 1, "approval_type":"REPLACEMENT", "label":"Replacement · ₹52,000 · Bluepeak" } ] }
```

---

## 3.3 REFERENCE IMPLEMENTATION — `TicketQueuePage.jsx`

Build this file exactly. It is the template for every other list screen in the module.

```jsx
// frontend/src/features/support-v2/pages/TicketQueuePage.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ListChecks, Plus, Search, Bookmark } from 'lucide-react';
import { PageHeader, Button, EmptyState, ResponsiveTable, ListPagination } from '../../../components/ui/primitives';
import { PriorityChip, prioritySpine, SlaChip, ClassificationChain, Mono, StatusPill }
  from '../../../components/ui/supportPrimitives';
import PermissionGate from '../../../components/PermissionGate';
import { usePermission } from '../../../hooks/usePermission';
import useUrlFilters from '../../../hooks/useUrlFilters';
import useDebouncedUrlSearch from '../../../hooks/useDebouncedUrlSearch';
import { listTickets, listViews, getTicketCounts, bulkAssign } from '../supportV2Api';

const PAGE_SIZE = 25;

const DEFAULTS = {
  page: 1, view: 'all_open', search: '',
  class: '', priority: '', type_id: '', subtype_id: '', issue_id: '',
  status: '', sla: '', group_id: '', assigned_to: '', channel: '',
  date_from: '', date_to: '', sort: 'priority_sla',
};

export default function TicketQueuePage() {
  const nav = useNavigate();
  const { canCreate } = usePermission();
  const { filters, setFilters, resetFilters } = useUrlFilters(DEFAULTS);
  const { searchInput, setSearchInput, debouncedSearch } = useDebouncedUrlSearch(filters, setFilters);

  const [rows, setRows] = useState([]);
  const [views, setViews] = useState([]);
  const [counts, setCounts] = useState({});
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });

  useEffect(() => {
    Promise.all([listViews(), getTicketCounts()])
      .then(([v, c]) => { setViews(v.data?.rows || []); setCounts(c.data?.counts || {}); })
      .catch(() => toast.error('Failed to load saved views'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTickets({
        ...filters,
        search: debouncedSearch.trim() || undefined,
        limit: PAGE_SIZE,
      });
      setRows(res.data?.rows || []);
      setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
      setSelected([]);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [filters, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  const allChecked = rows.length > 0 && selected.length === rows.length;
  const toggleAll = () => setSelected(allChecked ? [] : rows.map(r => r.ticket_id));
  const toggleOne = (id) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const columns = useMemo(() => [
    {
      key: 'sel', header: '', className: 'w-8',
      render: (r) => (
        <input
          type="checkbox"
          checked={selected.includes(r.ticket_id)}
          onChange={(e) => { e.stopPropagation(); toggleOne(r.ticket_id); }}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${r.ticket_number}`}
        />
      ),
    },
    {
      key: 'ticket', header: 'Ticket', className: 'w-[104px]',
      render: (r) => (
        <div>
          <PriorityChip priority={r.priority} />
          <div className="mt-[3px]"><Mono bold className="text-[11px]">{r.ticket_number}</Mono></div>
        </div>
      ),
    },
    {
      key: 'customer', header: 'Customer & site', className: 'w-[170px]',
      render: (r) => (
        <div>
          <div className="font-semibold text-sup-ink">{r.customer_name}</div>
          <div className="text-[10px] text-sup-muted">{r.site_label}</div>
          {r.support_tier === 'PLATINUM' && (
            <span className="inline-flex items-center h-[19px] px-1.5 rounded-full text-[10.5px]
                             font-semibold bg-sup-accentSoft text-sup-accent mt-0.5">Platinum</span>
          )}
        </div>
      ),
    },
    {
      key: 'classification', header: 'Classification',
      render: (r) => (
        <div>
          <ClassificationChain {...r.primary_classification} />
          {r.asset_count > 1 && (
            <div className="text-[10px] text-sup-muted mt-0.5">
              +{r.asset_count - 1} more machine{r.asset_count > 2 ? 's' : ''}
              {r.mixed_issues ? ' · mixed issues' : ''}
            </div>
          )}
          <div className="flex gap-1 flex-wrap mt-0.5">
            {r.flags?.safety && <Flag tone="hot">Safety — forced P1</Flag>}
            {r.flags?.repeat && <Flag tone="hot">Repeat</Flag>}
            {r.flags?.chargeable_pending && <Flag tone="warm">Chargeable · awaiting approval</Flag>}
            {r.flags?.kb_suggested && <Flag tone="acc">KB suggested</Flag>}
          </div>
        </div>
      ),
    },
    {
      key: 'assets', header: 'Assets', className: 'w-[118px]',
      render: (r) => r.primary_ttspl_id
        ? (<div><Mono className="text-[11px]">{r.primary_ttspl_id}</Mono>
             {r.asset_count > 1 && <div className="text-[10px] text-sup-muted">+{r.asset_count - 1} assets</div>}</div>)
        : <span className="text-[11px] text-sup-faint">No asset</span>,
    },
    { key: 'status', header: 'Status', className: 'w-[110px]',
      render: (r) => <StatusPill kind="ticket" status={r.status} pendingReason={r.pending_reason} /> },
    {
      key: 'sla', header: 'Resolution SLA', className: 'w-[96px]',
      render: (r) => <SlaChip dueAt={r.sla_resolution_due_at} startedAt={r.sla_started_at} paused={r.sla_paused} />,
    },
    { key: 'owner', header: 'Owner', className: 'w-[96px]',
      render: (r) => r.assigned_to_name
        ? <span className="text-[11px]">{r.assigned_to_name}</span>
        : <span className="text-[11px] text-sup-faint">Unassigned</span> },
    {
      key: 'wo', header: 'Work orders', className: 'w-[82px]',
      render: (r) => r.open_wo_count > 0
        ? (<span className="inline-flex items-center h-[18px] px-1.5 rounded text-[10px] font-semibold
                            font-mono uppercase whitespace-nowrap bg-sup-accentSoft text-sup-accent">
             {r.open_wo_count} open</span>)
        : <span className="text-[11px] text-sup-faint">—</span>,
    },
  ], [selected, rows]);

  const renderCard = (r) => (
    <div className={`bg-white border border-sup-line rounded-lg p-3 ${prioritySpine(r.priority)}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <PriorityChip priority={r.priority} />
        <Mono bold className="text-[11px]">{r.ticket_number}</Mono>
        <div className="ml-auto"><SlaChip dueAt={r.sla_resolution_due_at} paused={r.sla_paused} /></div>
      </div>
      <div className="font-semibold mt-1.5">{r.customer_name}</div>
      <div className="text-[10px] text-sup-muted">{r.site_label}</div>
      <div className="mt-1"><ClassificationChain {...r.primary_classification} /></div>
      <div className="flex items-center gap-2 mt-2">
        <StatusPill kind="ticket" status={r.status} />
        <span className="text-[11px] text-sup-muted ml-auto">{r.assigned_to_name || 'Unassigned'}</span>
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Ticket queue"
          subtitle="One list. Everything else is a saved view of it."
          icon={ListChecks}
        />
        <div className="flex gap-2">
          <Button variant="secondary" icon={Bookmark} onClick={() => {/* save current filters */}}>
            Save this view
          </Button>
          <PermissionGate section="support_tickets" action="create">
            <Button variant="primary" icon={Plus} onClick={() => nav('/support-v2/tickets/new')}>
              New ticket
            </Button>
          </PermissionGate>
        </div>
      </div>

      <div className="mt-4 bg-white border border-sup-line rounded-xl shadow-sup">
        {/* ── saved views ── */}
        <div className="flex items-center gap-2 flex-wrap px-4 pt-3">
          <span className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold mr-1">
            Saved views
          </span>
          {views.map(v => (
            <button
              key={v.slug}
              type="button"
              onClick={() => setFilters({ ...DEFAULTS, view: v.slug })}
              className={`h-7 px-2.5 rounded-full text-[11.5px] inline-flex items-center gap-1.5 border
                ${filters.view === v.slug
                  ? 'bg-sup-accent border-sup-accent text-white'
                  : 'bg-white border-sup-line text-sup-ink2 hover:bg-sup-canvas2'}`}
            >
              {v.name}
              {counts[v.slug] != null && (
                <span className="font-mono text-[10.5px] opacity-75">{counts[v.slug]}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── filters ── */}
        <div className="flex gap-2 flex-wrap items-center px-4 py-3 border-b border-sup-lineSoft">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sup-faint pointer-events-none" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Ticket, TTSPL, serial, customer, phone"
              className="w-[260px] h-7 border border-sup-line rounded-md pl-9 pr-3 text-[11.5px]"
            />
          </div>
          <Sel value={filters.class}       onChange={v => setFilters({ class: v, page: 1 })}       label="Class"     options={CLASS_OPTS} />
          <Sel value={filters.priority}    onChange={v => setFilters({ priority: v, page: 1 })}    label="Priority"  options={PRIORITY_OPTS} />
          <Sel value={filters.type_id}     onChange={v => setFilters({ type_id: v, subtype_id: '', issue_id: '', page: 1 })} label="Type" options={typeOpts} />
          <Sel value={filters.subtype_id}  onChange={v => setFilters({ subtype_id: v, issue_id: '', page: 1 })} label="Subtype" options={subtypeOpts} disabled={!filters.type_id} />
          <Sel value={filters.issue_id}    onChange={v => setFilters({ issue_id: v, page: 1 })}    label="Issue type" options={issueOpts} disabled={!filters.subtype_id} />
          <Sel value={filters.status}      onChange={v => setFilters({ status: v, page: 1 })}      label="Status"    options={STATUS_OPTS} />
          <Sel value={filters.sla}         onChange={v => setFilters({ sla: v, page: 1 })}         label="SLA"       options={SLA_OPTS} />
          <Sel value={filters.group_id}    onChange={v => setFilters({ group_id: v, page: 1 })}    label="Group"     options={groupOpts} />
          <Sel value={filters.assigned_to} onChange={v => setFilters({ assigned_to: v, page: 1 })} label="Owner"     options={ownerOpts} />
          <Sel value={filters.channel}     onChange={v => setFilters({ channel: v, page: 1 })}     label="Channel"   options={CHANNEL_OPTS} />
          <button type="button" onClick={resetFilters}
                  className="h-7 px-2 text-[11.5px] text-sup-accent hover:underline">Clear</button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-sup-muted">Sort</span>
            <Sel value={filters.sort} onChange={v => setFilters({ sort: v, page: 1 })} options={SORT_OPTS} bare />
          </div>
        </div>

        <ResponsiveTable
          columns={columns}
          rows={rows}
          keyField="ticket_id"
          loading={loading}
          renderCard={renderCard}
          rowClassName={(r) => prioritySpine(r.priority)}
          onRowClick={(r) => nav(`/support-v2/tickets/${r.ticket_id}`)}
          empty={<EmptyState icon={ListChecks} title="No tickets match these filters"
                             hint="Clear a filter or pick another saved view" />}
        />

        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-sup-lineSoft flex-wrap">
          <span className="text-[11px] text-sup-muted">
            {selected.length > 0 ? `${selected.length} selected · ` : ''}
            showing {rows.length} of {pagination.total}
          </span>
          <div className="flex items-center gap-2">
            {selected.length > 0 && (
              <>
                <PermissionGate section="support_dispatch" action="edit">
                  <Button size="sm" variant="secondary" onClick={() => {/* open assign modal */}}>Assign selected</Button>
                </PermissionGate>
                <PermissionGate section="support_triage" action="edit">
                  <Button size="sm" variant="secondary" onClick={() => {/* open priority modal */}}>Change priority</Button>
                </PermissionGate>
                <PermissionGate section="support_work_orders" action="create">
                  <Button size="sm" variant="secondary" onClick={() => {/* open WO modal */}}>Create work order</Button>
                </PermissionGate>
              </>
            )}
            <ListPagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              pageSize={pagination.limit}
              onPageChange={(n) => setFilters({ page: n })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── local helpers ─────────────────────────────────────── */
function Flag({ tone, children }) {
  const t = { hot: 'bg-pri1-bg text-pri1', warm: 'bg-pri2-bg text-pri2', acc: 'bg-sup-accentSoft text-sup-accent' }[tone];
  return <span className={`inline-flex items-center h-[19px] px-1.5 rounded-full text-[10.5px] font-semibold ${t}`}>{children}</span>;
}

function Sel({ value, onChange, label, options, disabled, bare }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 border border-sup-line rounded-md bg-white pl-2.5 pr-6 text-[11.5px]
                 text-sup-ink2 disabled:opacity-50 appearance-none
                 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%228%22 height=%225%22><path d=%22M0 0l4 5 4-5z%22 fill=%22%236B7382%22/></svg>')]
                 bg-no-repeat bg-[right_8px_center]"
    >
      {!bare && <option value="">{label} · all</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
```

### Notes the implementer must not skip
- **No client-side sorting.** `rows` is rendered in the order the server returned it. The existing
  `SupportTicketList.jsx:265` re-sorts a server page by descending id — that is the bug we are fixing.
- The **priority spine** is applied via `rowClassName` on `ResponsiveTable`. If `ResponsiveTable`
  does not support `rowClassName`, add the prop — it is a two-line change and every screen needs it.
- Filters live in the URL (`useUrlFilters`), so a lead can paste a filtered queue link into WhatsApp.
- Type → Subtype → Issue are **dependent** selects: changing the parent clears the children.

---

## 3.4 S1 — Command centre

`features/support-v2/pages/CommandCentrePage.jsx`. Single call to `GET /dashboard`. Layout matches
the mockup exactly:

1. **KPI row** — 4 tiles. "Breaching in 4 h" uses the alarm variant (`border-pri1-ring bg-[#FEF7F8]`,
   value in `text-pri1`). Numbers are `tabular-nums`, 27px, `-0.035em` tracking. No icons, no gradients.
2. **SLA risk — act now** (left, wider) — a 5-row table, same row anatomy as S2, clicking a row
   navigates to the ticket. Header has an "Open queue →" ghost button that navigates to
   `/support-v2/queue?view=breaching`.
3. **Open tickets by priority** — a single horizontal stacked bar (8px, rounded) plus a legend.
   Not a pie, not a donut, no chart library needed — it is four `<i>` elements with percentage widths.
4. **Today's field capacity** — one row per technician: avatar, name, zone + skills, a capacity bar
   (green under limit, amber near, `pri1` over), "8 of 6 jobs · over", and a Rebalance/Assign button
   gated on `support_dispatch · edit`. Technicians on leave show "Not available" and no bar.
5. **Bottom row, three cards** — Waiting on someone / Quality signals / Needs your decision.
   In "Waiting on someone", `Pending part` is rendered in `text-pri2` with the label
   "SLA running" while the others say "SLA paused". That visual asymmetry is deliberate and is the
   whole point of PLAN §8.3 — do not normalise it.

**Permission behaviour:** the whole page is `support_dashboard · view`. The "Needs your decision"
card only renders for users with `support_approvals · view`. The capacity card's buttons only
render with `support_dispatch · edit`.

---

## 3.5 Wire up badges
`GET /api/support/v2/badges` now returns real numbers:
`open_tickets` (open assigned to anyone), `unassigned_wos`, `parts_pending`, `approvals_pending`,
`my_jobs` (WOs assigned to the caller, not terminal).

---

## VERIFICATION CHECKLIST — Phase 3

**Queue correctness**
- [ ] Default order is: breached first, then P1→P4, then earliest due
- [ ] Page 2 continues that order — no duplicates, no gaps (page through the whole set and count)
- [ ] Changing a filter resets to page 1
- [ ] Every filter narrows the result; combining Type + SLA + Owner works
- [ ] Selecting Type enables Subtype; changing Type clears Subtype and Issue
- [ ] Search finds a ticket by its **legacy** number
- [ ] Saved view chips show counts, and clicking one replaces all filters
- [ ] Copying the URL into a new tab reproduces the exact same filtered list

**Visual fidelity — compare side by side with the mockup**
- [ ] Priority spine on every row, correct colour
- [ ] All identifiers monospace with tabular numerals
- [ ] SLA chip shows the depleting bar and the right colour state
- [ ] A paused ticket shows `‖ paused` in grey, not a countdown
- [ ] A breached ticket shows a negative countdown in crimson
- [ ] Classification renders as `Type › Subtype › Issue` with the issue bold
- [ ] Flags (Safety / Repeat / Chargeable / KB) render where applicable

**Permissions**
- [ ] `support_tickets · view` only → sees the queue, no New ticket button, no bulk buttons
- [ ] add `create` → New ticket button appears
- [ ] add `support_dispatch · edit` → Assign selected appears
- [ ] `support_dashboard` removed → S1 is not reachable and its nav item is hidden, but S2 still works

**Dashboard**
- [ ] One network call renders the whole page
- [ ] KPI numbers reconcile against the queue (open count === `all_open` view count)
- [ ] Capacity shows an over-capacity technician in `pri1` and an on-leave technician as unavailable
- [ ] Pending part is styled as SLA-running, the other three as SLA-paused

**Responsive**
- [ ] At 375px the table becomes cards via `renderCard` and every card still shows priority + SLA
- [ ] No horizontal scrolling on mobile

**Build**
- [ ] `npm test` green · `npm run build` clean · phase report written with screenshots of S1 and S2
      next to the mockup
