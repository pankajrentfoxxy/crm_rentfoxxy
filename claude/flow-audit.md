# RentFoxxy CRM — Flow Audit

Branch `new_crm_rentfoxxy`, head `7c394f3`. Read-only audit — nothing was changed.

**Read this before using any line number.** This audit was taken on production at `7c394f3`. Work now happens on `new_stagging_crm`, which is ahead of production, and production itself has moved to `3531fea8`. **Line numbers in this document have drifted and several findings are already fixed** — BL1 and the prepaid half of BL3 are done; BL19 has been solved differently and better. Treat this as the map of *what was wrong*, not as a current checklist. For asset-status bypasses use `claude/bypass-register.md`, which is verified on staging; for current status use the master prompt. 141 findings across 16 areas. Every reference is a file and line on that commit.

Interactive version: the **Flow Audit** artifact — filterable by flow, severity and class.

---

## The short version

The system is not missing features. It is missing single owners. Almost every flow works — and then works a second time, somewhere else, differently. Two sales chains, three asset status stores, five ways to mark a delivery complete, three permission systems, and a support revamp on another branch that builds a second support module beside the first without deleting the first.

That is also why the screens feel scattered. The navigation is not confusing because it was laid out badly; it is confusing because it is honestly reporting a system that does the same thing in several places. Renaming the menu would hide that.

| Severity / class | Count |
|---|---|
| **Critical** | 59 |
| **Serious** | 60 |
| **Moderate & minor** | 22 |
| Missing / unreachable gate | 35 |
| Parallel implementation | 18 |
| Revenue or cost leak | 15 |
| Permission hole | 16 |
| No audit trail | 10 |
| Race or structural bug | 25 |
| Dead code or dead value | 18 |
| Navigation / design | 4 |

---

## The eight patterns

### 1. Everything important exists twice

*This is the root cause, not a symptom. Most of the other findings are downstream of it.*

- Two complete sales → dispatch → delivery stacks, both live, both in the UI (X1)
- Three asset status stores: the serial master, the legacy inventory table, and a vendor product inventory (I8, I9)
- Two vendor billing models that nothing reconciles (P7)
- Five code paths that mark a challan delivered (V1); two that mark it rejected (T1)
- Two OTP column families, and which one works depends on the screen (V7)
- Five independent production stage movers; QC pass written in two controllers (R2, D7)
- Three authorisation systems inside the support module alone (U25)
- The revamp branch adds a second support module beside the first and deletes nothing (U27)

**What the design has to decide.** You cannot draw a navigation for two systems. Every duplicate needs a named survivor and a deletion date before the IA is worth drawing — otherwise the redesign just gives both copies a nicer menu entry.

### 2. The rules exist and are not enforced

*There is a state machine, a transition-rules table and a QC gate. All three are advisory.*

- The asset state machine is bypassed 32 times at runtime — nine of those are catch blocks that force the write after validation refuses it (I3)
- One bad write exempts an asset from validation permanently (I2)
- The production transition rules are read in one place and bypassed for every role that moves tickets (R1)
- QC accepts the stage from the request body without checking it (R3)
- Quotation acceptance is never required for a sales order (Q1)
- The only pre-dispatch QC gate is unreachable, and fails open when reached (D2, D3)
- One of the two DC endpoints has no QC gate at all (D1)
- The guard gate checks nothing but whether the challan is cancelled (DC1)
- Neither status column has a CHECK constraint (I1, U1)

**What the design has to decide.** Every one of these has a screen. If the screen implies a gate the backend does not hold, the redesign inherits the lie. Decide per gate: enforce it, or remove the step from the UI.

### 3. The money leaks in both directions

*Vendor bills that never stop, customer rent that never starts, and no report that would show either.*

- The vendor bill has no status filter — scrapped, sold and returned units keep billing every month (BL1)
- Vendor rent can start from the date the database row was created (BL2)
- A missing rate writes a ₹0 line, advances the billed-until marker, and loses that month permanently (BL3)
- A challan delivered through the register never starts the rent clock at all (V2)
- A laptop away for repair keeps billing the customer; there is no hold concept (BL19)
- Parts charged to the customer never reach an invoice (BL20, U9)
- The rate stamped on the asset can come from the wrong order line (S5)
- Nothing moves an invoice to overdue, so outstanding is permanently understated (BL9)

**What the design has to decide.** Finance needs one screen that reconciles what should have been billed against what was. It does not exist today, and none of the existing dashboards could be repaired into it.

### 4. The dashboards read values the system never writes

*This is why the manager dashboard has been wrong. It is not a display bug.*

- "Ready stock" filters on a QC status no code writes; "currently rented" on an inventory status no code writes; "in QC" on three more (I11)
- Those tiles therefore report only rows imported from the old ERP — they go down as the business grows
- The DC screen's failure flag is permanently false because that status is never written (D6)
- Hardware capture is recorded and ignored (D4); config verification is recorded and never read (P5)
- Two support settings have toggles in the UI and nothing behind them (U18)
- The payment ledger works and has no screen calling it (BL18)

**What the design has to decide.** Every number on the new dashboards has to be traced to a predicate that some code actually writes. That trace is the acceptance test for the redesign, and it is cheap to run.

### 5. Nothing can be reconstructed after the fact

*Where an audit trail exists, the paths that matter most are the ones that skip it.*

- The asset's first entry into stock is unaudited (G1), as are all 32 state-machine bypasses (I3)
- The two audit logs disagree: one path writes the event and not the transition, another the reverse (I15)
- Zero audit rows from either billing controller (BL11)
- No DC status history table anywhere; the activity feed swallows its own failures (DC4)
- Support ticket status changes are unaudited, and the audit rows that do exist record no from/to pair (U17)
- Quotation status is overwritten in place (Q3); lead conversion time is overwritten (L1)

**What the design has to decide.** A timeline is the one component this ERP most needs and cannot currently render for any entity. Designing it first forces the backend question: what is the single event table?

### 6. Permissions describe intent, not access

*Three systems, and the gaps are in the expensive places.*

- Vendor Management view rights grant create, edit and delete — on purchase orders and on vendor billing (P1, BL14)
- Production move-stage, diagnosis-failed and QC submit have no permission middleware (R13)
- The dispatch-QC capture token mints with auth only, redeemable on an unauthenticated endpoint (D5)
- Any technician can deliver any other technician's challan (V5)
- The delivery OTP has no expiry, no attempt limit, and one code opens every line (V6)
- Any logged-in user reads any parts challan and every technician's held parts (U21, U22)
- The public support endpoint leaks customer identity with no rate limit (U24)
- No maker-checker on bill approval (BL12); the frontend gates on role, not permission (X6)

**What the design has to decide.** The Roles screen is the design surface here. It should be the only thing that decides what a user sees and what they can do — which means one permission source before the UI is redrawn.

### 7. Correct in isolation, wrong under two users

*Almost every multi-step write validates before it opens its transaction.*

- Two concurrent DC creations both succeed; the second repoints the serials of the first (DC2)
- Serial attach checks capacity with no database backstop (S3)
- The asset state machine takes no row lock (I5)
- Two table-wide UPDATEs run as a side effect of a read endpoint any user can call (I13)
- Every jsonb write replaces the whole object, so concurrent writes lose keys (I12)
- Four of the five delivery paths take no lock, so a double-click can double-invoice (V8)
- Security hold moves a ticket to a stage that does not exist and reports success (R8)

**What the design has to decide.** Not a design question directly — but it decides whether the redesign can safely add the bulk actions and multi-select the new screens will obviously want.

### 8. The navigation lost the work

*The audit found finished features nobody can reach.*

- About 64 routed pages are unreachable from the menu (X3)
- Four of roughly twenty-two support routes are in the menu (U26)
- The vendor billing overview page is routed and unlisted (P7)
- The payment recording screens were never built for a working ledger (BL18)
- There is no design system to redesign against: Tailwind extends nothing, and the shared table component is used in 9 of 133 files (X7)

**What the design has to decide.** This is the part you already saw. It is also the cheapest to fix and the one that makes everything else visible.

---

## Sequencing

The redesign does not need the backend fixed first. It needs seven decisions made first, because each one changes what the screens are. Drawing a navigation for two sales chains, or a status chip for twenty status values, produces a prettier version of the current problem.

Decisions 1, 2, 3 and 6 are structural — they decide how many modules exist, what a status is, and who sees what. Decisions 4 and 5 decide what two specific screens are. Decision 7 is the colour, and it gates the design-system work everything else is built on. None of them require writing code to answer.

Three findings should not wait, because they are losing money every month while the design work happens: **BL1** (vendor bills that never stop), **V2** (deliveries that never start the rent clock) and **BL3** (a missing rate that silently writes off a month). Each is a small, contained backend change.

---

## Seven decisions before the redesign

### Decision 1 — Which sales chain survives?

The legacy `/api/sales` stack (orders, order_items, inventory) is still reachable from four screens and never touches the asset master.

- [ ] Retire it — redirect the four screens at the modern chain, then delete
- [ ] Keep it for a named purpose and document the boundary

**Why it blocks the design.** Nothing else in the redesign can be settled first. Two chains means two of every screen, two status vocabularies and two sources for every number on the dashboard.

### Decision 2 — Support v1 or the v2 on the revamp branch?

`support_revamp` builds about 40 tables and a parallel frontend beside the existing module, deletes nothing, and its migration numbers collide with live migrations 197–222.

- [ ] Adopt v2 as the target, renumber its migrations, and plan v1's deletion
- [ ] Discard v2 and extend v1 with SLA, assignment and attachments
- [ ] Take v2's schema, rebuild its UI inside the new design system

**Why it blocks the design.** You said the support revamp comes after the design. That is right — but the design has to know which support module it is drawing.

### Decision 3 — One status vocabulary per entity, or keep the current sets?

The asset carries about twenty distinct `inventory_status` values: five written and never read, seven read and never written. Support has no constraint at all.

- [ ] Canonicalise now — one list per entity, CHECK constraints, a migration to map the strays
- [ ] Canonicalise the display layer only and leave the columns alone

**Why it blocks the design.** A status chip is a design component. It needs one list. Until there is one, every screen invents its own mapping — which is how you got here.

### Decision 4 — Is the guard gate the dispatch gate, or a record of it?

Today it is the event that puts stock in transit and starts the rent clock, and it checks only that the challan is not cancelled.

- [ ] Make it the gate — QC, e-way and AWB checked at the gate
- [ ] Keep it as a record and move the checks to DC creation

**Why it blocks the design.** It changes what the guard's screen is: a checklist that can refuse, or a scan that confirms. Those are different products.

### Decision 5 — One event table, or per-module audit tables?

There are currently at least five partial audit trails, two of which contradict each other, and none of which covers billing or DC status.

- [ ] One append-only event table keyed by entity type and id
- [ ] Per-module tables with a shared shape and a union view

**Why it blocks the design.** The timeline component is the single most useful thing the new UI could add, and it cannot be designed before this is decided.

### Decision 6 — Which permission system is the one?

The section matrix, hardcoded role arrays and the legacy JWT permissions array all gate live routes.

- [ ] The section matrix — migrate the others to it, frontend included
- [ ] Roles-only, and retire the matrix

**Why it blocks the design.** Role-aware navigation is most of the redesign. It needs a single source, and the frontend must read the same one the backend enforces.

### Decision 7 — What is the primary colour?

Still open from the IA proposal, along with the other five: are the nine sections right, which orphan pages get deleted, what happens to QC Management, do the Technician and Guard shells stay, and is dark mode in scope now.

- [ ] RentFoxxy orange
- [ ] Blue, with orange reserved for the brand mark

**Why it blocks the design.** Cheapest decision here, and it gates the design system work that everything else is built on.

---

## Finding register

### Purchase Order · 7 findings

*Vendor PO raised, rates and config locked*

**P1 · Critical · Permission hole** — Vendor Management writes are gated on `view`

The whole module uses one `authorize` helper defined as `checkSectionPermission('vendor_management','view')`. Server-side, view IS create, edit and delete — on purchase orders and on vendor billing alike.

`routes/vendorManagement.js:24-27, :263-267`

**P3 · Critical · Missing / unreachable gate** — Config verification is optional on unit receive

`capture_token` is declared `.optional()`. A unit can be received against the PO with no hardware capture compared to the ordered configuration at all.

`controllers/vendorManagement/purchaseOrders.controller.js:1018`

**P4 · Critical · Missing / unreachable gate** — The bulk receive endpoint has no capture-token parameter

Up to 250 units per call can be received with zero configuration verification. The single-unit endpoint at least offers the check.

`controllers/vendorManagement/purchaseOrders.controller.js (bulk receive)`

**P6 · Critical · Revenue or cost leak** — Vendor rent always reads PO line 0

`vpo.line_items->0` regardless of which line the serial belongs to. Every serial on a mixed-rate PO bills at the first line's rate; the error is unbounded in either direction.

`services/billingSchedulerService.js:3190-3194`

**P2 · Serious · Missing / unreachable gate** — PO status is writable straight from the request body

No transition map, no allowed-from check. Any value the client sends becomes the PO status.

`controllers/vendorManagement/purchaseOrders.controller.js:1927`

**P7 · Serious · Parallel implementation** — A second, parallel vendor-billing model

`vendor_billing` + `BillingMonthlyPage.jsx` sit alongside `vendor_monthly_bills`. Nothing reconciles the two, and the page is routed but absent from the menu.

`controllers/vendorManagement/billing.controller.js`

**P5 · Moderate · Dead code or dead value** — `grn_config_verifications` is write-only

One INSERT in the codebase, zero SELECTs anywhere. Every verification ever run has been recorded and never looked at.

`services/grnConfigService.js`

### GRN · 4 findings

*Goods received, serials created, config verified*

**G1 · Critical · No audit trail** — The asset's first entry into stock is unaudited

GRN QC pass writes `inventory_status='in_stock'` and `qc_status='passed'` with a raw UPDATE. No `inventory_status_transitions` row, no TTSPL audit event. The laptop's life begins with no record.

`services/grnTicketService.js:340, :357-363`

**G2 · Critical · Missing / unreachable gate** — `inventory_status` is NULL for the entire production life

Migration 037 adds the column with no default, and all three GRN receive INSERTs omit it. Every availability query then has to `COALESCE(inventory_status,'in_stock')` — which quietly means a unit still on the diagnosis bench reads as in stock.

`migrations/037_vendor_serial_inventory_meta.sql:3-5`

**G3 · Moderate · Dead code or dead value** — Received condition is stored twice and read once

`received_condition` and `missing_parts` are written onto `vendor_serial_numbers` at GRN, but every read in the codebase goes to the mirrored copies on `tickets`.

`migrations/177_grn_laptop_condition.sql:13-22`

**G4 · Moderate · Race or structural bug** — The config comparator maps `storage` to `ssd`

`compareConfig` compares brand / model / processor / generation / ram / **ssd** / gpu, while the rest of the system says `storage`. The mapping lives in one place and is easy to lose in a refactor.

`services/grnConfigService.js:324, :468`

### Production · 13 findings

*Floor Manager → Diagnosis / Assembly / Software / Final Testing → QC1 → QC2 → Inventory Pending*

**R1 · Critical · Missing / unreachable gate** — `stage_transition_rules` is not enforced

The table is read in exactly one function, and that function is bypassed outright for `admin`, `floor_manager`, `manager` and `super_admin` — which is every role that actually moves tickets. The pipeline has a rulebook nobody reads.

`controllers/ticketPhase2Controller.js:26, :69-83`

**R11 · Critical · Parallel implementation** — Ticket state is stored three ways

`tickets.status`, `tickets.current_stage_id` and the legacy `inventory.status`/`inventory.stage` all claim to say where the laptop is. `status` and `current_stage_id` are documented to diverge at seven points.

`controllers/ticketPhase2Controller.js`

**R13 · Critical · Permission hole** — Production routes with no permission middleware

`/tickets/:id/move-stage`, `/diagnosis-failed`, `/qc/submit`, all of `routes/diagnosis.js`, and most of `routes/productionAssets.js` carry auth but no permission check. Any logged-in user can advance any ticket.

`routes/diagnosis.js, routes/productionAssets.js`

**R2 · Critical · Parallel implementation** — Five independent stage movers

Only `moveToStage` consults the transition rules. The other four write `current_stage_id` directly, so the same hop behaves differently depending on which screen the user came from.

`controllers/ticketPhase2Controller.js, qcController.js, diagnosisController.js`

**R3 · Critical · Missing / unreachable gate** — `submitQC` trusts the stage sent by the client

It takes `qcStage` from the request body and never compares it to the ticket's `current_stage_id`. A ticket sitting at Diagnosis can be jumped straight to Pending Inventory by posting the right string.

`controllers/qcController.js:257`

**R5 · Critical · No audit trail** — A QC2 failure records nothing when it comes through `submitQC`

No reason, no assignee, no `qc2_failed_at`, no highlight, no `qc_fail_count` increment. The same failure routed through `moveToStage` records all five. Which screen the technician used decides whether the failure exists.

`controllers/qcController.js:257 vs ticketPhase2Controller.js:442`

**R8 · Critical · Race or structural bug** — Security hold routes to a stage that does not exist

`flags.security_hold` moves the ticket to stage `'Hold'`, which appears in no seed. The UPDATE matches nothing, the ticket does not move — and the API still returns `success: true`. Silent, and the operator believes it worked.

`controllers/diagnosisController.js:405, :455`

**R10 · Serious · Race or structural bug** — The pipeline differs depending on how the DB was provisioned

`Chip Level Repair` and `Body & Paint` land at stage_order 3 and 6 when restored from the dump, but 35 and 36 when built from migrations alone. Two environments, two pipelines, same code.

`migrations vs database dump`

**R4 · Serious · Parallel implementation** — QC1 and QC2 are the same code

`calculateQCResult` is stage-agnostic — byte-identical pass/fail logic for both. There is no second, stricter gate; there are two runs of the first one.

`controllers/qcController.js:93-117`

**R6 · Serious · Missing / unreachable gate** — No retry limit on rework loops

`qc_fail_count` is incremented on one path and never bounded. QC1 ↔ Assembly and QC2 ↔ QC1 can cycle forever with nothing escalating.

`controllers/ticketPhase2Controller.js:444`

**R7 · Serious · Missing / unreachable gate** — Final Testing has no failure mechanism at all

Every other production stage has a fail route. Final Testing can only pass.

`stages seed + ticketPhase2Controller.js`

**R9 · Serious · Race or structural bug** — `Dispatch QC` is seeded at the same stage_order as `QC2`

Order 10 is used twice. Any ordering-by-stage_order view puts them in arbitrary sequence.

`migrations/082:11`

**R12 · Moderate · Dead code or dead value** — Dead columns and dead status values across the pipeline

`stage_transition_rules.is_backward` and `.notes`; `tickets.previous_stage_id` and `.previous_technician_id` (written, never read); `production_assets.status` values `qc2_passed` and `qc_ready` (read, never written); `qc_results.is_locked`, which locks nothing.

`migrations 056, 082; productionAssetService.js`

### Inventory · 18 findings

*The asset master and its status machine*

**I1 · Critical · Missing / unreachable gate** — No CHECK constraint on `inventory_status` or `qc_status`

Both are bare `VARCHAR(64)`. Every status column added since got a constraint; these two, the most important in the system, did not. Nothing at the database level stops an arbitrary string.

`migrations/037_vendor_serial_inventory_meta.sql:3-4`

**I10 · Critical · Parallel implementation** — Six mutually inconsistent definitions of "available"

SO attach, Ready-to-Rent, support, dispatch workflow, serial attach and the analytics dashboard each use a different predicate. A unit can be available on one screen and rejected on the next.

`salesManagementService.js:2359; inventoryManagementService.js:77; supportInventoryService.js:68; dispatchWorkflowService.js:331; salesOrderSerialController.js:193; analyticsController.js:186`

**I11 · Critical · Dead code or dead value** — The manager dashboards read statuses nothing writes

"Ready stock" filters on `qc_status='qc_passed'`, "currently rented" on `inventory_status='out_stock'`, "in QC" on `qc_status IN ('qc1','qc2','in_qc')`. None of those values is written by any current code path. Those tiles report only rows imported from the old ERP.

`controllers/analyticsController.js:186-196; reportsController.js:1347-1355`

**I13 · Critical · Race or structural bug** — Two table-wide UPDATEs run on every inventory search

`healStaleReturnedPassedSerials` and `healStaleReservedPassedSerials` flip `returned`/`reserved` → `in_stock` across the table, outside any transaction, as a side effect of a read endpoint any user can call. They exist to paper over the six availability definitions above.

`services/salesManagementService.js:2280-2316, :2336-2340`

**I2 · Critical · Missing / unreachable gate** — One bad write exempts a row from validation forever

`isAllowed()` returns `true` whenever the *current* status is not in the canonical list. So the moment any code writes a non-canonical value, that asset can never be validated again — it is permanently outside the state machine.

`services/inventoryStateMachine.js:59-68`

**I3 · Critical · Parallel implementation** — 32 runtime bypasses of `transitionAsset`

Nine of them are `catch` blocks: the state machine refuses an illegal transition, the catch swallows the error and forces the same write with raw SQL. The machine is advisory, and the exception path is the one that always succeeds.

`salesManagementController.js:3208, :3663, :5577, :5855; guardGateValidationService.js:2441; productionAssetService.js:939; supportServiceDcService.js:561; inventoryAssetMovementService.js:321; dispatchQcCaptureService.js:342`

**I4 · Critical · Permission hole** — QC writes the client's chosen string into `inventory_status`

`selected_value` from the request body goes straight into the column. This is the largest single source of non-canonical statuses in production: `out_for_repare`, `out_for_return`, `repared`, `replace`, `qc_reject`.

`controllers/qcManagement/orders.controller.js:527-535, :432-438`

**I8 · Critical · Parallel implementation** — The legacy `inventory` table is a second allocation engine

`salesController`, `warehouseController` and `procurementController` run a parallel Reserved / Ready / Outward flow on it that the state machine knows nothing about. The two are synced at exactly one event — POD — and even there through `.catch(() => {})`.

`salesManagementController.js:5716-5747`

**I12 · Serious · Race or structural bug** — Every `extra` write replaces the whole object

There is no `jsonb_set` anywhere in the codebase. Two concurrent requests each read `extra`, each modify their key, each write the whole blob — and one set of changes is lost.

`inventoryAssetMovementService.js:324-336; qcProcessIntakeService.js:616-620`

**I15 · Serious · No audit trail** — The two audit trails disagree with each other

The super-admin override writes a TTSPL event and no transitions row. Support cancel writes a transitions row and no TTSPL event. Neither log is complete on its own, and they cannot be joined.

`inventoryStatusOverrideService.js:106-128; supportCancelInventoryService.js:98-109`

**I17 · Serious · Race or structural bug** — A rejected delivery strands the asset

`releaseSoAllocationOnReject` detaches the unit from the DC and deliberately leaves it `in_transit` — no DC, no owner, no next step, until a human notices.

`services/deliveryRejectionService.js:231-241`

**I18 · Serious · Race or structural bug** — Ready-to-Rent shows units that SO attach will refuse

The off-shelf list on the inventory screen omits `qc_failed`, `out_for_repare` and `out_for_return`, which the attach path excludes. The comment above it claims the two lists are aligned. Neither excludes `in_repair`.

`services/inventoryManagementService.js:75-80 vs salesManagementService.js:2361-2362`

**I5 · Serious · Race or structural bug** — No row lock anywhere in the transition path

`loadSerial` has no `FOR UPDATE`, and serial-attach runs its whole eligibility check before `BEGIN`. Two concurrent transitions both read the same "from" state and both pass validation.

`services/inventoryStateMachine.js:71-77; salesOrderSerialController.js:183-232`

**I6 · Serious · Missing / unreachable gate** — The allowed-transition map is missing real business events

`in_transit → returned` and `dispatch_ready → qc_failed` both happen every week and neither is permitted — which is precisely why two of the bypasses exist. The map was written from the happy path.

`services/inventoryStateMachine.js:43-55`

**I7 · Serious · Missing / unreachable gate** — Scrapped is not terminal in practice

`ALLOWED.scrapped = []` says nothing leaves scrapped. A raw UPDATE in the QC intake service resurrects scrapped units to `in_stock`.

`services/qcProcessIntakeService.js:797-805`

**I9 · Serious · Parallel implementation** — `vendor_product_inventory` is a third status store

Written only on DC create and cancel, never on delivery, return, QC fail or scrap — and still read when checking availability.

`salesManagementService.js:2449-2450`

**I14 · Moderate · Dead code or dead value** — Columns written and never read

`vendor_return_ticket_number`, `vendor_buyout_bill_no/amount/at/by`, `part_instance_id`, and `rental_start_date` (superseded by `rent_start_date`, but still a COALESCE fallback in billing).

`migrations 178, 240, 248`

**I16 · Moderate · No audit trail** — QC failure detail is silently truncated

`transitionAsset` cuts `reason` to 255 characters; Dispatch QC builds a 2,000-character failure reason. The detail the technician typed is the part that gets cut.

`inventoryStateMachine.js:196; dispatchQcCaptureService.js:209`

### Lead · 3 findings

*Enquiry captured, followed up, qualified*

**L1 · Serious · Race or structural bug** — `converted_at` is overwritten, not preserved

`converted_at = NOW()` rather than `COALESCE(converted_at, NOW())`, and nothing guards against converting twice. The conversion-latency metric on the dashboard reads this column.

`controllers/leadController.js:2765-2770`

**L2 · Serious · Parallel implementation** — Two lead → customer upserts

`convertToCustomer` is status-gated and stamps `converted_at`. `ensureCustomerFromLead` is neither, and writes a different column set. Both key on `source_lead_id`.

`controllers/leadController.js:2639 vs :342`

**L3 · Moderate · No audit trail** — The conversion overwrite is unaudited

One free-text `lead_activities` note. The previous conversion timestamp is simply gone.

`controllers/leadController.js:2772-2779`

### Quotation · 5 findings

*Estimate issued, sent, accepted by the customer*

**Q1 · Critical · Missing / unreachable gate** — Quotation acceptance is never required for a sales order

`storeSalesOrder` does not query `sales_quotations` at all. The quotation number is free text: a rejected quote, a pending quote, a number that does not exist, or the literal string `N/A` all produce a valid SO. The entire accept-token mechanism is decorative.

`controllers/salesManagementController.js:928-1055, :966`

**Q2 · Serious · Missing / unreachable gate** — Quotation status has no transition guard

Any of the five statuses in any order — `accepted → pending` is legal. And setting `accepted` through this endpoint never sets `accepted_at`, producing rows the accept-token path then treats as already accepted.

`controllers/salesManagementController.js:642-679`

**Q3 · Serious · No audit trail** — Quotation status changes are not audited

The status is overwritten in place with the actor's name. The previous value is lost and there is no quotation activity table.

`controllers/salesManagementController.js:670-674`

**Q5 · Serious · Parallel implementation** — Two representations of acceptance

A `sales_quotations` row with `accepted_at`, and `leads.quotation_accepted_at`. The token path falls through from one to the other when no quotation row matches.

`services/salesQuotationEmailService.js:262; leadController.js:817-860`

**Q4 · Moderate · Dead code or dead value** — `sales_quotations` has no line number

Lines are one row each but are distinguished only by insertion `id` order. Reordering or re-inserting a line changes the quotation.

`migrations/042_sales_management_module.sql`

### Customer · 2 findings

*Lead converted or customer onboarded directly*

**C1 · Serious · Parallel implementation** — Three customer-creation paths, two of them lossy

The direct-onboarding path never sets `source_lead_id`, `onboarded_by`, `onboarded_at` or `source_lead_stage`. Any report that segments customers by origin under-counts by exactly those customers.

`controllers/customerManagementController.js:1289-1304`

**C2 · Moderate · Parallel implementation** — Two more lead-less customer inserts in the legacy sales chain

Different column set again, from a chain that never touches the asset master.

`controllers/salesController.js:527, :788`

### Sales Order · 5 findings

*Order raised, lines priced, serials attached*

**S5 · Critical · Revenue or cost leak** — The rent-rate fallback can pick the wrong line

On a mixed-configuration DC the fallback joins order lines on the SO number alone, ordered by brand match, and stamps whatever it finds onto `vendor_serial_numbers.rent_monthly_rate` — which billing then treats as authoritative.

`services/serialRentRateService.js:31-38`

**S1 · Serious · Missing / unreachable gate** — `sales_order_lines.quotation_type` has no CHECK constraint

The quotation table constrains it to sale / rental / demo. The order line does not — and any unknown value silently maps to the `rentfoxxy` entity, so a typo picks the billing entity.

`migrations/042_sales_management_module.sql:78 vs 044:4-5`

**S2 · Serious · Race or structural bug** — The SO number is allocated outside its own transaction

`nextFinancialYearNumber('sales_order')` is called without the client, so it commits and releases the sequence lock immediately. A rollback burns the number. Every other document in the chain passes the client correctly; SO create and Return DC do not.

`controllers/salesManagementController.js:965; :4420`

**S3 · Serious · Race or structural bug** — The line-capacity check has no database backstop

Duplicate serial attach is caught by a partial unique index. Over-allocating a line is not: two concurrent attaches to a `quantity=1` line both read zero and both insert.

`controllers/salesOrderSerialController.js:241-263`

**S4 · Serious · Missing / unreachable gate** — One serial can sit on two sales orders

The unique index covers `status='attached'` only. Once an allocation flips to `dispatched`, the same serial can be attached to a second SO with nothing stopping it.

`migrations/075_sales_order_serial_allocation.sql:29-30`

### Dispatch QC · 7 findings

*Pre-dispatch check after serials are attached to the SO*

**D1 · Critical · Missing / unreachable gate** — One of the two DC endpoints has no QC gate

`createDcsByAddress` blocks laptops that have not passed Dispatch QC. Its sibling `storeDeliveryChallan` has no equivalent check in 400 lines — it takes serial tokens straight from the request body and moves them to dispatch-ready.

`controllers/salesManagementController.js:3437-3443 vs :2921-3321`

**D2 · Critical · Missing / unreachable gate** — The real QC gate is unreachable

`assertDcQcComplete` has exactly one caller, and that endpoint returns 409 for every DC created today because it refuses DCs already at `dispatch_ready` — the status every modern DC is born with. The demo-KYC gate and the e-way-bill gate die with it.

`controllers/salesManagementController.js:5390, :5464, :5521-5529`

**D5 · Critical · Permission hole** — The capture-token mint route has no permission check

Auth middleware and nothing else. Any authenticated user mints a token for any ticket, returning an 8-character access number redeemable on an unauthenticated endpoint.

`routes/dispatchQc.js`

**D3 · Serious · Missing / unreachable gate** — That gate also fails open

Zero QC rows is treated as a pass, not as "not yet checked".

`controllers/salesManagementController.js:5395`

**D4 · Serious · Dead code or dead value** — `dispatch_qc_capture_tokens` is a write-only table

Hardware script verification is recorded and ignored. The comment in the code records the deliberate decision to stop enforcing it because it blocked every SO completed through the normal QC flow.

`controllers/salesManagementController.js:3445-3447`

**D7 · Serious · Parallel implementation** — QC pass is written in two controllers

Both update the same four things, but only one first checks whether an attached allocation still exists; the other re-reserves unconditionally.

`controllers/qcController.js:529-565 vs ticketPhase2Controller.js:584-621`

**D6 · Moderate · Dead code or dead value** — `dc_qc_tickets.status = 'qc_failed'` is never written

The status is allowed by the constraint and produced by no code path, so the `any_failed` flag the DC screen reads is permanently false.

`migrations/061_phase4_sales_pipeline.sql:56-57; salesManagementController.js:5376`

### DC / Dispatch · 7 findings

*Delivery challan cut, guard gate outward*

**DC1 · Critical · Missing / unreachable gate** — The guard gate checks nothing but the DC's own state

It blocks cancelled, delivered and rejected challans. It does not check QC, e-way, or that an AWB exists — and it accepts DCs still at `pending`. This is the event that puts stock in transit and starts the rent clock.

`services/guardGateValidationService.js:588-599, :2463`

**DC2 · Critical · Race or structural bug** — Two concurrent DC creations can both succeed

Allocations are validated before `BEGIN`, with no row lock, and the commit UPDATE has no `status='attached'` guard and no rowCount check. The second call silently repoints `dc_number`, leaving the first challan referencing serials that now belong to another one. There is no unique constraint on the DC number.

`controllers/salesManagementController.js:3364-3443, :3633-3638`

**DC4 · Critical · No audit trail** — There is no DC status history

No `dc_status_history` table anywhere. The activity feed is written post-commit, fire-and-forget, and swallows its own failures — and a DC with no sales order number (every return DC) gets no timeline at all.

`services/deliveryRejectionService.js:176-191`

**DC3 · Serious · Race or structural bug** — Order-line quantity is decremented by configuration match, not line id

Two order lines with identical configuration both get decremented by the full quantity of one shipment.

`controllers/salesManagementController.js:3116-3119`

**DC7 · Serious · Missing / unreachable gate** — A DC that never left the warehouse cannot be rejected

`REJECTABLE_STATUSES` omits `dispatch_ready`, so a challan created but not yet gated out must be cancelled by a super admin instead — a different code path with different inventory effects.

`services/deliveryRejectionService.js:17`

**DC5 · Moderate · Dead code or dead value** — The `shipped` status is written only by dead code

Its single writer is the unreachable dispatch endpoint. The status remains in the constraint and in every status filter.

`migrations/209_dc_status_dispatch_ready.sql:8-19`

**DC6 · Moderate · Dead code or dead value** — Five file columns on the DC line, one of them read by nothing

`file_path`, `pdf_path`, `pod_photo_url`, `esign_url`, `bluedart_awb_pdf_path`. `file_path` is written on one path and read nowhere in the backend.

`controllers/deliveryRegisterController.js:249`

### BlueDart · 2 findings

*AWB generated, tracking swept, auto-delivery*

**B1 · Critical · Race or structural bug** — BlueDart sync claims challans with a blank courier

The sweep matches `courier_name ILIKE '%bluedart%' OR courier_name IS NULL OR TRIM(courier_name) = ''`. A porter or by-hand DC carrying an AWB number with no courier name gets swept into BlueDart tracking and can be auto-marked delivered by an unrelated waybill — full inventory finalisation, rent clock and invoice included.

`services/bluedartAwbSyncService.js:52-53`

**B2 · Moderate · Missing / unreachable gate** — Courier auto-delivery has no proof and no opt-out

A delivered scan is the proof, by design. But there is no per-customer or per-mode way to require a POD on top of it.

`services/bluedartAwbSyncService.js:165-237`

### Delivery · 8 findings

*Reached → OTP → POD → delivered, rent clock starts*

**V1 · Critical · Parallel implementation** — Five code paths write `status = 'delivered'`

Technician OTP+POD, admin override, delivery register POD, `markDcDelivered`, `submitDeliveryRegister`, plus the BlueDart sweep. Only four call `finalizeDeliveryInventory`; only four set `delivered_at`. Which one was used decides whether the asset, the rent clock and the invoice follow the challan.

`deliveryFlowController.js:638, :749; deliveryRegisterController.js:250; salesManagementController.js:5998, :4008; bluedartAwbSyncService.js:194`

**V2 · Critical · Revenue or cost leak** — `submitDeliveryRegister` delivers with no OTP, no POD and no finalisation

It also never sets `delivered_at`. The challan reads delivered everywhere, the asset stays `in_transit`, `rent_start_date` is never set and no invoice is ever raised. This is silent revenue loss with no error anywhere.

`controllers/salesManagementController.js:3988-4031`

**V3 · Critical · Missing / unreachable gate** — `markDcDelivered` requires no proof at all

It takes `pod_image_url` as a plain string from the request body and never verifies a file exists. Anyone with challan edit rights can mark any DC delivered and start the rent clock.

`controllers/salesManagementController.js:5959-6065`

**V5 · Critical · Permission hole** — Technician delivery endpoints have no ownership check

Reached, verify-serial and deliver all gate on `technician_bucket:edit` only. `delivery_person_id` is never compared to the caller. Any technician can generate the OTP for, and deliver, any other technician's challan.

`routes/salesManagement.js:170-172; middleware/dcNumberRoutes.js:39-58`

**V6 · Critical · Permission hole** — The delivery OTP has no expiry and no attempt limit

Six digits, stored in plaintext, compared as a bare string with unlimited retries — and written to every line of the challan, so one code opens all of them.

`migrations/086_delivery_flow_complete.sql:34-36; deliveryFlowController.js:504-510, :621`

**V4 · Serious · Missing / unreachable gate** — POD is optional on the technician path

`pod_type` falls back to `none` and the delivery completes. The admin-override path enforces the photo; the primary path does not.

`controllers/deliveryFlowController.js:633`

**V7 · Serious · Parallel implementation** — Two OTP column families

`otp_code` / `otp_verified_at` and `d_otp` / `d_otp_verified_at`. One screen writes only the first, another only the second, a third gates on only the second, a fourth coalesces both. Which OTP works depends on which screen sent it.

`deliveryRegisterController.js:135, :200; deliveryFlowController.js:506; salesManagementController.js:3967`

**V8 · Serious · Race or structural bug** — Only one of the five delivery paths takes a row lock

`markDcDelivered` locks, with a comment about double-clicks. The other four read the aggregate with a plain SELECT before `BEGIN`, so two concurrent submissions can both finalise inventory and both trigger a rental invoice.

`deliveryFlowController.js:599-616, :731-742; deliveryRegisterController.js:188-202`

### Returns · 4 findings

*Refusal, customer return DC, vendor return*

**T1 · Critical · Revenue or cost leak** — Rejecting from the delivery register strands the unit permanently

It writes `status='rejected'` with no reason, no timestamp, no allocation release and no QC re-entry. The asset stays `in_transit` pointing at a rejected challan, the SO allocation stays `dispatched`, and the cancel-eligibility check counts it as awaiting warehouse receipt forever — so the sales order can never be cancelled.

`controllers/deliveryRegisterController.js:225; salesManagementController.js:4017`

**T2 · Serious · Missing / unreachable gate** — Returned units land in `returned`, not back in stock

Nothing single-handedly owns releasing them. They become attachable again only when a return-QC ticket passes, or when the table-wide heal flips them on someone's next inventory search.

`services/returnCompletionService.js:158-165`

**T4 · Serious · Missing / unreachable gate** — Vendor return and vendor repair leave different traces

The vendor-return path follows a proper transition then raw-writes `qc_status`; the vendor-repair return is the one fully clean return path in the codebase. The two are not symmetric.

`vendorReturnToVendorService.js:513-522 vs vendorRepairDcService.js:1665`

**T3 · Moderate · Dead code or dead value** — The vendor return ticket number is written, cleared, and never displayed

Set on the asset, cleared on completion, and read only by its own WHERE clause. No screen shows it.

`services/vendorReturnTicketService.js:364, :707`

### Billing · 22 findings

*Customer invoices and vendor monthly bills*

**BL1 · Critical · Revenue or cost leak** — The vendor bill has no inventory-status filter

Scrapped, sold, lost and back-in-warehouse units keep accruing vendor rent every month. The customer-side query filters on status; the vendor-side query selects it and never uses it. Exposure = every rental-purchase serial in a terminal state with no vendor rent-end date, times the PO rate, times the months since.

`services/billingSchedulerService.js:3196-3210`

**BL11 · Critical · No audit trail** — Zero audit rows from either billing controller

Invoice generation, send, mark-paid, credit-note approval, vendor-bill approval and debit-note approval all write nothing. For the one module where every action is a financial fact, there is no trail.

`controllers/customerBillingController.js; vendorBillingController.js`

**BL14 · Critical · Permission hole** — Vendor Management view rights grant delete on vendor billing

The same `authorize` helper as P1, applied to the billing CRUD routes. Highest-severity permission item in the audit.

`routes/vendorManagement.js:263-267`

**BL19 · Critical · Revenue or cost leak** — A unit away for repair keeps billing the customer

There is no billing-hold concept anywhere in the backend. The return-date loader deliberately excludes still-rented repair pickups, so the rent runs while the laptop is on the bench.

`services/billingSchedulerService.js:206-210`

**BL2 · Critical · Revenue or cost leak** — Vendor rent can start from the row-creation date

The eligibility date coalesces down to `created_at::date` when the serial has no received date and no rental start date — so the vendor is paid from the moment the row appeared, not from receipt.

`services/billingSchedulerService.js:3207-3208`

**BL3 · Critical · Revenue or cost leak** — A missing rate produces a ₹0 line that counts as billed

The calculation only skips a `null` result, not a zero amount. On the customer side `rent_billed_until` still advances, so that month is permanently lost — there is no retry path and nothing reports it.

`services/billingSchedulerService.js:669, :3229; services/billingMath.js:78`

**BL7 · Critical · Race or structural bug** — GST is a flat hardcoded 18%

No place of supply, no CGST/SGST versus IGST split, and no columns to hold one. Every inter-state supply is mis-classified on the invoice.

`services/billingSchedulerService.js:2637, :3262`

**BL10 · Serious · Race or structural bug** — The vendor-bill duplicate check has no row lock

A plain SELECT before insert. Two concurrent runs both see no row, both insert, one dies on the unique index and rolls back its whole bill.

`services/billingSchedulerService.js:3173-3181`

**BL12 · Serious · Permission hole** — No maker-checker separation on bill approval

Approve requires only edit rights and never checks that the approver differs from the generator. `manager` holds both by default from the seed.

`controllers/vendorBillingController.js:230-247; migrations/067:153`

**BL13 · Serious · Missing / unreachable gate** — There is no void or cancel endpoint

`cancelled` is filtered on everywhere and set nowhere. Every correction is a direct database write, with no reason and no trail — by design, because no other path exists.

`controllers/customerBillingController.js:122, :327, :515`

**BL15 · Serious · Permission hole** — No customer-scope check on invoice generation

A rental-scoped user can generate an invoice for any customer id.

`controllers/customerBillingController.js:659-665`

**BL18 · Serious · Navigation / design** — The payment endpoints have no frontend caller

Record-payment exists on both customer and vendor sides, with a working ledger behind it. Nothing in the UI calls it — partial payments can only be entered by hitting the API directly.

`routes/customerBilling.js:17-18; vendorBilling.js:17-18`

**BL20 · Serious · Revenue or cost leak** — Parts charged to the customer never reach an invoice

`charge_amount` and `billing_type` are captured on the part request and joined by no billing code.

`migrations/183_support_part_customer_dc.sql:19-20`

**BL22 · Serious · Missing / unreachable gate** — The billing cron is off by default

`BILLING_CRON_ENABLED` defaults to false, so in practice billing runs when somebody clicks a button. Nothing reports a month that was never generated.

`services/billingSchedulerService.js:3332-3333`

**BL4 · Serious · Revenue or cost leak** — Three draft-strip functions delete lines without rewinding the billed-until marker

Only the warehouse-return strip rewinds it. The spans the other three remove are never re-billed.

`services/billingSchedulerService.js:1149-1227, :1343, :1377`

**BL5 · Serious · Revenue or cost leak** — A vendor can be permanently invisible to the batch run

The batch enumerates vendors by the PO type; the per-vendor generator selects serials by the serial's own acquisition type. A vendor whose POs are all direct-purchase but whose serials were flipped to rental never gets enumerated, so their bill is never generated.

`services/billingSchedulerService.js:3308-3315 vs :3196`

**BL6 · Serious · Revenue or cost leak** — The debit-note sweep has no month filter

Every approved, unadjusted debit note for a vendor is consumed by whichever bill is generated first — including a backfill of an old month.

`services/billingSchedulerService.js:3253-3259, :3287-3295`

**BL8 · Serious · Race or structural bug** — Invoice numbers break past 9,999

Four-digit zero pad with no financial-year segment and no width guard — unlike every other document in the system. The docblock records that a previous version of this function burned 625 of 1,193 numbers, breaking the consecutive-series requirement.

`services/billingSchedulerService.js:117-144`

**BL9 · Serious · Revenue or cost leak** — Nothing ever moves an invoice from sent to overdue

There is no job and no endpoint. The overdue total on the finance screen is permanently zero unless someone sets the status by hand.

`controllers/customerBillingController.js:179-181`

**BL16 · Moderate · Dead code or dead value** — `vendor_bill_lines` is written and read by nothing

Its only SELECT in the repository is inside a backfill script.

`migrations/119_invoice_lines_normalized.sql:28-41`

**BL17 · Moderate · Dead code or dead value** — The IRN and e-way columns on the invoice are never written

E-invoice data goes to a different table entirely. Six columns sit permanently null on the invoice record.

`migrations/067_phase5_billing_engine.sql:22-27`

**BL21 · Moderate · Race or structural bug** — Proration rounds in the vendor's favour at both ends

A minimum of one billable day is floored in even for a zero-day span, and a return on the last day of the month bills the full month.

`services/billingMath.js:73, :77`

### Support · 27 findings

*Complaint, pickup, repair, return, technician bucket*

**U1 · Critical · Missing / unreachable gate** — Support has no state machine and no constraints

Around 40 raw UPDATE sites across six files, and no CHECK on either the ticket status or the item status. Any string can be written as any status at any time.

`migrations/025_support_module.sql:22-69`

**U12 · Critical · No audit trail** — Support writes the asset status with raw SQL

It sets `inventory_status='returned'` directly, bypassing the state machine the module already imports — and the source state is usually `in_transit`, a transition the map forbids. No transitions row, no TTSPL event.

`controllers/supportController.js:3046-3055, :3659-3668`

**U14 · Critical · Race or structural bug** — Support finds the asset by string match, not by key

The join is `ttspl_id = inventory_asset_code OR unique_serial_number = inventory_asset_code OR serial_number = serial_number`. There is no `serial_id` foreign key on the ticket item. A TTSPL typed into the serial field silently matches the wrong row, or nothing.

`services/billingSchedulerService.js:191-199; grnTicketService.js:677-683`

**U17 · Critical · No audit trail** — Ticket status changes are never audited

Recompute, close and cancel all write the ticket status with no audit row — and the audit table that does exist records no from/to pair, only a free-text action. A status history cannot be reconstructed.

`controllers/supportController.js:890-916, :1582, :1718; migrations/025:71-79`

**U2 · Critical · Permission hole** — Replacement status is taken unvalidated from the request body

It is written into both the replacement order and the ticket item. With no constraint behind it, a lead can PATCH `status: "resolved"` and close a ticket with no inventory movement and no OTP.

`controllers/supportController.js:5485-5503`

**U21 · Critical · Permission hole** — Any logged-in user can read any parts challan

Authenticated but not authorised, and no ownership check in the handler. Customer name, ticket, parts and e-sign names are all returned.

`routes/supportParts.js:108; supportPartsController.js:1327-1353`

**U22 · Critical · Permission hole** — Any non-technician role sees every technician's held parts

The bucket endpoint has no permission guard and self-filters only when the caller's role is exactly `support_tech`.

`routes/supportParts.js:112; supportPartsController.js:1230-1236`

**U23 · Critical · Permission hole** — Warehouse-confirm is mounted before the support gate

It sits above `requireSupportAccess` in the router, so any authenticated user reaches it; only an in-controller role check stands in the way.

`routes/support.js:140-143`

**U24 · Critical · Permission hole** — The public support endpoints have no rate limit

And the TTSPL lookup returns the customer id and company name for any valid code — unauthenticated fleet enumeration, one guess at a time.

`server.js:150; controllers/supportRequestController.js:486-491`

**U25 · Critical · Parallel implementation** — Authorisation is split three ways inside one module

The permission matrix, hardcoded role arrays, and the legacy JWT permissions array all gate different routes of the same module. The Roles screen does not govern the parts routes at all.

`middleware/supportAccess.js:16, :31-34, :114-151; routes/supportParts.js:7`

**U27 · Critical · Parallel implementation** — The revamp branch builds a second support module beside the first

About 40 new tables, 15 controllers, 40 services and a parallel frontend — and it deletes nothing. Its migration numbers 197 to 222 collide with migrations that already exist on the live branch with different content.

`branch origin/support_revamp`

**U4 · Critical · Missing / unreachable gate** — There is no SLA of any kind

No response or resolution targets, no clocks, no pauses, no business calendar, no escalation. The only thing resembling one is a flat 48-hour inactivity flag.

`services/supportQuery.js:5, :49`

**U5 · Critical · Missing / unreachable gate** — No assignment engine

No auto-assignment, no round robin, no skill or zone routing, and no capacity cap. The technician list computes each technician's open-item count and nothing consumes it.

`controllers/supportController.js:1144-1171`

**U10 · Serious · Missing / unreachable gate** — The return leg has no courier or tracking fields

The pickup leg captures courier name and AWB. The service delivery challan that returns the repaired laptop captures only its own number.

`migrations/168_service_delivery_challan.sql:2-8`

**U11 · Serious · Revenue or cost leak** — Parts handed over at the warehouse never enter the costing ledger

`markPartUsed` writes no cost row. Only the courier-to-customer path does, so repair cost per laptop is understated by every warehouse handover.

`controllers/supportPartsController.js:1032-1126`

**U13 · Serious · Race or structural bug** — The link to the production floor is one-way

Support creates a floor ticket on warehouse receipt and stores its id. Nothing reads that ticket's completion to advance the support item — the technician has to notice.

`controllers/supportController.js:3020-3058; services/grnTicketService.js:669-740`

**U15 · Serious · Race or structural bug** — The outcome vocabulary differs across three files

`setOutcome` rejects `repair_required`; the pickup submission writes it directly; the flow service branches on it. Three files, three views of the same enum.

`controllers/supportController.js:4087, :2919; services/supportTicketFlow.js:11`

**U26 · Serious · Navigation / design** — Four of about twenty-two support routes are in the menu

Everything else is reachable only through the module's own sidebar, which gates on the raw role string rather than the permission matrix.

`frontend/src/config/menuConfig.js:333, :340, :85-86`

**U3 · Serious · Race or structural bug** — The ticket-status recomputation has a no-op branch

`anyActive ? IN_PROGRESS : IN_PROGRESS` — both arms identical, the condition computed and discarded. A ticket whose items are all in a non-terminal, non-open state is forced to in-progress regardless.

`controllers/supportController.js:911-912`

**U6 · Serious · Missing / unreachable gate** — No technician acceptance step

Assignment is push-only. The technician never accepts, so there is no moment that separates "assigned" from "started".

`controllers/supportController.js:2143-2214`

**U7 · Serious · Missing / unreachable gate** — One photo per item, and no attachments table

A single `pod_image_path` and a single proof-of-completion path. A complaint with three photos of the damage has nowhere to put two of them.

`migrations/025_support_module.sql:57`

**U8 · Serious · Missing / unreachable gate** — No CSAT, no notification templates, no notification log

WhatsApp is fire-and-forget with no record of what was sent or whether it landed.

`controllers/supportController.js:71`

**U9 · Serious · Revenue or cost leak** — Parts charged to the customer never reach an invoice

Same leak as BL20, seen from the support side: the charge is captured on the request and read by no billing code.

`migrations/183_support_part_customer_dc.sql:19-20`

**U16 · Moderate · Race or structural bug** — Issue category is stored twice and drifts

Both the id and the label are written onto the item. Renaming a category leaves every historical label stale, and reports group by the stale copy.

`migrations/025_support_module.sql:52-53`

**U18 · Moderate · Dead code or dead value** — Two settings that are settable, visible and inert

`auto_close_enabled` has a toggle in the settings screen and no worker behind it. `msr91_enabled` is read by the query layer and acted on nowhere.

`controllers/supportController.js:2288-2307; services/supportQuery.js:40-42`

**U19 · Moderate · Dead code or dead value** — The loan-machine flow is unreachable

Its legacy branch requires a null pickup type, which every new pickup sets. The columns, the 72-hour wait and the step derivation are all dead.

`services/supportTicketFlow.js:53-54, :91-94`

**U20 · Moderate · Dead code or dead value** — The replacement order has three overlapping link columns

`source_item_id`, `complaint_item_id` and `pickup_item_id` from three different migrations, plus old and new serial ids from a fourth. The backfills show they were never consolidated.

`migrations/027:24, 029:20-21, 097:50, 113:17-18`

### Platform · 7 findings

*Cross-cutting: permissions, navigation, tests*

**X1 · Critical · Parallel implementation** — Two complete sales → dispatch → delivery stacks are live

The legacy chain runs on `orders` / `order_items` / `inventory` with its own statuses and hand-rolled role checks, never touches the asset master or the state machine, and is still wired into the UI. Nothing reconciles the two.

`server.js:120-121; components/Orders.jsx:60; Sales.jsx:289; Dispatch.jsx:85`

**X2 · Critical · Permission hole** — Three permission systems coexist

Section matrix, hardcoded role arrays inside controllers, and a legacy JWT permissions array. A grant in the Roles screen does not describe what a user can actually do.

`middleware/*, routes/salesManagement.js:225, supportAccess.js`

**X3 · Critical · Navigation / design** — About 64 routed pages are unreachable from the menu

Including the three purchase-type pages that answer a question already asked of this system. Work that was built, shipped and then lost.

`frontend/src/config/menuConfig.js`

**X4 · Serious · Dead code or dead value** — No tests cover the order-to-cash chain

The test folder covers billing maths, WhatsApp, sale-in-place, support OTP and the vendor repair gate. Nothing covers quotation → SO, serial attach, DC creation, the guard gate, delivery or rejection.

`backend/test/`

**X6 · Serious · Permission hole** — The frontend gates on the raw role string

Not on the permission matrix. Revoking a permission leaves the link visible and the API is the only real gate.

`components/support/SupportShell.jsx:81-95; SupportApp.jsx:56-71`

**X7 · Serious · Navigation / design** — There is no design system to redesign against

`tailwind.config.js` extends nothing. The shared primitives file exports eleven components; the responsive table is used in 9 of 133 files and the empty state in none.

`frontend/tailwind.config.js; components/ui/primitives.jsx`

**X5 · Moderate · Dead code or dead value** — Open decisions are recorded as prose, not as work items

No TODO, FIXME or HACK marker anywhere in controllers, services, routes or middleware. Known trade-offs are written as comments describing why a check was removed — invisible to a linter and to grep.

`backend/controllers, services, routes`
