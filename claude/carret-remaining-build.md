# Remaining new-UI build — plan (29 Sep 2026)

User: "implement all these with clean and without gap … without breaking any flow … if any merge is
required then merge sections." Scope = pending B: Money (item 8), daily dashboard (item 11), and every
old-styled screen still linked from the new menu.

## Money decisions taken (defaults — the 28 Sep M1–M12 were never answered; user may override)
Survey of defects: `claude/carret-money.md`.
- MD1 Payments: row lock on the invoice, amount capped at the outstanding balance, refused on a cancelled /
  draft invoice, idempotency key so a double click posts once. "Record payment" in the new UI.
- MD2 Credit notes: number from `nextFinancialYearNumber('credit_note', client)` inside the transaction
  (one series, `CN/26-27/NNNNNN` — same as the scheduler); amount > 0 and ≤ the invoice balance; invoice must
  belong to the customer; created as draft, approved by a different user (maker-checker); cancel releases.
- MD3 Security deposits: refund only through account closure (SD1) — the standalone refund route is closed;
  row lock; Rs 0 refund is "held", not "partially refunded".
- MD4 Invoice cancel: row lock + status guard; releases applied credit notes and security lines.
- MD5 Vendor bills: CGST/SGST vs IGST from `computeGstBreakdown` / `isIntraState` (vendor state vs company
  state), stored per bill; `generated_by` written so maker-checker works; 'cancelled' added to the status
  CHECK so Cancel works; a debit note raised after the bill month is deducted on the next bill, not marked
  "adjusted" without a deduction.
- MD6 Debit notes: a draft's amount can be set and the draft cancelled; approving Rs 0 is refused; numbers
  allocated in the transaction.
- MD7 DC / sale / e-invoice queues: an attached invoice / IRN / e-way number cannot be silently overwritten
  (explicit "replace" with reason, audit); duplicate numbers refused.
- MD8 E-invoice IRN (Zoho GSP) integration is external/legal: screens show and record numbers; the GSP call
  itself is not changed in this pass (flagged). Legacy `/api/sales/orders/:id/generate-invoice|generate-eway`
  that invent INV-/EWB- numbers are closed (410) if nothing live calls them.

## Merges
- Finance menu: the dead `/finance/*` links go; each entry opens a new-UI page.
- One "Today" dashboard at /carret/home merges the old Overview (/dashboard), Billing dashboard
  (/finance/dashboard) and Operations (/carret): day's counts, rentals, sales, money due, floor, dispatch.
- Scrap Challans → Stock → Scrap (already has request → approve → challan).
- Vendor Return DC / Vendor Repair DC / receive / Vendor Return Ticket → Procurement → Vendor Returns (one
  place, tabs), linked from Movement.
- Deployed Fleet → Stock → Assets (With customers view) if it adds nothing else.
- Service Parts Challans → Support → Parts desk if it duplicates it.

## Builders (parallel, one git worktree each; merged by the lead)
| # | Area | Migrations |
|---|---|---|
| 1 | Customer money: invoices (record payment, cancel), payments list, credit notes, security deposits, delivery charges | 363–368 |
| 2 | Vendor money: vendor bills, debit notes, vendor payments | 369–374 |
| 3 | GST documents: DC / sale / e-invoice queues, e-way bills list | 375–378 |
| 4 | Today dashboard (merge of Overview + Billing dashboard + Operations) | 379–381 |
| 5 | Parts Catalogue, Part Repairs, Master Data, Asset Configuration, Deployed Fleet | 382–386 |
| 6 | Movement docs (vendor return / repair DC, return ticket, scrap, service parts), Demo Agreements, Sale in Place, Teams, Settings, Reports | 387–392 |

Rules for every builder: existing APIs first (no parallel API; a new endpoint needs a reason); every route
declares (section, action) = the section its API enforces; no hex; tests with the fix; migrations applied
one file at a time on QA (never `run-all-migrations.js`); no pm2 restart, no frontend build (lead does it);
do not edit `config/navigation.js` / `routes/carretRoutes.jsx` — report the entries to add.
