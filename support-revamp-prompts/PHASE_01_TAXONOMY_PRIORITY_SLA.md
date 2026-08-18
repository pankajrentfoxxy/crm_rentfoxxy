# PHASE 1 — Taxonomy, priority engine, SLA policies

> Read `00_MASTER_CONTEXT.md` first.
> **Screens:** S18 (Issue taxonomy admin), S17 (SLA policy table — the lower half only; the breach
> register comes in Phase 10).
> **Depends on:** Phase 0.
> **Why first:** every ticket created from Phase 4 onward needs a classification, a computed
> priority and an SLA due date. Building this now means no rework later.

---

## 1.1 Migration `194_support_v2_taxonomy.sql`

Create the four code tables from PLAN §21. Then **seed the entire catalogue** from PLAN §5.3 —
all 7 types, 41 subtypes, and every issue type listed. Do not abbreviate the seed. Where the plan
lists issue types separated by `·`, each one becomes a row.

```sql
CREATE TABLE IF NOT EXISTS support_issue_catalog (
  catalog_id         SERIAL PRIMARY KEY,
  parent_id          INT REFERENCES support_issue_catalog(catalog_id),
  level              SMALLINT NOT NULL CHECK (level IN (1,2,3)),
  code               VARCHAR(24) NOT NULL UNIQUE,
  name               VARCHAR(120) NOT NULL,
  applies_to_class   VARCHAR(10) NOT NULL DEFAULT 'BOTH'
                       CHECK (applies_to_class IN ('INCIDENT','REQUEST','BOTH')),
  default_impact     SMALLINT CHECK (default_impact IN (1,2,3)),
  default_urgency    SMALLINT CHECK (default_urgency IN (1,2,3)),
  default_wo_type    VARCHAR(30)
                       CHECK (default_wo_type IS NULL OR default_wo_type IN
                         ('FIELD_VISIT','REPAIR_PICKUP','RETURN_PICKUP','SERVICE_RETURN',
                          'REPLACEMENT_DELIVERY','PART_DELIVERY','PART_RETURN','REMOTE_FIX')),
  is_safety          BOOLEAN NOT NULL DEFAULT FALSE,
  requires_photo     BOOLEAN NOT NULL DEFAULT FALSE,
  chargeable_default BOOLEAN NOT NULL DEFAULT FALSE,
  skill_required     VARCHAR(30),
  kb_article_id      INT,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order         INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issue_catalog_parent ON support_issue_catalog(parent_id);
CREATE INDEX IF NOT EXISTS idx_issue_catalog_level  ON support_issue_catalog(level) WHERE active;
```

Plus `support_resolution_codes`, `support_root_causes`, `support_action_codes` — exact DDL is in
PLAN §21. Seed them from PLAN §6.1 / §6.3 / §6.2.

### Seeding pattern (idempotent, parent resolved by code)
```sql
-- Level 1
INSERT INTO support_issue_catalog (level, code, name, applies_to_class, sort_order) VALUES
  (1,'HW','Hardware','INCIDENT',10),
  (1,'SW','Software / OS','INCIDENT',20),
  (1,'PER','Peripherals & Accessories','INCIDENT',30),
  (1,'NET','Network & Connectivity','INCIDENT',40),
  (1,'LOG','Logistics / Asset Movement','REQUEST',50),
  (1,'COM','Commercial / Billing','REQUEST',60),
  (1,'SVC','Service Quality / Other','BOTH',70)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, applies_to_class = EXCLUDED.applies_to_class;

-- Level 2 — parent looked up by code so re-runs are safe
INSERT INTO support_issue_catalog (parent_id, level, code, name, default_impact, default_urgency,
                                   default_wo_type, skill_required, sort_order)
SELECT p.catalog_id, 2, v.code, v.name, v.imp, v.urg, v.wo, v.skill, v.so
FROM (VALUES
  ('HW','HW-DIS','Display',                    2,2,'FIELD_VISIT','HARDWARE_BASIC',10),
  ('HW','HW-KBD','Keyboard & Trackpad',        2,2,'FIELD_VISIT','HARDWARE_BASIC',20),
  ('HW','HW-BAT','Battery & Charging',         2,1,'PART_DELIVERY','HARDWARE_BASIC',30),
  ('HW','HW-STO','Storage',                    2,2,'FIELD_VISIT','HARDWARE_BASIC',40),
  ('HW','HW-MEM','Memory (RAM)',               2,2,'PART_DELIVERY','HARDWARE_BASIC',50),
  ('HW','HW-MBD','Motherboard / Chip level',   1,1,'REPAIR_PICKUP','CHIP_LEVEL',60),
  ('HW','HW-THM','Thermal',                    2,2,'REPAIR_PICKUP','HARDWARE_BASIC',70),
  ('HW','HW-BDY','Body & Physical',            3,3,'REPAIR_PICKUP','HARDWARE_BASIC',80),
  ('HW','HW-AUD','Audio',                      3,3,'FIELD_VISIT','HARDWARE_BASIC',90),
  ('HW','HW-PRT','Ports & Connectivity',       3,2,'FIELD_VISIT','HARDWARE_BASIC',100),
  ('HW','HW-CAM','Camera',                     3,3,'FIELD_VISIT','HARDWARE_BASIC',110),
  ('HW','HW-BOO','Boot / POST',                1,1,'REPAIR_PICKUP','HARDWARE_BASIC',120)
  -- … all remaining subtypes from PLAN §5.3
) AS v(parent_code, code, name, imp, urg, wo, skill, so)
JOIN support_issue_catalog p ON p.code = v.parent_code AND p.level = 1
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, default_impact = EXCLUDED.default_impact,
  default_urgency = EXCLUDED.default_urgency, default_wo_type = EXCLUDED.default_wo_type,
  skill_required = EXCLUDED.skill_required, sort_order = EXCLUDED.sort_order;
```

Level 3 follows the identical pattern, joining on `p.level = 2`. Codes are
`<SUBTYPE>-<3 letters>`, e.g. `HW-DIS-CRK` for "Cracked panel".

**Safety issues** — set `is_safety = true` on exactly these: `Battery swollen`, `Burning smell`,
`Liquid damage`, `Cable frayed`, `Ransomware`, `Damaged in transit`.

**`chargeable_default = true`** on: `Cracked panel`, `Body crack`, `Hinge broken`,
`Screen bezel damaged`, `Liquid spill on keyboard`, `Lost by customer` (adapter/mouse/bag),
`Power surge` related issues.

**`requires_photo = true`** on every issue under `HW-BDY`, `HW-DIS`, and anything
`chargeable_default = true`.

### `SVC-OTH` placeholder rule
Under every level-2 subtype also insert a level-3 row `<SUBTYPE>-UNS` named "Unspecified", with
`active = false`. Phase 2's backfill maps legacy tickets to these so historical rows satisfy the
`NOT NULL` classification without polluting the pick-lists.

---

## 1.2 Migration `195_support_v2_sla.sql`

Create `support_business_calendars`, `support_calendar_hours`, `support_holidays`,
`support_sla_policies`, `support_sla_pauses` (DDL in PLAN §21).

Seed:
- Calendar `BUSINESS_MON_SAT` — days 1–6, 09:30–18:30, `Asia/Kolkata`
- Calendar `ALWAYS_ON` — days 0–6, 00:00–23:59
- Indian public holidays for FY 26-27 on `BUSINESS_MON_SAT` (26 Jan, 15 Aug, 2 Oct, Holi, Diwali,
  and the company's own list — add a comment telling the operator to review)
- The four default SLA policies from PLAN §8.2 with `specificity = 0`
- One example tier policy `Platinum — High` with `support_tier='PLATINUM'`, `specificity = 10`

Also add the customer tier column if it does not exist:
```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS support_tier VARCHAR(20)
  CHECK (support_tier IS NULL OR support_tier IN ('PLATINUM','GOLD','SILVER','STANDARD'));
UPDATE customers SET support_tier = 'STANDARD' WHERE support_tier IS NULL;
```

---

## 1.3 Backend — `services/supportPriorityService.js`

This is a pure module with no DB writes. It must be unit-testable.

```js
'use strict';

const MATRIX = {           // [impact][urgency] → priority
  1: { 1: 1, 2: 2, 3: 3 },
  2: { 1: 2, 2: 3, 3: 4 },
  3: { 1: 3, 2: 4, 3: 4 },
};

/**
 * @param {object} p
 * @param {1|2|3} p.impact
 * @param {1|2|3} p.urgency
 * @param {string} [p.supportTier]      PLATINUM | GOLD | SILVER | STANDARD
 * @param {boolean} [p.isSafety]
 * @param {boolean} [p.isRepeat]
 * @param {boolean} [p.isReopen]
 * @param {boolean} [p.contactIsVip]
 * @param {boolean} [p.isSlaComplaint]  issue type is SVC-SLA
 * @param {number}  [p.fleetSize]
 * @param {number}  [p.affectedUnits]
 * @returns {{ priority:number, reasons:string[] }}
 */
function computePriority(p) {
  const reasons = [];
  let priority = MATRIX[p.impact]?.[p.urgency];
  if (!priority) throw Object.assign(new Error('Invalid impact/urgency'), { status: 400 });
  reasons.push(`Impact ${p.impact} × Urgency ${p.urgency} → P${priority}`);

  const bump = (label) => {
    if (priority > 1) { priority -= 1; reasons.push(`${label}: −1 → P${priority}`); }
    else reasons.push(`${label}: already P1`);
  };

  if (p.supportTier === 'PLATINUM') bump('Platinum customer');
  else if (p.supportTier === 'GOLD' && priority >= 3) bump('Gold customer');
  if (p.isRepeat) bump('Repeat complaint');
  if (p.isReopen) bump('Reopened ticket');
  if (p.contactIsVip) bump('VIP contact');

  if (p.isSafety)       { priority = 1; reasons.push('Safety issue: forced P1'); }
  if (p.isSlaComplaint) { priority = 1; reasons.push('SLA breach complaint: forced P1'); }
  if ((p.fleetSize || 0) >= 200 && (p.affectedUnits || 0) >= 10) {
    priority = 1; reasons.push('Large fleet, ≥10 units affected: forced P1');
  }
  return { priority, reasons };
}

module.exports = { computePriority, MATRIX };
```

**Order matters and is deliberate:** modifiers first, hard overrides last, so a safety issue is
always P1 regardless of tier.

---

## 1.4 Backend — `services/supportSlaService.js`

The hard part is the business calendar. Implement carefully and test it.

```js
'use strict';
const pool = require('../config/db');

/** Pick the most specific policy: customer > tier > default. */
async function resolvePolicy(db, { customerId, supportTier, ticketClass, priority }) { … }

/**
 * Add `minutes` of BUSINESS time to `from`, honouring calendar hours + holidays.
 * Returns a Date.
 */
async function addBusinessMinutes(db, calendarId, from, minutes) { … }

/** Business minutes elapsed between two instants (used for pause accounting). */
async function businessMinutesBetween(db, calendarId, a, b) { … }

/** Compute and persist both due dates on a ticket. Call on create and on every priority change. */
async function recalcTicketSla(db, ticketId) { … }

/** Pause / resume — writes support_sla_pauses and updates sla_paused_minutes. */
async function pauseSla(db, ticketId, reason, userId, note) { … }
async function resumeSla(db, ticketId, userId) { … }

module.exports = { resolvePolicy, addBusinessMinutes, businessMinutesBetween,
                   recalcTicketSla, pauseSla, resumeSla };
```

### Rules that must be implemented exactly
1. A policy with `calendar = ALWAYS_ON` (P1) uses wall-clock minutes — no calendar walk.
2. `addBusinessMinutes` starts from the next open moment if `from` is outside business hours.
3. Holidays on the calendar are skipped entirely.
4. **Pause behaviour** — only these reasons pause the resolution clock:
   `PENDING_CUSTOMER`, `PENDING_VENDOR`, and `PENDING_APPROVAL` **only when the approval is
   customer-side** (a boolean `customer_side` on the pause row).
   `PENDING_PART` and `PENDING_WAREHOUSE` **do not pause**. This is intentional — see PLAN §8.3.
5. Resuming adds the elapsed business minutes to `sla_paused_minutes` and pushes
   `sla_resolution_due_at` forward by the same amount.
6. The response clock **never** pauses.

### Unit tests — required, `backend/test/support-sla.test.js`
- P2 raised Saturday 18:00 → due Monday 18:30 (Sunday skipped)
- P1 raised Saturday 18:00 → due Sunday 02:00 (24×7)
- P3 raised the day before a holiday → holiday skipped
- Pause for 3 business hours pushes the due date exactly 3 business hours
- `PENDING_PART` does **not** move the due date

---

## 1.5 Backend — routes and controllers

### `routes/supportTaxonomy.js` → mounted at `/api/support/v2/taxonomy`
```
GET    /catalog                 ?level=&parent_id=&class=&active=      cp('support_taxonomy','view')
GET    /catalog/search          ?q=      returns level-3 rows with full parent chain
GET    /catalog/tree            full nested tree for the admin screen
POST   /catalog                 cp('support_taxonomy','create')
PATCH  /catalog/:id             cp('support_taxonomy','edit')
DELETE /catalog/:id             cp('support_taxonomy','delete')   → soft delete (active=false)
GET    /resolution-codes        cp('support_taxonomy','view')
GET    /root-causes
GET    /action-codes
```

`GET /catalog/search?q=cracked` must return:
```json
{ "success": true, "rows": [
  { "catalog_id": 148, "code": "HW-DIS-CRK", "name": "Cracked panel",
    "type": { "catalog_id": 1, "code": "HW", "name": "Hardware" },
    "subtype": { "catalog_id": 12, "code": "HW-DIS", "name": "Display" },
    "default_impact": 2, "default_urgency": 2, "default_wo_type": "REPAIR_PICKUP",
    "chargeable_default": true, "requires_photo": true, "is_safety": false,
    "skill_required": "HARDWARE_BASIC", "kb_article_id": 91 }
] }
```
Search matches on the name of **any** of the three levels, so typing "hardware" returns all
level-3 rows under Hardware. Use a single recursive CTE, not three queries.

### `routes/supportSla.js` → `/api/support/v2/sla`
```
GET   /policies                cp('support_sla_admin','view')
POST  /policies                cp('support_sla_admin','create')
PATCH /policies/:id            cp('support_sla_admin','edit')
GET   /calendars
POST  /calendars/:id/holidays  cp('support_sla_admin','edit')
POST  /preview                 cp('support_sla_admin','view')
        body: { customer_id, ticket_class, impact, urgency }
        →     { priority, reasons[], policy, response_due_at, resolution_due_at, calendar }
```
`POST /preview` is what the create-ticket wizard calls in Phase 4 to show the SLA promise before
submitting. Build it now and it makes Phase 4 trivial.

---

## 1.6 Frontend — S18 Issue taxonomy admin

`features/support-v2/pages/TaxonomyAdminPage.jsx` — match the mockup screen S18 exactly:
two-column layout, tree on the left (1.3fr), detail panel on the right (1fr).

**Left — the tree.** Port the `.tree`, `.n1`, `.n2`, `.n3` markup from the mockup:
- Level 1 rows: `bg-sup-canvas rounded-md px-2.5 py-1.5 font-semibold` with a chevron and the code as a `TypeTag`
- Level 2: indented 30px, bottom border, shows the code, badges for `is_safety` / `skill_required`, and an issue count
- Level 3: indented 52px, `text-sup-muted`, hover `bg-sup-canvas`; selected row `bg-sup-accentSoft text-sup-accent font-semibold`
- Chargeable-by-default level-3 rows show a `<Badge tone="amber">Chargeable by default</Badge>`
- Search box at the top filters the tree and auto-expands matches

**Right — the detail panel** for the selected node: impact, urgency, default work order type,
skill required, linked KB article, and four toggles (chargeable by default / photos mandatory /
safety issue / active). Below a divider, a read-only "Last 90 days" block — reported count,
confirmed-on-inspection %, average resolution, amount recovered. In Phase 1 these can return zeros
from a stub endpoint; Phase 11 wires them to real data.

**Guarding:** the whole page is `support_taxonomy · view`. Every input is `disabled` unless
`canEdit('support_taxonomy')`. The "＋ Add issue type" button only renders under
`<PermissionGate section="support_taxonomy" action="create">`.

---

## 1.7 Frontend — S17 SLA policies (lower half)

`features/support-v2/pages/SlaAdminPage.jsx`. In Phase 1 build **only** the policies table and the
calendar/holiday editor. The KPI tiles and breach register at the top of S17 come in Phase 10 —
leave a `<Placeholder>` block above the table so the layout is already right.

Policies table columns exactly as the mockup: Policy · Applies to · Priority (`PriorityChip`) ·
Calendar · Response · Resolution · Edit. Rows whose `customer_id` or `support_tier` is set get
`bg-sup-accentSoft` and a `<Badge tone="blue">Contractual</Badge>`.

Add a note row under the table (the mockup's design-note styling is fine as a plain hint):
"Most specific match wins — customer beats tier beats default."

---

## 1.8 Extend the demo seed
`seed-support-demo.js` gains: customer tiers (one PLATINUM, one GOLD, rest STANDARD), and a
verification print-out of the resolved SLA for a sample P1/P2/P3/P4 on each tier.

---

## VERIFICATION CHECKLIST — Phase 1

**Taxonomy**
- [ ] `GET /taxonomy/catalog/tree` returns 7 level-1 nodes, 41 level-2, and the full level-3 set
- [ ] `GET /taxonomy/catalog/search?q=cracked` returns `HW-DIS-CRK` **with** its type and subtype chain
- [ ] `GET /taxonomy/catalog/search?q=hardware` returns every level-3 row under Hardware
- [ ] Re-running migration 194 changes nothing (idempotent)
- [ ] S18 tree renders; clicking a level-3 row loads the detail panel
- [ ] A user with `support_taxonomy · view` but not `edit` sees the page with all inputs disabled
      and no Add button
- [ ] Soft-deleting an issue type sets `active=false` and it disappears from search but historical
      references still resolve

**Priority**
- [ ] Unit test covers all 9 matrix cells
- [ ] Platinum P3 → P2; Platinum P1 → stays P1 with reason "already P1"
- [ ] Safety issue with Impact 3 / Urgency 3 → **P1** (override beats matrix)
- [ ] Repeat + Platinum + P4 → P2 (two bumps), and `reasons[]` lists both

**SLA**
- [ ] `POST /sla/preview` for a Platinum customer, INCIDENT, impact 2 urgency 2 returns
      P2 with the **Platinum — High** policy (1 h / 12 h), not the default (2 h / 24 h)
- [ ] All five calendar unit tests pass
- [ ] Pausing with `PENDING_PART` leaves `sla_resolution_due_at` unchanged
- [ ] Pausing with `PENDING_CUSTOMER` for 3 business hours moves it forward exactly 3 business hours,
      and `support_sla_pauses` has a row with both timestamps
- [ ] A holiday added via the UI immediately changes the result of `POST /sla/preview`

**Build**
- [ ] `npm test` green · `npm run build` clean · phase report written
