# Phase 02 report — Core object model, backfill, read API

Branch: `support-revamp/phase-02`  
Depends on: Phase 00 + 01 (still on this branch; not committed).  
Legacy `/support/*` and `supportController.js` were not edited.

Migrations are **not** applied from this machine. Apply 201–203 on Docker with the rest of the phases, then run the backfill.

## Migration numbers

The prompt asked for `196` / `197` / `198`. Those numbers (and 199–200) are already used.

| File | Purpose |
|---|---|
| `backend/migrations/201_support_v2_core.sql` | Tickets, assets, WOs, steps, events, attachments, migration review |
| `backend/migrations/202_support_v2_groups.sql` | Zones, groups, skills, shifts, leaves, approvals, technician `user_id` link |
| `backend/migrations/203_support_v2_billing_hooks.sql` | Holds, extra invoice lines, buffer stock, vendor claims — tables only |

`SUPPORT_REVAMP_PLAN.md` §21 is not in the repo. Columns were reconstructed from Phases 03–11 (CSAT, `replacement_group_id`, `linked_wo_id`, approval types, `waive_rent`, `billed_in_invoice_id`, `evidence_urls`).

## Model

- Ticket statuses: `NEW|TRIAGED|ASSIGNED|IN_PROGRESS|PENDING|RESOLVED|CLOSED|CANCELLED`
- WO types: all 8, each with checkpoint rows in `support_work_order_type_config`
- WO statuses and step kinds have CHECK constraints
- Asset lines require reported type / subtype / issue (`NOT NULL`)
- Legacy columns: `legacy_ticket_id`, `legacy_ticket_number`, `migration_confidence` on tickets; `legacy_item_id`, `migration_rule` on WOs
- `support_migration_review` gates LOW-confidence pickup apply

## Identity (D21/D22)

`delivery_technicians.user_id` already existed (migration 048). 202 re-links unmatched rows by email, then by `users.mobile_no` (not `phone`). Unique index `uq_delivery_tech_user`. `delivery_challan_lines.delivery_person_id` is untouched.

`supportIdentityService.js` is the resolver both old and new code should call.

## Single writer

`supportTicketStateService.computeTicketStatus` is the only `UPDATE support_tickets_v2 SET status`. Enforced by `test/support-single-writer.test.js` (Node file walk — no `grep` on Windows).

Migrate **inserts** status; it does not update it.

## Backfill

```bash
cd backend
node scripts/migrate-support-to-v2.js --dry-run   # writes docs/support-revamp/MIGRATION_RECONCILIATION.md
node scripts/review-migration-lows.js --list
node scripts/review-migration-lows.js --item <id> --decision repair|return
node scripts/migrate-support-to-v2.js --apply     # one transaction per new ticket; no-op on legacy_ticket_id
```

Pickup type uses the 7-rule table. Never `source_item_id ? 'repair' : 'return'`. Replacement collect legs resolve as `RETURN_PICKUP` via rule 3.

Open tickets get an SLA clock from `NOW()` and event `SLA_CLOCK_RESET_ON_MIGRATION`. CLOSED/CANCELLED get no due dates.

## Read API

| Method | Path | Permission |
|---|---|---|
| GET | `/api/support/v2/tickets` | `support_tickets · view` |
| GET | `/api/support/v2/tickets/:id` | `support_tickets · view` |
| GET | `/api/support/v2/work-orders` | `support_work_orders · view` |
| GET | `/api/support/v2/events/:ticketId` | `support_tickets · view` |

List default order: breached first, then priority ASC, due ASC NULLS LAST, created ASC. Detail is one aggregate: ticket, asset lines with nested WOs+steps, events, attachments, approvals, costs.

## Demo seed

`ALLOW_DEMO_SEED=true node scripts/seed-support-demo.js [--reset]`

4 demo users assigned to groups, skills on the tech, 25 tickets covering every status / priority / WO type, plus one breached, one paused, one repeat asset, one chargeable-awaiting-approval. `--reset` deletes demo tickets/WOs/events/approvals before re-seeding.

## How to check (after Docker migrations)

```bash
cd backend
node scripts/run-all-migrations.js
npm test
node scripts/migrate-support-to-v2.js --dry-run
cd ../frontend && npm run build
```
