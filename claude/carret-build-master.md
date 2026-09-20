# Carret — Master Implementation Prompt (Parts 0 and 2–6)

**Repo:** `github.com/pankajrentfoxxy/crm_rentfoxxy`

## Branch model

| | |
|---|---|
| **Work here** | `new_stagging_crm` — branch every part off this, verified at `10c2778a` |
| **Promote to** | `new_crm_rentfoxxy` — production, at `3531fea8`. Merge only after sign-off. |

Staging is currently **9 commits ahead** of production and production is 0 ahead of staging, so staging is a clean superset — the merge base is production's own head. Keep it that way: never commit to `new_crm_rentfoxxy` directly, and merge staging forward rather than cherry-picking, or the two will diverge and every file:line in these documents becomes unreliable on one of them.

### ⚠️ Staging is also connected to the LIVE database

This is the single most important line in this document. `new_stagging_crm` points at the same live data as production. So:

- **Verifying on staging proves the code, not the data.** A migration run on staging has already changed production data. There is no undo.
- Every migration in Parts 2–6 must be written and reviewed as if it were running in production, **because it is**.
- Before any migration runs on staging, take a backup of the tables it touches and record the row counts in the PR. Part 2's status canonicalisation touches every row of `vendor_serial_numbers`.
- Anything destructive — dropping `orders`, `order_items`, the legacy `inventory` table, retiring support v1 — is a **separate, announced change**, never bundled into a feature commit.

If a genuinely isolated database becomes available, say so and this constraint relaxes. Until then, treat "it is only staging" as false.

**Part 1 (Foundation) is a separate companion document — `claude/carret-build-part1-foundation.md`. Run it first.** It writes no migration and no backend code, and every part below assumes its tokens, primitives, shells and canonical status constants exist.

Run the parts **in order, one at a time**. Stop at the end of each part, run its acceptance tests, and get them signed off before starting the next. Parts 2 and 3 in particular must not be interleaved: Part 2 makes the asset state machine trustworthy, and Part 3 adds a new state to it.

| Part | Scope | Backend | Screens | Branch |
|---|---|---|---|---|
| **0** | The remaining money leaks — BL3 postpaid, BL3 vendor, V2 | all of it | — | `fix/money-leaks-2` off `new_stagging_crm` |
| 1 | Foundation — companion document, run first | none | the system itself + 2 screens | `carret-foundation` off `new_stagging_crm` |
| **2** | Stock — the event spine, close the bypasses, canonicalise statuses, one availability predicate | heavy | 8 | `carret-stock` off `new_stagging_crm` |
| **3** | Move — `at_gate`, the gate becomes a gate, one delivery path, OTP hardening | heavy | 7 | `carret-move` off `new_stagging_crm` |
| **4** | Sell — retire the legacy chain, two entities, quotation gate, attach races | medium | 6 | `carret-sell` off `new_stagging_crm` |
| **5** | Procure & Produce — mandatory config verification, enforced stage rules, QC that records | heavy | 16 | `carret-produce` off `new_stagging_crm` |
| **6** | Money & Serve — permissions, GST, audit, then support v2 | heavy | 19 | `carret-money`, `carret-serve` off `new_stagging_crm` |

**Every part is both.** Each one ends with a Screens phase that draws its pages in the design system Part 1 built — 58 screens in total, matching the prototype. The backend work in a part always lands *before* its screens, because a screen built on a number that is not yet true has to be rebuilt when it becomes true.

---

# THE CONTRACT — applies to every part below

These override anything else in this document, and anything a later section seems to imply.

1. **Inspect before writing.** Every file:line in this document was verified on **`new_stagging_crm` at `10c2778a`**, which is where you work. They will not all match production, because staging carries four billing commits production does not. If what you find differs, **stop and report it**. A divergence means the map is wrong, and working around it silently is how the current mess was built.
2. **Never create a duplicate flow.** If a helper, endpoint, component or table already does the job, extend it. This codebase's central defect is that everything exists twice. Do not make it three times.
3. **Never create a parallel API.** A new endpoint requires a written justification in the PR description explaining why no existing one could be extended.
4. **One migration per concern, and never two concerns in one migration.** Number every new migration **above the current maximum on the live branch** — check it, do not assume. `support_revamp` carries migrations numbered 197–222 that collide with live migrations of the same number and different content; running one of those on the live database is the single highest-risk action in this whole plan.
5. **Every data migration preserves what it overwrites.** Old value into `extra.legacy_*` or a `*_migrated_from` column, plus an audit row. A migration that cannot be reconstructed afterwards is not acceptable on a live database.
6. **Old and new coexist.** Every existing screen keeps working while its replacement is built beside it behind `REACT_APP_CARRET`. Nothing is deleted until its replacement has been signed off.
7. **No hex literals in `frontend/src`.** Every colour comes from a Part 1 token. Enforce with a CI grep.
8. **Every route declares `(section, action)`.** No route may use `view` as a write guard. No route ships without permission middleware.
9. **Write the test with the fix.** Every behaviour change in Parts 0 and 2–6 ships with a test that fails before it and passes after. `backend/test/` currently covers billing maths, WhatsApp, sale-in-place, support OTP and the vendor repair gate — and nothing in the order-to-cash chain.
10. **Stop and ask** rather than guessing on anything marked **BLOCKER**.

**Reference documents — read all three before starting any part:**
- `claude/flow-audit.md` — 141 findings with file:line. Finding IDs (BL1, V2, I3…) are cited throughout.
- `claude/pre-redesign-decisions.md` — the seven decisions and their reasoning.
- `claude/bypass-register.md` — every asset-status bypass enumerated with current line numbers. **Part 2.2 works from this file, not from the count in the audit.**

---

# PART 0 — The remaining money leaks

Branch `fix/money-leaks-2` off `new_stagging_crm`. Three contained backend fixes.

**BL1 is already fixed on staging and correctly scoped — do not touch it.** The filter sits at `billingSchedulerService.js:3461`: `AND COALESCE(vsn.inventory_status,'') NOT IN ('sold','scrapped')`. Only those two stop the clock, because `returned`, `in_stock` and `in_repair` mean you still physically hold the vendor's unit and the rent is genuinely owed. Do not widen it.

**Note on drift.** Staging carries four billing commits production does not, all in the files this part touches (`billingSchedulerService.js` +179 lines, `billingMath.js` +43). Every line number below is staging's. Re-verify before editing; do not trust a line number that has moved.

## 0.1 — BL3 on the postpaid path (NOT FIXED)

`backend/services/billingSchedulerService.js`, `generatePostpaidCustomerInvoice` (starts `:959` on staging).

The prepaid path was fixed at **`:723-740`** on staging: with no `rent_monthly_rate` it skips the unit entirely, writes no line, and **leaves `rent_billed_until` where it was**, so the span stays owed. That reasoning is right.

The postpaid path has no such guard. It computes `monthlyRate` at **`:906`** and advances `rent_billed_until` at **`:938`**, with nothing in between that checks the rate. Verified on staging: `sed -n '906,940p'` contains no `monthlyRate > 0` test. Identical bug, identical damage — the month is skipped permanently and nothing revisits it.

Apply the same fix, with the same shape and the same warning log. Do not invent a different remedy for the same defect on a sibling path — they must stay readable as one rule.

## 0.2 — BL3 on the vendor side (NOT FIXED)

`backend/services/billingMath.js:154` on staging, `calcVendorLineAmount`. (It is `:112` on production — staging added 42 lines above it.)

`const rate = parseFloat(monthlyRate || 0)` produces a ₹0 line whenever the PO's `line_items->0` carries no usable rate. The caller at `billingSchedulerService.js:3477` on staging only skips a `null` result, never a zero amount, so the line is written onto the vendor bill.

There is no watermark on this path, so nothing is permanently lost — but a ₹0 line on a vendor bill reads as *"this unit was billed"* when it was not priced. It hides a data gap and it under-pays the vendor silently.

Return `null` when the rate is not greater than zero, and have the caller log which serial and which PO it skipped, so the missing rate is findable. **Do not** silently drop it with no record.

## 0.3 — V2 (NOT FIXED)

`backend/controllers/salesManagementController.js:3988`, `submitDeliveryRegister`.

Someone has added status validation against `['delivered','rejected','processing']`, which is a real fix for a real bug — the status previously went from the request body straight into the column. Keep it.

The V2 defects themselves are untouched. The handler still:

- sets `delivery_completed_at` but **never `delivered_at`**, and
- **never calls `finalizeDeliveryInventory`**.

Confirmed by grep: `submitDeliveryRegister` appears in neither the list of `delivered_at` writers nor the list of `finalizeDeliveryInventory` callers. So the challan reads delivered everywhere, the asset stays `in_transit`, `rent_start_date` is never set, and no rental invoice is ever raised.

**Do not patch this handler in place.** It is one of five paths that write `status='delivered'` (finding V1), and adding a sixth variation of the same logic is the disease, not the cure. Instead:

1. Extract the one correct completion routine — `markDcDelivered` at `:5959` is the closest to correct; it takes a row lock (`:5971-5975`), sets `delivered_at`, and calls `finalizeDeliveryInventory`.
2. Make `submitDeliveryRegister` call that routine for the `delivered` branch, passing its serial split and remark through.
3. For the `rejected` branch, call the rejection service (`deliveryRejectionService.markDeliveryRejectedByCustomer`) rather than writing the status directly — the bare write is finding T1, which strands the unit permanently and makes the sales order impossible to cancel.

Part 3 collapses all five delivery paths properly. This step makes the worst one safe in the meantime.

## 0.4 — Also in that query, while you are there

`billingSchedulerService.js:3286-3287` still coalesces the vendor rent start down to `vsn.created_at::date`. A serial with no `received_at` and no `rental_start_date` therefore bills the vendor from the day its database row appeared rather than from physical receipt (finding BL2).

**BLOCKER — do not change this without an answer.** Ask first: how many serials does that fallback actually catch, and should they bill from row creation, from GRN date, or not at all until someone records a receipt date?

## Part 0 acceptance

1. A postpaid customer with a serial carrying `rent_monthly_rate = NULL` produces **no line** and leaves `rent_billed_until` unchanged. Test proves the watermark did not move.
2. A vendor PO with no usable rate on `line_items->0` produces **no line**, and the skip is logged with the serial and PO.
3. `POST /delivery-challans/:dc/delivery-register` with `status='delivered'` sets `delivered_at`, moves every serial out of `in_transit`, sets `rent_start_date`, and raises the first rental invoice. Test asserts all four.
4. The same endpoint with `status='rejected'` produces a rejection reason, a rejected timestamp, a released sales-order allocation and a QC re-entry ticket.
5. Re-run of any invoice or bill generation is still idempotent. No double lines.

---

# PART 2 — Stock: the event spine and the state machine

Branch `carret-stock`. This is the largest part and everything downstream depends on it. Nothing here is cosmetic.

## 2.1 — One event table (Decision 5)

Create the append-only `events` table. **No UPDATE and no DELETE, ever** — enforce with a database rule or trigger, not a code convention.

```
events
  event_id       bigserial primary key
  occurred_at    timestamptz not null default now()
  actor_type     text not null         -- user | system | courier | customer | migration
  actor_id       int
  actor_name     text                  -- denormalised; survives user deletion
  entity_type    text not null         -- asset | ticket | so | dc | invoice | support_ticket | po | grn
  entity_id      text not null
  entity_ref     text                  -- human handle: TTSPL/4227, DC/26-27/0778
  event_type     text not null
  from_state     text
  to_state       text
  payload        jsonb
  correlation_id uuid                  -- one request / one transaction
  source         text not null         -- the module that wrote it
```

Index `(entity_type, entity_id, occurred_at DESC)` and `(event_type, occurred_at DESC)`. Partition by month once it exceeds a few million rows — not before.

**Hold this distinction or the whole thing collapses:** state lives in columns, history lives in events. `qc_results`, `payment_records`, `sales_order_serials` keep holding business state. Nothing reads current state out of the event log.

**The `correlation_id` is the point.** One request, one id, on every event it writes. It is what makes "one delivery wrote five rows from five paths" visible, and then provable once it is fixed.

Backfill from `ttspl_audit_log` and `inventory_status_transitions` with `actor_type='migration'`. Keep both old tables read-only for one release, then drop.

## 2.2 — Close the 32 bypasses (finding I3)

**This must land before any CHECK constraint.** Adding the constraint first converts thirty-two existing bugs into production 500s.

Make `inventoryStateMachine.transitionAsset()` the only writer of `inventory_status`.

**Work from `claude/bypass-register.md`, not from the count in this sentence.** That file enumerates every site with line numbers verified at `3531fea8`; the audit's "32" was counted at `7c394f3` and every line number in it has since drifted. Re-run the enumeration at the start of this phase and reconcile any difference before touching code.

**The nine `catch`-block bypasses are the priority**, because they invert the machine into advisory-only — validation refuses, the catch swallows the error, and the raw write goes through anyway:

`salesManagementController.js:3208, :3663, :5577, :5855` · `guardGateValidationService.js:2441` · `productionAssetService.js:939` · `supportServiceDcService.js:561` · `inventoryAssetMovementService.js:321` · `dispatchQcCaptureService.js:342`

Each becomes: attempt the transition; on refusal, **fail the request and log it**. Do not force the write. If a refusal turns out to be a legitimate business event, the fix is to add it to the map — not to bypass it.

Then the unconditional raw writers, in this order (highest damage first):

- `qcManagement/orders.controller.js:527-535` — writes the request body's `selected_value` straight into `inventory_status`. This is the largest single source of non-canonical values in production. Map the QC outcomes to canonical statuses and reject anything else.
- `grnTicketService.js:340, :357-363` — the asset's first entry into stock, entirely unaudited.
- `qcProcessIntakeService.js:38-54, :615-629, :719-727, :797-805` — the last of these resurrects `scrapped` units, which the map forbids.
- `supportController.js:3046-3055, :3659-3668` · `qcController.js:551` · `ticketPhase2Controller.js:610` · `supportCancelInventoryService.js:98` · `inventoryStatusOverrideService.js:106` · `qcCheckService.js:260` · `salesManagementService.js:2280, :2300` · `inventoryList.controller.js:385` · `dispatchQcCaptureService.js:329` · `vendorReturnToVendorService.js:513` · `deliveryRejectionService.js:280` · `returnCompletionService.js:163`

Also in this phase:

- **Add the missing legal transitions** (finding I6): `in_transit → returned` and `dispatch_ready → qc_failed`. Both are real weekly events, and two of the bypasses exist only because the map was written from the happy path.
- **Add `FOR UPDATE`** to `loadSerial` (`inventoryStateMachine.js:71-77`).
- **Fix `isAllowed()`** (`:66`): it currently returns `true` whenever the current status is non-canonical, so one bad write exempts that asset from validation permanently. After 2.3 there are no non-canonical rows; make it return `false` and log loudly.
- **Delete the two bulk heals** (`salesManagementService.js:2280-2316`). They run table-wide UPDATEs, outside any transaction, as a side effect of a read endpoint any user can call. They exist only to paper over the six availability definitions, which 2.5 removes.
- **Stop truncating the reason** at 255 characters (`:196`) while Dispatch QC builds a 2,000-character failure reason.
- **Replace whole-object `extra` writes with `jsonb_set`** everywhere (finding I12). There is no `jsonb_set` in the codebase today, so every concurrent write loses the other's keys.

## 2.3 — Canonicalise the statuses (Decision 3)

**Phase order is not negotiable.**

1. **Measure.** Run the census from Part 1 §6.1 again — the distribution will have changed. Paste it into `docs/status-census.md`.
2. **Map and migrate.** One migration per entity. Preserve the old value in `extra.legacy_status`. Write an `events` row per change with `event_type='status_canonicalised'`, `actor_type='migration'`, so the migration appears in each asset's own timeline instead of as an unexplained jump.
3. **Constrain.** `CHECK` on `inventory_status` and `qc_status`. Only now.
4. Same three phases for `delivery_challan_lines.status`, `tickets.status` and the support statuses.

Canonical asset list, twelve values (from Part 1 §6.2): `in_stock` `reserved` `dispatch_ready` `at_gate` `in_transit` `rented` `on_demo` `sold` `returned` `in_repair` `qc_failed` `scrapped`.

**BLOCKERS:** `missing` and `deleted` still need business answers. Do not default them.

## 2.4 — Retire the second and third status stores

- The legacy `inventory` table is a parallel allocation engine written by `salesController`, `warehouseController` and `procurementController`, synced to the asset master at exactly one event (POD) and even there through `.catch(() => {})` (`salesManagementController.js:5716-5747`). Part 4 removes `salesController`. **This part** migrates `warehouseController` and `procurementController` onto `vendor_serial_numbers`, after which `inventory` is read-only and then dropped.
- `vendor_product_inventory` is written only on DC create and cancel, never on delivery, return or scrap, and is still read at `salesManagementService.js:2449`. Remove the read, then the table.

## 2.5 — One availability predicate (finding I10)

Six mutually inconsistent definitions exist today, at `salesManagementService.js:2359`, `inventoryManagementService.js:77`, `supportInventoryService.js:68`, `dispatchWorkflowService.js:331`, `salesOrderSerialController.js:193` and `analyticsController.js:186`.

Create **one** SQL view or function, `asset_available`, and make every one of those six call sites use it. Delete the other five predicates. This is what makes Ready-to-Rent stop offering units that order-attach will refuse (finding I18), and it is the reason the whole part is worth doing.

## 2.6 — Fix the dead dashboards (finding I11)

`analyticsController.js:186-196` and `reportsController.js:1347-1355` filter on `qc_status='qc_passed'`, `inventory_status='out_stock'` and `qc_status IN ('qc1','qc2','in_qc')` — none of which any current code writes. Those tiles count only rows imported from the old ERP, so they fall as the business grows.

Rewrite every one of them against the canonical statuses and the `asset_available` predicate. **Then verify each number by hand against a SQL query before shipping.** A dashboard that is confidently wrong is worse than no dashboard, and this system has had one for a year.

## 2.7 — Screens

Build in the Part 1 system, behind the flag: **Assets list** (filters that combine: family, status, entity, purchase type, vendor, customer, brand, carret, search), **Asset record** with the real `Timeline` reading from `events`, **Ready to Rent or Sell**, **Carrets**, **Pending Inventory**, **Asset Movements**, **Scrapped**.

Also the **Operations overview** — the home screen. It belongs here rather than in Part 1 because 2.6 is what makes its numbers true: fleet by lifecycle family, rent in versus vendor out, and the blocked-right-now panel. Every tile drills to the list behind it. Build it only after 2.6's hand-verification is done, and never before.

The prototype at the Carret Prototype artifact is the reference for layout, filters and copy.

## Part 2 acceptance

1. `grep -rn "UPDATE vendor_serial_numbers" backend/ | grep -c "inventory_status"` returns **only** the state machine and the canonicalisation migration.
2. Every asset status change produces exactly one `events` row. Prove it: run a delivery end to end and assert one correlated set, not five.
3. The CHECK constraints exist and every row passes.
4. `asset_available` has exactly one definition and six callers.
5. Every tile on the manager dashboard matches a hand-run SQL query. Show the query and the number side by side.
6. Concurrency: two simultaneous transitions on one serial — one wins, one fails cleanly, no lost update. Test with real concurrent requests, not a mock.
7. The timeline for one asset renders its whole life, including rows created by the backfill.

---

# PART 3 — Move: the gate becomes a gate

Branch `carret-move`. Depends on Part 2.

## 3.1 — `at_gate` (Decision 4)

Add `at_gate` to the canonical list and the transition map. It is the state that makes guard custody recordable: a unit at the gate is neither outside nor in stock, and somebody is accountable for it.

Transitions in: `in_transit → at_gate` (arriving), `dispatch_ready → at_gate` (staged to leave, if you want the two-step; confirm with Pankkaj before adding it).
Transitions out: `at_gate → in_transit` (confirmed outward), `at_gate → in_stock` (inventory collects from the guard), `at_gate → returned`, `at_gate → qc_failed`.

## 3.2 — The gate refuses

`guardGateValidationService.js`. Today `loadOutboundDc:588-599` blocks only cancelled, delivered and rejected challans, and `applyOutwardGateInventory:2463` accepts challans still at `pending` (finding DC1).

Add a pre-flight that runs before the guard can confirm, and that **records a refusal** rather than returning a silent 400:

- Dispatch QC passed on every unit on the challan
- E-way bill present where the value requires it
- AWB present when the mode is courier
- Per-unit configuration match (this already exists in `buildLaptopChecks:299-371` — reuse it, do not rewrite it)

A refusal writes an `events` row with the reason. The challan stays `dispatch_ready`. The guard screen shows which check failed and who to call.

**Inward**: confirm moves units to `at_gate`, not to `returned`. A separate inventory action moves them from `at_gate` into a carret. That second step is what "inventory picks from guard" means, and it is the thing that cannot be recorded today.

## 3.3 — One delivery path (findings V1–V8)

Five code paths write `status='delivered'`; only four call `finalizeDeliveryInventory`; only four set `delivered_at`.

Collapse them into **one** service function that every caller uses: lock the row, validate the proof for that mode, set status, `delivered_at` and `delivery_completed_at`, finalise inventory, raise the invoice, write one correlated event set. The five callers become five thin wrappers that differ only in what proof they supply.

Proof rules, stated once and enforced in that service:

| Mode | Required |
|---|---|
| By hand / in-house | Customer OTP **and** POD (photo or e-sign) |
| Courier, auto from tracking | Courier delivered scan |
| Courier / porter, manual | POD photo, and an actor who is not a field role |
| Admin override | POD photo and a reason, always logged |

`markDcDelivered:5959` currently accepts `pod_image_url` as a plain body string with no OTP at all (finding V3). Under the new service that is impossible.

## 3.4 — OTP hardening (finding V6)

Six digits, plaintext, no expiry, no attempt limit, and written to **every line of the challan** so one code opens all of them.

Add `otp_expires_at` (15 minutes), `otp_attempts` with a limit of 5 then re-issue, store a hash rather than the code, and scope the code to the challan rather than per line. Retire the second column family (`d_otp` / `d_otp_verified_at`, finding V7) — one family, one writer, one reader.

## 3.5 — BlueDart (finding B1)

`bluedartAwbSyncService.js:52-53` matches `courier_name IS NULL OR TRIM(courier_name) = ''`, so a porter or by-hand challan carrying an AWB with a blank courier gets swept into BlueDart tracking and can be auto-delivered — rent clock and invoice included — by an unrelated waybill.

Match on courier name **only**. Then backfill `courier_name` where it is blank and an AWB exists, and report anything that cannot be resolved rather than guessing.

## 3.6 — Rejection (findings T1, DC7, I17)

One rejection service, three entry points, no bare status writes. Add `dispatch_ready` to `REJECTABLE_STATUSES` (`deliveryRejectionService.js:17`) — a challan created but not yet gated out must be rejectable. And stop leaving a rejected unit permanently `in_transit` with no DC and no owner (`:231-241`): it goes to `at_gate` or `returned`, never nowhere.

## 3.7 — Screens

**Delivery Challans**, **Challan record** with the pre-flight panel, **Guard Gate** at floor density (outward and inward, scan-first, the scanner holds focus), **Dispatch QC**, **Delivery Register**, **Courier & Tracking**, **Return Challans**.

## Part 3 acceptance

1. A challan whose Dispatch QC has not passed **cannot** be confirmed at the gate, and the refusal is in `events` with a reason.
2. Inward confirm lands units at `at_gate`; a separate inventory action moves them to `in_stock`; both are in the timeline with different actors.
3. All five delivery entry points call one service. `grep -c "status = 'delivered'"` returns 1.
4. An expired OTP fails. A sixth wrong attempt fails and re-issues. The stored value is a hash.
5. A by-hand challan with an AWB and a blank courier is **not** picked up by the BlueDart sweep.
6. A rejected delivery releases the allocation, creates a QC re-entry ticket, and the sales order becomes cancellable.

---

# PART 4 — Sell: one chain, two books

Branch `carret-sell`. Depends on Parts 2 and 3.

## 4.1 — The prerequisite (finding S1)

`sales_order_lines.quotation_type` has no CHECK, and `entityForQuotationType()` (`salesManagementService.js:115-124`) maps every unknown value silently to `rentfoxxy`. **Today a typo in the order type picks which brand bills the customer.**

Add the CHECK (`sale`, `rental`, `demo`). Make the mapping throw on anything unknown instead of defaulting. This lands **before** anything else in this part.

## 4.2 — Retire the legacy chain (Decision 1)

Redirect `components/Orders.jsx:60`, `Sales.jsx:289`, `QCOrders.jsx` and `Dispatch.jsx:85` at `/api/sales-management`. Then delete `routes/sales.js`, `controllers/salesController.js`, and the `orders`, `order_items` and `procurement_requests` tables — **after** verifying no live row in them is younger than the redirect.

## 4.3 — The quotation gate (finding Q1)

`storeSalesOrder` (`:928-1055`) never queries `sales_quotations` at all. A rejected quote, a pending quote, a number that does not exist and the literal string `N/A` all produce a valid order.

Require an accepted quotation, with one explicit, permissioned and logged exception (`is_without_quotation`, which already exists as a flag and today means nothing). Add the transition guard on quotation status (`:642-679`): no `accepted → pending`, and setting `accepted` always sets `accepted_at`.

## 4.4 — The attach races (findings S3, S4, DC2)

- Move the eligibility check inside the transaction and add `FOR UPDATE` (`salesOrderSerialController.js:183-232`, `BEGIN` at `:269`).
- Add a database backstop for line capacity — the duplicate-serial case has a partial unique index, the over-allocation case has nothing.
- Widen `uq_sos_serial_active` so a `dispatched` allocation still blocks a second attach.
- Fix `createDcsByAddress` (`:3633-3638`): add `AND status='attached'` and a `rowCount` check, so two concurrent calls cannot both create a challan with the second silently repointing the first's serials.
- Fix `storeDeliveryChallan:3116-3119`, which decrements order-line quantity by configuration match rather than line id, so two identical-config lines both get decremented in full.
- Allocate the SO number **on the caller's client** (`:965`) so a rollback stops burning numbers. Same at `generateReturnDc:4420`.

## 4.5 — Screens

**Leads**, **Quotations**, **Sales Orders**, **Sales order record**, **Customers**, **Demo Agreements**. The entity split is a filter *inside* Sell, never two menu branches — one laptop crossing books must not cross sections.

## Part 4 acceptance

1. An order cannot be created against a quotation that is not accepted, except through the logged exception.
2. An unknown `quotation_type` is rejected by the database and by the mapping.
3. No route reaches `/api/sales`. The tables are gone. No screen broke.
4. Concurrency: two attaches to a `quantity=1` line — one succeeds, one 409s. Two challan creations from the same allocations — one succeeds, one fails cleanly.
5. A rolled-back order does not consume a document number.

---

# PART 5 — Procure & Produce: gates that hold

Branch `carret-produce`. Depends on Part 2.

## 5.1 — Configuration verification becomes mandatory (findings P3, P4, P5)

- `capture_token` is `.optional()` on unit receive (`purchaseOrders.controller.js:1018`). Make it required.
- The bulk receive endpoint has no token parameter at all — up to 250 units received with zero verification. Add it.
- `grn_config_verifications` is write-only: one INSERT, zero SELECTs anywhere. Surface it on the GRN screen. A check nobody can read is not a check.
- Reuse `verifyConfigurationAgainst()` (`grnConfigService.js:468`). Do not write a second comparator. Watch the `storage → ssd` mapping at `:324` — it is the one place the field is renamed.

## 5.2 — `inventory_status` at GRN (finding G2)

Migration 037 added the column with no default, and all three GRN receive INSERTs omit it, so a laptop's status is NULL for its entire production life and every availability query has to `COALESCE(..., 'in_stock')` — which quietly means a unit on the diagnosis bench reads as in stock.

Set it explicitly at receive. Backfill the NULLs by inferring from the ticket's current stage, and record the inference in `events`.

## 5.3 — Enforce the stage rules (findings R1, R2, R3)

- `stage_transition_rules` is read in exactly one function and bypassed for `admin`, `floor_manager`, `manager` and `super_admin` — which is every role that moves tickets. Remove `canBypassTransitionRules` (`ticketPhase2Controller.js:26`). If a transition is legitimate, put it in the table.
- Five independent stage movers exist; only `moveToStage` consults the rules. Collapse them to one.
- `submitQC` (`qcController.js:257`) takes `qcStage` from the request body and never compares it to `current_stage_id`, so a ticket at Diagnosis can jump to Pending Inventory. Read the stage from the ticket, never from the client.

## 5.4 — QC that records (findings R4, R5, R6, R7, R8)

- `calculateQCResult` (`:93-117`) is stage-agnostic, so QC2 is a second run of QC1 rather than a stricter gate. Give QC2 its own checklist.
- A QC2 failure through `submitQC` records nothing — no reason, no assignee, no `qc2_failed_at`, no count — while the same failure through `moveToStage` records all five. One failure routine, used by both.
- Bound the rework loops. `qc_fail_count` is incremented and never checked; QC1↔Assembly and QC2↔QC1 can cycle forever. Escalate at three.
- Give Final Testing a failure route. It is the only stage that can only pass.
- Fix the security hold: `flags.security_hold` (`diagnosisController.js:405, :455`) moves the ticket to stage `'Hold'`, which exists in no seed, so the UPDATE matches nothing, the ticket does not move, **and the API returns `success: true`**. Seed the stage, or route it to a real one.

## 5.5 — Seed integrity (findings R9, R10)

`Dispatch QC` is seeded at `stage_order 10`, colliding with `QC2`. `Chip Level Repair` and `Body & Paint` land at 3 and 6 from the database dump but 35 and 36 from migrations alone — so the pipeline differs depending on how the environment was provisioned. Fix the seed, add a uniqueness constraint on `stage_order`, and reconcile live.

## 5.6 — Permissions on production routes (finding R13)

`/tickets/:id/move-stage`, `/diagnosis-failed`, `/qc/submit`, all of `routes/diagnosis.js` and most of `routes/productionAssets.js` carry auth and no permission check. Any logged-in user can advance any ticket. Add `(section, action)` to every one.

## 5.7 — Screens

**Purchase Orders**, **GRN** with the config comparison visible, **Vendors**, **Vendor Returns**, **Vendor Repair**, **Purchase Types** (including the "Returned" column that has never existed), **Floor Pipeline**, the six stage views, **Parts**, **Repairs**.

## Part 5 acceptance

1. A unit cannot be received without a matched capture token, single or bulk.
2. The GRN screen displays the stored verification for every unit.
3. `inventory_status` is never NULL on a new serial.
4. A `floor_manager` cannot make a transition absent from `stage_transition_rules`.
5. `submitQC` ignores a `qcStage` that disagrees with the ticket.
6. A QC2 failure records reason, assignee, timestamp and count **through both entry points** — assert they produce identical rows.
7. A third failure escalates rather than looping.
8. Security hold moves the ticket, or fails loudly. It never returns success without moving.
9. Every production route returns 403 for a role without the permission.

---

# PART 6 — Money, then Serve

Branches `carret-money` then `carret-serve`. Serve depends on money being done, because support writes billing holds.

## 6.1 — Permissions (findings P1, BL14)

`routes/vendorManagement.js:24-27` defines `authorize` as `checkSectionPermission('vendor_management','view')` and uses it to gate create, edit and delete — on purchase orders **and** on vendor billing. Split into explicit actions. This is the highest-severity permission item in the audit.

Then the wider Decision 6 work: every route declares `(section, action)`; the hardcoded role arrays and the legacy JWT `permissions[]` retire into the matrix; scope becomes an explicit third axis `{entity, customer_type, branch}` applied as a query filter in one place; and the frontend reads the same matrix through one `usePermission(section, action)` hook.

## 6.2 — Billing correctness

- **Audit rows** (BL11): zero today from either billing controller. Every generate, send, mark-paid, approval and void writes to `events`.
- **GST** (BL7): flat hardcoded 18%, no place of supply, no CGST/SGST versus IGST split, and no columns to hold one. Add them and compute the split. Every inter-state supply is currently mis-classified.
- **Numbering** (BL8): `LPAD(...,4,'0')` breaks past 9,999 and carries no financial-year segment, unlike every other document. Widen it and add the FY segment, preserving the existing series.
- **`sent → overdue`** (BL9): nothing moves an invoice to overdue, so the outstanding figure is permanently understated. Add the job.
- **Ageing buckets and a statement of account** — neither exists.
- **Maker-checker** (BL12): approve requires only edit rights and never checks that the approver differs from the generator; `manager` holds both by default.
- **Void/cancel** (BL13): `cancelled` is filtered on everywhere and set nowhere, so every correction is a direct database write with no reason and no trail. Add the endpoint.
- **The draft-strip functions** (BL4): three of the four delete lines without rewinding `rent_billed_until`, so the stripped spans are never re-billed.
- **Vendor enumeration** (BL5): the batch selects vendors by PO type while the generator selects serials by the serial's own acquisition type, so a vendor can be permanently invisible to the batch.
- **Debit-note sweep** (BL6): no month filter, so every approved note is consumed by whichever bill generates first.
- **Payments UI** (BL18): the ledger works and nothing in the UI calls it. Build the screens.

## 6.3 — Support v2 (Decision 2)

**Order matters. The first step is the risky one.**

1. **Renumber `support_revamp`'s migrations 197–222 above the live maximum.** They collide with live migrations of the same number and different content. Verify the live maximum; do not assume it.
2. Review the shared-file diffs (`billingSchedulerService.js`, `inventoryStateMachine.js`, `grnTicketService.js`, `roleDefaultsSeed.js`, `ticketController.js`) **against the audit findings**, not blind. Part 2 has rewritten the state machine; the v2 diff predates that.
3. Adopt the v2 schema: SLA policies, clocks and pauses; the assignment engine with skills, zones and shifts; `support_attachments`; `support_ticket_events` (fold into the single `events` table from 2.1 rather than keeping a parallel one); `asset_billing_holds`; CSAT and notification log; work orders as the state layer.
4. **BL19 — read this before wiring `asset_billing_holds`.** The audit said a laptop away for repair keeps billing the customer with no hold concept. **Staging has since solved it a different way, and the staging answer is the better one.** Commit `5ed5261f` ("Bill continuously across a repair and credit the warehouse days") establishes the rule: a repair pickup is *not* the end of the rental — the unit goes back to the same customer on a Service DC, so billing continues and the days it actually sat in the warehouse are credited back. The customer pays both transit legs. `repairPickupInventoryService` no longer stamps `rent_end_date` and no longer clears `current_customer_id`, and a `repair_window` credit reason now exists at `billingSchedulerService.js:2338`.

   That is better than a hold because it leaves a finance record. The old behaviour silently suspended billing, so a discount was given with nothing on an invoice and nothing in `customer_credit_notes`.

   **So do not wire `asset_billing_holds` for the repair case — it would reintroduce silent suspension and double-count against the credit note.** Bring the table in only for a genuinely different case (a disputed unit, a customer-agreed pause), and require a reason and an approver on every hold. **BLOCKER:** confirm with Pankkaj which cases, if any, should suspend rather than credit.
5. Close the support permission holes: any logged-in user can read any parts challan (U21) and any non-technician role sees every technician's held parts (U22); warehouse-confirm sits above the support gate (U23); the public endpoints have no rate limit and leak customer identity (U24).
6. **Rebuild the UI** in the Carret system — discard `features/support-v2/`. Two shells: **support lead** at desk density (queue, buckets, SLA board, assignment, approvals) and **technician** at field density (my work, offline queue, photo capture, OTP, parts held).
7. **Retire v1** — controllers, services and tables — only once v2 is signed off. v2 as shipped deletes nothing, which would recreate exactly the duplication this whole programme is about.

## 6.4 — Screens

**Money:** **Customer Invoices**, **Invoice record** (with its event timeline, which is what 6.2's audit rows exist for), **Credit Notes**, **Security Deposits**, **Vendor Bills**, **Vendor bill record**, **Debit Notes**, **Payments** (the ledger has worked for months with nothing calling it), **Ageing & Outstanding**.

**Serve:** the two shells from 6.3.6 — support lead at desk density (**Queue**, **Ticket record**, **Technician Bucket**, **Parts Requests**, **SLA Board**, **Issue Catalogue**) and technician at field density.

**Control:** **Roles & Permissions** — the matrix screen, which is the visible half of 6.1 and the thing that makes the whole permission model reviewable — plus **Users**, **Masters**, **Event Log** and **Settings**. The Event Log screen is the fleet-wide view of the table built in 2.1; it needs the `correlation_id` filter, because seeing one business event's whole correlated set on one screen is how you prove the duplicate-write problem is actually gone.

**Settings** is where the sale book's display name and entity colour are read from. Nothing in any component hardcodes either.

## Part 6 acceptance

1. A `vendor_management:view` role cannot create, edit or delete anything.
2. Every billing action writes an event. The invoice timeline renders.
3. An inter-state invoice shows IGST; intra-state shows CGST + SGST. Verify against a real customer address.
4. Invoice 10,000 has a valid number with an FY segment.
5. An overdue invoice appears in the overdue bucket without anyone touching it.
6. The generator cannot approve their own vendor bill.
7. A repair pickup **continues** billing and produces a `repair_window` credit note for the warehouse days, with both transit legs charged. Assert on the invoice and the credit note, not on a flag. Any hold that does suspend billing carries a reason and an approver.
8. SLA clocks pause on customer-wait and resume, respecting the business calendar.
9. No route in `/api/support-parts/*` returns data to a user without the permission.
10. v1 support tables are gone and nothing references them.

---

# FINAL GATE — before any part is called done

- [ ] Every acceptance test in that part passes, with the test committed.
- [ ] `git diff --stat` reviewed by a human, not just by the agent that wrote it.
- [ ] No new hex literal in `frontend/src`.
- [ ] No new route without `(section, action)`.
- [ ] No new `UPDATE vendor_serial_numbers ... inventory_status` outside the state machine.
- [ ] Every migration numbered above the live maximum, and reversible.
- [ ] The three money-leak fixes from Part 0 still pass. Re-run them at the end of every part — they are the canary.

## Promotion to production

Nothing above is done until it is on `new_crm_rentfoxxy`. The promotion itself has rules:

- [ ] Merge `new_stagging_crm` → `new_crm_rentfoxxy` as a **merge, never a cherry-pick**. Cherry-picking is what makes two branches drift and every file:line in these documents unreliable.
- [ ] Promote **one part at a time**, in the same order they were built. Never promote Part 3 before Part 2 — Part 3 adds a state to a machine Part 2 makes trustworthy.
- [ ] Any migration in the part has already run against live data on staging. **Say so explicitly in the promotion note**, with the row counts before and after and where the backup is. A migration that "will run on promotion" is a migration that ran twice.
- [ ] Re-run the Part 0 canary on production after every promotion.
- [ ] Deploy destructive changes — dropping `orders`, `order_items`, the legacy `inventory` table, retiring support v1 — on their own, announced, never bundled with a feature.

# BLOCKERS — stop and ask

1. `missing` and `deleted` asset statuses — business answers, not technical ones (Part 2).
2. The `created_at::date` vendor rent fallback — how many serials, and what should they do (Part 0.4).
3. Whether `dispatch_ready → at_gate` is a real two-step at your gate, or whether units go straight out (Part 3.1).
4. The sale book's brand name and colours — still a config placeholder.
5. Bucket B of the route inventory from Part 1 — anything believed to be a true duplicate. List it; do not delete it.
6. Any divergence between this document and what you find in the code.
