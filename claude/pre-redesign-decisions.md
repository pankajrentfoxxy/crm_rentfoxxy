# Pre-redesign decisions — resolved

Companion to `claude/flow-audit.md`. Answered 20 Sep 2026. Decisions 3, 5 and 6 are my recommendations with reasoning; the rest are Pankkaj's calls.

**Where the work happens:** branch off `new_stagging_crm`, verify, then merge forward to `new_crm_rentfoxxy`. **Both branches point at the same live database**, so staging verifies the code and not the data — every migration lands on production data the moment it runs.

**Two things in here have moved since this was written.** Decision 3's phase order still stands, but the bypass list now lives in `claude/bypass-register.md` with line numbers verified on staging. And BL19 — the repair-billing leak cited under Decision 2 — has since been solved on staging by *continuing* to bill across a repair and crediting the warehouse days back, rather than by a hold. See Part 6.3.4 of the master prompt; the staging answer is the better one because it leaves a finance record.

---

## 1. Which sales chain survives? — **RESOLVED**

**Retire the legacy `/api/sales` chain.** Redirect its four screens (`Orders.jsx`, `Sales.jsx`, `QCOrders.jsx`, `Dispatch.jsx`) at `/api/sales-management`, then delete the chain, its controllers and the `orders` / `order_items` / `procurement_requests` tables.

**Within the surviving chain, sales splits into two entities:**

| | Rental | Sale |
|---|---|---|
| Brand | RentFoxxy | Gorefurbo |
| `entity_code` | `rentfoxxy` | `gorefurbo` |
| `quotation_type` | `rental`, `demo` | `sale` |
| Delivered asset status | `rented`, `on_demo` | `sold` |

**Prerequisite nobody has flagged.** `sales_order_lines.quotation_type` has **no CHECK constraint** (finding S1), and `entityForQuotationType()` maps every unknown value silently to `rentfoxxy`. So today a typo in the order type picks the billing entity. Before the two-entity split can be trusted on screen, that column needs a constraint and the mapping needs to fail loudly. This is a one-migration fix and it should land early.

Also note: the legacy `inventory` table is written by `salesController`, `warehouseController` and `procurementController`. Retiring the sales chain removes one of the three writers, not all of them — warehouse and procurement need their own migration off it (findings I8, B4).

---

## 2. Support v1 or v2? — **RESOLVED**

**Take the `support_revamp` v2 schema, rebuild its UI inside the new design system.** v1's backend is deleted once v2 is live.

Requirement stated: it must be genuinely easy for the **support lead** and the **technician**, and every case must work.

### What carries over well from v2

The v2 schema was clearly designed against the same problems the audit found. It already contains:

- `support_sla_policies` / `_clocks` / `_pauses` + business calendars — fixes U4 (no SLA)
- `support_assignment_groups`, `support_skills`, `user_skills`, `user_shifts`, `support_zones` — fixes U5 (no assignment engine)
- `support_attachments` — fixes U7 (one photo per item)
- `support_ticket_events` — fixes U17 (no status history)
- **`asset_billing_holds`** — fixes BL19, the leak where a laptop away for repair keeps billing the customer
- `support_csat_tokens`, `support_notification_templates` / `_log` — fixes U8
- `support_work_orders` + `workOrderEffects/` — a real state layer, fixes U1

### Blockers to clear before adopting it

1. **Migration numbers 197–222 collide** with live migrations that already exist on `new_stagging_crm` and `new_crm_rentfoxxy` alike with different content. Renumber above the live maximum before anything is run. This is the single highest-risk item in the whole plan — running a colliding migration on the live DB is how you lose data.
2. **v2 deletes nothing.** The adoption plan needs an explicit v1 retirement step, or you end up with the same duplication the audit is about.
3. v2 modifies shared live files (`billingSchedulerService.js`, `inventoryStateMachine.js`, `grnTicketService.js`, `roleDefaultsSeed.js`, `ticketController.js`). Those diffs need reviewing against the audit findings, not merging blind.
4. The v2 UI (`features/support-v2/`, ~50 files) is discarded and rebuilt — that is the decision, and it means the v2 controllers must not assume its screens.

---

## 3. Status vocabulary — **RECOMMENDATION: canonicalise the columns, in this order**

Display-layer-only canonicalisation is a trap. It cannot fix the three most expensive findings:

- **I11** — the dashboards read `qc_passed`, `out_stock`, `qc1/qc2/in_qc`, none of which any current code writes. A display mapping does not make those tiles correct; it just hides that they are counting ERP-imported rows.
- **I10** — six mutually inconsistent "available stock" predicates live in SQL, not in the display layer. A unit is available on one screen and rejected on the next, and that stays true.
- **I2** — `isAllowed()` exempts any row whose current status is non-canonical. Every stray value written today permanently removes that asset from validation. Only fixing the column fixes this.

So: canonicalise the columns. **But the order matters more than the choice**, because this is a live database.

### Phase 0 — close the bypasses first
Make `transitionAsset()` the only writer of `inventory_status`. Thirty-two runtime bypasses, nine of them `catch` blocks that force the write after validation refuses it. **Adding a CHECK constraint before this turns those bugs into production 500s.** This phase is also where the missing legal transitions get added (`in_transit → returned`, `dispatch_ready → qc_failed` — finding I6), because two of the bypasses only exist because the map was written from the happy path.

### Phase 1 — measure
`SELECT inventory_status, qc_status, count(*) FROM vendor_serial_numbers WHERE deleted_at IS NULL GROUP BY 1,2 ORDER BY 3 DESC`. You cannot plan the mapping without the real distribution. Do the same for support statuses, DC status and ticket status.

### Phase 2 — map and migrate
One migration per entity. Every stray value maps to a canonical one, and **the old value is preserved** (`extra.legacy_status`, or a `status_migrated_from` column) so nothing is lost and the mapping is auditable. Write an `inventory_status_transitions` row for each change with `reason = 'canonicalisation'` so the migration itself appears in the timeline.

### Phase 3 — constrain
Add the CHECK. Not before phase 2, or every unmapped row blocks writes.

### Phase 4 — one predicate
Replace the six availability definitions with a single SQL view or function that every caller uses. This is the phase that makes the dashboards trustworthy, and it is the reason to do all of it.

### The proposed canonical list — asset

Eight values, which is also the state palette in the design system:

`in_stock` · `reserved` · `dispatch_ready` · `in_transit` · `rented` · `on_demo` · `sold` · `returned` · `in_repair` · `qc_failed` · `scrapped` · `at_gate`

(Eleven canonical today plus `at_gate`, which decision 4 introduces. The design system uses eight *display* groups; several of these collapse for the chip.)

Retired, with their mapping: `out_stock → rented` · `passed → in_stock` · `out_for_repare → in_repair` · `out_for_return → returned` · `repared → in_stock` · `replace → returned` · `qc_reject → qc_failed` · `require_for_parts → scrapped` · `send_to_qc_check → qc_failed` · `missing` and `deleted` → need a business answer, not a technical one.

---

## 4. Is the guard gate the gate? — **RESOLVED**

**It is the gate.** Stated model:

- A laptop stays **Dispatch Ready** until the guard scans it out. The guard scan is what means it left the warehouse.
- On the way back the guard confirms arrival and **holds custody**; inventory then picks it up from the guard.
- The guard must see full detail of what is going out and what is coming in.

### What this implies structurally

**A new state is required: `at_gate`.** Today inward confirm has nowhere clean to put a unit between "guard received it" and "inventory booked it". The stated model makes that interval explicit and auditable — a unit at the gate is neither out nor in stock, and somebody is accountable for it. Without this state, "inventory can pick from guard" cannot be recorded.

**The gate becomes a checklist that can refuse.** Today `loadOutboundDc` blocks only cancelled / delivered / rejected challans — it does not check QC, e-way or AWB, and it accepts challans still at `pending` (finding DC1). Under this decision the gate checks: QC passed, e-way present where required, AWB present for courier mode, and per-unit config match. A refusal is recorded, not just a silent 400.

**The guard screen is a first-class shell**, at floor density, not a cut-down desk page. It is the load-bearing screen for this decision.

Noted: more changes to this flow are coming later.

---

## 5. One event table or per-module? — **RECOMMENDATION: one append-only event table**

### Why one

The thing actually wanted is a **timeline per laptop and per document**. A laptop's life crosses PO, GRN, production, QC, sales order, DC, gate, delivery, support, return and billing. With per-module tables that timeline is a `UNION` of eight queries that must be updated every time a module is added, and it breaks the moment one module adds a column.

There is also direct evidence in the codebase: `ttspl_audit_log` was an attempt at exactly this and it works where it is used. `inventory_status_transitions` is the per-module version of the same thing, and the two now **disagree** — the super-admin override writes the event and not the transition; support cancel writes the transition and not the event (finding I15). Two partial logs that cannot be joined is the per-module outcome, already observed.

### Shape

```
events
  event_id        bigserial
  occurred_at     timestamptz   not null
  actor_type      text          -- user | system | courier | customer | migration
  actor_id        int
  actor_name      text          -- denormalised, survives user deletion
  entity_type     text          -- asset | ticket | so | dc | invoice | support_ticket | po | grn
  entity_id       text
  entity_ref      text          -- human handle: TTSPL/4227, DC/26-27/0778
  event_type      text          -- status_changed | created | approved | scanned | billed | …
  from_state      text
  to_state        text
  payload         jsonb
  correlation_id  uuid          -- one request / one transaction
  source          text          -- module or service that wrote it
```

Index on `(entity_type, entity_id, occurred_at DESC)` and `(event_type, occurred_at DESC)`. Partition by month once it is large.

### The `correlation_id` is the point

It makes the current mess visible and then prevents it. One delivery today writes rows from up to five different paths; with a correlation id you can see that on one screen, and after the cleanup you can assert that one business event produces one correlated set.

### The distinction that must be held

The event table is the **narrative layer**, not a replacement for domain tables. `qc_results`, `payment_records`, `sales_order_serials` keep holding business state. If people start reading current state out of the event log, you have rebuilt the problem in a new shape. Rule: **state lives in columns, history lives in events, and the event table is append-only** — no UPDATE, no DELETE, ever.

### Migration
Backfill from `ttspl_audit_log` and `inventory_status_transitions` with `actor_type='migration'`. Keep the old tables read-only for a release, then drop.

---

## 6. Which permission system? — **RECOMMENDATION: the section matrix, extended with an explicit scope axis**

### Why not roles-only

Roles-only cannot express what is already needed. The codebase already has `sales_orders_doc` / `_sale` / `_rental` / `_replacement` as separate sections — and decision 1 just made the RentFoxxy / Gorefurbo split structural. "Sales executive who can see rental orders but not Gorefurbo margins" is a real requirement. Under roles-only that becomes role × entity × section, which is how you end up with forty roles nobody can reason about.

The matrix also already governs most live routes. Migrating *to* it is a smaller job than migrating *away* from it.

### But the matrix has to be fixed while it is being adopted

1. **No route may use `view` as a write guard.** `authorize = checkSectionPermission('vendor_management','view')` currently gates create, edit and delete on purchase orders *and* on vendor billing (findings P1, BL14). Every route declares `(section, action)` explicitly.
2. **Every route gets middleware.** Production move-stage, diagnosis-failed, QC submit, all of `routes/diagnosis.js`, most of `routes/productionAssets.js`, and the dispatch-QC capture token mint currently have none (R13, D5).
3. **Retire the hardcoded role arrays and the legacy JWT `permissions[]`.** `SUPPORT_LEAD_ROLES`, `WAREHOUSE_ROLES`, `hasSupportTicketAssigneeGrant` and the rest become matrix sections.

### The third axis: scope

Permission today is `(section, action)`. There is already a bolted-on fourth thing — `customerScope` / `allowedCustomerTypes`. Make it explicit:

```
permission = (section, action) + scope
scope = { entity: [rentfoxxy|gorefurbo|*], customer_type: [...], branch: [...] }
```

The API applies scope as a query filter, every time, in one place. This is what makes "this user sees only RentFoxxy" a configuration rather than a code change.

### The frontend must read the same source

One `usePermission(section, action)` hook. `menuConfig.js` entries carry `{ section, action }` and the menu is generated from the matrix — which is what makes role-aware navigation possible and fixes X6 (frontend gating on the raw role string) and U26 (four of twenty-two support routes in the menu) at the same time.

---

## 7. Design direction — **PROPOSED**

See the **Carret** artifact. Three directions rendered on the same asset record, and the recommendation: don't pick one.

- **Ledger** becomes the base system — warm paper, hairline rules, one navy ink, documents that look like the documents they print as.
- **Signal** stops being a separate direction and becomes its **dark theme**.
- **Shopfloor** stops being a separate direction and becomes its **floor density**.

One token set, three densities (`desk` / `field` / `floor`), two themes, and a fixed **entity edge** — a 4px left edge, RentFoxxy orange or Gorefurbo counterpart — that never recolours the app and is never used for state. A screen is then a coordinate `(density, theme)` and nothing is designed twice.

**The state palette is decision 3 arriving through the front door.** Eight state hues means eight canonical statuses; you cannot build a state palette for twenty values, five of which nothing writes. The design system and the status canonicalisation are the same piece of work.

### The five leftover IA questions

- **Sections: eight, not nine.** Retiring the legacy chain collapses Orders and Sales. *Procure · Produce · Stock · Sell · Move · Serve · Money · Control.* The RentFoxxy / Gorefurbo split lives *inside* Sell, not above it.
- **Orphan pages: sort into three buckets**, don't sweep. Legacy-chain pages go with the chain; true duplicates get deleted; finished work that just needs a menu entry (the purchase-type pages, the vendor billing overview) gets one. The bucket list goes to you before anything is deleted.
- **QC Management: absorb it into Produce.** It is the largest single source of non-canonical asset statuses in production — it writes the client's chosen string straight into the column. Keeping it a separate module is what lets it keep its own vocabulary.
- **Technician and Guard shells: keep, and promote.** Under the density dial they are first-class shells at floor density sharing every component with the desk app. Decision 4 makes the Guard shell load-bearing.
- **Dark mode: in scope from day one.** Not as a feature — as the discipline that keeps the token system honest. There is a night shift and a gate.

---

## All seven confirmed — 20 Sep 2026

| # | Decision | Outcome |
|---|---|---|
| 1 | Sales chain | Retire legacy `/api/sales`. Rental = RentFoxxy, Sale = Gorefurbo, split inside Sell |
| 2 | Support | Adopt the v2 schema, rebuild the UI in the new system, retire v1 |
| 3 | Status vocabulary | Canonicalise the columns, in four phases. Bypasses close first, CHECK last |
| 4 | Guard gate | It is the gate. New `at_gate` state for guard custody |
| 5 | Audit | One append-only event table with a `correlation_id` |
| 6 | Permissions | Section matrix, every route declaring `(section, action)`, plus an explicit scope axis |
| 7 | Design | Carret — Ledger base, Signal as dark theme, Shopfloor as floor density |

**Entity edge:** token now, name later. `--entity-rental: #E2571F` (RentFoxxy), `--entity-sale: #16605A` (placeholder), label from config. `entity_code` stays `gorefurbo` in the database regardless of what the marketplace brand is finally called — renaming later costs one token and one string.

**Sections:** Procure · Produce · Stock · Sell · Move · Serve · Money · Control.

**Canonical status lists** are produced with the design work, since the state palette and the status list are the same artefact.

---

## Not waiting for any of it

Three leaks are costing money every month while the design work happens, and each is contained:

- **BL1** — vendor bills have no `inventory_status` filter; scrapped and sold units keep billing.
- **V2** — `submitDeliveryRegister` marks a challan delivered without setting `delivered_at` or finalising inventory; the rent clock never starts.
- **BL3** — a missing rate writes a ₹0 line, advances `rent_billed_until`, and loses that month permanently.
