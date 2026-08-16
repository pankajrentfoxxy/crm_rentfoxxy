# PHASE 8 — Unified part requests, part delivery and part return

> Read `00_MASTER_CONTEXT.md` first.
> **Screens:** S14 (Parts queue), S15 (Request a part — mobile), the part steps in S12.
> **Depends on:** Phase 7.

---

## 8.1 What we are merging

Two parallel systems exist today (PLAN D25):

| | `part_requests` | `support_part_requests` |
|---|---|---|
| Belongs to | floor `tickets` | `support_tickets` |
| Blocks progression | **yes** (`ticket_part_blocks`) | no |
| Approver | warehouse | warehouse-ish role set |
| Statuses | `pending, escalated, ordered, received, approved, attached, rejected, cancelled` | `pending, approved, challan_generated, issued, dispatched, delivered, used, return_requested, returned, rejected, cancelled` |
| Old part model | `old_part_expected` | `old_part_status` |
| Same-named, different-meaning columns | `old_part_condition`, `old_part_notes` | `old_part_condition`, `old_part_notes` |

They become **one table with a `context` discriminator**, one status vocabulary, one queue,
one approval screen.

---

## 8.2 Migration `203_support_v2_parts_unify.sql`

Extend the existing `part_requests` table rather than creating a third one:

```sql
ALTER TABLE part_requests
  ADD COLUMN IF NOT EXISTS context VARCHAR(10) NOT NULL DEFAULT 'FLOOR'
      CHECK (context IN ('FLOOR','FIELD')),
  ADD COLUMN IF NOT EXISTS support_ticket_id INT REFERENCES support_tickets_v2(ticket_id),
  ADD COLUMN IF NOT EXISTS support_line_id   INT REFERENCES support_ticket_assets(line_id),
  ADD COLUMN IF NOT EXISTS work_order_id     INT REFERENCES support_work_orders(wo_id),
  ADD COLUMN IF NOT EXISTS status_v2 VARCHAR(28),
  ADD COLUMN IF NOT EXISTS liability VARCHAR(24)
      CHECK (liability IS NULL OR liability IN
        ('COMPANY','CUSTOMER_CHARGEABLE','VENDOR_WARRANTY','INSURANCE','NOT_APPLICABLE')),
  ADD COLUMN IF NOT EXISTS charge_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS fulfilment_mode VARCHAR(24)
      CHECK (fulfilment_mode IS NULL OR fulfilment_mode IN
        ('WAREHOUSE_HANDOVER','COURIER_TO_CUSTOMER','COURIER_TO_TECH')),
  ADD COLUMN IF NOT EXISTS collect_old_part BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS photo_attachment_ids JSONB NOT NULL DEFAULT '[]';

-- one status vocabulary
ALTER TABLE part_requests DROP CONSTRAINT IF EXISTS part_requests_status_v2_check;
ALTER TABLE part_requests ADD CONSTRAINT part_requests_status_v2_check
  CHECK (status_v2 IS NULL OR status_v2 IN (
    'REQUESTED','APPROVED','RESERVED','ISSUED','IN_TRANSIT','DELIVERED','CONSUMED',
    'REJECTED','CANCELLED','RETURNED_UNUSED','ESCALATED_TO_PROCUREMENT'));

CREATE INDEX IF NOT EXISTS idx_part_req_context ON part_requests(context, status_v2);
CREATE INDEX IF NOT EXISTS idx_part_req_support ON part_requests(support_ticket_id);

-- part compatibility, so a technician on a phone sees 14 options instead of 2,180
CREATE TABLE IF NOT EXISTS part_compatibility (
  compat_id  SERIAL PRIMARY KEY,
  part_id    INT NOT NULL REFERENCES parts(part_id) ON DELETE CASCADE,
  brand      VARCHAR(60),
  model      VARCHAR(120),
  config_key VARCHAR(60),
  notes      TEXT,
  UNIQUE (part_id, brand, model, config_key)
);
```

### Backfill both vocabularies into `status_v2`
```sql
UPDATE part_requests SET status_v2 = CASE status
  WHEN 'pending'   THEN 'REQUESTED'  WHEN 'escalated' THEN 'ESCALATED_TO_PROCUREMENT'
  WHEN 'ordered'   THEN 'ESCALATED_TO_PROCUREMENT'
  WHEN 'received'  THEN 'RESERVED'   WHEN 'approved'  THEN 'APPROVED'
  WHEN 'attached'  THEN 'CONSUMED'   WHEN 'rejected'  THEN 'REJECTED'
  WHEN 'cancelled' THEN 'CANCELLED'  ELSE 'REQUESTED' END
WHERE status_v2 IS NULL;
```
Then migrate `support_part_requests` rows into `part_requests` with `context='FIELD'`, mapping their
status vocabulary similarly and preserving `request_number` in a `legacy_request_number` column.
**Leave the old table in place, read-only, until Phase 11.**

---

## 8.3 The blocking rule, done right

Floor tickets already block stage progression while a part is open. Do the same on the support
side, but scope it to the **asset line**, not the whole ticket:

- The line moves to `PENDING_PART`
- Other lines on the same ticket continue normally
- The ticket header shows "1 of 3 machines waiting for part"
- **The ticket SLA keeps running** — a stock-out is our problem (PLAN §8.3). This is deliberate and
  the parts queue KPI in Phase 11 depends on it.

---

## 8.4 Part flow, end to end

| Step | Actor | Status | Effect |
|---|---|---|---|
| Request from the job screen | Technician | `REQUESTED` | photo mandatory; catalogue filtered by the asset's brand/model/config |
| Stock check | System | — | in stock → continue; out of stock → `ESCALATED_TO_PROCUREMENT`, line `PENDING_PART` |
| Liability | Technician / Lead | — | chargeable → quote to customer → `PENDING_CUSTOMER` (**SLA pauses here**) |
| Approve | Warehouse (+Lead > ₹5,000) | `APPROVED` → `RESERVED` | `part_instances` reserved |
| Fulfilment | Warehouse | — | `WAREHOUSE_HANDOVER` → `SPC-` · `COURIER_TO_CUSTOMER` → `PDC-` |
| Create WO | System | — | `PART_DELIVERY` WO into the technician's **one** bucket |
| Issue | Warehouse + Tech | `ISSUED` | tech e-sign, instance → `with_technician` |
| Fit | Technician | `CONSUMED` | scan part QR → scan laptop serial → photo of fitted part |
| Old part | Technician | — | grade condition → auto-create `PART_RETURN` WO, same bucket, same day |
| Return old | Technician | — | `RPDC-` → warehouse receipt → instance `returned` → vendor repair or scrap |
| Unused | Technician | `RETURNED_UNUSED` | back to stock — this is a real leak today |

### Part delivery / part return effects
```js
// workOrderEffects/partDelivery.js
onComplete: scan part QR → scan asset serial → photo → mark CONSUMED,
            link part_instance to the TTSPL, decrement stock, post cost to asset TCO,
            if liability CUSTOMER_CHARGEABLE insert customer_invoice_extra_lines
// workOrderEffects/partReturn.js
onCreate:   generate RPDC-  (existing sequence, unchanged)
onComplete: warehouse receipt → instance 'returned' → route to vendor repair or scrap
```

---

## 8.5 Endpoints
```
GET   /parts/compatible?serial_id=          cp('support_parts_request','view')
POST  /parts/requests                       cp('support_parts_request','create')
GET   /parts/requests                       cp('support_parts_request','view')     ?context=&status=&priority=
GET   /parts/queue                          cp('support_parts_approve','view')     priority-sorted
POST  /parts/requests/:id/approve           cp('support_parts_approve','edit')     { fulfilment_mode, instance_id }
POST  /parts/requests/:id/reject            cp('support_parts_approve','edit')     { reason }
POST  /parts/requests/:id/escalate          cp('support_parts_approve','edit')
POST  /parts/requests/:id/issue             cp('support_parts_approve','edit')     { signature_attachment_id }
POST  /parts/requests/:id/consume           cp('support_bucket','edit')            own only
POST  /parts/requests/:id/return-unused     cp('support_bucket','edit')            own only
POST  /parts/requests/:id/cancel            cp('support_parts_request','edit')
```

### `GET /parts/queue` — the sort that matters
```sql
ORDER BY
  CASE WHEN t.sla_resolution_due_at < NOW() THEN 0 ELSE 1 END,
  t.priority ASC NULLS LAST,
  pr.created_at ASC
```
The legacy warehouse queue is FIFO by `created_at`. Sorting by **the priority of the ticket that is
waiting** is the single change that stops P1 tickets queueing behind P4 ones.

### `GET /parts/compatible`
Joins `part_compatibility` on the asset's brand/model/config. Returns 14 rows, not 2,180.
If no compatibility rows exist for that model, return the full list **with a warning flag** so the
UI can say "No compatibility data for this model — showing all parts" rather than silently
returning nothing.

---

## 8.6 Frontend

### S14 — Parts queue
Filter chips: Awaiting approval · Approved, not issued · With technician · Old parts pending return ·
Out of stock. Context selector Field / Floor / All. Sort selector defaults to **ticket priority**.

Table: priority spine + `PriorityChip` on the request row (inherited from the waiting ticket) ·
request number · context badge · part & machine · ticket link with an SLA warning if breached ·
stock state · liability · action buttons.

Approve modal: compatibility confirmation, instance allocation, fulfilment mode, liability,
collect-old-part choice, and an info bar stating exactly which work orders will be created.

### S15 — Request a part (mobile, inside the job screen)
Machine (read-only), part select **filtered by compatibility** with the count shown
("14 of 2,180 catalogue items"), quantity, old part expected, mandatory photo, reason textarea.

---

## VERIFICATION CHECKLIST — Phase 8

**Unification**
- [ ] One queue shows both FLOOR and FIELD requests, distinguishable by a badge
- [ ] Both use the same `status_v2` vocabulary
- [ ] Legacy `support_part_requests` rows appear in the new queue with their original numbers
- [ ] The old table is untouched and the old screens still work

**Priority sort — the reason this phase exists**
- [ ] Raise a P4 part request, then a P1 part request → the **P1 is at the top** of the warehouse queue
- [ ] A breached ticket's part request sorts above everything
- [ ] Switching the sort to "Oldest first" restores FIFO

**Compatibility**
- [ ] `GET /parts/compatible?serial_id=` for a Dell Latitude 5420 returns only Dell 5420 parts
- [ ] The mobile picker shows the "14 of 2,180" count
- [ ] A model with no compatibility rows returns everything **with the warning flag set**

**Flow**
- [ ] A part request without a photo is rejected by the API, not just the UI
- [ ] Out of stock auto-escalates to procurement and sets the line `PENDING_PART`
- [ ] **The ticket SLA keeps running** while `PENDING_PART` — verify the due date does not move
- [ ] A chargeable part sets `PENDING_CUSTOMER` and the SLA **does** pause
- [ ] Approval creates a `PART_DELIVERY` WO in the right technician's bucket, same day
- [ ] Consuming requires part QR scan + asset serial scan + photo; a mismatch is refused
- [ ] Collecting the old part auto-creates a `PART_RETURN` WO in the same bucket
- [ ] `RETURNED_UNUSED` puts the instance back to `in_stock` and the count reconciles

**Blocking scope**
- [ ] A part-blocked line shows `PENDING_PART`; the ticket's other two lines continue working
- [ ] The ticket header reads "1 of 3 machines waiting for part"

**Permissions**
- [ ] `support_parts_request` only → can raise and see own requests, cannot approve (403 on approve)
- [ ] `support_parts_approve` only → sees the warehouse queue, cannot raise a request
- [ ] Neither → the Parts queue nav item is hidden and `/support-v2/parts` bounces

**Build**
- [ ] `npm test` green · `npm run build` clean · phase report written
