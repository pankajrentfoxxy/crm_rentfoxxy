# Phase 03 report — Command centre and Ticket queue

Branch: `support-revamp/phase-03`  
Depends on: Phase 00–02 (still on this branch; not committed).  
Legacy `/support/*` was not edited.

Phase 02 was already complete (201–203, backfill, read API, single-writer). This phase adds the two screens that replace eight old nav items.

## Migration numbers

The prompt asked for `199_support_v2_saved_views.sql`. 199 is taxonomy.

| File | Purpose |
|---|---|
| `backend/migrations/204_support_v2_saved_views.sql` | Saved views + seven system chips |

## API

| Method | Path | Permission |
|---|---|---|
| GET | `/api/support/v2/views` | `support_tickets · view` |
| POST | `/api/support/v2/views` | `support_tickets · view` |
| DELETE | `/api/support/v2/views/:id` | own views only |
| GET | `/api/support/v2/tickets/counts` | one query, seven chips |
| GET | `/api/support/v2/queue-meta` | catalog + groups + owners |
| GET | `/api/support/v2/dashboard` | `support_dashboard · view` |
| POST | `/api/support/v2/tickets/bulk-assign` | `support_dispatch · edit` |
| GET | `/api/support/v2/tickets` | full filter contract + `view=` |

List order is still server-side: breached first, then P1→P4, then earliest due. `sort=sla|newest|age` are alternatives. No client re-sort.

`GET /tickets/counts` is registered before `/tickets/:id`.

## UI

- `/support-v2/queue` — S2 from the phase reference. Filters live in the URL. Type → subtype → issue are dependent. Priority spine via `ResponsiveTable.rowClassName` (added this phase).
- `/support-v2/dashboard` — S1, one `GET /dashboard` call. Alarm KPI for breaching-in-4h. Pending part is `text-pri2` / “SLA running”; the other three waiting reasons say “SLA paused”.
- Approvals card gated on `support_approvals · view`. Capacity Assign/Rebalance gated on `support_dispatch · edit`.
- Bulk assign works. Change priority / create WO toast that those land in later phases.

## How to check (after Docker migrations)

```bash
cd backend
node scripts/run-all-migrations.js
npm test
cd ../frontend && npm run build
```

Open `/support-v2/queue` and `/support-v2/dashboard`. Paste a filtered queue URL into another tab — same list. A user without `support_dashboard · view` still reaches the queue.
