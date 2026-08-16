# Phase 05 report — Work order engine · Field visit · Repair pickup · Service return

Branch: `support-revamp/phase-05`  
Depends on: Phase 00–04 (still on this branch; not committed).  
Legacy `/support/*` tables and controllers were not rewritten. `ticketController.js` got a **link hook** only: when a floor ticket completes, it may auto-create a `SERVICE_RETURN` WO if a completed repair pickup points at that floor ticket.

## Migration numbers

Prompt asked for `200_support_v2_wo_engine.sql`. 200 is SLA.

| File | Purpose |
|---|---|
| `backend/migrations/206_support_v2_wo_engine.sql` | `skips_travel`, `support_wo_idempotency`, WO document / floor / outcome columns |

## Engine

- `supportWorkOrderService.js` — one `TRANSITIONS` table, `assertTransition`, step instantiate/complete/mandatory gate, create/assign/advance/complete/fail/cancel.
- `REMOTE_FIX` skips travel via `wo_type_config.skips_travel`, not an `if (wo_type === …)` in the machine.
- Completion effects are a strategy map: `workOrderEffects/{fieldVisit,repairPickup,serviceReturn}.js`. Phases 6–8 add files there.
- OTP verify updates `WHERE wo_id = $1` only. Grep test forbids `OR document_number`.
- Pickup eligibility lives in **one** file: `supportPickupEligibility.js`.
- Inventory moves go through `inventoryStateMachine.markInTransit` / `markDelivered`. `rented|on_demo|sold → in_transit` was added so a repair pickup can leave site without a credit-note return.
- Customer inventory `UNDER_REPAIR` / `ACTIVE` is extra JSON on the serial — `current_customer_id` stays put.
- Technician mutating routes accept `Idempotency-Key`.
- Type overlay: create needs `support_work_orders` **and** the type section. Bucket actions are own-job only (`assigned_to = user`).

## UI

- S9 `CreateWorkOrderModal` — type chips filtered by permission.
- S7 work-order cards show type, number, status, assignee, document, `n / m steps`.
- `/support-v2/jobs/:woId` — S12/S13, steps from config, kind renderers (GPS, scan/`html5-qrcode`, photo, checklist, OTP, `signature_pad`, form, confirm).
- `/support-v2/bucket` — own jobs list.
- `offlineQueue.js` — IndexedDB FIFO + “N actions pending sync” banner.

## How to check (after Docker migrations)

```bash
cd backend
node scripts/run-all-migrations.js
npm test
cd ../frontend && npm run build
```

Do not apply these migrations from this machine. Do not run them against Railway.
