# Rentfoxxy CRM — Phase 2 Plan
### Business Requirements Document (for stakeholder review)

**Company:** TrueTech Services Pvt. Ltd. (Rentfoxxy — laptop rental · gorefurbo — laptop sales/refurb)
**Prepared by:** CTO office
**Date:** 30 June 2026
**Status:** For approval

---

## 1. One-line summary

Phase 1 built the engine that runs the business (leads → orders → delivery → support → automated billing). **Phase 2 builds the windscreen and dashboard** — so management can *see* the money and the fleet at a glance — and fixes a few billing blind spots before they cost us cash.

---

## 2. Where we are today (so the gap is clear)

- The CRM already runs the full rental lifecycle end to end.
- **Invoices are already generated automatically.** On the 1st of every month the system bills customers in advance; vendors are billed at month-end. Pro-rata for part-month rentals, mid-month additions, and returns is already handled, including refund credit notes when a customer returns a laptop early.
- **What's missing is visibility and a few safeguards** — management cannot yet see total recurring revenue, who owes us money and how overdue they are, or how much of our laptop fleet is sitting idle.

---

## 3. What Phase 2 will deliver

### A. Management dashboards (the headline value)
- **Monthly Recurring Revenue (MRR):** a single live number for "how much rent are we earning per month," split by Rentfoxxy vs gorefurbo and by top customers.
- **Revenue per customer (ARPU)** and a **12-month revenue trend**.
- **Money owed to us (Aging):** unpaid invoices grouped by how late they are — current, 0–30, 31–60, 61–90, and 90+ days — for both customers (receivables) and vendors (payables).
- **Cash-flow view:** collected this month, total outstanding, and expected inflow in the next 30 days.
- **Fleet health:** how many laptops are rented, available, under repair, or scrapped; a **utilisation %**; and an **idle-fleet cost** figure showing revenue we're losing on laptops sitting in stock.
- **Churn forecast:** which rentals are ending in the next 30/60/90 days and the monthly revenue at risk — so sales can act before customers leave.
- Every dashboard is **exportable to Excel** for board and finance use.

### B. Billing safeguards (protecting cash)
- **Due dates on every invoice:** today invoices have no payment-due date, so we can't reliably track lateness. Phase 2 adds clear payment terms (e.g. 15 days for customers, 30 for vendors).
- **Automatic "overdue" flagging:** the system will mark invoices overdue the day they cross their due date — no manual tracking, no missed follow-ups.
- **Invoice review queue:** auto-generated invoices currently wait quietly as drafts. Phase 2 surfaces them in one screen where accounts can review and send in bulk on the 1st — nothing slips through.
- **Edge-case verification:** a formal check of tricky scenarios (early returns, replacements, leap-year months, large credit notes) to guarantee we never over- or under-bill.

### C. System health audit (reducing future risk)
- A one-time, thorough audit of the database to find **unused leftover tables** and **broken links** (records pointing to nothing) — cleaned up safely after review.
- Confirms every laptop's status is valid and consistent across the system.
- **No customer, login, role, or historical data is ever touched** — audit is read-only until changes are explicitly approved.

---

## 4. Business outcomes (why this matters)

- **See the money:** leadership gets MRR, receivables, and cash-flow at a glance instead of pulling numbers manually.
- **Collect faster:** automatic overdue flags and aging buckets mean fewer late payments and better cash flow.
- **Earn more from the fleet:** idle-laptop visibility turns dead stock into rentable revenue.
- **Retain customers:** churn forecasting flags at-risk rentals early.
- **Lower risk:** the audit removes hidden data problems before they cause billing errors.

---

## 5. What Phase 2 is NOT (scope guardrails)

- Not a rebuild of billing — the billing engine already works and stays as-is.
- Not a change to how rent, GST, or pro-rata is calculated.
- Not a change to user logins, roles, or permissions.
- No new laptop/operations workflows — Phase 2 is reporting, safeguards, and cleanup only.

---

## 6. Indicative effort & sequencing

| Workstream | Relative size | Suggested order |
|---|---|---|
| Billing safeguards (due dates, overdue, review queue) | Small | First — protects cash immediately |
| Management dashboards (MRR, aging, cash-flow, fleet, churn) | Medium–Large | Second — the headline deliverable |
| System health audit + cleanup | Medium | In parallel; cleanup applied only after sign-off |

*(Detailed engineering estimates to follow once this scope is approved.)*

---

## 7. Decision requested

Approval to proceed with the three Phase 2 workstreams above, prioritising the billing safeguards and the MRR / receivables dashboards first.
