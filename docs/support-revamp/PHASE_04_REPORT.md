# Phase 04 report — Complaint flow (create, detail, resolve)

Branch: `support-revamp/phase-04`  
Depends on: Phase 00–03 (still on this branch; not committed).  
Legacy `/support/*` was not edited.

After this phase an agent can log a classified multi-machine complaint, work it on the ticket, and resolve a line that needs no field job. Work orders stay Phase 5.

## Migration numbers

The prompt did not name a file. Next free number after 204 is 205.

| File | Purpose |
|---|---|
| `backend/migrations/205_support_v2_ticket_flow.sql` | `support_ticket_links`, `reopen_count` / `reopen_reason`, `time_spent_minutes`, `contact_method` on events |

## API

All under `/api/support/v2`. More-specific routes are registered before `/tickets/:id`.

| Method | Path | Permission |
|---|---|---|
| POST | `/tickets` | `support_tickets · create` |
| GET | `/customers/search` | view |
| GET | `/customers/:id/context` | view |
| GET | `/customers/:id/assets` | view |
| GET | `/tickets/search` | view (global search) |
| GET | `/lines/:lineId/repeat-check` | view |
| PATCH | `/tickets/:id` | edit |
| POST | `/tickets/:id/classify` | `support_triage · edit` |
| POST | `/tickets/:id/priority-override` | `support_triage · edit` |
| POST | `/tickets/:id/assign` | edit |
| POST | `/tickets/:id/status` | edit |
| POST | `/tickets/:id/pause` | edit — `PENDING_CUSTOMER` needs `contact_method` |
| POST | `/tickets/:id/resume` | edit |
| POST | `/tickets/:id/resolve` | edit — blockers + breach_reason |
| POST | `/tickets/:id/close` | edit |
| POST | `/tickets/:id/reopen` | edit — 7-day window |
| POST | `/tickets/:id/cancel` | delete |
| POST | `/tickets/:id/link` | edit |
| POST | `/tickets/:id/comment` | view |
| POST | `/tickets/:id/attachments` | edit (existing multer) |
| POST | `/attachments/staging` | create (wizard photos before the ticket exists) |
| POST | `/lines/:lineId/found` | edit |
| POST | `/lines/:lineId/resolve` | edit — hard gate; chargeable needs `support_charges` + photo |

Create still inserts `NEW`, then `computeTicketStatus` moves a fully classified unassigned ticket to **TRIAGED**. Assigned tickets become **ASSIGNED**. Status writes stay in `supportTicketStateService` (`forceTicketStatus` for close / cancel / reopen).

`GET /taxonomy/catalog/search` (and tree / codes) and `POST /sla/preview` also accept `support_tickets · view` so agents without admin sections can classify and preview SLA.

## UI

- `/support-v2/tickets/new` — S3–S6 wizard. Continue stays disabled until every machine has L3 + 15-char description (+ photo when `requires_photo`). Invalid classify cards use `border-pri1`.
- `/support-v2/tickets/:id` — S7 from one `GET /tickets/:id`. Resolve machine opens S8.
- Sidebar search: `STK-…`, `#1234`, and `T-1234` call `GET /tickets/search` and link to the v2 ticket.

Client `computePriority` is a preview only. The server recomputes on create.

## How to check (after Docker migrations)

```bash
cd backend
node scripts/run-all-migrations.js
npm test
cd ../frontend && npm run build
```

Do not apply these migrations from this machine. Do not run them against Railway.
