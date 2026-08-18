# Phase 01 report — Taxonomy, priority, SLA

Branch: `support-revamp/phase-01`  
Depends on: Phase 00 (still on this branch; not yet merged).  
Legacy `/support/*` was not edited.

## Migration numbers

The prompt asked for `194` / `195`. Those numbers (and 196–198) are already used.

| File | Purpose |
|---|---|
| `backend/migrations/199_support_v2_taxonomy.sql` | Catalogue + resolution / root-cause / action codes |
| `backend/migrations/200_support_v2_sla.sql` | Calendars, holidays, policies, pause log, `customers.support_tier` |

`SUPPORT_REVAMP_PLAN.md` was not in the repo. The 7 types / 41 subtypes / level-3 rows were built from PHASE_01 (named Hardware subtypes, safety/chargeable/photo rules, `*-UNS` placeholders) plus codes referenced in Phases 02/04/06 (`SW-OS`, `NET-WIF`, `LOG-RET`, `LOG-RET-EOC`, `SVC-SLA`, `RES-FOS`). Drop the plan into `docs/support-revamp/` if a later pass must match §5.3 verbatim.

## Catalogue

- 7 level-1 types: HW, SW, PER, NET, LOG, COM, SVC
- 41 level-2 subtypes (12 hardware as specified, plus software / peripherals / network / logistics / commercial / service)
- Active level-3 issues including `HW-DIS-CRK` (Cracked panel)
- Inactive `<SUBTYPE>-UNS` Unspecified under every subtype
- Safety: Battery swollen, Burning smell, Liquid damage, Cable frayed, Ransomware, Damaged in transit
- Chargeable-by-default: Cracked panel, Body crack, Hinge broken, Screen bezel damaged, Liquid spill on keyboard, Lost by customer (adapter/mouse/bag), Power surge
- Photos mandatory on every HW-DIS / HW-BDY issue and every chargeable-default issue

## SLA

| Policy | Priority | Calendar | Response | Resolution | Specificity |
|---|---|---|---|---|---|
| Default P1 — Critical | 1 | ALWAYS_ON | 1 h | 8 h | 0 |
| Default P2 — High | 2 | BUSINESS_MON_SAT | 2 h | 24 h | 0 |
| Default P3 — Moderate | 3 | BUSINESS_MON_SAT | 4 h | 48 h | 0 |
| Default P4 — Low | 4 | BUSINESS_MON_SAT | 8 h | 72 h | 0 |
| Platinum — High | 2 | BUSINESS_MON_SAT | 1 h | 12 h | 10 |

Pause: `PENDING_CUSTOMER`, `PENDING_VENDOR`, and `PENDING_APPROVAL` when `customer_side`. `PENDING_PART` / `PENDING_WAREHOUSE` do not move the clock. Response clock never pauses.

Phase 1 persists clocks on `support_sla_clocks` until Phase 2 creates `support_tickets_v2`.

## API

- `GET/POST/PATCH/DELETE /api/support/v2/taxonomy/catalog…`
- `GET /taxonomy/catalog/search?q=` — recursive CTE, type + subtype chain
- `GET /taxonomy/catalog/tree`
- `GET /taxonomy/resolution-codes|root-causes|action-codes`
- `GET/POST/PATCH /api/support/v2/sla/policies`
- `GET /sla/calendars` · `POST /sla/calendars/:id/holidays`
- `POST /sla/preview` — priority reasons + policy + due dates

## UI

- `/support-v2/taxonomy` — S18 two-column tree + detail (view-only when no edit; Add gated on create)
- `/support-v2/sla` — S17 policies table + calendar/holiday editor; KPI/breach block left as Phase 10 placeholder

## Phase 02 (not started)

Phase 02 is the core model + live-data backfill. It needs a database snapshot first. Do not start it until Phase 01 is applied and checked on local.

## How to check

```bash
cd backend
node scripts/run-all-migrations.js    # APPLIED 199 and 200
npm test
cd ../frontend && npm run build
```

Then in the browser: search “cracked” on S18, open a view-only taxonomy user, `POST /sla/preview` for the Platinum demo customer with impact 2 / urgency 2 (expect P2 + Platinum — High 1 h / 12 h).
