# Phase 08 report — Unified part requests

Branch: `support-revamp/phase-08`  
Depends on: Phase 00–07 (still on this branch; not committed).  
Legacy `/support/*` tables and controllers were not rewritten. `support_part_requests` is copied into `part_requests` and left in place.

## The rule

One table, `part_requests`, with `context` `FLOOR` | `FIELD`. One `status_v2` vocabulary. One warehouse queue sorted by **the waiting ticket's priority**, not FIFO.

A stock-out blocks the **asset line** (`PENDING_PART`), not the ticket. Other machines on the same ticket keep working. The ticket SLA keeps running. A chargeable part is different: `pending_reason = PENDING_CUSTOMER` and the SLA pauses.

## Migration numbers

Prompt asked for `203_support_v2_parts_unify.sql`. 203 is billing hooks.

| File | Purpose |
|---|---|
| `backend/migrations/209_support_v2_parts_unify.sql` | Extend `part_requests`; backfill floor + field; `part_compatibility`; add `PENDING_PART` to line status |

## Flow

1. Tech requests from the job screen. Photo is mandatory (API, not just UI). Catalogue is filtered by `part_compatibility`; no rows → full list + warning.
2. Out of stock → `ESCALATED_TO_PROCUREMENT`, line `PENDING_PART`.
3. Chargeable → `CHARGEABLE_PART` approval + SLA pause.
4. Warehouse approve (Lead if amount > ₹5,000) → reserve instance → `PART_DELIVERY` in the requesting tech's bucket, same day. `SPC-` or `PDC-`.
5. Issue → instance `with_technician`.
6. Consume → part QR + laptop serial + fitted photo. Mismatch is 409. Stock decrements. Chargeable posts an extra invoice line. Old part expected → `PART_RETURN` same bucket.
7. Unused → `RETURNED_UNUSED`, instance back to `in_stock`.

## Endpoints

```
GET  /parts/compatible
POST /parts/requests
GET  /parts/requests
GET  /parts/queue
POST /parts/requests/:id/approve|reject|escalate|issue|consume|return-unused|cancel
```

## UI

- S14 `PartsQueuePage` at `/support-v2/parts` (still gated `support_parts_approve` view).
- S15 `RequestPartSheet` on the job screen.
- Ticket header: "N of M machines waiting for part".

## How to check (after Docker migrations)

```bash
cd backend
node scripts/run-all-migrations.js
npm test
cd ../frontend && npm run build
```

Do not apply these migrations from this machine. Do not run them against Railway.
