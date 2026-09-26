# Promotion to live — checklist (Carret: Order to delivery, Procure to stock, Production)

Written 26 Sep 2026. Everything below is built and running on **QA** (`qa.rentfoxxy.com`,
database `laptop_refurbishment_qa`, branch `new_stagging_crm`). Nothing here has touched
**live** (`/var/www/crm_rentfoxxy`, database `laptop_refurbishment`, branch
`new_crm_rentfoxxy`).

Use this file in order. Give it to Claude at promotion time with: *"Follow
claude/production-promotion-checklist.md, one step at a time, dry runs first, and stop
at every ☐ that says REVIEW."*

**House rules for the promotion**

- Nothing is deleted. Every data change is additive, or goes through a report → a person
  approves it → apply step. Anything a script changes is listed in its CSV first.
- Billing is not changed. No step writes `customer_invoices`, `vendor_purchase_orders.line_items`,
  `extra.line_index`, rates, or the laptop configuration invoices read
  (`vendor_serial_numbers.extra`), except where noted as already existing behaviour.
- Migrations are applied **by name**, never with `run-all-migrations.js`: dry run, then
  `--commit`.
- One step at a time. If a step fails, stop. Do not work around it.

---

## Part A — Verify on QA first (you, on qa.rentfoxxy.com)

Sign in as a floor manager, as a technician, and as a QC inspector. Use test laptops only.
Tick each line when it behaves as described.

### A1. Floor board (Production → Floor)
☐ A technician opens on **My work**; a floor manager opens on **Everything I can see**.
☐ **Waiting** lists unassigned laptops in your team's stages, with a **Claim** button.
☐ Stage tabs show counts; Hold and Pending Inventory are visible.

### A2. Triage (a new laptop at Floor Manager)
☐ **Triage and assign** opens a side panel: powers on? · TTSPL · serial · technician list
  with open-ticket counts and "least busy".
☐ Serial is required only when it powers on.
☐ A technician trying to assign someone else is refused ("Only a floor manager assigns…").
  Claiming for yourself still works.

### A3. Diagnosis
☐ Questions are in plain words, grouped (Power, Motherboard, Screen, Keyboard, Battery, RAM &
  drive, Wi-Fi & ports, Fan, Body, Locks). Each answer button says what it means
  ("OK", "Won't power on", "Not fitted"…).
☐ "Not fitted" appears only where a model may not have the part (webcam, 2nd RAM slot, USB-C…).
☐ Answers **save as a draft** by themselves (refresh the page — they are still there).
☐ **What happens next**: the answers pre-select it; "No faults" is disabled when you marked a
  fault; "Needs parts" is disabled until a part is asked for in the Parts tab.
☐ A note is required when there is any fault, or when sending to the floor manager.
☐ TTSPL + serial are scanned once, at the end.
☐ After submit, the ticket is at the chosen stage, and the answers are kept (reopen the
  diagnosis — they are there). *(Before: submit threw all answers away — 986 diagnoses on QA
  have none.)*

### A4. Chip-level repair and Body & Paint
☐ Each shows its own 5-job checklist and two outcomes: **Repaired → back to Diagnosis** or
  **Can't repair → floor manager** (reason required).
☐ Body & Paint can now leave its stage. *(Before: it only saved a note; laptops got stuck.)*
☐ No dead "Request part / Add part" buttons.

### A5. Assembly & software, Final testing
☐ Ticking every job enables **Finish this stage**; the bar says what is still missing.
☐ Assembly can also send to chip-level or body work (reason required).
☐ Final testing → QC1: optional inspector (the list excludes you); empty = QC1 queue.
☐ Final testing "A test failed" goes back to assembly with a reason.
☐ Old screen (Old view) "Next stage" on an unfinished checklist is refused
  ("Finish the … checklist first"). A floor manager can still move it with a reason.

### A6. Parts tab (technician side)
☐ **Ask for a part**: search the catalogue, replace / upgrade / consumable, one unit per request;
  battery parts ask for model number + photo.
☐ Each request shows where it is in plain words ("Waiting for the parts desk", "Ready —
  collect it and fit it", "Fitted").
☐ **I fitted it** records the old part (good / faulty / nothing came off — the last is hidden
  when the old part must come back).
☐ The laptop can't leave its stage while a requested part is not fitted.

### A7. QC1 / QC2 / Dispatch QC (one form)
☐ Step 1: QC1 — tick the 6 lines that match the laptop; QC2 — the configuration check
  (access number → run the checker on the laptop → the page updates by itself);
  Dispatch QC — charger, then its configuration check.
☐ QC2 with a **mismatch** shows the differences and a working **Send back to QC1** button.
  *(Before: the form pointed at a button that did not exist; the laptop was stuck.)*
☐ Every question makes the good answer obvious. "Scratches?" → "No scratches" is green,
  "Has scratches" is neutral (affects grade only). Keyboard light / touch screen / LAN / HDMI
  / headphone jack have "Not fitted".
☐ New question: **BitLocker turned off?** — "Still on" fails the stage.
☐ The result shows **live** before you submit ("Passes → QC2" or "Fails → back to assembly:
  reasons"), using the same rules as the server. *(Before: the form checked 7 rules, the
  server 22 for QC2 — an "Average" battery looked like a pass and then errored.)*
☐ Grade list shows what each grade means. Remarks are required when anything is marked bad.
☐ Parts fitted are listed from the parts record — nothing to type.
☐ **Can't pass — fail now** fails with a reason at any time (won't start, mismatch).
☐ Failing: "Who fixes it" is optional — empty puts it in that stage's queue.
☐ Dispatch QC failure asks: **Fix it for this order** (back to assembly, stays on the order)
  or **Take it off the order** (back to Diagnosis).
☐ A technician sees "Technicians can't pass QC"; a person who repaired the laptop is refused.
☐ Third failure shows "goes to the floor manager".

### A8. Laptop tab
☐ Configuration with "Last confirmed" (QC2 check / part fitted) and a warning when records
  disagree.
☐ **Cost of this laptop**: its own PO line + each fitted part (flagged "no cost recorded" if the
  unit has none) − old parts collected = total. Rented-from-vendor laptops show the monthly
  rent separately and leave it out of the total.

### A9. Unchanged — check it still works
☐ Old view screens still open (Production → Old view).
☐ Order to delivery: attach laptop to SO → Dispatch QC → challan → gate → delivered.
☐ Customer billing: invoice list, invoice detail, credit notes, generate a draft invoice.

**Only when every box in Part A is ticked, do Part B.**

---

## Part B — Promote to live

### B0. Before anything
☐ Announce a short window; nobody works on the floor or creates invoices during it.
☐ **Back up the live database** (full `pg_dump` of `laptop_refurbishment`) and keep the file
  outside the repo. Note its name here: ____________
☐ Copy the live `frontend/build` to `frontend/build.prev-<date>` (a failed build takes the site
  down; this is the way back).
☐ **REVIEW — which migrations live already has** (read-only):
  `SELECT name FROM schema_migrations WHERE name ~ '^(2[6-9][0-9]|3[0-9][0-9])_' ORDER BY name;`
  Mark in B3 which ones are already there. *(Claude could not read the live database from the
  QA session — it was not permitted — so this list must be checked at promotion.)*

### B1. Code — merge, never overwrite
Live has **2 billing commits QA does not**: `18210c8c Restore invoice security, rent and
credit-note views…` and `5737ea1c Delivery Charges…`. A `reset --hard` / force-push of
`new_stagging_crm` onto `new_crm_rentfoxxy` would **delete them**.
☐ `git checkout -b promote-<date> origin/new_crm_rentfoxxy`
☐ `git merge new_stagging_crm` — checked 26 Sep: merges cleanly, and those 2 commits add no
  migrations.
☐ `cd backend && npm test` — must be all pass (QA: 459 pass, 0 fail).

### B2. The Carret build flag — DONE (26 Sep)
`REACT_APP_CARRET=1` is in `frontend/.env.production` (tracked in git), so the live deploy's
plain `npm run build` includes the new screens once the merge lands. Without it **every new
screen is silently left out** (the site works, the redesign is missing).
☐ After the live deploy, check the Carret menu entries (Procure, Production) are there.
☐ The live VPS has the same memory limits as QA: a plain build can be killed for memory
  (that took QA down once). If the live job fails there, change its frontend build line in
  `deploy.yml` to `GENERATE_SOURCEMAP=false CI=false NODE_OPTIONS=--max-old-space-size=3072 npm run build`.

### B3. Database migrations (in this order, by name)
Command for each group — dry run first, then the same with `--commit`:
`node scripts/apply-listed-migrations.js <files…>` → `… --commit`

| ☐ | Files | What it adds | Notes |
|---|---|---|---|
| ☐ | `268`–`274` | Carret parts 5–6 | Recorded as applied to live on 21 Sep — verify in B0 |
| ☐ | `275_parts_fitment.sql` | parts fitment | verify in B0 (276–300 do not exist on this branch) |
| ☐ | `301`–`322`, `324`–`326` | Support v2 | **REVIEW** — belongs to the Support release; apply only if Support v2 goes live now |
| ☐ | `323_support_v2_tech_access.sql` | revokes technician access | **Do not apply** with this release (kept back on QA too) |
| ☐ | `327`–`329` | quotation validity/terms, hashed warehouse-return OTP, SO advance | Order to delivery |
| ☐ | `330`–`336` | vendor GST cert, To-buy links, PO amend/cancel/close, spare PO, vendor deliveries, `returned_to_vendor` status, return item cancelled | Procure to stock |
| ☐ | `337_floor_hold.sql`, `338_old_part_collected.sql` | Hold with reason; old-part collected | Production |
| ☐ | `339_floor_stage_forms.sql` | `diagnosis_results.answers`, `.outcome`; Chip + Body & Paint checklists | Production (this work) |
| ☐ | `340_laptop_config_confirmations.sql` | new insert-only table | Production (this work) |
| ☐ | `341_final_testing_item_label.sql` | one checklist label | Production (this work) |
| ☐ | `342_vendor_return_request.sql` | return request dates/pickup/PDF/cancel columns; challan porter + in-house person, auto e-way mail record | Vendor return request (D10) — additive only |
| ☐ | `343_vendor_repair_rent_pause.sql` | `vendor_rent_pauses`; repair challan rent stop / vendor mail / transport person / auto e-way columns; item issue type, replacement check + approval, vendor kept; capture token `mode` | Vendor repair (additive only) |
| ☐ | `344_support_status_rules.sql` | CHECK on support item / ticket / replacement-order status and item outcome; from→to status audit trigger | Support safety — dry run first: any value outside the list on live fails it (QA passed) |
| ☐ | `345_support_repair_ready.sql` | `repair_ready_at` + trigger: floor ticket completed → support laptop ready to return; back-fills ones already done | Support S7 |
| ☐ | `346_support_charges.sql` | part charge reason/marked/priced columns; one extra line per part request; WFH charge columns on support items | Support charges |
| ☐ | `347_support_sla_csat.sql` | `support_ticket_holds`, `support_csat` + trigger (token on close) | Support SLA/CSAT — feedback mails go through the email queue (outbound switch) |

All of 327–347 were applied to QA this way on 26 Sep. Set `VENDOR_REPLACEMENT_APPROVERS` on live only if the approver list should differ from pankkajyadav@rentfoxxy.com (plus the accounts role). They add columns/tables/rows; the files
that also UPDATE existing rows are 334, 335, 336 (Procure-to-stock status backfills) and 341
(one checklist label) — read their dry-run output before `--commit`.

### B4. Deploy and restart
☐ Push `promote-<date>` to `new_crm_rentfoxxy` (**normal push, not force**). The workflow
  builds and restarts. Or on the box: build into `build.next`, check, then swap.
☐ `GET /api/health` → OK. Frontend: `grep -rl "/carret/move/gate" build/static/js/` must hit
  (proves the Carret flag was on). The served `main.*.js` matches the new build.
☐ Restart only the live backend process (`rentfoxxy-backend-live`), plain restart — never
  `--update-env` from an agent shell.

### B5. Data clean-ups on live — each is report → REVIEW → apply
These fix old data. Each writes a CSV first; nothing changes until a person puts **yes** in
the Approve column and the apply step is run. Each apply re-checks the row is still in the
state the report saw.

☐ **PO receive status** (Procure to stock):
  `node backend/scripts/sync-po-receive-status.js` (report) → `--apply`
☐ **Open floor tickets (PD10)** — laptops shown "in stock" while on the floor go to "in repair";
  tickets of laptops already rented / sold / scrapped / with the vendor are closed:
  `node backend/scripts/floor-ticket-cleanup.js --csv floor-cleanup-LIVE.csv`
  → **REVIEW with the floor manager** →
  `--apply floor-cleanup-LIVE-reviewed.csv --dry-run` → `--apply …`
  (QA run 26 Sep: 487 open → 428 to "in repair", 12 close, 47 keep, 98 idle 60+ days flagged.)
  No ticket is deleted; closed tickets are marked cancelled with a note.
☐ **Configuration drift** — the legacy `inventory` row brought in line with the laptop record
  (the record invoices read is **never** changed by this script):
  `node backend/scripts/config-drift.js --csv config-drift-LIVE.csv` (in stock + in repair;
  add `--all` for every laptop) → **REVIEW** (`FIX_LEGACY` rows are pre-ticked; `CHECK` rows are
  for a person to look at the laptop — never applied) → `--apply … --dry-run` → `--apply …`
  (QA 26 Sep: 33 differences on 23 laptops — 26 FIX_LEGACY, 7 CHECK. Example CHECK:
  TTSPL3051 floor copy says 16 GB / 500 GB, record says 8 GB / 256 GB.)

Keep every reviewed CSV in `claude/reports/` with the date — it is the record of what changed.

☐ **PO GST type (120 POs: 96 laptop, 24 spare)** — `node backend/scripts/fix-po-gst-type.js --csv gst.csv`
  (report) → Accounts reviews → `--apply` (writes a backup JSON under backend/backups first). Totals do not
  change (18% either way); only the CGST+SGST / IGST split on the PO. Not yet applied on QA either (26 Sep —
  the session was not allowed to write it; run it by hand).
☐ **Rented laptops' rent start date (BLOCKER for vendor bills)** — on QA 1,025 of ~1,050 rented laptops have
  `rental_start_date = 2027-02-07` (created 2026-02-07, the ERP import day; PO and GRN dates are that day too).
  A start date in the future keeps them OFF every vendor bill. The real receipt dates are only in the ERP
  (`extra.erp_serial_id`). Check live for the same before any vendor bill is generated there.

### B6. After promotion — watch for a day
☐ Floor: one laptop through triage → diagnosis → assembly → testing → QC1 → QC2 → into stock.
☐ One part asked for, given by the parts desk, fitted; the old part appears on "Old parts to
  collect".
☐ One invoice generated / viewed as normal; Delivery Charges page opens (the live-only commit).
☐ Backend log: no new errors mentioning `floor-checklists`, `stage-work`, `qc/submit`,
  `laptop_config_confirmations`.

### B7. If something goes wrong
- Code: redeploy the previous live commit (it is the first parent of the merge commit); swap
  `build.prev-<date>` back.
- Migrations 339–341 are additive: leaving them in place with the old code is harmless (the
  old code ignores the new columns/table/rows). 341 can be reversed by setting the label back.
- Data clean-ups: each CSV holds the old value; restore from it, or from the B0 backup.

---

## What changed in Production (26 Sep, this session) — for the record

Code: branch `new_stagging_crm`. Tests: `backend/test/productionFloorForms.test.js` (16) +
existing suites, 459 pass.

1. **One definition of every floor checklist** — `backend/services/floorChecklists.js`, served
   by `GET /api/tickets/floor-checklists`. The forms read it; the server checks against it.
2. **Diagnosis** (`diagnosisController.submitDiagnosisV2`, migration 339): answers kept;
   outcome chosen and checked (faults rule out "No faults", "Needs parts" needs an open part
   request, note required with faults); only the assignee or a floor manager submits; one
   transaction. Drafts save without a scan. The Old view form still works (old routing).
   Security-lock hold now records where it was held from (PD11).
3. **Chip / Body & Paint / Assembly / Final testing** — `POST /api/tickets/:id/stage-work`
   (`floorBoard.controller.completeStageWork`): checklist checked on the server, part block
   checked, one transaction, chip/body → Diagnosis (PD12), Final testing → QC1 with an
   inspector who did not work on it (PD2) or the QC1 queue. The stage mover now refuses
   Assembly → Final testing and Final testing → QC1 without that stage's finished checklist
   (floor manager may override with a reason).
4. **QC** (`qcController.submitQC`): every question answered and valid, a grade, remarks when
   anything is bad — checked on the server; "fail now" with a reason; a failure without a named
   person goes to the stage queue (PD9); Dispatch QC fail chooses fix-for-order or
   take-off-order; BitLocker question (fails every QC stage); old QC form is held to its own
   questions.
5. **Dispatch QC rework status**: a laptop taken off its order after failing Dispatch QC goes
   to **in repair** (was **in stock**, i.e. sellable mid-repair); its ticket follows the normal
   floor route afterwards; state machine allows reserved / dispatch_ready → in_repair.
6. **Cost per laptop (PD15)** — `backend/services/laptopCostService.js`: own PO line (not the
   priciest line on the PO), fitted units at their cost, collected old parts credited at the
   replacing unit's cost. Read-only. Used by the ticket (`laptop_cost`), the TTSPL history cost
   summary and the part cost summary (same response fields, plus the breakdown).
7. **Parts ledger gaps**: collecting an old part is one transaction and writes a ledger row when
   the warehouse corrects it to defective; the old "Remove part" route (put stock back with no
   ledger row) is retired (410) — fitted parts come off through the parts desk.
8. **Configuration truth** — `laptop_config_confirmations` (migration 340, insert-only) records
   every QC2 script match and part fit; `laptopConfigService.getCurrentConfig` gives one answer
   with where each value came from and what disagrees; part fits now also update the legacy
   `inventory` row; `scripts/config-drift.js` for the one-time review.
9. **Triage / assign**: only a floor manager assigns a floor laptop to someone else (claiming
   for yourself is unchanged); Order-to-delivery Dispatch QC assignment is not affected.
10. **Screens** (`frontend/src/features/carret/produce/work/`): Diagnosis, stage work, QC, Parts,
    Assign — numbered steps, plain questions, "what's still missing" on the submit bar.
    Old embedded forms removed from the new ticket page (still used by Old view).

### The floor's checklists as the technician now sees them

**Diagnosis** — 36 questions (was 42 with overlaps), OK / Fault / Not fitted where allowed
- Power and start-up: Powers on with the charger connected? · Starts to Windows or the BIOS screen? · BIOS has no password?
- Motherboard (fault → chip-level repair): No short circuit? · No rust or liquid damage on the board? · No chip on the board heats up abnormally?
- Screen and camera: Screen lights up? · No lines, spots or dead pixels? · No flicker? · Brightness keys change the brightness? · Webcam shows a picture? (No webcam)
- Keyboard and touchpad: Every key types? · Touchpad and both click buttons work?
- Battery and charging: Battery detected? · Charges when plugged in? · Battery flat, not swollen? · Charging port firm, not loose?
- RAM and drive: RAM detected? · RAM size matches the label / order? · First RAM slot works? (Soldered RAM) · Second RAM slot works? (Only one slot) · Drive detected? · Drive health shows "Good" in CrystalDiskInfo?
- Wi-Fi, Bluetooth and ports: Wi-Fi connects? · Bluetooth finds a device? (No Bluetooth) · Every USB port works? · USB-C works? (No USB-C) · HDMI shows a picture? (No HDMI) · Headphone jack plays sound? (No jack)
- Fan and heat: Fan spins? · No grinding or rattling noise? · Temperature normal under load?
- Body: Body free of cracks and broken plastic? · Hinges firm?
- Locks (fault → floor manager): Drive has no password? · No company lock (MDM / Computrace / Absolute)?
- Outcomes: No faults → Assembly · Needs parts → Assembly (fitted there) · Needs chip-level repair · Needs body / paint work · Can't fix it here → Floor manager

**Chip-level repair**: found the faulty component · replaced / reworked it · no short after the repair · powers on and starts · ran 15 minutes with no chip heating → *Repaired → Diagnosis* or *Can't repair → Floor manager (reason)*

**Body & Paint**: cracks / broken plastic repaired or panel replaced · hinges firm · painted and fully dry · all screws and rubber feet back · TTSPL and serial labels back on → *Done → Diagnosis* or *Can't fix → Floor manager (reason)*

**Assembly & software**: OS installed (genuine image) · all drivers · Windows / Office activated · standard software · reassembled, screws fitted · cleaning / cosmetic finish · boots and runs without errors → *Final testing*, or *needs chip / body work (reason)*

**Final testing**: powers on & charges · display clean · keyboard & touchpad · battery health acceptable · all ports · Wi-Fi & Bluetooth · audio · camera · laptop cleaned and ready for QC (QC gives the grade) → *QC1*, or *a test failed → Assembly (reason)*

**QC1 / QC2 / Dispatch QC** — 36 questions in 7 groups (Body; Inside and heat; BIOS, drivers
and software incl. BitLocker; Keyboard and touchpad; Ports, network and charger; Screen, camera
and sound; Battery and drive health), then grade and remarks.
- Fails QC1 and Dispatch QC: keyboard, touchpad, USB, Wi-Fi not working; battery or drive
  health Bad; screen fault; BitLocker still on.
- QC2 also fails: battery or drive only Average; crack / broken plastic; loose hinge; TTSPL
  label missing; speaker, camera, Bluetooth, charger, HDMI/VGA, LAN, left/right click not
  working; drivers missing; MS Office not installed.
- Battery health: Good ≥ 80% of design capacity, Average 60–79%, Bad < 60% — **REVIEW these
  thresholds with the QC lead** (they are written on the form as guidance; the server checks
  the Good / Average / Bad answer, not the percentage).

### Still open / decided later
- The Old view forms (old Diagnosis with its own parts list, old QC form) stay until you sign
  Production off; then hide them from the menu.
- Rented-from-vendor laptops: the "cost" is a monthly rent, shown separately — decide if a
  purchase-equivalent is wanted.
- A returned old part's credit value is computed (cost of the unit that replaced it), not
  stored on its ledger row; `parts.quantity` still means several things — stock should be read
  from part units, not that number.
- Support v2 (301–326) is a separate release decision; 323 stays back.
