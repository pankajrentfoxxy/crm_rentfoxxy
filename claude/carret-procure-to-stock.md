# Carret — Procure to stock: the plan

Written 26 Sep 2026 from three code surveys and QA data. Process 2 of the Carret completion
(Order to delivery was process 1). Nothing here is built yet; the **Decisions** section needs
answers first, because several of them change how the team works, not just the screens.

## Where it stands today (QA numbers)

- 124 vendors. 227 POs: 186 direct purchase, 40 rental purchase, 1 rent-to-own; 83 in the last
  90 days. 2,132 GRNs, 138 in 90 days. 1,741 laptops received in 90 days.
- **86% of laptops received in the last 90 days skipped the hardware configuration check**
  (1,491 of 1,741: no capture, no recorded waiver). When the check did run it caught a wrong
  configuration **1 time in 11** (26 of 285).
- **Vendor billing reads the wrong price (urgent, money).** Of 41 rental/rent-to-own POs, 37 put
  the price in "Rate", which billing uses as the monthly rent. **PO-0225: Rate ₹25,000,
  Monthly rent ₹1,999 — billed at ₹25,000 per laptop per month.** And **14 of the 41 have
  several lines, but billing uses line 1's rate for every laptop on the PO** (finding P6).
- 17 laptops have no stock status. (1,375 status-less rows are spare parts — by design; their
  stock lives in `part_instances`, linked by `vendor_serial_id`.)
- Carret Procure screens are read-only lists and mostly show "—" (wrong response keys); the
  Carret menu's GRN / Vendor Return / Vendor Repair links go nowhere.

## The process, step by step (target)

| # | Step | Who | Today | Target |
|---|---|---|---|---|
| 1 | **Vendor** set up | Procurement | Form; status forced "approved"; vendor never gets portal password; GST cert upload always fails; no GSTIN/PAN/IFSC checks on server; bank details readable by 6 roles | Vendor record with status (pending → approved → suspended), validated tax/bank IDs, documents that save, portal invite emailed, bank data visible only to accounts/procurement |
| 2 | **Need** raised | Sales / floor | Sales orders with no stock go to "awaiting purchase" and the request is lost (no screen, no link to a PO); part requests lose their link when a spare PO is made | One "To buy" queue: laptop shortfalls from orders and part requests from the floor, each linked to the PO that fills it; the order moves on automatically when stock arrives |
| 3 | **Purchase order** | Procurement → manager | Create (draft) → submit → approve. Approval can be skipped by editing status; creator can approve own PO; approved/received POs can be edited silently (changes vendor billing); no cancel/close in UI; no PDF in CRM; rejected is a dead end | Draft → submit → approve by a *different* person → sent to vendor with a complete PDF (type, rent/tenure/warranty, GST split, ship-to, terms) → vendor accepts/declines in portal (we're notified) → receiving. Changes after approval = **amend**, which goes back for approval. **Cancel** (nothing received) and **short-close** (partly received, with reason) |
| 4 | **Arrival at gate** | Guard | Guard scan only possible after GRN, optional, changes nothing | Decision D4 |
| 5 | **Receive (GRN)** | Warehouse | One GRN per PO (deliveries merge); per laptop: condition, config capture, serial; 4 receive paths, 2 with no checks; waiver loophole; ticket made after commit (can be lost); no labels, photos, reject-at-door, short-close | One GRN per delivery with the vendor's invoice/delivery note; per laptop: scan serial → run config check (required unless a manager-approved waiver) → condition + missing parts + damage photo → TTSPL assigned → **label printed**. Wrong/dead-on-arrival units flagged at the door (D6). Only one receive path; ticket created in the same transaction |
| 6 | **Into production** | Floor | Ticket at "Floor Manager" stage, assigned to the lowest-ID floor manager | Handoff to the Production process (process 3). Decision D8 on the first stage |
| 7 | **Into stock** | Warehouse | After floor QC: Pending Inventory → serial-verified receive into a carret slot → in stock / Ready to Rent or Sell | Kept; built as the last step of the production process, linked from here |
| 8 | **Back to the vendor** | Warehouse / procurement | Repair (VRDC) out and back; rental return (ticket VRT → challan VRTDC); floor "QC failed → return to vendor" is a **dead end** (unit can't go on a return challan); returned units recorded as **scrapped**; write actions guarded by "view" permission; notify can hang | One "Vendor returns" area: repair (out and back), return (rent stops, D10), replacement received into stock with its own TTSPL and billing dates; QC-failed units flow straight in; a debit note drafted automatically for every return/replacement; proper status "returned to vendor" (D9) |
| 9 | **Vendor bill link** | Accounts | Vendor billed from PO line 0 and prefers "Rate" over "Monthly rent" (rental POs ask for both) | Decision D3 fixes the field at source; billing itself is the Money process |

## Decisions needed (my recommendation first)

- **D1 Who approves a PO.** Recommend: anyone with PO-approve permission **except the person who created it**.
- **D2 Changing an approved PO.** Recommend: no silent edits — "Amend" sends it back for approval; "Cancel" only while nothing is received; "Short-close" for a partly received PO, with a reason.
- **D3 Rental PO price fields.** Today a rental PO asks for "Rate" *and* "Monthly rental", and vendor billing uses Rate. Recommend: rental POs have **Monthly rent per laptop** (billed) and optional **Asset value** (for e-way/insurance); purchase POs have **Price**. Needs a check of the 41 existing rental/rent-to-own POs.
- **D4 Guard at vendor arrival.** Recommend: the guard logs each vendor delivery at the gate (PO, vendor challan/invoice no., number of laptops) **before** GRN; the GRN starts from that entry, so "arrived" and "received" can't drift.
- **D5 Configuration check.** Recommend: required for every laptop that powers on; a laptop that won't power on is received with a waiver that a manager approves, and Diagnosis captures its config later. Closes the loophole.
- **D6 Wrong or dead-on-arrival at the door.** Recommend: receive it (TTSPL, for traceability) marked "rejected at receipt", excluded from vendor billing, and auto-add it to a vendor return.
- **D7 GRN and vendor invoice.** Recommend: one GRN per delivery; vendor invoice number optional at receipt, required before the vendor bill.
- **D8 First floor stage.** Today "Floor Manager" (triage). Keep, or go straight to Diagnosis? (Production process decision; recommend keep triage.)
- **D9 Status for a unit back with the vendor.** Recommend a real status **"returned to vendor"** instead of "scrapped" (scrap reports and billing currently mix them).
- **D10 When vendor rent stops on a rental return.** Today: when the vendor is **notified**. Alternative: when the laptop **leaves our gate**. Depends on the vendor contracts.
- **D11 QC-failed on the floor.** Recommend: moves the unit to "QC failed" so it goes straight onto a vendor return; debit note drafted.
- **D12 Debit notes.** Recommend: drafted automatically for every return and replacement (today only for floor QC fail).
- **D13 Spare-part POs.** Recommend: same flow and screens as laptop POs (they currently skip manager approval and can be received before approval).
- **D14 TTSPL labels at GRN.** Recommend yes — needs the label printer/size used on the floor.
- **D15 Vendor portal.** Recommend now: accept/decline notifies us, invoice upload checked for duplicates, returns page shows real vendor returns. Later: vendor-entered dispatch/ETA.

## Build order (after decisions)

0. **Vendor billing rate (urgent, before anything else)** — DONE on QA 26 Sep: each laptop billed
   at its own PO line, Monthly rent before Rate; BL5 vendor list fixed. Impact on QA data: 765 of
   1,036 laptops change (SG Laptops +₹2.37 lakh/month, C Prompt −₹1.14 lakh, Firmsap +₹1.02
   lakh, Siddhi −₹20k); 27 laptops have no rate at all. **Accounts must confirm before it is
   promoted** — `node backend/scripts/report-vendor-rate-changes.js --csv <file>` lists every laptop.
1. **Safety fixes** — DONE on QA 26 Sep (e9d9fea1, 9a120a63, deb38d0f, ee53ae73): PO approval
   bypass, self-approval, edit lock, server numbering, cancel guard, spare-PO rules; one checked
   receive path, D5 waiver, over-receipt lock, ticket in the receipt transaction, TTSPL reuse, QC
   intake via state machine; edit guards on return DC/ticket writes, e-way upload auth, billing
   list guard, bank/PAN redaction, capture rate limiter, link expiry; notify hang, DC number locks,
   declared values, portal invoice duplicates, vendor transactions. **Left for the screens, because
   each is a process change:** D9 returned-to-vendor status, QC-fail → vendor return (B1), units on
   a draft return DC still allocatable (B5), repaired units in stock while on the triage desk
   (B20), replacement intake (B18), VRDC cancel (B23), part vendor repair gate/QC (B24), porter
   fields on return DCs (B13), vendor portal invite/login-as, GST certificate storage, complete PO
   PDF. Original list: approval bypass, self-approval, edit lock, numbers taken from
   the request, delete with received units, over-receipt race, the two unchecked receive paths,
   "view"-guarded write routes (return DC, return ticket, billing list), e-way upload auth, notify
   hang, unmounted rate limiter on public capture, spare-PO GST/crash/approval bugs, vendor
   transactions on the shared pool, ticket created outside the receive transaction, DDL on every
   request. Each with a test.
2. **Vendors** — list, record (POs, laptops with them, returns), create/edit, portal access.
3. **To buy queue** (D13 demand chain).
4. **Purchase orders** — list (correct columns and status), create/amend, record with
   approve/send/PDF/cancel/short-close/activity; spare-part POs on the same screens.
5. **Gate arrival** (D4) and **Receive (GRN)** — wizard with capture, waiver approval, labels,
   reject-at-door; GRN record with verification per unit and bills.
6. **Vendor returns & repair** — one area for repair, return, replacement, QC-failed; debit notes.
7. Menu: Procure section opens the new screens; old ones under "Old view" until sign-off.
8. Verify on QA end to end, same method as Order to delivery.

Migrations expected: "returned to vendor" status (D9), PO amend/close fields, gate arrival entry
(D4), GRN delivery/invoice fields, porter fields on return DCs, VRDC status constraint, link
tables for the "To buy" queue. Numbered above 329; applied to QA; listed for production.

## Full findings

The three surveys (vendors & POs: 30 items; receiving: 24; vendor returns & repair: B1–B31) are
the reference for step 1 and for each screen. Key file references are kept in the session notes
and re-verified at build time (hard rule 1: inspect before writing).
