# PHASE 11 — Reports, billing wiring, cutover and decommission

> Read `00_MASTER_CONTEXT.md` first.
> **Screens:** S20 (Reports), S18 stats panel, S19 (Settings).
> **Depends on:** Phase 10.
> **This phase touches production.** Nothing here happens without a database snapshot and a
> rollback plan written down before you start.

---

## 11.1 Wire the billing hooks

The tables were created in Phase 2 and written to in Phases 5–8. Now the invoice cron reads them.

Modify `backend/services/billingSchedulerService.js` and `billingLineItemsService.js`:

1. **Rent holds** — when computing a customer's monthly rent, subtract days covered by
   `asset_billing_holds` where `waive_rent = true` and the hold overlaps the billing month.
2. **Extra lines** — pull `customer_invoice_extra_lines` where `status = 'APPROVED'` and
   `billed_in_invoice_id IS NULL`, add them to the invoice, then stamp `billed_in_invoice_id` and
   set `status = 'BILLED'` **inside the same transaction** as the invoice insert.
3. **Return credit notes** — already handled in Phase 6; verify no double-credit now that both paths
   are live.

> Do this behind a setting `BILLING_READ_SUPPORT_HOOKS` (default `false`), turn it on in staging,
> reconcile one full month against the previous logic, then enable in production. A billing change
> that silently drops or duplicates a line is far worse than a support bug.

Add a reconciliation script:
```
node scripts/reconcile-billing-hooks.js --month 2026-07
```
It prints, per customer: rent before, rent after, days waived, extra lines added, and the delta.
**Any unexplained delta blocks the cutover.**

---

## 11.2 Reports (S20)

All read-only, all `cp('support_reports','view')`. Build them as SQL views or materialised views
refreshed nightly — not as ad-hoc queries in controllers.

```
GET /reports/volume            by channel, class, type, subtype, top-20 issue types, customer, city
GET /reports/sla               response %, resolution %, breaches by reason, avg times, paused analysis
GET /reports/quality           FCR %, reopen rate, CSAT distribution, CSAT ≤2 detail,
                               reported-vs-found accuracy by agent
GET /reports/field             jobs/day/technician, on-time arrival %, avg on-site minutes,
                               failed-visit rate by reason, photo-compliance %
GET /reports/assets            MTBF by model, top failing subtypes by brand/model,
                               repeat-offender assets, TCO per TTSPL, retirement candidates
GET /reports/parts             consumption, stock-out incidents, avg approval time,
                               unused-return rate, cost per customer
GET /reports/commercial        chargeable raised/approved/billed/waived, vendor claims,
                               rent waived due to repair delay
```

### Definitions — write these into the code as comments so they never drift
- **FCR** = resolved with exactly one work order **and** no reopen within 7 days
- **On-time arrival** = `on_site_at <= slot_end`
- **Reported-vs-found accuracy** = lines where `reported_subtype_id = found_subtype_id`, over lines with both set
- **MTBF by model** = complaints per unit per year for that model, over the fleet-days deployed
- **TCO per TTSPL** = parts + field visit cost + rent waived, over the asset's life

Every report screen gets a CSV export via the existing `xlsx` dependency.

### The three that will change decisions
1. **Failure rate by model** — "the ThinkPad E14 fails 2.4× as often as the Latitude 5420" is a
   procurement decision you can now evidence.
2. **Reported vs found accuracy by agent** — a coaching tool that costs nothing to produce.
3. **Commercial recovery** — chargeable raised → approved → billed. None of this line exists today.

Charts: use `recharts` (already a dependency). The dashboards in the mockup use simple horizontal
stacked bars — do not add pies or donuts.

---

## 11.3 Settings (S19)

`cp('support_settings','edit')`. One screen, grouped:

| Group | Settings |
|---|---|
| SLA | `auto_close_hours` (48), `reopen_window_days` (7), escalation thresholds |
| Repair | `free_repair_days` (3), `max_repair_days` (7 → triggers the convert-to-replacement suggestion) |
| Field | default `max_jobs_per_day` (6), accept-window minutes (30), photo minimums |
| Parts | lead approval threshold (₹5,000), manager threshold (₹10,000) |
| Notifications | per-event on/off, template editor |
| Portal | what customers may see and do |

Store in a `support_settings_v2(key, value JSONB, updated_by, updated_at)` table with a cached
accessor. Never hard-code these numbers anywhere else.

---

## 11.4 CUTOVER

### Pre-cutover gate — every box, no exceptions
- [ ] Phases 0–10 all merged into `support-revamp` and verified
- [ ] Full regression pass on a production data copy
- [ ] Billing reconciliation shows zero unexplained delta for a full month
- [ ] Support team trained on the new module (see 11.6)
- [ ] Rollback plan written and rehearsed **on staging**
- [ ] Production database snapshot taken and restore tested

### Step 1 — Dual run (2 weeks, production)
- New module live at `/support-v2/*`, old module still at `/support/*`
- Support team uses **the new one** for all new tickets
- Old module stays writable **only** for tickets that were already open in it
- Nightly comparison job writes `docs/support-revamp/DUAL_RUN_DAY_NN.md`: ticket counts, status
  distribution, and any ticket where the two models disagree
- Any disagreement is investigated before proceeding. Do not extend the dual run to "fix it later".

### Step 2 — Swap the routes
```js
// frontend/src/routes/supportRoutes.jsx
{ path: '/support/*',        element: … <SupportV2App /> … }        // new module takes the URL
{ path: '/support-legacy/*', element: … <SupportModuleApp /> … }    // old one, 30 days, read-only
{ path: '/support-v2/*',     element: <Navigate to="/support" replace /> }
```
Menu: remove "Support (new)", point "Support" at `/support`, add "Support (legacy, read-only)"
visible only to admins.

### Step 3 — Freeze the old write paths
Legacy write endpoints return:
```js
res.status(410).json({ success: false,
  message: 'This endpoint has moved. Use /api/support/v2. See docs/support-revamp/API_MIGRATION.md' });
```
Keep GETs working so the read-only legacy UI still renders.

### Step 4 — 30 days of monitoring
Watch: SLA compliance, ticket volume vs the previous month, error rate, support team feedback,
`SVC-OTH` usage (> 5% means the catalogue needs extending — see PLAN §5.3).

### Step 5 — Decommission
Only after 30 clean days:
1. Delete legacy support routes, controllers, services and frontend components
   (list them in the phase report before deleting)
2. Delete the four near-duplicate replacement functions
3. Drop `delivery_challan_lines.delivery_person_id` (now that `assigned_user_id` is proven)
4. Rename tables:
   ```sql
   ALTER TABLE support_tickets      RENAME TO support_tickets_legacy;
   ALTER TABLE support_ticket_items RENAME TO support_ticket_items_legacy;
   ALTER TABLE support_tickets_v2   RENAME TO support_tickets;
   -- update every reference in code in the same commit
   ```
5. Retire the old permission sections:
   ```sql
   UPDATE permission_sections SET description = '[RETIRED] ' || description
    WHERE section IN ('support_technician','technicians_bucket_list','technician_bucket');
   ```
   Retire, do not delete — old audit rows reference them.
6. Archive the legacy tables to a backup schema, then drop them **one release later**, not now.

### Rollback plan
| When | Action |
|---|---|
| During dual run | Just tell the team to use `/support`. No data loss — the old module never stopped working. |
| After the route swap, within 24 h | Revert the routes commit. Tickets created in v2 during that window stay in v2 and must be worked there — export a list. |
| After the 410 freeze | Restore the snapshot **only** if data is corrupted. Otherwise fix forward — by this point the team has been on v2 for 6+ weeks. |
| After the rename | No rollback. This is the point of no return, which is why it is 30 days after everything else. |

---

## 11.5 Final acceptance — the whole flow, on staging, end to end

Run this as a scripted walkthrough with the actual support team watching. Every step must work
without a developer intervening.

1. Agent raises a 3-machine complaint by phone for a Platinum customer. All three classified. → P2, SLA shown.
2. Lead triages, confirms priority, releases a Field visit for all three machines.
3. Dispatch board: auto-assign. Technician gets a push notification.
4. Technician accepts on their phone, marks en route (customer gets WhatsApp with ETA), arrives.
5. Machine 1: cannot fix → raises a Repair pickup on the same visit. RDC generated, OTP verified,
   6 photos, e-signature. Rent hold starts.
6. Machine 2: cracked screen → Replacement. Delivery + collect pair, same technician, same slot.
   Data transfer done on site. Damage charge ₹6,500 raised with photos → manager approves.
7. Machine 3: battery → Part request. Warehouse approves, SPC challan, technician fits it,
   photographs it, collects the old battery → RPDC. Vendor warranty claim raised.
8. Warehouse receives machine 1, floor QC ticket opens, repairs, passes → Service return WO
   auto-created, delivered, rent hold ends.
9. Agent resolves all three lines with full codes. Ticket auto-resolves.
10. Customer gets the resolution email, taps 4 stars.
11. Ticket auto-closes after 48 h.
12. Monthly invoice includes the ₹6,500 damage charge and waives 2 days of rent for the repair.
13. Reports show: 1 ticket, 3 lines, 8 work orders, 1 chargeable recovered, 1 vendor claim,
    FCR = false (multiple WOs), CSAT 4, reported-vs-found accuracy 2 of 3.

**If any step needs a developer, the phase is not done.**

---

## 11.6 Training and documentation

Write `docs/support-revamp/USER_GUIDE.md` — one page per role, screenshots, and the five things
each role does most:
- **Agent** — raise a ticket, classify, link a duplicate, resolve remotely, pause correctly
- **Lead** — triage, assign, dispatch board, override priority, handle a breach
- **Technician** — accept, navigate, execute a checklist, request a part, complete
- **Warehouse** — approve parts, receive returns, grade condition
- **Manager** — approvals, breach register, monthly reports

Also `docs/support-revamp/API_MIGRATION.md` mapping every old endpoint to its replacement, for
anything that integrates with the CRM.

---

## VERIFICATION CHECKLIST — Phase 11

**Billing**
- [ ] `reconcile-billing-hooks.js --month` shows zero unexplained delta
- [ ] A repair hold of 5 days with `free_repair_days = 3` waives exactly 2 days
- [ ] An approved damage charge appears once on the next invoice and never again
- [ ] A return raises exactly one credit note, pro-rata from the pickup date
- [ ] Turning `BILLING_READ_SUPPORT_HOOKS` off restores the previous behaviour exactly

**Reports**
- [ ] Every report renders and exports to CSV
- [ ] FCR, on-time arrival and accuracy match hand-calculations on 10 sample tickets
- [ ] Failure rate by model reconciles against the raw ticket count
- [ ] Commercial recovery totals match `customer_invoice_extra_lines`

**Settings**
- [ ] Changing `free_repair_days` changes the next invoice calculation with no deploy
- [ ] Changing an approval threshold changes who is asked with no deploy
- [ ] No hard-coded copy of any setting remains — grep for the default values

**Cutover**
- [ ] Dual run completed with zero unresolved disagreements
- [ ] After the swap, `/support` serves the new module and `/support-legacy` the old one, read-only
- [ ] Legacy write endpoints return 410 with a helpful message
- [ ] Legacy GETs still work so the read-only UI renders
- [ ] Rollback rehearsed on staging and documented

**Final acceptance**
- [ ] The 13-step walkthrough completes with no developer intervention
- [ ] The support team signs off in writing

**Decommission (30 days later, separate PR)**
- [ ] Legacy code deleted, listed in the report
- [ ] Tables renamed, all references updated in the same commit
- [ ] Old permission sections retired, not deleted
- [ ] `npm test` green · all three apps build clean
