# Phase 06 report — Return pickup · Condition grading · Bulk returns · Credit notes

Branch: `support-revamp/phase-06`  
Depends on: Phase 00–05 (still on this branch; not committed).  
Legacy `/support/*` tables and controllers were not rewritten.

## The rule

`RETURN_PICKUP` is a **different type**, not a flag on repair. Two effect modules. No heuristic.

| | `REPAIR_PICKUP` (Phase 5) | `RETURN_PICKUP` (this phase) |
|---|---|---|
| Ticket class | INCIDENT | REQUEST (`LOG-RET-*`) |
| Billing | hold | **stop** |
| Credit note | none | **once, at warehouse receipt** |
| Customer inventory | stays, `UNDER_REPAIR` | removed, `PASSIVE` |
| Destination | back to same customer | free stock (after floor QC) |
| Grading | optional | **mandatory** A/B/C/D |

## Migration numbers

Prompt asked for `201_support_v2_return_pickup.sql`. 201 is core.

| File | Purpose |
|---|---|
| `backend/migrations/207_support_v2_return_pickup.sql` | `site_id`, `requires_eway_bill`, `billing_stop_date`; `support_asset_condition`; accessory + damage catalogues; unique `(serial_id, wo_id)` on credit notes |

`bulk_group_id` already exists as `VARCHAR(40)` from 201. Kept. UUID strings fit. Site FK uses `customer_addresses(customer_address_id)`, not the prompt’s non-existent `address_id`.

## Engine

The WO engine was **not** rewritten. `workOrderEffects/index.js` gained one key: `RETURN_PICKUP`.

- `onCreate` — deployed + belongs to customer; lock-in → `EARLY_TERMINATION` + hold `DRAFT`; overdue invoices notify Accounts and **do not block**; Return DC `dc_purpose='return'`; e-way flag if consignment > ₹50,000; mint OTP.
- `onComplete` (at customer) — `markInTransit` reason `SUPPORT_RETURN_PICKUP`; `PASSIVE`; billing stop. **No credit note.**
- `onWarehouseReceipt` — `markReturned` (now a legal `in_transit → returned` move) + floor QC (`pickup_type: 'return'`) + `raiseReturnCreditNoteOnce`. Unique `(serial_id, wo_id)` makes a retry a no-op.

`generateReturnDc` now takes `{ purpose }`. Repair still defaults to `repair_pickup`.

## Endpoints

```
POST /work-orders/:woId/condition          support_bucket · edit, own job
POST /work-orders/:woId/warehouse-receipt  support_pickup_return · edit
POST /returns/bulk                         support_pickup_return · create
GET  /returns/bulk/:groupId                support_pickup_return · view
POST /returns/preview
GET  /returns/catalog
POST /approvals/:id/decide                 support_approvals · edit
```

Approving or waiving `EARLY_TERMINATION` moves a `DRAFT` WO to `PENDING_ASSIGNMENT`. Damage charges stay `PENDING` on `customer_invoice_extra_lines` until decided.

Bulk grouping: 40 assets at one site, capacity 25 → **2** work orders, one parent REQUEST ticket (`LOG-RET-EOC`), shared `bulk_group_id`. Across sites, groups split by site first.

## UI

- `/support-v2/returns/bulk` — 4-step wizard (customer/site/reason → multi-select → lock-in warning → schedule + “N assets → M work orders”).
- `ConditionGradingSheet` on the `GRADE` job step — A/B/C/D tap targets with the spec definitions, damage + accessory checklists, photos, live “Chargeable so far: ₹X”.
- `/support-v2/returns/receipt` — scan expected list; unscanned serials need a short-shipment reason.
- Nav: Bulk return (create) and Warehouse receipt, both gated on `support_pickup_return`.

## How to check (after Docker migrations)

```bash
cd backend
node scripts/run-all-migrations.js
npm test
cd ../frontend && npm run build
```

Do not apply these migrations from this machine. Do not run them against Railway.
