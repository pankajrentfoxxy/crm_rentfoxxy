# What is still pending — final list (27 Sep 2026, updated 29 Sep)

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
7. **Customer returns / rental end** — BUILT 27 Sep (`claude/carret-customers-returns-control.md`):
   return challans + RDC record with warehouse receive (rent stops there), damage charges,
   account closure + deposit refund; also Sell → Customers (auto tag, record with rented /
   returned / purchased). Control (roles & permissions) in progress. Waiting: click-through.
8. **Money** — BUILT on QA 29 Sep (`claude/carret-remaining-build.md`, decisions MD1–MD8 to confirm):
   customer invoices (record payment, cancel), payments received / to vendors, credit notes, security
   deposits, delivery charges, vendor bills (GST split, cancel), debit notes (set amount / cancel), one
   invoice & e-way queue, e-way register. Migrations 363, 369, 375 applied on QA — run on live at promotion.
9. **Stock** — BUILT on QA 27 Sep (`claude/carret-stock.md`): assets, ready stock (tag + slot),
   not earning, scrap (request → approve → challan). asset_available = QC-passed (354, done).
   Clean-up applied on QA 27 Sep by the user (398 rows, backup
   backend/backups/stock-cleanup-2026-09-27T22-03-38-587Z.json). Waiting: click-through, the 13
   REVIEW rows checked physically. (Asset-config duplicates merged 27 Sep: scripts/merge-asset-config-duplicates.js — run on live at promotion.)
10. **Move leftovers** — BUILT on QA 29 Sep (`claude/carret-move-leftovers.md`): charger
    handover clubbed into Order to delivery (SO laptops "Charger" column, Dispatch QC ticket,
    "Chargers to hand over" list; no handover without laptop / SO / requester — backend
    refuses too), Orders to accept (pending dispatch), Delivery technicians, Part inward (old
    link was broken), Dispatch QC → new floor board. Waiting: click-through.
11. **Daily dashboard + snapshot** — BUILT 29 Sep: Today at /carret/home (replaces Overview, Billing
    dashboard, Operations), past-day snapshot.
12. **Hide the old screens** — DONE 29 Sep for the new UI menu: every "Old view" group removed so teams
    test only the new screens (old screens stay routed, reachable from the Old UI sidebar). Audit 29 Sep night:
    every new-UI menu entry opens a new-UI page (Finance, Demo, Sale in Place, vendor return / repair DC, scrap,
    service parts challans, part repairs, parts catalogue incl. add part / units / labels, deployed fleet, asset
    configuration, teams, settings, reports). Last old pieces (signature pad, transport / e-way fields, label
    print, browser pop-ups, list layouts, report charts) are being replaced — see 12e.

12b. **Wave 2 (29 Sep)** — BUILT on QA: spare-parts PO receiving, part naming (category + details + fits →
    generated name), dead parts in & out + discarded parts → scrap, customer profile / documents / portal,
    My Deliveries pickups + vendor hand-over. Migrations 396, 399, 405 on QA (due at promotion). Waiting on the
    user: `sync-spare-po-receive-status.js --apply` (57 spare POs), part-naming clean-up CSV review
    (`claude/reports/part-naming-cleanup-QA-2026-09-29.csv`, 56 confident / 63 REVIEW) then `apply-part-naming-cleanup.js`.

12c. **Partial pickup — "Collect later" (29 Sep)** — BUILT on QA: a laptop the customer keeps moves to a new
    RDC on the same ticket (reason + date, own OTP); guard gates in / warehouse receives the collected ones,
    rent stops for them only; ticket closes when all are in. Support RDCs are worked in My work only (not My
    Deliveries). Needs promotion to reach crm.rentfoxxy.com; until then use Edit pickup before gate-in.

12d. **Sell / production changes of 29 Sep (this session)** — BUILT on QA, pushed except the last item:
    SO form (customer list, saved config lines, WFH = employee address + Rs 799 per laptop + GST, WFH address
    saved on the customer, no WFH on sale, Save as draft + Drafts tab), GSTIN required on rental AND demo orders,
    "Same as contact person" for finance / spoke, security deposit None / 1 / 2 / 3 months (chosen at Deal, default
    per customer, per-order override, also on quotations), GSTIN lookup on the lead fills company / trade name /
    type / PAN / billing and carries into Deal, Dispatch QC needs Praman Device ID + PDF (shown on the SO),
    production assign / reassign to anyone (new permission "Assign floor tickets", reassign keeps the stage).
    Migrations 406–410 on QA. Waiting: click-through.

12e. **New UI clean-up (29 Sep night, commit f7e4f7cd)** — BUILT on QA: no old components or browser pop-ups left in
    the new UI; six list pages on the standard layout; Finance gaps (invoice e-way + QR, row PDF / mark paid / approve,
    ageing statement, credit-note laptop links); 7 report charts; Deployed Fleet history drawer; Service Parts
    Challans full register; vendor return / repair / scrap list PDFs + filters. Six Finance routes and /carret/home
    were unguarded — fixed. Open question: Deployed-Fleet-only users can't load laptop history (backend needs
    ttspl_history / floor view) — widen or not? Waiting: click-through.

## C. Waiting on the user / Accounts
13. First month the CRM makes vendor bills (earlier months settled outside).
14. Accounts to confirm `claude/reports/vendor-rates-to-confirm-QA-2026-09-26.csv` (67 laptops).
15. Interakt template `support_feedback` approved → set `INTERAKT_TPL_SUPPORT_FEEDBACK`.
16. ERP issue ids (`["10"]` …) → names, if old tickets should count in issue insights.
17. Rented-from-vendor laptops: show a purchase-equivalent cost, or monthly rent only?

## D. Promotion to live (after sign-off) — `claude/production-promotion-checklist.md`
18. Run on live, in order, with backups: migrations 327–352 (and later ones up to 410, see carret-migrations memory) (350–352 = lock-in / warranty,
    then `scripts/backfill-lockin-warranty.js` dry-run → --commit; 353–354 + stock clean-up
    (`stock-cleanup-report.js --tag LIVE-…` → review → `apply-stock-cleanup.js`),
    `merge-asset-config-duplicates.js`, `laptop-brand-cleanup.js --tag LIVE-…`) (Support v2 301–326 is a
    separate decision; 323 stays back), `sync-po-receive-status.js`, floor-ticket clean-up,
    config-drift fix, `fix-rental-start-dates.js` (~1,025 laptops start 2027-02-07 on live).
19. Merge new_stagging_crm into live (merge, never overwrite); `REACT_APP_CARRET=1` is in
    `frontend/.env.production`.
