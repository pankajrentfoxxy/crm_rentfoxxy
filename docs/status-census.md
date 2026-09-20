# Status census

Part 1 §6.1. **Read-only** — five `SELECT`s, no writes, no migration.

Run 20 Sep 2026 against `laptop_refurbishment_qa` (the database behind
`qa.rentfoxxy.com`, port 5010). You cannot plan a mapping without the real
distribution; the counts decide which strays matter.

> **On which database this is.** The build documents say staging shares
> production's database. On this machine it does not: `qa.rentfoxxy.com` resolves
> to 157.173.221.119 and runs on `laptop_refurbishment_qa`, while
> `crm.rentfoxxy.com` resolves to 187.77.187.213 — a different VPS with its own
> Postgres. The data here is clearly a restore of real production data (real
> TTSPL codes, real customers, real invoice numbers), so the *shape* below should
> hold, but **re-run this census on production before Part 2.3 writes a
> migration**. The absolute counts will differ.

---

## 1. Assets — `vendor_serial_numbers`

### By `inventory_status`, including soft-deleted

| `inventory_status` | Live | Soft-deleted | Total | Canonical? |
|---|---:|---:|---:|---|
| `rented` | 3,037 | 0 | 3,037 | ✅ |
| `in_stock` | 1,930 | 0 | 1,930 | ✅ |
| **`<null>`** | **1,372** | 0 | **1,372** | ❌ **not a value** |
| `returned` | 330 | 0 | 330 | ✅ |
| `sold` | 287 | 0 | 287 | ✅ |
| `scrapped` | 141 | 0 | 141 | ✅ |
| `out_stock` | 95 | 0 | 95 | ❌ stray |
| `out_for_repare` | 19 | 0 | 19 | ❌ stray |
| `in_transit` | 18 | 0 | 18 | ✅ |
| `in_repair` | 14 | 0 | 14 | ✅ |
| `on_demo` | 7 | 0 | 7 | ✅ |
| `out_for_return` | 6 | 0 | 6 | ❌ stray |
| `dispatch_ready` | 6 | 0 | 6 | ✅ |
| `reserved` | 3 | 0 | 3 | ✅ |
| `deleted` | 0 | **1** | 1 | ❌ stray |

**7,265 rows. 9 of the 12 canonical values are in use** — `at_gate` does not exist
yet (Part 3 introduces it), and `qc_failed` is never written to this column.

### Three things the numbers change

**1. The NULL bucket is the largest problem, not the strays.** 1,372 rows —
**18.9% of the fleet** — carry no `inventory_status` at all. That is finding **G2**,
and it dwarfs every stray value put together. All three GRN receive INSERTs omit
the column and migration 037 gave it no default, so a laptop is NULL for its whole
production life and every availability query has to `COALESCE(…, 'in_stock')` —
which silently means *a unit on the diagnosis bench reads as in stock*.

Part 1 §6.3's mapping table does not mention NULL. It must, and it cannot be
defaulted to `in_stock` blindly: the correct value is inferable from the ticket's
current stage, which is what Part 5.2 specifies. **Do not fold this into the
Part 2.3 canonicalisation migration as a flat default.**

**2. Only three stray values exist, totalling 120 rows — 1.65%.** The mapping
job on this column is far smaller than the audit implies:

| Stray | Rows | Proposed |
|---|---:|---|
| `out_stock` | 95 | `rented` |
| `out_for_repare` | 19 | `in_repair` |
| `out_for_return` | 6 | `returned` |
| `deleted` | 1 (soft-deleted) | — see below |

**3. Six of the eleven strays in §6.3's table do not exist on this column.**
`passed`, `repared`, `replace`, `qc_reject`, `require_for_parts` and
`send_to_qc_check` have **zero** `inventory_status` rows. They are real values —
but they live in `qc_status`, which is where QC writes the client's chosen string
(finding I4). The §6.3 table conflates the two columns.

### Both BLOCKERs are smaller than they look

- **`missing` — zero rows.** The value appears nowhere in this column, live or
  soft-deleted. There is nothing to migrate. It still needs a business answer
  before anything *writes* it, but it does not block Part 2.3.
- **`deleted` — one row, already soft-deleted** (`deleted_at IS NOT NULL`), written
  by `scripts/delete-laptop-by-serial.js:108`. The canonicalisation migration
  filters on `deleted_at IS NULL`, so it never sees this row. It does not block
  Part 2.3 either; the script does (register section E).

**Both blockers can be deferred out of Part 2.3 without guessing.** That is a
material change to the plan's critical path.

### By `qc_status` — the genuinely dirty column

| `qc_status` | Rows |
|---|---:|
| `out_stock` | 2,699 |
| `pending` | 2,571 |
| `passed` | 760 |
| `in_used` | 758 |
| `qc_pending` | 271 |
| `dead` | 117 |
| `out_for_repare` | 44 |
| `out_for_repair` | 15 |
| `returned_to_vendor` | 12 |
| `unrepairable` | 10 |
| `out_for_return` | 6 |
| `qc_failed_return_vendor` | 2 |

**Twelve values, and no canonical list for them exists yet.** Part 1 §6.2 defines
the asset list only. Note `out_for_repare` and `out_for_repair` both present —
the misspelling and the correct spelling, 44 and 15 rows, meaning the same thing.
`qc_failed_return_vendor` (2 rows) is the value finding R12/register C says
nothing reads.

**This column needs its own canonical list before Part 2.3 can constrain it.**
Part 1 does not specify one. Flagged as a gap, not guessed at.

### The pairs that should not exist

| `inventory_status` | `qc_status` | Rows | Why it is wrong |
|---|---|---:|---|
| `rented` | `out_stock` | 2,427 | The largest single pair in the table, and `out_stock` is a stray |
| `in_stock` | `in_used` | 758 | In stock and in use at once |
| `sold` | `out_for_repare` | 24 | Sold, and out for repair |
| `rented` | `out_for_repare` | 1 | Same, rented |
| `in_stock` | `out_for_repair` | 1 | On the shelf and out for repair |
| `returned` | `qc_failed_return_vendor` | 2 | Returned, flagged with a value nothing reads |

---

## 2. Delivery challans — `delivery_challan_lines`

| Status | Movement | Rows |
|---|---|---:|
| `delivered` | outbound | 4,988 |
| `delivered` | return | 1,943 |
| `in_transit` | return | 50 |
| `cancelled` | return | 25 |
| `rejected` | outbound | 20 |
| `pending` | return | 14 |
| `in_transit` | outbound | 12 |
| `pending` | outbound | 9 |
| `cancelled` | outbound | 3 |
| `dispatch_ready` | outbound | 3 |
| `reached` | return | 2 |
| `shipped` | return | 1 |

7,070 rows, 7 distinct statuses. Clean by comparison.

**`shipped` — 1 row**, confirming finding **DC5**: its only writer is the
unreachable dispatch endpoint, and it survives in the constraint and in every
status filter. One row is the whole population.

**Only 3 rows sit at `dispatch_ready`**, against 20 `rejected`. Worth noting for
finding DC7 (a challan that never left the warehouse cannot be rejected): the
state it is stuck in is rare, so the fix is cheap to verify.

---

## 3. Production tickets — `tickets`

| Status | Distinct stages seen | Notable |
|---|---|---|
| `completed` | Inventory (1,499), Floor Manager (4), Assembly & Software (1), `<null>` (1) | |
| `in_progress` | 11 stages, 468 rows | |
| `cancelled` | 7 stages, 115 rows | |
| `out_for_repair` | Diagnosis (15) | |
| `diagnosis_failed` | Diagnosis (12) | |
| `qc_failed_return_vendor` | Body & Paint (1), Assembly & Software (1) | |

Six ticket statuses. **`completed` with a NULL stage — 1 row**, and `completed`
at Floor Manager (4) and Assembly & Software (1): finding **R11**, `status` and
`current_stage_id` diverging. 5 rows say completed while sitting at a stage that
is not the end of the pipeline.

`Chip Level Repair` and `Body & Paint` both appear as live stages, so this
database was provisioned from the dump rather than migrations alone — finding
**R10**. Confirm the `stage_order` values before Part 5.5 touches the seed.

---

## 4. Support

**`support_tickets` — 3,320 rows, 4 statuses.**

| Status | Rows |
|---|---:|
| `closed` | 3,122 |
| `cancelled` | 70 |
| `open` | 69 |
| `in_progress` | 59 |

**`support_ticket_items` — 3,681 rows, 14 statuses.**

| Status | Rows |
|---|---:|
| `resolved` | 1,743 |
| `inventory_updated` | 1,544 |
| `cancelled` | 97 |
| `assigned` | 64 |
| `open` | 59 |
| `closed` | 51 |
| `repair_failed` | 25 |
| `picked_up` | 23 |
| `visited` | 17 |
| `awaiting_service_return` | 15 |
| `pending_dispatch` | 14 |
| `order_placed` | 13 |
| `delivered` | 10 |
| `swap_initiated` | 6 |

The ticket level is tidy; the item level carries 14 values with no CHECK behind
any of them (finding **U1**). `resolved` and `inventory_updated` together are 89%
of all items, and both are terminal — the twelve others describe the journey.
Part 6.3 replaces this vocabulary wholesale with the v2 work-order layer, so
canonicalising it in Part 2.3 would be work thrown away. **Recommend leaving the
support statuses to Part 6** and constraining only the asset and DC columns in
Part 2.3.

---

## What this census changes in the plan

1. **NULL `inventory_status` is the biggest item on this column**, at 1,372 rows,
   and §6.3's mapping table omits it. It needs its own treatment (Part 5.2's
   stage inference), not a default.
2. **Both Part 2.3 BLOCKERs are effectively empty** — `missing` has zero rows,
   `deleted` has one soft-deleted row the migration would not touch. They stop
   being critical-path.
3. **`qc_status` has no canonical list anywhere in Part 1**, and it is the dirtier
   of the two columns — 12 values including a misspelling that coexists with its
   correct spelling. Part 2.3 cannot put a CHECK on it until that list exists.
4. **Support statuses should be left to Part 6**, not canonicalised in Part 2.3.
5. Confirmed by count: **DC5** (`shipped`, 1 row), **R11** (5 completed tickets at
   a non-terminal stage), **R10** (provisioned from the dump), **G2** (18.9% NULL).
