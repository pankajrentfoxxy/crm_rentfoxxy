# What is still pending — final list (27 Sep 2026)

We go through this one item at a time, top to bottom. An item is closed only when the
user has clicked it through on qa.rentfoxxy.com and said it is fine.

New UI: the old sidebar now has ONE entry, "New UI → Open New UI" (/carret/home). It opens
the new interface with its own menu; "Old UI" in the new header goes back.

## A. Built — check on QA, fix what is wrong, sign off
1. **Order to delivery** — quotation → SO → attach laptops → DC → dispatch QC → gate →
   delivered (OTP / POD / courier). Challan create, gate confirm and delivery were never
   clicked through (they move real QA stock).
2. **Procure to stock** — to buy, POs, spare-parts POs, vendor arrivals / GRN, vendor
   returns + return request, vendor repair (VRDC) + rent pause, vendor rentals,
   replacement approvals.
3. **Production** — floor, stage forms, QC / QC2, Hold, parts desk, into stock, parts stock.
4. **Support** — queue, ticket record (pickup / replacement / Service DC), new ticket
   (Type > Subtype > Issue), SLA & feedback, my work / job / my parts, support parts desk,
   issue insights, technician bucket, requests, settings, support charges to bill.
   Includes live's sold-laptop replacement (original sale order, Rs 0) merged 27 Sep.
5. **Lead** — board, lead record, follow-ups with outcome, Deal = convert, auto-move from
   quotes / SO.
6. **Live merges of 27 Sep** — billing (no double day, first order only on delivery,
   security kept, SO rate per customer), OTP in ticket sidebar, Return DC config view.
6a. **Lock-in + early return, gorefurbo warranty** — built 27 Sep (`claude/carret-lockin-warranty.md`):
   replacement keeps the original lock-in end; return pickup blocked in lock-in; early return
   Support → Sales → Accounts → "Lock-in break" charge; sold laptop out of warranty = paid repair,
   service charges → SVO service order + Zoho invoice.

## B. Still to build in the new UI — one at a time
7. **Customer returns / rental end** — return challans, return pickup, receive, back to
   stock, NPA.
8. **Money** — vendor bills, credit / debit notes, security deposits, payments, DC / sale /
   e-invoice queues, e-way bills. (New UI has invoices, ageing and support charges only.)
9. **Stock** — BUILT on QA 27 Sep (`claude/carret-stock.md`): assets, ready stock (tag + slot),
   not earning, scrap (request → approve → challan). asset_available = QC-passed (354, done).
   Clean-up applied on QA 27 Sep by the user (398 rows, backup
   backend/backups/stock-cleanup-2026-09-27T22-03-38-587Z.json). Waiting: click-through, the 13
   REVIEW rows checked physically, 5 asset-config duplicates merged by hand.
10. **Move leftovers** — dispatch chargers, part inward, pending dispatch, delivery
    technicians, dispatch QC link.
11. **Daily dashboard + snapshot** — the day's counts, rentals, sales.
12. **Hide the old screens** of each process after its sign-off (the "Old view" links).

## C. Waiting on the user / Accounts
13. First month the CRM makes vendor bills (earlier months settled outside).
14. Accounts to confirm `claude/reports/vendor-rates-to-confirm-QA-2026-09-26.csv` (67 laptops).
15. Interakt template `support_feedback` approved → set `INTERAKT_TPL_SUPPORT_FEEDBACK`.
16. ERP issue ids (`["10"]` …) → names, if old tickets should count in issue insights.
17. Rented-from-vendor laptops: show a purchase-equivalent cost, or monthly rent only?

## D. Promotion to live (after sign-off) — `claude/production-promotion-checklist.md`
18. Run on live, in order, with backups: migrations 327–352 (350–352 = lock-in / warranty,
    then `scripts/backfill-lockin-warranty.js` dry-run → --commit) (Support v2 301–326 is a
    separate decision; 323 stays back), `sync-po-receive-status.js`, floor-ticket clean-up,
    config-drift fix, `fix-rental-start-dates.js` (~1,025 laptops start 2027-02-07 on live).
19. Merge new_stagging_crm into live (merge, never overwrite); `REACT_APP_CARRET=1` is in
    `frontend/.env.production`.
