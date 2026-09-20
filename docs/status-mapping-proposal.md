# Status mapping proposal

Part 1 §6.3. **A proposal for human approval. Nothing here is implemented, and
Part 1 writes no migration.** Part 2.3 applies whatever this document becomes
once it is signed off.

Counts are from `docs/status-census.md`, run 20 Sep 2026 against
`laptop_refurbishment_qa`. **Re-run the census on production before writing the
migration** — the shape should hold, the absolute numbers will not.

---

## 1. `vendor_serial_numbers.inventory_status`

### The strays that actually exist

Three values, 120 rows, **1.65% of the live fleet**. That is the whole job on
this column.

| Stray | Rows | Proposed | Why |
|---|---:|---|---|
| `out_stock` | 95 | `rented` | Read in 12 places as "deployed"; written by no current code — an ERP import artefact |
| `out_for_repare` | 19 | `in_repair` | Misspelling of an existing family |
| `out_for_return` | 6 | `returned` | |
| `deleted` | 1 | **leave** | Soft-deleted already; the migration filters `deleted_at IS NULL` and never sees it. See §4. |

### Six proposed mappings have nothing to map

Part 1 §6.3 lists these as `inventory_status` strays. **All six have zero rows in
that column.** They are real values, but they live in `qc_status` — which is
where QC writes the client's chosen string (finding I4). The original table
conflates the two columns.

`passed` · `repared` · `replace` · `qc_reject` · `require_for_parts` · `send_to_qc_check`

They are carried into §2 below, against the column they are actually in.

### The item §6.3 omits, and it is the biggest one

| Value | Rows | Share | Proposed |
|---|---:|---:|---|
| **`NULL`** | **1,372** | **18.9%** | **Not a flat default — infer from the ticket stage** |

This is finding **G2**. Migration 037 added the column with no default and all
three GRN receive INSERTs omit it, so a laptop carries NULL for its entire
production life. Every availability query then does `COALESCE(…, 'in_stock')`,
which means **a unit on the diagnosis bench currently reads as in stock**.

Defaulting these to `in_stock` in the canonicalisation migration would bake that
lie into the column permanently and make 1,372 units attachable that are not.
The correct value is derivable from the ticket's `current_stage_id`:

| Ticket stage | Proposed `inventory_status` |
|---|---|
| Inventory (completed) | `in_stock` |
| Floor Manager, Diagnosis, Assembly & Software, Chip Level Repair, Body & Paint, Final Testing, QC1, QC2 | `in_repair` — on the floor, not attachable |
| Pending Inventory | `in_repair` until QC2 passes |
| Dispatch QC | `reserved` |
| No ticket at all | **ASK** — see §4 |

**Recommendation: this is Part 5.2's job, not Part 2.3's.** Part 5.2 already
specifies "backfill the NULLs by inferring from the ticket's current stage, and
record the inference in `events`". Doing it in Part 2.3 as a default would be a
silent, unauditable guess across a fifth of the fleet. Part 2.3 should leave NULL
alone and the CHECK constraint should permit it until Part 5.2 lands.

---

## 2. `vendor_serial_numbers.qc_status`

**Part 1 defines no canonical list for this column, and Part 2.3 is told to put a
CHECK on it. That cannot happen until the list exists — this is a gap in the
plan, flagged rather than guessed.**

It is also the dirtier of the two columns: 12 values, 7,265 rows, and no value is
obviously wrong in the way `out_stock` is — several encode a real distinction the
asset status does not carry.

| Current | Rows | Observation |
|---|---:|---|
| `out_stock` | 2,699 | Duplicates `inventory_status`; 2,427 of these sit on `rented` assets |
| `pending` | 2,571 | |
| `passed` | 760 | |
| `in_used` | 758 | Duplicates `rented`; 758 sit on `in_stock` assets, which contradicts |
| `qc_pending` | 271 | Same meaning as `pending` — two spellings of one state |
| `dead` | 117 | All on `scrapped` assets |
| `out_for_repare` | 44 | **Misspelling, coexisting with the correct spelling below** |
| `out_for_repair` | 15 | |
| `returned_to_vendor` | 12 | |
| `unrepairable` | 10 | Overlaps `dead` |
| `out_for_return` | 6 | |
| `qc_failed_return_vendor` | 2 | Finding R12 / register C: nothing reads this value |

**A first sketch, for discussion — not a recommendation:**

`pending` + `qc_pending` → one `pending` · `passed` stays · `dead` +
`unrepairable` → one terminal value · `out_for_repare` + `out_for_repair` → one
· `out_stock` and `in_used` → **delete, do not map** (they restate
`inventory_status` and contradict it in 758 + 2,427 rows) · `qc_failed_return_vendor`
→ **delete**, nothing reads it.

That is a ~6-value list. **It needs a decision before Part 2.3, and it belongs in
a Part 1 §6.2 addendum.**

---

## 3. `delivery_challan_lines.status`

Seven values, 7,070 rows, and all seven are legitimate. No mapping needed.

`delivered` · `in_transit` · `cancelled` · `rejected` · `pending` ·
`dispatch_ready` · `reached` · `shipped`

One item only: **`shipped` has 1 row** (finding DC5) and its only writer is the
unreachable dispatch endpoint. Proposed: map that row to `in_transit`, then drop
`shipped` from the constraint and from every status filter.

---

## 4. The two BLOCKERs — both smaller than the plan assumes

### `missing` — **zero rows**

The value appears nowhere in `inventory_status`, live or soft-deleted. **There is
nothing to migrate and it does not block Part 2.3.**

It still needs a business answer before anything *writes* it — *is a missing
laptop written off, or still owed by someone?* — because that decides whether it
becomes a thirteenth canonical value or is rejected outright. But that decision
can be taken during Part 3 or later, not as a gate on the canonicalisation.

### `deleted` — **one row, already soft-deleted**

Written by `scripts/delete-laptop-by-serial.js:108`, and read by exactly one
other script. The row carries `deleted_at IS NOT NULL`, and the canonicalisation
migration filters on `deleted_at IS NULL`, so **the migration never sees it**.

**It does not block Part 2.3.** What does need a decision is the script, which
will keep writing the value after the CHECK constraint exists and will then fail
at runtime. That is bypass-register section E, and the answer is probably "the
script should soft-delete without touching `inventory_status` at all".

### The new blocker this census surfaced

**NULL `inventory_status` on assets with no production ticket.** The stage
inference in §1 covers units that have a ticket. For any that do not, there is no
evidence to infer from and the value would be a guess across a potentially large
bucket. **Count these on production first, then decide.**

---

## 5. For Part 2.3 — the rules this migration must follow

Carried from Part 1 §6.3, unchanged, plus what the census adds:

- **Preserve the original value** in `extra.legacy_status` so the mapping is
  auditable and reversible. Use `jsonb_set`, not a whole-object write — finding
  I12 means a whole-object write loses concurrent keys.
- **Write an `inventory_status_transitions` row per change** with
  `reason = 'canonicalisation'`, so the migration appears in each asset's own
  timeline rather than as an unexplained jump. Once Part 2.1's `events` table
  exists, write there too with `event_type='status_canonicalised'`,
  `actor_type='migration'`.
- **The CHECK constraint goes on last**, after the bypasses in
  `claude/bypass-register.md` are closed. Adding it earlier converts existing
  bugs into production 500s.
- **The CHECK must permit NULL** until Part 5.2 backfills the 1,372 rows, or a
  fifth of the fleet becomes unwritable.
- **Leave the support statuses to Part 6.** Part 6.3 replaces that vocabulary
  wholesale with the v2 work-order layer; canonicalising 14 item statuses in
  Part 2.3 is work thrown away.
- **Back up `vendor_serial_numbers` and record row counts before and after** in
  the PR, per the master prompt's promotion rules.

---

## 6. Summary — what needs a human

| # | Question | Blocking? |
|---|---|---|
| 1 | The `qc_status` canonical list — Part 1 never defines one | **Yes, blocks Part 2.3's CHECK on that column** |
| 2 | NULL `inventory_status` on assets with **no** ticket — infer from what? | **Yes**, if Part 2.3 touches NULL at all; no, if it defers to Part 5.2 |
| 3 | `missing` — write-off, or owed by someone? | No — zero rows |
| 4 | `deleted` — what should the delete script write instead? | No — one soft-deleted row |
| 5 | Confirm `out_stock → rented` for 95 live assets | Low risk, but it is 95 real laptops |

Items 3 and 4 were the plan's two stated blockers. **Neither blocks the
migration.** Items 1 and 2 are new, and both do.
