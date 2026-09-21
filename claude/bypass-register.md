# Asset status bypass register

> **Re-verified 20 Sep 2026 at `4df9654f`, after Parts 0 and 1 merged.** Two of
> the nine section A line numbers moved: `salesManagementController.js:5579 →
> :5658` and `:5858 → :5937`, both +79, because Part 0 extracted
> `performDcDelivery` and expanded `submitDeliveryRegister` above them. The
> other seven sites, and every entry in sections B and C, are unchanged — Part 0
> touched only this controller plus the two billing files, and Part 1 touched no
> backend file but `constants/statuses.js`. The list below carries the corrected
> numbers.

**Verified against `new_stagging_crm` at `10c2778a`** on 20 Sep 2026 — the branch you work on — by walking every `UPDATE vendor_serial_numbers` in `backend/controllers` and `backend/services` and taking every line that assigns `inventory_status` or `qc_status`.

Every line number below was re-run on staging after it diverged from production. They happen to match production for these particular sites, because staging's four extra commits touch billing and add lines *below* them — but do not rely on that holding. Re-run the enumeration at the start of Part 2.2 and reconcile.

This exists because finding **I3** in `claude/flow-audit.md` gives a count ("32 runtime bypasses") and cites the nine worst by file:line, but does not enumerate all of them — and the audit was taken at `7c394f3` on production, so every line number in it has drifted. Work from **this** file for Part 2.2, not from the count in the audit.

**The count differs from the audit and that is expected.** The audit's 32 was taken at `7c394f3`, counted some `qc_status`-only sites in the same total, and predates several commits. What follows is the list as it actually stands today: **28 runtime sites that write `inventory_status`** (the raw scan returns 31; three of those are `WHERE`-clause matches, not writes — `qcProcessIntakeService.js:51`, `salesManagementService.js:2287` and `:2309`), plus **14 that write only `qc_status`**. If you find a site not on this list, add it and say so — do not silently work around it.

Scripts under `backend/scripts/` are excluded from the checklists below and listed separately at the end. They are production-capable and must be dealt with, but they are not request paths and they are not what Part 2.2 is about.

---

## A. The nine catch-block bypasses — do these first

> **All nine closed.** Part 2.2 section A, commit below. Verified: no
> `inventory_status = '...'` write remains in any of the six files.

These are the reason the state machine is advisory rather than enforcing. The pattern in each: call `transitionAsset` (or a wrapper), catch the refusal, log it, then perform the raw write anyway. Validation never actually stops anything.

**Fix pattern for all nine, identically:** attempt the transition; on refusal, **fail the request** and log at error level with the serial, the attempted transition and the caller. Do not write. If the refused transition turns out to be a legitimate business event, add it to `ALLOWED` in `inventoryStateMachine.js` — do not reopen the bypass.

- [x] `backend/controllers/salesManagementController.js:3210` — `catch (rErr)` → `dispatch_ready` + `current_dc_number`, `dispatch_mode`, `rent_monthly_rate`. DC create.
- [x] `backend/controllers/salesManagementController.js:3666` — same, second DC-create path (`createDcsByAddress`).
- [x] `backend/controllers/salesManagementController.js:5658` — `catch` → `in_transit` + `dispatched_at`. Gate dispatch. *(was `:5579`; +79 since Part 0 landed)*
- [x] `backend/controllers/salesManagementController.js:5937` — `backToStock` then `catch (_)` → `in_stock`, clears customer / DC / entity. DC cancel. Note the bare `catch (_)` — it does not even log. *(was `:5858`; +79 since Part 0 landed)*
- [x] `backend/services/guardGateValidationService.js:2443` — `catch (dispErr)` → `in_transit`. Guard gate outward. **Part 3 rewrites this path entirely; close the bypass here anyway so the two parts do not fight.**
- [x] `backend/services/productionAssetService.js:941` — `catch (e)` → `in_stock` + `qc_status='passed'`. Pending-inventory receive.
- [x] `backend/services/supportServiceDcService.js:563` — `catch (dispErr)` → `dispatch_ready`. Support service DC.
- [x] `backend/services/inventoryAssetMovementService.js:325, :335` — catch swallows the transition, then writes `qc_status` and `inventory_status` plus a whole-object `extra` replace. Two lines, one site.
- [x] `backend/services/dispatchQcCaptureService.js:330-331` — the raw UPDATE runs *before* the transition attempt, so the catch at `:342` is decorative. Both writes must go.

---

## B. Unconditional `inventory_status` writers — no transition attempted at all

> **All closed except the two bulk heals**, which are deliberately held for
> Part 2.5 — the register says removing them before the single availability
> predicate exists will surface units that stop appearing in search, and that
> the surfacing is the point. Landing them together avoids a visible gap on a
> publicly reachable QA instance.

Ordered by damage.

- [x] `backend/controllers/qcManagement/orders.controller.js:530` — writes the request body's `selected_value` **straight into the column**. Largest single source of non-canonical values in production (`out_for_repare`, `out_for_return`, `repared`, `replace`, `qc_reject`). Map QC outcomes to canonical statuses; reject anything else with a 400.
- [x] `backend/controllers/qcManagement/orders.controller.js:408` — `require_for_parts` into both columns. Non-canonical.
- [x] `backend/controllers/qcManagement/orders.controller.js:326` — `in_stock` on QC order pass.
- [x] `backend/services/grnTicketService.js:340` — `in_stock` + `qc_status='passed'`. **This is the asset's first entry into stock and it is entirely unaudited.**
- [x] `backend/services/grnTicketService.js:359` — `markVendorSerialReadyForRent`: `in_stock` + `passed` after QC2.
- [x] `backend/services/qcProcessIntakeService.js:800` — unconditional `in_stock` on dead/failed re-evaluation. **Resurrects `scrapped` units, which `ALLOWED.scrapped = []` forbids.**
- [x] `backend/services/qcProcessIntakeService.js:722` — unconditional `in_stock`, QC Pending → QC Process.
- [x] `backend/services/qcProcessIntakeService.js:619` — CASE → `in_stock` for anything not in a deployed list.
- [x] `backend/services/qcProcessIntakeService.js:41` — CASE `qc_failed|in_repair` → `in_stock`.
- [x] `backend/controllers/supportController.js:3048` — `returned` + clears `current_customer_id`. Support warehouse receive. Source state is usually `in_transit`, a transition the map forbids — see I6 below.
- [x] `backend/controllers/supportController.js:3661` — `returned`, conditional customer detach.
- [x] `backend/controllers/qcController.js:552` — `reserved`, pre-dispatch QC pass, guarded only by a `NOT IN` list.
- [x] `backend/controllers/ticketPhase2Controller.js:611` — `reserved`. **Byte-identical duplicate of the line above.** Collapse both into one helper rather than fixing them twice.
- [x] `backend/services/inventoryStatusOverrideService.js:109` — super-admin override. `inventoryStatusForQc()` has `default: return qcStatus`, so **any** qc string lands verbatim in `inventory_status`. Keep the override as a capability, but constrain it to the canonical list and write an event.
- [x] `backend/services/qcCheckService.js:264` — `COALESCE($3, inventory_status)` where `$3` is the caller's `selected` value → `require_for_parts`, `send_to_qc_check`.
- [x] `backend/services/supportCancelInventoryService.js:100` — `inventory_status = $2` + `qc_status='passed'`, clears `returned_at` / `rent_end_date`. Hand-rolls an `inventory_status_transitions` insert but writes no TTSPL event — one of the two logs that disagree (I15).
- [x] `backend/controllers/inventoryManagement/inventoryList.controller.js:387` — CASE self-heal → `in_stock`.
- [ ] `backend/services/salesManagementService.js:2283` — `healStaleReturnedPassedSerials`: bulk `returned → in_stock`, unbounded, **on every SO-attach search**. Delete rather than fix — see note below.
- [ ] `backend/services/salesManagementService.js:2303` — `healStaleReservedPassedSerials`: bulk `reserved → in_stock`. Same.

**On the two heals:** they run table-wide UPDATEs, outside any transaction, as a side effect of a read endpoint any authenticated user can call. They exist only to paper over the six conflicting availability predicates. They are deleted in Part 2.2 and the problem they mask is solved in Part 2.5. Do not "fix" them — removing them is the fix, and doing it before 2.5 will surface units that stop appearing in search. That is the point, and it is why 2.5 is in the same part.

---

## C. `qc_status`-only writers

> **Deferred to Part 5 by decision D2.** Part 1 defines no canonical list for
> `qc_status`, and its main writer — qcManagement/orders.controller.js — is
> rewritten in Part 5. Constraining the column before its writer is fixed turns
> a data-quality problem into 500s at the QC bench. The boxes below stay open
> on purpose.

Same rule applies — `qc_status` is a canonical vocabulary too, and Part 2.3 puts a CHECK on it.

- [ ] `backend/controllers/inventoryManagement/inventoryList.controller.js:442`
- [ ] `backend/controllers/ticketPhase2Controller.js:872` — writes `qc_failed_return_vendor`, a value **nothing reads**
- [ ] `backend/services/deliveryRejectionService.js:281` — `pending` + clears `current_dc_number`
- [ ] `backend/services/dispatchQcCaptureService.js:366` — `failed`
- [ ] `backend/services/grnTicketService.js:400` — `pending`
- [ ] `backend/services/productionAssetService.js:680` — `pending`
- [ ] `backend/services/returnCompletionService.js:165` — `pending`, immediately after a proper `markReturned`
- [ ] `backend/services/vendorRepairDcService.js:129, :445, :1644`
- [ ] `backend/services/vendorReturnToVendorService.js:515` — `returned_to_vendor`, follows a correct `SCRAPPED` transition

---

## D. Do these in the same pass, or the fixes above will not hold

- [ ] **Add the missing legal transitions** (finding I6): `in_transit → returned` and `dispatch_ready → qc_failed`. Both are real weekly events. Two of the bypasses above exist *only* because the map was written from the happy path — close those bypasses without adding these and you will break support warehouse receive and Dispatch QC failure.
- [ ] **Add `FOR UPDATE`** to `loadSerial` in `inventoryStateMachine.js`. Without it, two concurrent transitions read the same "from" state and both pass validation.
- [ ] **Fix `isAllowed()`**: it returns `true` whenever the current status is non-canonical, so a single bad write exempts that asset from validation permanently. Flip it to `false` **only after** Part 2.3's migration, or every legacy row starts failing.
- [ ] **Stop truncating `reason`** to 255 characters while Dispatch QC builds a 2,000-character failure reason.
- [ ] **Replace whole-object `extra` writes with `jsonb_set`.** There is no `jsonb_set` anywhere in this codebase today, so every concurrent write silently loses the other's keys.

---

## E. Scripts — separate task, do not skip

Twenty-one write sites across `backend/scripts/`, including `delete-laptop-by-serial.js:108` (writes `inventory_status='deleted'`, a value read by exactly one other script) and `lib/billingActivationUtils.js:214, :253, :264, :275` (four raw writes covering `returned`, `sold`, `on_demo`, `rented`).

These are production-capable and they will reintroduce non-canonical values after the migration. They are not request paths, so they are out of scope for Part 2.2 — but list them in the Part 2 PR with a decision for each: port to the state machine, or delete.

---

## How to use this file

1. Re-run the enumeration at the start of Part 2.2, **on `new_stagging_crm`**, and diff it against this list. If the counts differ, the branch has moved — reconcile before starting.
1a. Remember staging points at the live database. Closing a bypass changes behaviour against real data the moment it is deployed, so each of these lands with its test and gets watched, not batched into one big deploy.
2. Work section A to E in order. A first, always.
3. Tick each box in the PR description, with the commit that closed it.
4. The Part 2 acceptance test is that `grep -rn "UPDATE vendor_serial_numbers" backend/controllers backend/services` returns matches only in `inventoryStateMachine.js` and the canonicalisation migration.
