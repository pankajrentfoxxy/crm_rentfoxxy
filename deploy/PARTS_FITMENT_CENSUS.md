# Part Fitment — Phase 1 census (staging / live DB)

Branch: `parts-fitment` off `new_stagging_crm` @ `da68ec3d`

## Backup
- Path: `deploy/backups/fitment_phase1_20260922_100848/parts_and_instances.data.sql`
- Counts before: **parts = 117**, **part_instances = 1688**
- Counts after migration + Phase 1.3: **parts = 117**, **part_instances = 1688**

## Instance status
| status | n |
|---|---|
| in_stock | 1070 |
| installed | 307 |
| defective | 160 |
| with_technician | 75 |
| discarded | 58 |
| reserved | 17 |
| with_vendor_repair | 1 |

## compatible_brands provenance
| provenance | value | n |
|---|---|---|
| human-entered | Competaible | 5 |
| human-entered | Dell | 4 |
| human-entered | MI | 2 |
| human-entered | Realme | 1 |
| human-entered | Xiomi | 1 |
| human-entered | DELL | 1 |

Auto-seeded rows (`compatible_brands = ARRAY[default_brand]`): **0**  
Phase 1.3 UPDATE row count: **0**

## BLOCKER 1 — human-entered not in `asset_config_brands`
Left untouched (not mapped):
- `Competaible` (typo)
- `MI`
- `Realme`
- `Xiomi`

In master: `Dell` / `DELL`

## BLOCKER 3 — ticket/support model vs master
- Distinct brand+model pairs: **356**
- Missing from `asset_config_brands` + `asset_config_models`: **267**
- Common pattern: tickets store `"Dell Latitude 5420"` while master has `"Latitude 5420"`; also `"Dell Inc."` vs `"Dell"`.

## Acceptance #9 — spare brand/model checksum
`md5` of `parts.default_brand|default_model` + `part_instances.brand|model`:
**`04e59900ad34d4a983d73ae9521438d0`** (unchanged after build)

## Phase 6
Removed dead `AND NOT COALESCE(p.archived, FALSE)` reader in `supportPartsController` (nothing writes `parts.archived`).

---

# Phase 7 — why the pick list still showed every part (22 Sep 2026)

Reported from QA: parts-approval "Scan and approve" lists all units, so the team
cannot tell which one to pick. Two separate causes, both now fixed.

## Cause 1 — matching on raw strings

`fits()` compared `tickets.brand/model` to the unit tag after only lower-casing
and `-_/` → space. Measured against `asset_config_brands` + `asset_config_models`:

| normaliser | distinct ticket pairs resolved | tickets covered |
|---|---|---|
| before | 70 / 281 (24.9%) | — |
| + company words, punctuation, `Notebook PC` suffix | 175 / 281 (62.3%) | 88.1% |
| + iterative brand-prefix strip (shipped) | **252 / 281 (89.7%)** | **1956 / 2108 (92.8%)** |

The dirt that mattered:
- `Dell Inc.` vs `Dell` — 108 tickets
- `HP HP EliteBook 640 14 inch G9 Notebook PC` vs `Elitebook 640 14 inch G9`
- master rows carry prefixes too (`HP Probook 430 G3`, `HP Laptop Elitebook 840 G5`)

**`tickets.brand` is not trustworthy.** 1180 tickets are stamped `Dell` regardless
of the machine — `Dell` / `Dell Lenovo Thinkpad X-13`, `Dell` / `Apple Macbook Air`.
The model string is the better witness, so leading brand tokens are stripped one at
a time and the last one stripped wins. Residual misses are master-data gaps
(`Latitude 7440`, `Elitebook 640 14 inch G11` are in no `asset_config_models` row),
not matcher bugs.

## Cause 2 — nothing was tagged

| | |
|---|---|
| `part_instances.fitment = 'unset'` | 1688 / 1699 |
| `parts.default_fitment = 'unset'` | 117 / 117 |

An unset unit is `unknown`, and `unknown` is always shown — by design, so the
filter can never hide stock the warehouse actually has. With 99.3% unset the
filter had nothing to narrow, which is exactly the reported symptom.

Ticket 3932 (`TTSPL7709`, HP Probook 840 G8, part 9 "Laptop Keyboard"):

| | in stock | fit | not tagged | other models |
|---|---|---|---|---|
| before tagging | 72 | 0 | 69 | 3 (now hidden) |
| after bulk tag | 72 | 69 | 0 | 3 (hidden) |
| same stock, a Dell Latitude ticket | 72 | 0 | 0 | 72 (all hidden) |

Tagging is the operational step that makes the filter bite; `POST
/api/part-requests/instances/bulk-fitment` exists so it is one action per part
rather than 1688 individual edits.

## Changed

- `services/partFitmentService.js` — `normaliseBrand`/`normaliseModel`/
  `resolveLaptopIdentity`/`resolveUnitIdentity`/`rankByFit`, laptop brand master
  cached from `asset_config_brands` (60s TTL, primed by callers).
- `fitSqlFragment`/`fitAllowedSqlFragment` **removed**. The rule was implemented
  twice — once in JS, once as a SQL `CASE` — and the two could drift. Listing now
  filters in JS after the query; the row set is one part's stock.
- `POST /api/part-requests/instances/bulk-fitment` + "Tag fitment in bulk" in the
  part serials drawer.
- Pick lists return `laptop.counts` and are ordered fit → untagged → mismatch.
- The toggle reads "Only parts for this laptop" and is **on** by default
  (was "Show all", off) in both the floor and support pick modals.
- Model picker in `FitmentControls` is searchable — Dell has 61 models, HP 49.

## Still open (not code)

- `asset_config_models` is missing models that tickets use in volume
  (`Latitude 7440` ×44, `Elitebook 640 14 inch G11` ×43). Until they are added,
  a unit cannot be tagged to them — tag at brand level (empty model list) for those.
- ~~Migration 275 is applied but not recorded in `schema_migrations`.~~ Fixed
  22 Sep 2026: all ten objects it declares were verified present (3 columns +
  `default_fitment`, 2 CHECK constraints, 3 indexes, `app_settings` + its seed row,
  and the widened `part_movements_type_check`), then recorded as
  `275_parts_fitment.sql`. The runner keys on the filename, not the number.
