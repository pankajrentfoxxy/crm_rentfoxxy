# PHASE 5 — Work order engine · Field visit · Repair pickup · Service return

> Read `00_MASTER_CONTEXT.md` first.
> **Screens:** S9 (Create work order modal), the Work orders tab of S7, and the first working
> technician screens S12/S13 (desktop-usable; the polished mobile bucket is Phase 9).
> **Depends on:** Phase 4.
> **This is the engine phase.** Build it generically. Phases 6, 7 and 8 add work order *types*, not
> new machinery. If you find yourself writing `if (wo_type === 'REPAIR_PICKUP')` in more than two
> places, stop and move the behaviour into config or a strategy map.

---

## 5.1 The generic state machine

```
DRAFT → PENDING_ASSIGNMENT → ASSIGNED → ACCEPTED → EN_ROUTE → ON_SITE → IN_PROGRESS → COMPLETED
                                  │          │          │          │          │
                                  └──────────┴──────────┴──────────┴──────────┴──→ FAILED
                                  └──────────┴──────────┴──────────┴──────────┴──→ CANCELLED
```

Allowed transitions live in **one table**, not scattered `if`s:

```js
// backend/services/supportWorkOrderService.js
const TRANSITIONS = {
  DRAFT:              ['PENDING_ASSIGNMENT','CANCELLED'],
  PENDING_ASSIGNMENT: ['ASSIGNED','CANCELLED'],
  ASSIGNED:           ['ACCEPTED','PENDING_ASSIGNMENT','CANCELLED'],   // unassign is allowed
  ACCEPTED:           ['EN_ROUTE','ON_SITE','FAILED','CANCELLED'],     // remote jobs skip EN_ROUTE
  EN_ROUTE:           ['ON_SITE','FAILED','CANCELLED'],
  ON_SITE:            ['IN_PROGRESS','FAILED','CANCELLED'],
  IN_PROGRESS:        ['COMPLETED','FAILED'],
  COMPLETED:          [],
  FAILED:             [],
  CANCELLED:          [],
};
function assertTransition(from, to) {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw Object.assign(new Error(`Cannot move work order from ${from} to ${to}`), { status: 409 });
  }
}
```

`REMOTE_FIX` skips `EN_ROUTE`/`ON_SITE`. That is the only type-specific rule in the machine, and it
is expressed as `wo_type_config.skips_travel`, not as an `if`.

---

## 5.2 The step engine — this is what keeps types out of the status column

```js
/** Instantiate steps for a new WO from support_work_order_type_config. */
async function instantiateSteps(client, woId, woType) { … }

/** Mark one step done. Validates min_count for PHOTO steps, payload shape per step_kind. */
async function completeStep(client, { woId, stepCode, payload, userId }) { … }

/** Returns { ok, missing: [stepCode] } — COMPLETE is blocked unless ok. */
async function checkMandatorySteps(client, woId) { … }
```

`step_kind` determines the payload contract — validate it server-side:

| kind | payload | validation |
|---|---|---|
| `GPS` | `{ lat, lng, accuracy }` | lat/lng present and numeric |
| `SCAN` | `{ scanned_value, expected_value }` | must match the WO's asset; mismatch → 409 `ASSET_MISMATCH` |
| `PHOTO` | `{ attachment_ids: [] }` | `length >= min_count` |
| `CHECKLIST` | `{ items: [{code,label,checked,note}] }` | every item answered |
| `OTP` | `{ otp }` | matches `support_work_orders.customer_otp`, scoped to **this** WO only |
| `SIGNATURE` | `{ attachment_id }` | present |
| `FORM` | free JSON | per-step schema |
| `CONFIRM` | `{}` | — |

### The OTP rule — fixes PLAN D8 and D9
There is **one** OTP column, `support_work_orders.customer_otp`, and verification updates
**one** row:
```sql
UPDATE support_work_orders SET otp_verified_at = NOW() WHERE wo_id = $1
```
Never `WHERE ... OR document_number = $2`. The legacy code's batch-by-DC update is what let one
technician's e-sign silently mutate sibling pickups that then took a different inventory branch in
the same loop. Add a test that greps for `OR document_number` in the work order service and fails.

---

## 5.3 Migration `200_support_v2_wo_engine.sql`
```sql
ALTER TABLE support_work_order_type_config
  ADD COLUMN IF NOT EXISTS skips_travel BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS support_wo_idempotency (
  key         VARCHAR(80) PRIMARY KEY,
  wo_id       INT REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  response    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
**Idempotency matters from day one.** Technicians work in basements and lifts; the app will retry.
Every mutating technician endpoint accepts an `Idempotency-Key` header, and a repeat with the same
key returns the stored response instead of acting twice.

---

## 5.4 Endpoints

```
POST   /tickets/:id/work-orders          cp('support_work_orders','create')
GET    /work-orders                      cp('support_work_orders','view')
GET    /work-orders/:woId                cp('support_work_orders','view')
PATCH  /work-orders/:woId                cp('support_work_orders','edit')     slot, method, notes
POST   /work-orders/:woId/assign         cp('support_dispatch','edit')
POST   /work-orders/:woId/accept         cp('support_bucket','edit')          own only
POST   /work-orders/:woId/en-route       cp('support_bucket','edit')          own only
POST   /work-orders/:woId/on-site        cp('support_bucket','edit')          own only
POST   /work-orders/:woId/steps/:code    cp('support_bucket','edit')          own only
POST   /work-orders/:woId/verify-otp     cp('support_bucket','edit')          own only
POST   /work-orders/:woId/complete       cp('support_bucket','edit')          own only
POST   /work-orders/:woId/fail           cp('support_bucket','edit')          own only
POST   /work-orders/:woId/cancel         cp('support_work_orders','delete')
GET    /work-orders/:woId/document       type-specific section (see 5.6)
```

### Type-specific permission overlay
On top of `support_work_orders`, each type also checks its own section. Implement as one middleware:

```js
const WO_TYPE_SECTION = {
  FIELD_VISIT:          'support_field_visit',
  REMOTE_FIX:           'support_field_visit',
  REPAIR_PICKUP:        'support_pickup_repair',
  SERVICE_RETURN:       'support_pickup_repair',
  RETURN_PICKUP:        'support_pickup_return',
  REPLACEMENT_DELIVERY: 'support_replacement',
  PART_DELIVERY:        'support_parts_request',
  PART_RETURN:          'support_parts_request',
};
/** Requires BOTH support_work_orders AND the type's own section. */
function requireWoType(action) { … }
```
This is what makes access genuinely flow-by-flow: a user can be allowed to raise repair pickups but
not returns, or to see field visits but not replacements.

**Own-only enforcement:** `support_bucket` endpoints add `AND assigned_to = $userId` to the query.
A technician can never act on someone else's job regardless of role. This is a data rule, not a
permission — see MASTER §7.3.

### `POST /work-orders/:woId/complete`
```json
{ "found_issue_id": 152, "action_code_ids": [4,11],
  "notes": "No power at all…", "outcome": "NOT_RESOLVED", "time_spent_minutes": 45 }
```
Server: `checkMandatorySteps` → 409 with `{ missing: ['CUSTOMER_OTP','TECH_ESIGN'] }` if incomplete.
Then validate `found_issue_id`, `action_code_ids.length >= 1`, `notes.length >= 20`, `outcome`.
Then run the type's completion effects (5.5), then `computeAssetLineStatus`, then `computeTicketStatus`.

### `POST /work-orders/:woId/fail`
```json
{ "failure_reason": "CUSTOMER_UNAVAILABLE", "notes": "...", "create_retry": true }
```
Reasons: `CUSTOMER_UNAVAILABLE, SITE_ACCESS_DENIED, WRONG_PART, PART_FAULTY, UNIT_NOT_READY,
INSUFFICIENT_TIME, SAFETY_CONCERN, VEHICLE_BREAKDOWN, OTHER`.
`create_retry: true` clones the WO with `attempt_number + 1`, `previous_wo_id` set, status
`PENDING_ASSIGNMENT`. Failed attempts stay in history — do not overwrite them.

---

## 5.5 Completion effects — a strategy map, not a switch statement

```js
// backend/services/workOrderEffects/index.js
module.exports = {
  FIELD_VISIT:    require('./fieldVisit'),
  REPAIR_PICKUP:  require('./repairPickup'),
  SERVICE_RETURN: require('./serviceReturn'),
  // Phase 6, 7, 8 add the rest — no changes to the engine
};
// each module exports: { onCreate(client, wo), onAssign(...), onComplete(client, wo, body), onCancel(...) }
```

### `FIELD_VISIT.onComplete`
- `outcome === 'RESOLVED'` → line ready to resolve with `RES-FOS`
- `outcome === 'NOT_RESOLVED'` → suggest the next WO based on the **found** issue type's
  `default_wo_type`; surface it on the ticket as a suggestion, do not auto-create it

### `REPAIR_PICKUP.onCreate`
1. `assertAssetPickupEligible` — **one canonical eligibility list**, fixing PLAN D11:
   ```js
   const PICKUP_ELIGIBLE_STATUSES = ['rented','on_demo','sold','out_stock'];
   ```
   Export this constant from one module and use it everywhere. Add a test that no other file
   declares its own list.
2. No other open pickup WO for the same serial.
3. Generate the **Return DC** through the existing service with `dc_purpose = 'repair_pickup'`,
   reusing `nextFinancialYearNumber('delivery_challan', client)`. Prefix unchanged.
4. Mint one `customer_otp`.

### `REPAIR_PICKUP.onComplete`
```js
// inside the caller's transaction
await inventorySM.markInTransit(client, serialId, { reason: 'SUPPORT_REPAIR_PICKUP', woId });
await setCustomerInventoryState(client, serialId, 'UNDER_REPAIR');   // stays assigned to the customer
await startBillingHold(client, { serialId, customerId, ticketId, reason: 'UNDER_REPAIR', from: today });
await logEvent(client, { … eventType: 'REPAIR_PICKUP_COMPLETED', isCustomerVisible: true });
```
**Go through `inventoryStateMachine`.** Never `UPDATE vendor_serial_numbers SET inventory_status`
directly — that raw update in `warehouseReceiveSinglePickupItem` is PLAN D10 and it is why credit
notes go missing.

### Warehouse receipt (`WH_RECEIPT` step)
One canonical path: mark received → `qc_status = 'pending'` → create the floor QC ticket via the
**existing** `createFloorTicketFromSupportPickup`-equivalent → link `floor_ticket_id` onto the WO.
When that floor ticket passes QC, auto-create a `SERVICE_RETURN` WO in `PENDING_ASSIGNMENT`.

### `SERVICE_RETURN.onComplete`
- Generate/attach the Service DC (`SDC-`)
- `inventorySM.markDelivered`, customer inventory back to `ACTIVE`
- **End the billing hold** (`hold_to = today`)
- If the hold exceeded `free_repair_days` (setting, default 3), set `waive_rent = true` on the hold
  so the invoice cron waives the excess days — a contractual promise you can now actually keep

---

## 5.6 Documents
Reuse the existing PDF services. Do not write new ones.
`returnDcPdfService` for `RDC-`, `serviceDcPdfService` for `SDC-`. Add the WO number to the PDF
header so a document can be traced back to a job.

---

## 5.7 Frontend

### S9 — Create work order modal
`components/CreateWorkOrderModal.jsx`. Type chips (only the types the user has permission to
create), machine chips (multi-select from the ticket's lines), method, date, slot, assign-to.
A green info bar previews the document that will be generated and whether an e-Way Bill is needed
(> ₹50,000) — ties into the Zoho work.

### Work orders tab on S7
`WorkOrderCard` for each: type tag · WO number (mono) · status pill · assignee · slot · document
number right-aligned · a second line of type-specific detail · a step progress indicator
(`5 / 8 steps`). Cards for a `replacement_group_id` are visually paired (Phase 7).

### S12 / S13 — job execution
Build these as normal responsive pages now (`/support-v2/jobs/:woId`); Phase 9 wraps them in the
mobile bucket shell. The checklist is **generated from the step config** — never hard-code steps in
the component.

```jsx
{steps.map(s => (
  <StepRow key={s.step_code} step={s} disabled={!isMyJob || !isPrevDone(s)}
           onComplete={(payload) => completeStep(woId, s.step_code, payload)} />
))}
<Button variant="primary" disabled={!allMandatoryDone} onClick={openCompleteModal}>Complete job</Button>
```

Renderers per `step_kind`: `GpsStep`, `ScanStep` (uses the existing `html5-qrcode`),
`PhotoStep` (min count enforced, shows thumbnails), `ChecklistStep`, `OtpStep` (4 boxes + resend),
`SignatureStep` (uses the existing `signature_pad`), `FormStep`, `ConfirmStep`.

**Offline queue** — start it here, do not defer it. A tiny module
`features/support-v2/offlineQueue.js`: IndexedDB-backed FIFO of `{ url, method, body, idempotencyKey }`,
flushed on `online` and on app focus, with a persistent "N actions pending sync" banner. Every step
POST goes through it.

---

## VERIFICATION CHECKLIST — Phase 5

**Engine**
- [ ] Illegal transitions are rejected with 409 (try `ASSIGNED → COMPLETED`)
- [ ] Steps are instantiated from config on WO creation — change the config, create a new WO,
      the new step appears without a code change
- [ ] `complete` is blocked with a `missing[]` list until every mandatory step is done
- [ ] A PHOTO step with `min_count: 4` rejects 3 photos
- [ ] A SCAN step with the wrong serial returns 409 `ASSET_MISMATCH` and does **not** advance
- [ ] `fail` with `create_retry` creates attempt 2, keeps attempt 1 in history

**OTP isolation — the D8/D9 regression test**
- [ ] Create two pickups on the **same** Return DC, one repair and one return
- [ ] Verify OTP on the first → only the first WO gets `otp_verified_at`; the second is untouched
- [ ] The grep test for `OR document_number` in the WO service passes

**Repair pickup end to end**
- [ ] Raise from a ticket → RDC generated with the existing prefix and sequence, unbroken
- [ ] An ineligible serial (e.g. `in_stock`) is refused with a clear message
- [ ] Complete the pickup → serial `in_transit`, customer inventory `UNDER_REPAIR` but **still
      assigned to the customer**, and an `asset_billing_holds` row opens with `hold_to IS NULL`
- [ ] **No credit note is raised** (this is a repair, not a return)
- [ ] Warehouse receipt creates exactly **one** floor QC ticket, linked on the WO
- [ ] Floor QC pass auto-creates a `SERVICE_RETURN` WO in `PENDING_ASSIGNMENT`
- [ ] Completing the service return closes the hold and flips the customer inventory back to ACTIVE
- [ ] A hold longer than `free_repair_days` sets `waive_rent = true`

**Inventory integrity**
- [ ] Grep the new code: zero occurrences of `UPDATE vendor_serial_numbers SET inventory_status`
      outside `inventoryStateMachine`
- [ ] The eligibility constant is declared in exactly one file

**Permissions — flow by flow**
- [ ] A user with `support_work_orders` but **not** `support_pickup_repair` can see work orders but
      cannot create a repair pickup (403) and the type chip is hidden in S9
- [ ] A technician can accept/execute **their own** WO but gets 403 on another technician's WO,
      even with `support_bucket · edit`
- [ ] A user with `support_field_visit` only sees field visit and remote fix chips in S9

**Offline**
- [ ] Go offline in devtools, complete three steps → banner shows "3 actions pending sync"
- [ ] Come back online → all three apply, in order, exactly once
- [ ] Replay the same idempotency key manually → the stored response returns, no duplicate effect

**Build**
- [ ] `npm test` green · `npm run build` clean · phase report written
