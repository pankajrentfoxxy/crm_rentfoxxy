# Phase 09 report — One technician bucket, one identity, dispatch board

Branch: `support-revamp` (no per-phase branch).  
Depends on: Phase 00–08 (uncommitted on this branch).  
Legacy `/support/*` was not rewritten.

## The rule

One query, one identity (`users.user_id` / `assigned_to` / `assigned_user_id`), one screen. A technician never reads another technician's bucket. A lead sees everyone on the dispatch board.

## Migration numbers

Prompt asked for `204_support_v2_identity.sql`. 204 is saved views.

| File | Purpose |
|---|---|
| `backend/migrations/210_support_v2_identity.sql` | `delivery_challan_lines.assigned_user_id`; WO `slot_*`, `distance_km`, `sla_due_at`, `priority` |

`delivery_person_id` stays until Phase 11. Unresolved rows: run `node scripts/report-identity-unresolved.js` after Docker migrate. See `IDENTITY_UNRESOLVED.md`.

## Endpoints

```
GET  /me/bucket
GET  /me/bucket/summary
POST /me/bucket/sync
GET  /dispatch/board
POST /dispatch/assign          warning (not 409) on capacity/skill override
POST /dispatch/auto-assign     dry_run supported, per-WO explanation
GET  /dispatch/capacity
```

`GET /me/bucket` always uses `req.user.user_id`.

## Auto-assign

`supportAssignmentEngine.js`: zone → skill → leave/shift → capacity, then continuity / proximity / load. A `CHIP_LEVEL` job is never given to a delivery-only technician. No eligible tech → stays `PENDING_ASSIGNMENT` and an `ASSIGNMENT_UNASSIGNED` event is logged.

## UI

- S11 `BucketPage` — dark top strip, tabs, grouped trip cards, 44px actions, bottom nav
- S10 `DispatchBoardPage` — HTML5 drag-and-drop + keyboard (select, Enter on a cell)
- S12 sticky step progress; Complete shows “N steps remaining”
- `manifest.json` + `sw.js` for install / offline shell

## How to check (after Docker migrations)

```bash
cd backend
node scripts/run-all-migrations.js
node scripts/report-identity-unresolved.js
npm test
cd ../frontend && npm run build
```

Do not apply these migrations from this machine. Do not run them against Railway.
