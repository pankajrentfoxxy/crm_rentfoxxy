# Decisions taken during the build

Answers to blockers raised while implementing, recorded here so a later part
does not have to re-ask. Each one names who decided it and what it changes.

---

## D1 — The 1,345 assets with no `inventory_status`

**Asked:** Part 2 (status census). **Answered by Pankkaj, 20 Sep 2026.**

**They are real laptops that have not been through GRN yet.**

### What the data showed

1,345 rows — **18.5% of the live fleet** — share one exact signature:

| | |
|---|---|
| `inventory_status` | `NULL` |
| `qc_status` | `pending` (all 1,345) |
| TTSPL code | present |
| Serial number | present, real |
| Brand / model | **empty** |
| Purchase order | none |
| Production ticket | **none** |
| Customer / challan / delivery | none |
| Events in all of history | **zero** |
| Created | 29 Jun – 10 Sep 2026 |

Arrival is concentrated: 742 in July, 504 in August, 95 in September, 4 in June.

This also corrects the plan. Part 5.2 says to backfill NULL `inventory_status`
"by inferring from the ticket's current stage" — but **only 27 of the 1,372 NULL
rows have a ticket at all**. Stage inference covers 2% of the problem. The other
1,345 have nothing to infer from, which is why this needed a business answer
rather than a technical one.

### What it changes

**They must stop reading as `in_stock`.** Today every availability query does
`COALESCE(inventory_status, 'in_stock')` (finding G2), so all 1,345 read as
on-the-shelf and attachable. They are not: nobody has inspected them, they have
no configuration recorded, and no GRN has happened.

- **Part 2.5** — the single `asset_available` predicate excludes `NULL`
  explicitly rather than coalescing it. That is what makes them non-attachable,
  and it is a one-line consequence of having one predicate instead of six.
- **Part 2.3** — the canonicalisation migration leaves NULL alone, and the CHECK
  constraint permits NULL. Defaulting them to `in_stock` would bake the lie
  permanently into the column and make 1,345 uninspected laptops sellable.
- **Worklist produced:** `reports/awaiting-grn-worklist.csv` — all 1,345 with
  TTSPL, serial, and date received, so they can be processed through GRN.

### Still open

Whether NULL should become a *named* thirteenth status (`awaiting_grn`) rather
than staying NULL. NULL is already distinct and already means "has not entered
stock", so excluding it in one predicate is enough to fix the behaviour. A named
status would be more greppable and would stop a future `COALESCE` reintroducing
the bug — but it changes Part 1's canonical twelve and needs a lifecycle family
assigned, so it is not being done silently. **Raise before Part 2.3 migrates.**

---

## D2 — `qc_status` is deferred out of Part 2.3

**Asked:** Part 2 (status census). **Answered by Pankkaj, 20 Sep 2026.**

**Part 2.3 canonicalises `inventory_status` only. `qc_status` gets no CHECK
constraint and no mapping migration in this part.**

Part 2.3 as written says to constrain both columns, but Part 1 §6.2 defines a
canonical list for the asset status only — there is no list for `qc_status` to
be constrained against, and inventing one inside the migration would be the
guess this programme keeps warning about.

It is also the dirtier of the two columns: 12 values across 7,265 rows,
including `out_for_repare` (44) and `out_for_repair` (15) — the same state
spelled two ways — plus `out_stock` (2,699) and `in_used` (758), which restate
`inventory_status` and **contradict it in 3,185 rows**.

The deciding argument is sequencing: `qcManagement/orders.controller.js` is the
main writer and it writes the request body's chosen string straight into the
column (finding I4). Part 5 rewrites that controller. Constraining the column
before its writer is fixed converts a data-quality problem into 500s at the QC
bench.

**A sketch for when it is done** (needs approval, not yet a plan): `pending`
absorbing `qc_pending` · `passed` · `failed` · `in_repair` absorbing both
spellings · `dead` absorbing `unrepairable` · `returned_to_vendor`. Drop
`out_stock`, `in_used` and `qc_failed_return_vendor` — the first two duplicate
`inventory_status` and the third is read by nothing.

---

## D3 — Pushing

**Answered by Pankkaj, 20 Sep 2026.** Commits are made locally and Pankkaj
pushes; no remote credentials are configured on this box. Staging deploys from
the working tree, so nothing is blocked by an unpushed commit — only the remote
backup lags. **Flag each time a part is ready to push.**

---

## D4 — How Part 2.2 lands

**Answered by Pankkaj, 20 Sep 2026.** Small commits, **section A first**, each
with its test, restarting and watching between groups — which is what the
register's own line 1a asks for. The nine catch-block bypasses are the ones that
make the state machine advisory rather than enforcing, so they come first and a
break stays traceable to one change.

`qa.rentfoxxy.com` is publicly reachable and in use, so "it is only staging" is
false in the way that matters here even though the database is isolated.

---

## D5 — Availability trusts `inventory_status`, not `qc_status`

**Asked:** Part 2.5, while collapsing the six predicates.
**Answered by Pankkaj, 21 Sep 2026.**

Collapsing them exposed that they disagreed **69×**: SO attach offered **48**
units, Ready-to-Rent offered **3,325**. The gap was entirely `qc_status`.

Of 1,930 canonically in-stock laptops, only **48** carry `qc_status='passed'`.
852 say `pending`, 758 say `in_used`, 271 say `qc_pending` — all created
Feb–Jun, none touched by the 258 migration, so they are original ERP-import
values rather than anything this programme wrote.

**Decision: `asset_available` tests `inventory_status = 'in_stock'` and does not
test `qc_status` at all.**

The reasoning: `in_stock` is *defined* as "on the shelf, QC-passed, attachable"
(Part 1 §6.2), and Part 2.3 has just made that column canonical and
constrained. `qc_status` is the column decision D2 formally declared unreliable
until Part 5 rewrites its writer. Gating the whole fleet's availability on a
column we have just declared untrustworthy is backwards — and it would have
meant reporting that the business owns 48 rentable laptops.

**Result: all six call sites now agree at 1,693.** The exclusions are each
explainable — 126 on open production tickets, 5 still holding a customer, the
rest on live allocations or awaiting serial-verified receive, plus the 1,372
NULL rows from D1.

**Watch for:** if a unit turns out to be physically un-QC'd but marked
`in_stock`, that is a data problem in `inventory_status` and Part 5 is where it
gets fixed at source. It is now visible rather than masked by a second filter.

---

## Still outstanding

| # | Question | Blocks |
|---|---|---|
| 1 | Should NULL become a named `awaiting_grn` status? (D1) | Part 2.3 |
| 2 | Bucket B — 17 candidate duplicate routes, listed in `docs/route-inventory.md`, none deleted | Part 4 |
| 3 | The sale book's brand name — `Gorefurbo` is a placeholder read from config | Part 4 / 6 |
| 4 | Is `dispatch_ready → at_gate` a real two-step at your gate, or do units go straight out? | Part 3.1 |
| 5 | Which cases, if any, should *suspend* billing rather than credit it? (`asset_billing_holds`) | Part 6.3 |
| 6 | `missing` as an asset status — write-off, or owed by someone? Zero rows today, so not urgent | whenever it is first written |
