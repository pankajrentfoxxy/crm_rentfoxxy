# Support Revamp — Build Prompts

Twelve phases. One prompt per phase. Verify each on local before starting the next.

---

## The files

| Order | File | What Cursor builds | Verify by |
|---|---|---|---|
| — | **`00_MASTER_CONTEXT.md`** | Nothing — this is the rules file | Save it as `.cursor/rules/support-revamp.md` |
| 1 | `PHASE_00_FOUNDATION.md` | Branch, 20 RBAC sections, design tokens, primitives, module shell | Grant one section to one user, watch the nav change |
| 2 | `PHASE_01_TAXONOMY_PRIORITY_SLA.md` | Issue catalogue, priority matrix, SLA policies + calendars | Search "cracked", preview an SLA |
| 3 | `PHASE_02_CORE_MODEL.md` | New tables, backfill of live data, reconciliation report | Spot-check 10 tickets against the old UI |
| 4 | `PHASE_03_QUEUE_AND_DASHBOARD.md` | S1 Command centre, S2 Ticket queue | Page through the queue, check the sort holds |
| 5 | `PHASE_04_COMPLAINT_FLOW.md` | S3–S6 wizard, S7 detail, S8 resolve | Raise a 3-machine complaint, resolve it |
| 6 | `PHASE_05_WORK_ORDER_ENGINE_AND_REPAIR_PICKUP.md` | WO engine, field visit, repair pickup, service return | Full repair round trip, rent hold opens and closes |
| 7 | `PHASE_06_RETURN_PICKUP.md` | Return pickup, grading, bulk returns, credit notes | 40-asset return becomes 2 jobs, one credit note |
| 8 | `PHASE_07_REPLACEMENT.md` | Replacement, paired work orders | Collect leg refuses to complete before delivery |
| 9 | `PHASE_08_PARTS.md` | Unified part requests, part delivery and return | P1 part request sorts above P4 in the warehouse queue |
| 10 | `PHASE_09_TECHNICIAN_BUCKET_AND_DISPATCH.md` | One bucket, one identity, dispatch board, offline PWA | Complete a job in airplane mode, watch it sync |
| 11 | `PHASE_10_SLA_NOTIFICATIONS_APPROVALS.md` | SLA cron, escalation, notifications, CSAT, approvals | Force a breach, check it escalates once |
| 12 | `PHASE_11_REPORTS_AND_CUTOVER.md` | Reports, billing wiring, cutover, decommission | The 13-step end-to-end walkthrough |

Also needed in the repo, in `docs/support-revamp/`:
- `SUPPORT_REVAMP_PLAN.md` — the design document
- `support-ui-mockup.html` — the UI. Every phase prompt refers to screens by their S-number.

---

## How to run a phase

```bash
git checkout support-revamp && git pull
git checkout -b support-revamp/phase-NN
```
In Cursor Composer, paste the phase file. If you have not set up the rules file, paste
`00_MASTER_CONTEXT.md` first, in the same message.

When Composer finishes:
```bash
cd backend && node scripts/run-all-migrations.js && npm run prisma:sync && npm test
cd ../frontend && npm run build
```
Then work through the phase's **Verification checklist** in the browser. Every box.

Only then: commit, PR into `support-revamp`, and move on.

---

## Two things to watch for

**Cursor will want to refactor the old support module.** It shouldn't. The whole plan depends on the
old module continuing to work untouched until Phase 11. If you see it editing
`supportController.js` or `support_ticket_items`, stop it.

**Cursor will want to add libraries.** A modal library, a table library, a date library, a state
manager. Everything needed is already in `package.json`. Master §3.3 says no; hold the line, or the
UI will stop looking like one product.

---

## Things I added that you did not ask for

You asked me to suggest anything that would make the flow more organised. These are in the prompts:

**A dispatch board.** You have no way today to see "who is free" and "what is unassigned" at the
same moment, which is why one technician ends up with eight jobs and another with two. This is the
single biggest day-to-day quality-of-life change for your lead.

**Grouped visits.** Three jobs at the same customer, same day, become one card with three sub-jobs.
Today they live in three unrelated systems and the technician navigates three screens for one trip.

**An offline PWA for technicians.** Your people work in basements, lifts and server rooms. Every
step, photo, OTP and signature is queued locally with an idempotency key and synced on reconnect.
Without this, field data will keep going missing and you will keep blaming the technicians.

**Condition grading with a chargeable total that updates live.** The technician sees "Chargeable so
far: ₹2,850" while standing in front of the customer, instead of it being decided in an office a
week later.

**Buffer stock at customer sites.** If the CRM knows a client already holds four spare units, a P1
becomes "swap from your buffer now" and the field visit becomes a scheduled replenishment.

**Repeat-offender detection at the asset level.** Three complaints on one laptop in 90 days flags it
at ticket creation with "consider replacement". Today nothing watches this, so you pay for the same
laptop four times.

**Liability on every resolution.** Company / Customer chargeable / Vendor warranty / Insurance.
This is the field that connects support to revenue — right now a chargeable repair, a damaged
screen or a missing adapter has nowhere to go in the system, so it is handled inconsistently or not
at all.

**An assignment engine that explains itself.** `dry_run` returns why each technician was rejected.
A lead who does not trust auto-assignment will assign everything by hand, and you will have built
it for nothing.

**Breach reason codes, enforced by a DB constraint.** A breach count tells you nothing. A breach
count *by reason* tells you whether to hire technicians or buy more spare batteries.

**A single-writer test.** One `node:test` that greps the codebase and fails if anything except
`supportTicketStateService.js` writes ticket status. This is what stops the current bug — three
copies of the close logic, one with a dead ternary — from ever coming back.

**A demo seed script.** `node scripts/seed-support-demo.js --reset` builds a full working dataset so
each phase can be verified without touching production data. It refuses to run without
`ALLOW_DEMO_SEED=true`.

---

## One thing I would think about before Phase 0

The plan adds two roles, `support_agent` and `support_manager`. Your current setup has
`support_lead` and `support_tech` only, which means today every agent is effectively a lead.
Splitting them is what makes the 20-section access matrix useful — an L1 agent who can raise and
classify but not assign field jobs or approve charges.

If you would rather not add roles, the matrix still works: grant sections per user instead of per
role. But you will be doing that by hand for every new joiner.
