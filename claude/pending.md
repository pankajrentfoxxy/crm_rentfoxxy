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
1. **Support rework** — BUILT on QA 26 Sep (A–F, see `claude/carret-support.md`); waiting for the
   user's click-through.
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
