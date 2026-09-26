# What is still pending (26 Sep 2026)

Checked against the Carret menu (`frontend/src/config/navigation.js`) and the live
data on QA. "Built" = new screens on QA over the existing APIs; old screens stay
under "Old view" until sign-off.

## Built, waiting for the user's QA click-through
- Order to delivery — quotation → SO → laptops → DC → dispatch QC → gate → delivered.
- Procure to stock — to-buy, POs, spare POs, arrivals/GRN, vendor returns + return
  request, vendor repair (VRDC) + rent pause, vendor rentals, replacement approvals.
- Production — floor, parts desk, into stock, parts stock.
- Support steps 0–6 — queue, ticket record (pickup / replacement / Service DC),
  new ticket, SLA & feedback, my work / job / my parts, support parts desk, charges.

## To build — one at a time
1. **Support rework** (user: flow and UI/UX not good)
   - Issue type → subtype → issue: the 3-level catalog exists (7 / 41 / 158 in
     `support_issue_catalog`) but nothing uses it; tickets use a flat list of 7.
     2,656 laptops have no issue, 795 carry raw ERP ids like `["10"]`.
   - Technician records what was actually wrong + root cause + fix at close.
   - Issue insights: top issues by model / vendor / days since dispatch, and which
     floor technician / QC prepared the laptop → feedback to the floor.
   - Technician bucket for the lead: per technician — open jobs, laptops held,
     parts held, pickups not yet at the warehouse. Today only "Old view →
     Technician Bucket", parts only.
   - Customer requests (QR / portal), technicians, support settings: still old.
   - Walk the whole flow for UX (lead desk and technician phone).
2. **Lead** — no Carret screens: leads, lead detail, follow-ups, customers, lead
   email ingestion, lead quotation (hardcodes 18% GST — wrong for inter-state).
3. **Customer returns / rental end** — return challans (Carret list only), return
   pickup, receive, back to stock, NPA.
4. **Money** — vendor bills (now unblocked by the rent-start fix), credit / debit
   notes, security deposits, payments, DC / sale / e-invoice queues, e-way bills.
   Carret has invoices, ageing and support charges only.
5. **Stock** — ready to rent/sell, asset movements, scrap, master data, customer
   inventory, asset configuration: all old screens.
6. **Move leftovers** — dispatch chargers, part inward, pending dispatch, delivery
   technicians, dispatch QC link: old screens.
7. **Daily dashboard + snapshot** — the day's counts, rentals, sales (after the
   processes above).

## Waiting on the user / Accounts
- First month the CRM makes vendor bills (earlier months settled outside).
- Accounts: `claude/reports/vendor-rates-to-confirm-QA-2026-09-26.csv` (67 laptops).
- Interakt template `support_feedback` approved → set `INTERAKT_TPL_SUPPORT_FEEDBACK`.
- Map of the ERP issue ids (`["10"]` …) to names, if old tickets should count in
  the issue insights.
- Promotion to live: `claude/production-promotion-checklist.md`.
