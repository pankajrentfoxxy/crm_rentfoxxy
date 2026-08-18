# Phase 07 report — Replacement: one action, five reasons, paired work orders

Branch: `support-revamp/phase-07`  
Depends on: Phase 00–06 (still on this branch; not committed).  
Legacy `/support/*` tables and controllers were not rewritten.

## The rule

One function, `createReplacement`. Collect is decided by **where the old asset is**, not by which button was pressed.

| Reason | Collect? |
|---|---|
| `FAULTY_IRREPARABLE` / `UPGRADE_DOWNGRADE` / `WRONG_UNIT_DELIVERED` | Yes, if the unit is still with the customer |
| `REPAIR_TOO_LONG` / `RESEND_AFTER_RETURN` | Never — old unit is already in the warehouse |

`needsCollectLeg` uses `isPickupEligibleStatus` from `supportPickupEligibility.js`. The status list is not redeclared.

## Migration numbers

Prompt asked for `202_support_v2_replacement.sql`. 202 is groups.

| File | Purpose |
|---|---|
| `backend/migrations/208_support_v2_replacement.sql` | `support_replacements`; mandatory `DATA_TRANSFER` step on `REPLACEMENT_DELIVERY` |

`replacement_group_id` stays `VARCHAR(40)` to match the existing WO column.

## Safety rule

A `RETURN_PICKUP` in a replacement group cannot complete before its paired `REPLACEMENT_DELIVERY` is `COMPLETED`. 409 `COLLECT_BEFORE_DELIVERY`. A lead with `support_replacement · edit` can waive (`POST /replacements/:id/waive-collect` or `collect_override` on complete). The waiver is on the timeline.

## Commercial

- Same config, same day → warehouse receipt skips the credit note (they would cancel out).
- Rate change → `RATE_CHANGE` approval; on approve, the existing sales order line is **amended**, not duplicated.
- Unit value > ₹40,000 or 3rd+ replacement in 90 days → manager `REPLACEMENT` approval; WOs stay `DRAFT`.
- `WRONG_UNIT_DELIVERED` → internal `DISPATCH_QUALITY` event, no charge.

## Endpoints

```
GET  /lines/:lineId/replacement-context
GET  /replacements/candidates
POST /lines/:lineId/replacement
PATCH /replacements/:id
POST /replacements/:id/waive-collect
POST /replacements/:id/cancel
```

Candidates: buffer stock first, then free stock with a visible `config_match_score` and named downgrade fields.

## UI

- `InitiateReplacementModal` — five reason cards, then a plain-language “what will happen”, then the candidate picker.
- Paired cards on S7 under a shared “Replacement pair” header.
- Job step `DATA_TRANSFER` — four radio options. “Customer will do it themselves” reschedules collect +1 day and emails the customer.

## How to check (after Docker migrations)

```bash
cd backend
node scripts/run-all-migrations.js
npm test
cd ../frontend && npm run build
```

Do not apply these migrations from this machine. Do not run them against Railway.
