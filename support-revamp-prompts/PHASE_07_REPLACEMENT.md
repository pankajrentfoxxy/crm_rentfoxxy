# PHASE 7 — Replacement: one action, five reasons, paired work orders

> Read `00_MASTER_CONTEXT.md` first.
> **Screens:** Replacement pairing on S7, the replacement path through S9, and an asset-picker modal.
> **Depends on:** Phase 6.

---

## 7.1 What we are collapsing

The legacy module has **four near-identical functions** — `initiateReplacement`,
`initiateSwapFromRepairPickup`, `initiateReturnRedelivery`, `initiateResendLaptop` — that are
roughly 90% the same code. They exist because the developer branched on *how the request arrived*
rather than on *where the old asset currently is*.

**One action. One code path.** The system decides whether a collect leg is needed by looking at the
old asset's current location, not at which button was pressed.

```js
// backend/services/workOrderEffects/replacement.js
const REASONS = ['FAULTY_IRREPARABLE','REPAIR_TOO_LONG','UPGRADE_DOWNGRADE',
                 'WRONG_UNIT_DELIVERED','RESEND_AFTER_RETURN'];

/** Collect leg is needed iff the old asset is still physically with the customer. */
function needsCollectLeg(oldAsset) {
  return ['rented','on_demo','sold','out_stock'].includes(oldAsset.inventory_status)
      && oldAsset.current_customer_id != null;
}
```

That one function replaces all four legacy branches.

---

## 7.2 Migration `202_support_v2_replacement.sql`

```sql
CREATE TABLE IF NOT EXISTS support_replacements (
  replacement_id      SERIAL PRIMARY KEY,
  replacement_group_id UUID NOT NULL,
  ticket_id           INT NOT NULL REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  line_id             INT NOT NULL REFERENCES support_ticket_assets(line_id) ON DELETE CASCADE,
  reason              VARCHAR(30) NOT NULL
                        CHECK (reason IN ('FAULTY_IRREPARABLE','REPAIR_TOO_LONG','UPGRADE_DOWNGRADE',
                                          'WRONG_UNIT_DELIVERED','RESEND_AFTER_RETURN')),
  old_serial_id       INT REFERENCES vendor_serial_numbers(serial_id),
  new_serial_id       INT REFERENCES vendor_serial_numbers(serial_id),
  old_rate            NUMERIC(12,2),
  new_rate            NUMERIC(12,2),
  rate_change         BOOLEAN NOT NULL DEFAULT FALSE,
  config_match_score  SMALLINT,
  source              VARCHAR(20) NOT NULL DEFAULT 'FREE_STOCK'
                        CHECK (source IN ('FREE_STOCK','BUFFER_ON_SITE','NEW_PROCUREMENT')),
  sales_order_line_id INT,
  delivery_wo_id      INT REFERENCES support_work_orders(wo_id),
  collect_wo_id       INT REFERENCES support_work_orders(wo_id),
  collect_waived      BOOLEAN NOT NULL DEFAULT FALSE,
  collect_waived_reason VARCHAR(200),
  data_transfer       VARCHAR(24)
                        CHECK (data_transfer IS NULL OR data_transfer IN
                          ('NOT_REQUIRED','DONE_ON_SITE','CUSTOMER_WILL_DO','BACKUP_TAKEN')),
  status              VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL'
                        CHECK (status IN ('PENDING_APPROVAL','APPROVED','SCHEDULED','DELIVERED',
                                          'COMPLETED','CANCELLED')),
  created_by          INT REFERENCES users(user_id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_repl_group  ON support_replacements(replacement_group_id);
CREATE INDEX IF NOT EXISTS idx_repl_ticket ON support_replacements(ticket_id);
```

---

## 7.3 The safety rule that does not exist today

> A `RETURN_PICKUP` that belongs to a replacement group **cannot** be marked `COMPLETED` before its
> paired `REPLACEMENT_DELIVERY` is `COMPLETED`.

Enforce in `returnPickup.onComplete`:
```js
if (wo.replacement_group_id) {
  const pair = await getPairedDelivery(client, wo.replacement_group_id);
  if (pair && pair.status !== 'COMPLETED' && !wo.collect_override) {
    throw Object.assign(
      new Error('Deliver the replacement before collecting the old unit. A lead can override with a reason.'),
      { status: 409, code: 'COLLECT_BEFORE_DELIVERY' });
  }
}
```
Override requires `support_replacement · edit` and a reason, and writes an event. Today nothing stops
a technician taking the broken laptop and leaving the user with nothing.

---

## 7.4 Choosing the replacement unit

`GET /replacements/candidates?line_id=…` returns three ranked groups:

1. **Buffer stock at the customer's site** (`customer_buffer_stock` where `status='AVAILABLE'`)
   — if one matches, the whole thing becomes a same-day swap with no delivery leg at all.
   Surface this first, always.
2. **Free stock matching the config** — with a `config_match_score` 0–100 computed from
   brand / model / CPU / RAM / storage / screen. Show the score so nobody silently downgrades a customer.
3. **Nearest warehouse stock** with a lower score, clearly marked as a downgrade or upgrade.

```json
{ "success": true, "candidates": [
  { "serial_id": 44331, "ttspl_id": "TTSPL004433", "source": "FREE_STOCK",
    "brand": "Dell", "model": "Latitude 5420", "config": "i5-1135G7 · 16 GB · 512 GB",
    "config_match_score": 100, "rate": 2450, "location": "Gurugram WH", "distance_km": 4.2,
    "downgrade_fields": [] } ] }
```

---

## 7.5 Commercial handling

| Case | What happens |
|---|---|
| Same config, same rate | No contract change. Old asset billing stops on collection, new starts on delivery. If both happen the same day, net effect is zero — **do not** raise a credit note and an invoice line that cancel out. |
| Different config, different rate | Requires a **Sales approval**. On approval, amend the sales order line through the existing `sales_order_lines` mechanism. |
| `WRONG_UNIT_DELIVERED` | No rate change, no charge. Log an internal quality event so it appears on the dispatch quality report. |
| `REPAIR_TOO_LONG` | No collect leg. The old unit is already in our warehouse. |

**One function** creates or amends the sales order line. The legacy `createConfigSalesOrder` and
`appendConfigSalesOrderLines` are two ~60-line copies of the same insert — do not reproduce that.

### Approvals
- Unit value > ₹40,000 → Support Manager
- 3rd+ replacement for the same customer in 90 days → Support Manager
- Rate change → Sales
Held in `support_approvals`; the replacement sits in `PENDING_APPROVAL` and the WOs stay `DRAFT`.

---

## 7.6 Endpoints
```
GET  /lines/:lineId/replacement-context   cp('support_replacement','view')
       → old asset, its location, whether a collect leg is needed, approval thresholds hit
GET  /replacements/candidates             cp('support_replacement','view')
POST /lines/:lineId/replacement           cp('support_replacement','create')
       { reason, new_serial_id, source, rate, slot, assign_to }
PATCH /replacements/:id                   cp('support_replacement','edit')
POST /replacements/:id/waive-collect      cp('support_replacement','edit')  { reason }
POST /replacements/:id/cancel             cp('support_replacement','delete')
```

`POST /lines/:lineId/replacement` in one transaction:
1. Validate reason, load the old asset, run `needsCollectLeg`.
2. Threshold checks → create approvals if needed; if any, stop at `PENDING_APPROVAL` with WOs in `DRAFT`.
3. Generate `replacement_group_id` (UUID).
4. Create `REPLACEMENT_DELIVERY` WO + its DC.
5. If `needsCollectLeg`, create `RETURN_PICKUP` WO + its RDC, same group, **same technician and
   same slot by default**.
6. Cross-link `linked_wo_id` both ways.
7. Handle the commercial case from 7.5.
8. Events + `computeTicketStatus`.

---

## 7.7 The data transfer checkpoint

`REPLACEMENT_DELIVERY` gets a mandatory `DATA_TRANSFER` step of kind `FORM`:
```
( ) Not required — customer uses cloud only
( ) Done on site — files copied and verified with the user
( ) Customer will do it themselves — old unit left with them for 24 h
( ) Backup taken to external drive — handed to customer
```
This is a real-world gap in the current flow and a common source of escalations: the technician
swaps the machine, walks out, and the user discovers their desktop is gone.

If "Customer will do it themselves" is chosen, the collect leg is **automatically rescheduled to
the next day** rather than the same visit, and the customer gets a note saying when we will collect.

---

## 7.8 Frontend

### `components/InitiateReplacementModal.jsx`
Reason selector (5 cards with one-line explanations) → the modal then **tells the user what will
happen**: "The old unit is with the customer, so this creates two jobs: deliver the new unit and
collect the old one, both for the same technician on the same visit." For `REPAIR_TOO_LONG` it says
"The old unit is already in our warehouse, so only a delivery job is created."

Then the candidate picker with buffer stock first, config match score as a visible number, and a
clear amber warning on any downgrade.

### Paired cards on S7
Render the two WOs under a shared header:
```
REPLACEMENT PAIR                                     group 7f3a-2c
┌─ REPLACEMENT DELIVERY  WO-000903  Completed  Imran S  Fri 09:00–12:00   DC-26-27-0712
└─ RETURN PICKUP         WO-000904  Completed  Imran S  same visit        RDC-26-27-0342
```
If the collect leg is blocked by the safety rule, show it in `pri2` with the explanation and, for
users with permission, a "Waive collect" action.

---

## VERIFICATION CHECKLIST — Phase 7

**Collapse of the four legacy paths**
- [ ] `FAULTY_IRREPARABLE` with the unit at the customer → 2 WOs, paired, same group
- [ ] `REPAIR_TOO_LONG` with the unit already in the warehouse → **1** WO (delivery only)
- [ ] `RESEND_AFTER_RETURN` → 1 WO (delivery only)
- [ ] `UPGRADE_DOWNGRADE` → 2 WOs **and** a Sales approval for the rate change
- [ ] `WRONG_UNIT_DELIVERED` → 2 WOs, no charge, one internal quality event
- [ ] All five go through the same function — grep confirms there is one create path, not four

**The safety rule**
- [ ] Try to complete the collect leg first → 409 `COLLECT_BEFORE_DELIVERY`
- [ ] A lead with `support_replacement · edit` can waive with a reason; the waiver is on the timeline
- [ ] A technician without that permission cannot waive

**Candidates**
- [ ] Buffer stock at the customer's site is listed first when available
- [ ] `config_match_score` is 100 for an identical config and visibly lower for a downgrade
- [ ] A downgrade shows an amber warning naming the fields that are worse

**Commercial**
- [ ] Same config, same day → **no** credit note and **no** invoice line (they would cancel out)
- [ ] Different config → sales approval required; on approval the SO line is amended, not duplicated
- [ ] Unit value ₹52,000 → manager approval required before the WOs leave DRAFT

**Data transfer**
- [ ] Delivery cannot complete without the data transfer answer
- [ ] Choosing "Customer will do it themselves" reschedules the collect leg to the next day
      and notifies the customer

**Build**
- [ ] `npm test` green · `npm run build` clean · phase report written
