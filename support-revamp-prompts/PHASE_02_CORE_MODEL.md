# PHASE 2 — Core object model, backfill and reconciliation

> Read `00_MASTER_CONTEXT.md` first.
> **Screens:** none. This phase is data model + migration + a read-only reconciliation report.
> **Depends on:** Phase 1.
> **This is the highest-risk phase.** Take a database snapshot before running anything.

---

## 2.1 Migration `196_support_v2_core.sql`

Create, with the exact DDL from **PLAN §21**:

- `support_tickets_v2`
- `support_ticket_assets`
- `support_work_orders`
- `support_work_order_assets`
- `support_work_order_type_config`
- `support_work_order_steps`
- `support_work_order_actions`
- `support_ticket_events`
- `support_attachments`

Additions to the plan's DDL that you must include:

```sql
ALTER TABLE support_tickets_v2
  ADD COLUMN IF NOT EXISTS legacy_ticket_id     INT,
  ADD COLUMN IF NOT EXISTS legacy_ticket_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS migration_confidence VARCHAR(10)
      CHECK (migration_confidence IS NULL OR migration_confidence IN ('HIGH','MEDIUM','LOW')),
  ADD COLUMN IF NOT EXISTS demo_seed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_stk2_legacy ON support_tickets_v2(legacy_ticket_id);

ALTER TABLE support_work_orders
  ADD COLUMN IF NOT EXISTS legacy_item_id       INT,
  ADD COLUMN IF NOT EXISTS migration_confidence VARCHAR(10),
  ADD COLUMN IF NOT EXISTS migration_rule       VARCHAR(40),
  ADD COLUMN IF NOT EXISTS demo_seed BOOLEAN NOT NULL DEFAULT FALSE;
```

`legacy_ticket_number` matters operationally: a customer will ring up quoting an old number. Global
search must find the ticket by either number.

### Seed `support_work_order_type_config`
The checkpoint definitions from **PLAN §10.2**. One row per step per type, in order. Example:

```sql
INSERT INTO support_work_order_type_config (wo_type, step_code, step_label, step_kind, is_mandatory, min_count, sort_order) VALUES
  ('REPAIR_PICKUP','DOC_GENERATED','Return DC generated','CONFIRM',  true, 1, 10),
  ('REPAIR_PICKUP','ON_SITE_GPS','Arrived on site','GPS',            true, 1, 20),
  ('REPAIR_PICKUP','SERIAL_SCAN','Scan machine serial','SCAN',       true, 1, 30),
  ('REPAIR_PICKUP','ACCESSORIES','Accessories checklist','CHECKLIST',true, 1, 40),
  ('REPAIR_PICKUP','PHOTO_CONDITION','Condition photos','PHOTO',     true, 4, 50),
  ('REPAIR_PICKUP','DIAGNOSIS','Diagnosis on site','FORM',           true, 1, 60),
  ('REPAIR_PICKUP','CUSTOMER_OTP','Customer OTP','OTP',              true, 1, 70),
  ('REPAIR_PICKUP','TECH_ESIGN','Technician signature','SIGNATURE',  true, 1, 80),
  ('REPAIR_PICKUP','WH_RECEIPT','Warehouse receipt scan','SCAN',     false,1, 90)
ON CONFLICT (wo_type, step_code) DO UPDATE
  SET step_label = EXCLUDED.step_label, step_kind = EXCLUDED.step_kind,
      is_mandatory = EXCLUDED.is_mandatory, min_count = EXCLUDED.min_count,
      sort_order = EXCLUDED.sort_order;
```
Do this for all eight types.

---

## 2.2 Migration `197_support_v2_groups.sql`

`support_assignment_groups`, `support_group_members`, `support_zones`, `support_zone_pincodes`,
`support_skills`, `user_skills`, `user_shifts`, `user_leaves`, `support_approvals`
(DDL in PLAN §21).

Seed:
- Skills: `FIELD_SWAP, SOFTWARE_L1, SOFTWARE_L2, HARDWARE_BASIC, CHIP_LEVEL, NETWORK, DATA_MIGRATION`
- Zones + pincode ranges for NCR, Bengaluru, Mumbai, Pune, Hyderabad, Kolkata, Chennai
- Groups: `NCR Field`, `Bengaluru Field`, `Mumbai Field`, `Pune Field`, `Hyderabad Field`,
  `Remote L1`, `Remote L2`, `Warehouse Gurugram`, `Chip-level Repair`
- Default shift for every existing `support_tech` user: Mon–Sat 09:30–18:30, `max_jobs_per_day = 6`

### The identity fix (PLAN D21/D22)
```sql
-- delivery_technicians becomes a PROFILE of a user, not a parallel identity.
ALTER TABLE delivery_technicians ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(user_id);

-- Best-effort link by email, then by phone. Report anything unmatched.
UPDATE delivery_technicians dt SET user_id = u.user_id
  FROM users u WHERE dt.user_id IS NULL AND lower(dt.email) = lower(u.email);
UPDATE delivery_technicians dt SET user_id = u.user_id
  FROM users u WHERE dt.user_id IS NULL
    AND regexp_replace(dt.phone,'\D','','g') = regexp_replace(u.phone,'\D','','g')
    AND length(regexp_replace(dt.phone,'\D','','g')) >= 10;

CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_tech_user
  ON delivery_technicians(user_id) WHERE user_id IS NOT NULL;
```
**Do not delete or repoint `delivery_challan_lines.delivery_person_id` in this phase.** Add a
resolver service instead so both old and new code agree:

`backend/services/supportIdentityService.js`
```js
'use strict';
/** Single source of truth for "who is this technician". Fixes D22. */
async function resolveTechnicianUserId(db, { userId, technicianId }) { … }
async function resolveTechnicianIds(db, userId) { … }  // → { user_id, technician_id }
module.exports = { resolveTechnicianUserId, resolveTechnicianIds };
```

---

## 2.3 Migration `198_support_v2_billing_hooks.sql`

`asset_billing_holds`, `customer_invoice_extra_lines`, `customer_buffer_stock`,
`vendor_warranty_claims` (DDL in PLAN §21).

**Do not wire these into the billing cron yet.** Phase 5 starts writing holds; Phase 11 changes
`billingSchedulerService.js` to read them. Creating the tables now means Phase 5 has somewhere to write.

---

## 2.4 The backfill — `backend/scripts/migrate-support-to-v2.js`

This is the piece that must not get it wrong. It runs in two modes:

```bash
node scripts/migrate-support-to-v2.js --dry-run     # writes nothing, produces the report
node scripts/migrate-support-to-v2.js --apply       # writes, inside one transaction per ticket
```

### Mapping rules

| Legacy | New |
|---|---|
| `support_tickets` where `ticket_category='complaint'` | `support_tickets_v2`, `ticket_class='INCIDENT'`, `channel='PHONE'` (flag as inferred) |
| `support_tickets` where `ticket_category='pickup'` **and** its items chain via `source_item_id` to a complaint ticket | **merged into that complaint** as work orders — no new ticket |
| orphan `ticket_category='pickup'` | new `REQUEST` ticket, classification `LOG-RET-*`, one `RETURN_PICKUP` WO |
| `support_tickets` where `ticket_category='replacement'` | merged into parent if one exists, else a new `REQUEST` ticket; `support_replacement_orders` → paired WOs sharing a generated `replacement_group_id` |
| `support_ticket_items` `item_type='complaint'` | `support_ticket_assets` |
| `support_ticket_items` `item_type='pickup'` | `support_work_orders` — type resolved by the decision table below |
| `support_ticket_items` `item_type='replacement'` | `REPLACEMENT_DELIVERY` WO |
| `support_issue_categories` (7 rows) | mapped to level-2 subtypes; level-3 set to the `*-UNS` placeholder |
| `support_ticket_item_audit` + `support_ticket_item_comments` | `support_ticket_events` |

### Legacy issue-category mapping (exact)
```
'Hardware / performance'        → HW-MBD  (Unspecified)
'Display / keyboard / touchpad' → HW-DIS  (Unspecified)
'Battery / charging'            → HW-BAT  (Unspecified)
'Software / OS'                 → SW-OS   (Unspecified)
'Network / Wi-Fi'               → NET-WIF (Unspecified)
'Pickup / return logistics'     → LOG-RET (Unspecified)
'Other' / NULL                  → SVC-OTH (Unspecified)
```

### Resolving `pickup_type` — the decision table
The legacy heuristic is broken (PLAN D3, D4, D5). Apply these rules **in order**, stop at the first
match, and record which rule fired in `support_work_orders.migration_rule`:

| # | Rule | Result | Confidence |
|---|---|---|---|
| 1 | The item has a `service_dc_number` | `REPAIR_PICKUP` | HIGH — the unit demonstrably went back to the same customer |
| 2 | A `customer_credit_notes` row exists for this customer/serial dated within 7 days of the pickup | `RETURN_PICKUP` | HIGH — a credit note is only raised on a real return |
| 3 | The item is referenced by a `support_replacement_orders` row (`pickup_item_id`) | `RETURN_PICKUP` | HIGH — replacement collect leg |
| 4 | `pickup_type` is explicitly `'repair'` or `'return'` | that value | MEDIUM |
| 5 | The item's status history ever reached `awaiting_service_return` | `REPAIR_PICKUP` | MEDIUM |
| 6 | The serial's current `inventory_status` is `returned` or `in_stock` and it is not assigned to that customer | `RETURN_PICKUP` | LOW |
| 7 | Fallback | `RETURN_PICKUP` | LOW |

Never use the legacy `source_item_id ? 'repair' : 'return'` expression. It is wrong for
replacements, which is exactly how the bug got in.

### Legacy status → new status

`support_ticket_items.status` → `support_work_orders.status`:
```
pending_dispatch          → PENDING_ASSIGNMENT
assigned                  → ASSIGNED
in_transit                → EN_ROUTE
visited                   → ON_SITE
work_done                 → IN_PROGRESS
awaiting_otp              → IN_PROGRESS
picked_up                 → COMPLETED   + step CUSTOMER_OTP = DONE
awaiting_service_return   → COMPLETED   + a follow-on SERVICE_RETURN WO in PENDING_ASSIGNMENT
returned / inventory_updated → COMPLETED
repair_failed             → FAILED      (failure_reason = 'LEGACY_REPAIR_FAILED')
swap_initiated            → COMPLETED   + linked replacement group
resolved / closed         → COMPLETED
cancelled                 → CANCELLED
open                      → DRAFT
```

`support_tickets.status` → `support_tickets_v2.status`:
```
open        → NEW        (if no item assigned) else ASSIGNED
in_progress → IN_PROGRESS
closed      → CLOSED
cancelled   → CANCELLED
```

### Priority and SLA on migrated tickets
- Impact/urgency are unknown for historical data. Set `impact=2, urgency=2` and derive priority
  through `computePriority`, then **overwrite** with the legacy `priority` string if it was
  meaningful (`urgent`→1, `high`→2, `normal`→3, `low`→4) and set `priority_overridden = true`,
  `priority_override_reason = 'MIGRATED'`.
- **Do not compute SLA due dates for CLOSED or CANCELLED tickets.** Leave them NULL. Only open
  tickets get a live clock, and their clock starts from `NOW()`, not from their original creation
  date — otherwise every migrated ticket appears breached on day one. Record
  `support_ticket_events` row `SLA_CLOCK_RESET_ON_MIGRATION`.

### The reconciliation report
`--dry-run` writes `docs/support-revamp/MIGRATION_RECONCILIATION.md`:

```markdown
# Support v2 migration — reconciliation

## Counts
| Legacy | Count | New | Count | Match |
|---|---|---|---|---|
| support_tickets (all)        | 4,182 | support_tickets_v2 | 3,914 | merged 268 pickups into parents |
| support_ticket_items         | 9,077 | assets + work orders | 4,201 + 4,876 | ✓ |
| support_replacement_orders   | 312   | replacement WO pairs | 312 | ✓ |

## Pickup type resolution
| Rule | Fired | Confidence |
|---|---|---|
| 1 · has service_dc_number      | 1,204 | HIGH |
| 2 · credit note within 7 days  | 2,011 | HIGH |
| … |

## Needs human review (LOW confidence) — 87 rows
| Legacy item | Ticket | Customer | Serial | Assigned type | Why |
```

**Rule: `--apply` refuses to run if any LOW-confidence row is unreviewed.** Add a
`migration_review` table with `legacy_item_id, decision, decided_by, decided_at`, and a tiny
review script `node scripts/review-migration-lows.js` that prints each row and accepts
`repair`/`return`. That forces a human to look at 87 rows once, instead of discovering the error
six months later.

---

## 2.5 Backend — the single derivation functions

Create `backend/services/supportTicketStateService.js`. These are the functions that replace the
three duplicated close-logic implementations and the dead ternary (PLAN D6, D7).

```js
'use strict';

/** THE ONLY function permitted to write support_tickets_v2.status. */
async function computeTicketStatus(client, ticketId) {
  // 1. load ticket, all asset lines, all work orders
  // 2. if ticket.status === 'CANCELLED' → return unchanged (terminal)
  // 3. if every line is terminal AND every WO is COMPLETED|CANCELLED → RESOLVED
  //    (only if every line has resolution_code_id, root_cause_id and liability — otherwise
  //     leave IN_PROGRESS and return a `blockers` array explaining what is missing)
  // 4. else if an explicit pending_reason is set → PENDING
  // 5. else if any WO is ASSIGNED..IN_PROGRESS → IN_PROGRESS
  // 6. else if assigned_to is set → ASSIGNED
  // 7. else if every line is classified → TRIAGED
  // 8. else NEW
  // Persist only if changed, and write a STATUS_CHANGED event when it does.
  return { status, changed, blockers };
}

/** THE ONLY function permitted to write support_ticket_assets.line_status. */
async function computeAssetLineStatus(client, lineId) { … }

/** Append to the single event stream. Every mutation calls this. */
async function logEvent(client, { ticketId, lineId, woId, eventType, actorId, actorKind = 'USER',
                                  summary, detail, isCustomerVisible = false }) { … }

module.exports = { computeTicketStatus, computeAssetLineStatus, logEvent };
```

**Enforcement:** add a test that greps the codebase for `UPDATE support_tickets_v2` and fails if the
string `SET status` appears anywhere except `supportTicketStateService.js`.

```js
// backend/test/support-single-writer.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');

test('only supportTicketStateService writes ticket status', () => {
  const out = execSync(
    `grep -rn "UPDATE support_tickets_v2" --include=*.js controllers services scripts || true`
  ).toString();
  const offenders = out.split('\n')
    .filter(Boolean)
    .filter(l => /SET[\s\S]*status/i.test(l))
    .filter(l => !l.includes('supportTicketStateService.js'));
  assert.deepStrictEqual(offenders, [], `Direct status writes found:\n${offenders.join('\n')}`);
});
```
This one test prevents the exact class of bug that produced D6 and D7.

---

## 2.6 Backend — read API (no UI yet)

`routes/supportV2.js` gains:
```
GET /tickets            cp('support_tickets','view')   paginated list, server-sorted
GET /tickets/:id        cp('support_tickets','view')   full aggregate
GET /work-orders        cp('support_work_orders','view')
GET /events/:ticketId   cp('support_tickets','view')
```

`GET /tickets` **must** implement server-side sorting and the default order:
```sql
ORDER BY
  CASE WHEN t.sla_resolution_due_at < NOW() AND t.status NOT IN ('RESOLVED','CLOSED','CANCELLED')
       THEN 0 ELSE 1 END,
  t.priority ASC,
  t.sla_resolution_due_at ASC NULLS LAST,
  t.created_at ASC
```

`GET /tickets/:id` returns one aggregate — the UI must never need a second call to render the page:
```json
{ "success": true, "ticket": {…},
  "asset_lines": [ { …, "work_orders": [ { …, "steps": [] } ] } ],
  "events": [], "attachments": [], "approvals": [], "costs": {…} }
```

---

## 2.7 Extend the demo seed
Add: zones, groups, skills, shifts, 4 support users assigned to groups, and 25 demo tickets across
every status/priority/WO type — including one breached, one paused, one repeat asset, one
chargeable-awaiting-approval. All rows `demo_seed = true`.

---

## VERIFICATION CHECKLIST — Phase 2

**Before you start**
- [ ] `pg_dump` snapshot taken and restorable

**Schema**
- [ ] Migrations 196–198 apply cleanly on a fresh DB **and** on a restored production copy
- [ ] Every status column has a `CHECK` constraint — verify with:
      `SELECT conrelid::regclass, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid::regclass::text LIKE 'support_%' AND contype='c';`
- [ ] `support_work_order_type_config` has rows for all 8 types

**Backfill**
- [ ] `--dry-run` completes and writes `MIGRATION_RECONCILIATION.md`
- [ ] Counts reconcile: every legacy ticket is either migrated or explicitly merged, none dropped
- [ ] The pickup-type table shows rules 1–3 (HIGH) covering the large majority
- [ ] `--apply` **refuses** to run while LOW rows are unreviewed
- [ ] After review, `--apply` runs; re-running it is a no-op (idempotent on `legacy_ticket_id`)
- [ ] Spot-check 10 tickets by hand against the old UI — same customer, same machines, same
      documents, same outcome
- [ ] **Specifically check a replacement:** its collect leg is `RETURN_PICKUP`, not `REPAIR_PICKUP`
- [ ] No migrated CLOSED ticket has an SLA due date
- [ ] No migrated open ticket shows as breached immediately

**Single-writer rule**
- [ ] `support-single-writer.test.js` passes
- [ ] Deliberately add `UPDATE support_tickets_v2 SET status='X'` in a scratch controller → the test
      fails. Remove it.

**API**
- [ ] `GET /tickets` default order puts breached first, then P1, then earliest due
- [ ] `GET /tickets?page=2` returns a genuinely different page and the order is stable across pages
- [ ] `GET /tickets/:id` renders everything in one call
- [ ] A user without `support_tickets · view` gets 403 on all four endpoints

**Build**
- [ ] `npm test` green · `npm run build` clean · phase report written, including the reconciliation table
