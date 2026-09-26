# Carret — Vendor repair challan (VRDC): rent pause, replacement, vendor keeps it

Asked 26 Sep 2026, right after the return request (`claude/carret-vendor-return-request.md`).
Decisions: memory `vendor-repair-decisions` — summarised below.

## The flow (target)
1. **Diagnosis Failed → create repair challan** (existing screen). Per laptop: **issue type
   (required)** + **remarks (required)** + declared value **pre-filled** from the PO line (rental:
   asset value, else the line's purchase price when it differs from the monthly rent; purchase POs:
   the line rate). **Rent stop date required** (today … +30 days). Transport = the VRTDC form
   (courier: name + AWB; porter / vendor pickup / in-house: person, phone, vehicle).
2. **Mail the vendor** (challan record): preview → send. Mail + "repair request" PDF (issues,
   remarks, config, TTSPL, serial) to the vendor, CC the four addresses. **Sending pauses rent from
   the stop date** (a `vendor_rent_pauses` row per laptop). Required before "send to gate" on new
   challans (old ones without a stop date are exempt and bill as before).
3. **Send to gate** (sign dispatch). At **≥ ₹50,000** Accounts is mailed for the e-way bill
   automatically (brand/model/count/value + transport). Gate blocks until the e-way bill exists.
4. **Back from the vendor** — guard gate-in (existing) mints the config-check access number.
   - **Repaired:** config + serial check (existing) → receive → **rent resumes on the gate-in date**.
   - **Replacement:** "It's a replacement" mints a replacement check: the script reads the new
     laptop's config + serial and compares with the laptop we sent.
     - Same model **and** config → accepted at receive: new TTSPL, same PO line (same rate),
       **billing from the gate-in date**; the original becomes `returned_to_vendor`, its rent ends
       the day before the pause started (it never resumes). Debit note drafted (D12).
     - Model or config differs → **pending approval**; Accounts (role) or pankkajyadav are mailed and
       approve/reject in Procure → Replacement approvals.
       Approve → as above (billing from gate-in date, not the approval date).
       Reject → vendor mailed "not accepted", unit recorded handed back, the item goes back to
       "with vendor", rent stays paused, waiting for a repair / another replacement / vendor-keeps.
   - Laptop that won't power on as a replacement → can't be checked → always needs approval.
5. **Vendor can't repair and keeps it** (item still with vendor) → confirmation mail to the vendor
   (preview, send) → item closed "vendor kept", laptop `returned_to_vendor`, rent ends the day
   before the pause started, floor ticket closed, debit note drafted.
6. **Cancel a challan** that hasn't left: pauses voided (rent continues as if never stopped) and,
   if the vendor was mailed, a cancellation mail.

## Billing (daily, in the vendor bill)
`calcVendorLineAmount` bills days in the month from received to end date; now minus **paused
days** (`vendor_rent_pauses`, not cancelled, overlapping the billed range; the resume day is
billed). Bill lines carry `paused_days`. A pause still open at month end keeps the rest of the
month unbilled — so generate vendor bills after pending receives are done (the dashboard shows
"back at the gate, not received").

## Vendor rental assets (Carret → Procure → Vendor rentals)
Per vendor: received on rent, replacements received, returned to vendor (incl. vendor kept), active
now → with customers / in stock / in production / at vendor for repair (rent paused), pending
replacement approvals, monthly rent now. Drill-down lists; replacements show original → replacement.
The daily all-company "snapshot" dashboard is later (user, 26 Sep).

## Build order
1. Migration 343: `vendor_rent_pauses`; VRDC head (rent stop, mail, porter/in-house person, auto
   e-way record); VRDC items (issue type, pause dates, replacement check/approval, vendor kept);
   capture token `mode`.
2. Billing pause maths + tests.
3. VRDC create (issue type, remarks, stop date, price prefill, VRTDC transport); VRDC threshold
   ≥ 50,000; auto e-way mail at sign dispatch.
4. Vendor mail + PDF + cancel mail; pause create/void.
5. Receive: resume on gate-in; replacement check (capture mode), approval, reject; vendor kept.
6. Screens: create page, challan detail (mail, replacement, vendor kept, transport), Carret
   Replacement approvals, Vendor rentals dashboard.
7. Tests, migration on QA, build, QA click-through.

## Built 26 Sep — status
On QA: migration 343 applied, backend restarted, frontend rebuilt. Tests: `test/vendorRepairFlow.test.js`
14/14 (rules + the whole flow on the database, rolled back); full suite 487 pass, 0 fail
(`vendorRepairGate.test.js` setup now passes the required issue type + remarks).

Where things are:
- Create: Floor → Diagnosis Failed → Generate Vendor DC (issue, remarks, value from PO, rent stop, transport).
- Challan: Vendor Repair DC record → "Vendor mail & rent" panel (preview, PDF, date, Mail the vendor);
  per laptop: "It's a replacement", "Vendor keeps it", Approve / Reject (approvers only).
- Carret → Procure → Replacement approvals; Procure → Vendor rentals.
- Approvers: role `accounts`, or an email in `VENDOR_REPLACEMENT_APPROVERS` (default pankkajyadav@rentfoxxy.com).
  super_admin is NOT an approver unless added there.

Known limits:
- The guard can't scan an untagged replacement at gate-in; "It's a replacement" on a laptop still with the
  vendor records its arrival (today) instead — that date is the replacement's billing start.
- A rejected replacement's physical hand-back isn't a gate movement; it's recorded on the laptop's history.
- Challans made before this (no rent stop date) keep billing through the repair, as before.
- The gate now blocks any laptop repair challan ≥ ₹50,000 without an e-way bill, old ones included.

## QA click-through
QA mails only internal addresses: use a vendor whose email is @rentfoxxy.com, and remember the four CCs are real.
1. Diagnosis Failed → pick laptops rented from vendor X → vendor X: rent stop date appears; per laptop issue +
   remarks; value pre-filled where the PO has an asset value; transport per mode → Generate.
2. Challan: preview mail + PDF → Mail the vendor → try "E-sign & send to gate" before mailing (refused), then after.
   ≥ ₹50,000 → toast says Accounts was mailed; gate refuses outward until the e-way bill is entered.
3. Back: guard gate-in → script → receive repaired → the row shows "Rent resumed <gate-in date>".
4. Replacement: "It's a replacement" → run the script on the replacement → same config: receive accepts;
   different: goes to Replacement approvals → approve (as accounts) → receive → new TTSPL; Vendor rentals shows it
   under Replacements with the laptop it replaced. Try reject too (vendor mailed, laptop back to "with vendor").
5. Vendor keeps it on a laptop still with the vendor → preview → send → laptop returned to vendor, challan closes.
6. Cancel an un-dispatched, mailed challan → vendor gets the cancellation mail; rent as before.
7. Generate a vendor bill for a month with a paused laptop → the line shows the paused days, not billed.
