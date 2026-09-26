# Carret — Production: the plan

Written 26 Sep 2026 from three code surveys (floor flow F1–F27, QC and into stock Q1–Q23,
parts and repair P1–P21) and QA data. Process 3 of the Carret completion (Order to delivery,
then Procure to stock, are done). Nothing here is built yet; the **Decisions** need answers
first, because several change how the floor works, not just the screens.

## Where it stands today (QA numbers)

- **489 open floor tickets, but only 44 of those laptops are "in repair".** 127 are marked
  **in stock** (sellable while still on the floor), 302 "returned", and 11 are rented / sold /
  scrapped / back with the vendor — stale tickets. Median age 34–85 days depending on the group.
- By stage: Floor Manager 99, Diagnosis 175, Chip 14, Body 2, Assembly 61, QC1 98, QC2 5,
  Pending Inventory 29, Inventory 2, Dispatch QC 2. Final Testing, Dismantle, Procurement and
  Hold: 0 (Hold can't be reached — F6).
- **QC can be passed without QC.** The main "QC1 PASS" / "QC2 PASS" buttons skip the checklist
  and the configuration check; the check is enforced only in the browser (F4, Q1).
- **Seven different QC implementations**, and four ways into stock that skip QC, the serial
  scan or the slot (Q2–Q6). Every "into stock" call overrides the state machine (Q7).
- **Parts stock can't be trusted.** One part can be reserved for two requests (P1), approval can
  create parts that don't exist (P3), and `parts.quantity` means three different things (P5).
  A "direct attach" tab issues stock with no approval and no unit (P5/P18).
- **Technicians can move, bulk-move, fail, complete or pass QC on any ticket** — one grant
  (`floor_tickets` edit) opens every door, and `PUT /tickets/:id` sets status from the body
  (F10, F11).
- Every GRN ticket goes to **one** floor manager (lowest user id, F18); moves to Chip/Body and
  back leave tickets **unassigned and invisible** to technicians (F20).
- Carret "Floor pipeline" shows every ticket ever, not the floor (F25).

## The process, step by step (target)

| # | Step | Who | Target |
|---|---|---|---|
| 1 | **Triage** | Floor manager | Shared FM queue (PD1). Power on / not, TTSPL + serial confirmed, assign a technician. |
| 2 | **Diagnosis** | Technician | Checklist (server-checked). Result: fine → Assembly; needs chip/body work; needs parts (request); can't be fixed → vendor repair / return / dismantle for parts. |
| 3 | **Repair** | Chip / body / technician | Parts only through request → approve → issue → fit → old part back (PD7, PD8). Back to Diagnosis after chip/body (PD12). |
| 4 | **Assembly & software, final testing** | Technician | Checklist; then sends to QC. |
| 5 | **QC1 / QC2** | QC inspector ≠ repairer (PD2) | One QC path: checklist saved; QC2 needs a server-verified configuration match (PD3). Fail → rework with a reason; 3rd fail → floor manager. |
| 6 | **Into stock** | Warehouse | Only by scanning the serial into a carret + slot (PD5); tag Ready-to-Rent / Sell. Laptop becomes in_stock here and nowhere else. |
| 7 | **Can't be fixed** | Floor manager | Vendor repair / return (done in Procure step 6), or dismantle for parts (PD14) — never into stock. |

## Decisions needed (my recommendation first)

- **PD1 Floor manager queue.** Today every GRN ticket goes to the lowest-id floor manager.
  Recommend: one shared FM queue any floor manager picks from.
- **PD2 Who can pass QC.** Recommend: the QC inspector must not be the technician who repaired
  it, and technicians can't pass QC at all.
- **PD3 One QC path.** Recommend: the QC buttons open the checklist (saved as a QC record); QC2
  pass needs a matched configuration check verified on the server (script-captured values, not
  typed ones). A laptop that won't boot can't pass QC2. Manager override with a reason, logged.
- **PD4 Moving back.** Recommend: every backwards move needs a reason; only floor manager /
  manager can send a ticket back to Floor Manager or skip Diagnosis.
- **PD5 Into stock.** Recommend: only the serial-scan receive into a carret/slot; remove the
  "move to Inventory" shortcuts.
- **PD6 QC Management and "QC Process" screens (ERP-style).** They put laptops in stock with no
  floor QC. Recommend: they stop being a way into stock; anything they handle gets a floor
  ticket and goes through QC.
- **PD7 Direct attach of parts.** Recommend: remove it; every part goes request → approve (quick
  for the floor manager) → issue → fit, so stock and cost are right.
- **PD8 Old part back.** Recommend: the technician records it at fitting (with its real size, not
  the new part's); the warehouse confirms receipt later from a "to collect" list — the ticket is
  not blocked waiting for that.
- **PD9 Unassigned tickets.** Recommend: each stage has a queue every technician of that stage
  can see and claim; nothing is invisible.
- **PD10 The 489 open tickets.** Recommend a one-time clean-up list: close tickets for laptops
  already rented / sold / scrapped / with the vendor; for "in stock" ones, close if the last QC
  passed, otherwise put the laptop back to "in repair". Reviewed by the floor manager before it
  runs.
- **PD11 Hold.** Recommend: keep Hold with an explicit "hold / release" and a reason (security
  hold goes there); today it can't be reached or left.
- **PD12 After chip / body repair.** Recommend: always back to Diagnosis (re-check), removing the
  shortcut straight to Assembly.
- **PD13 Work timers.** Recommend: only the assigned technician starts/stops their own timer.
- **PD14 Dismantle for parts.** Recommend: harvested parts go into parts stock and the laptop is
  scrapped — it never goes into stock (today "Dismantle → Inventory" puts it in stock).
- **PD15 Cost per laptop.** Recommend: base cost = its own PO line; parts at the issued unit's
  cost; old parts returned credited. (Today the base is the priciest line on the PO.)

## Build order (after decisions)

0. **Safety fixes** — DONE on QA 26 Sep (3e0e4bd6, a711327f, eec1568c, b348ef2b; 441 tests):
   A QC gates + one way into stock (QC1/QC2 pass only via the saved checklist or a manager
   override with a reason, enforced in applyStageMove for every door; QC2 needs a matched
   server check; inspector ≠ repairer / not a technician; stock only by serial-scan receive;
   enterStock() without override; floor-failed laptops can't be received; QC Management
   "passed/repaired" and QC Process no longer put laptops in stock; qcCheckService crash).
   B parts (no double reservation, no phantom units, fitment check reads the laptop, one unit
   per request, "received" checks, upgrades name the removed part, direct attach retired,
   routes guarded). C floor permissions/transactions (bulk move + floor-manager fail need a
   floor manager, no status from the edit form, chip routes guarded, backwards moves need a
   reason, chip/body → Diagnosis, only the assignee runs the timer, claim first-come,
   next-stage and assign in one transaction). D public QC2 link (no expected config before the
   check, failed is final, 4-hour cap, closed when the laptop leaves QC2, per-link verify
   limit, token minting needs a permission). **Left for the screens / later:** QC person picks
   from a checklist in the new QC screen (today: the old page's QC tab); Dispatch QC rework
   still returns laptops to in_stock (Order-to-delivery flow); parts ledger gaps and cost per
   laptop (P9–P15, P21, PD15); config truth between tables (Q9–Q11); assignment (PD1, PD9);
   Hold (PD11); dismantle (PD14). Original list: server-side QC gates (Q1, F4), into-stock only by
   serial receive (Q2, Q3, F3), QC Management / QC Process not into stock (Q4–Q6), state-machine
   overrides removed (Q7), failed units can't be received (Q8), `qcCheckService` crash (Q13),
   part reservation and phantom parts (P1–P4), `markPartReceived` checks (P2), permissions:
   technicians can't pass QC / bulk-move / complete, `PUT /tickets/:id` status, chip-repair and
   part-request routes (F10–F12, P16), transactions on the move/assign/claim handlers (F14–F15),
   public QC capture links (Q20–Q22).
1. **Data clean-up** (PD10), reviewed list first.
2. **Floor board** — stage queues with claim, my work, stuck/aged, holds.
3. **Ticket record** — the laptop, its stage path, checklist per stage, parts, timers, history.
4. **Parts on the floor** — request/approve/issue/fit/old part; parts approval; stock that agrees.
5. **QC** — one QC screen per stage with the checklist and the capture result.
6. **Into stock** — pending inventory → scan into carret/slot, tag.
7. Menu (Production opens the new screens; old under "Old view"), verify on QA end to end.

## Full findings

The three surveys are the reference (floor flow F1–F27, QC and into stock Q1–Q23, parts P1–P21);
each is re-verified against the code before it is fixed.
