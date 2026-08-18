# PHASE 6 — Return pickup, condition grading, bulk returns, credit notes

> Read `00_MASTER_CONTEXT.md` first.
> **Screens:** the return pickup path through S9/S7/S12, plus a new **Bulk return** wizard.
> **Depends on:** Phase 5.
> **Adds one work order type. The engine does not change.**

---

## 6.1 Repair vs Return — the difference, in code

You are implementing a *different type*, not a variant of the same one. This table is the spec:

| | `REPAIR_PICKUP` (Phase 5) | `RETURN_PICKUP` (this phase) |
|---|---|---|
| Ticket class | INCIDENT | REQUEST (`LOG-RET-*`) or a replacement leg |
| Billing | **hold** starts, ends on service return | **stop** — permanent |
| Credit note | none | **pro-rata, raised once, at warehouse receipt** |
| Customer inventory | stays assigned, `UNDER_REPAIR` | removed, `PASSIVE` |
| Asset destination | back to the same customer | free stock |
| Follow-on WO | `SERVICE_RETURN` | none (or a paired `REPLACEMENT_DELIVERY`) |
| Condition grading | optional | **mandatory** A/B/C/D + damage checklist |
| Contract | unchanged | line closed / quantity reduced |

The legacy module told these apart with a nullable flag and three disagreeing heuristics
(PLAN D3–D5). Here they are two values of a DB-constrained enum with two separate effect modules.
There is no heuristic to get wrong.

---

## 6.2 Migration `201_support_v2_return_pickup.sql`

```sql
ALTER TABLE support_work_orders
  ADD COLUMN IF NOT EXISTS bulk_group_id UUID,
  ADD COLUMN IF NOT EXISTS site_id INT REFERENCES customer_addresses(address_id);
CREATE INDEX IF NOT EXISTS idx_wo_bulk ON support_work_orders(bulk_group_id)
  WHERE bulk_group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_asset_condition (
  condition_id     SERIAL PRIMARY KEY,
  wo_id            INT NOT NULL REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  line_id          INT REFERENCES support_ticket_assets(line_id),
  serial_id        INT NOT NULL REFERENCES vendor_serial_numbers(serial_id),
  grade            CHAR(1) NOT NULL CHECK (grade IN ('A','B','C','D')),
  damage_items     JSONB NOT NULL DEFAULT '[]',
  accessories      JSONB NOT NULL DEFAULT '{}',
  missing_items    JSONB NOT NULL DEFAULT '[]',
  chargeable_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  assessed_by      INT REFERENCES users(user_id),
  assessed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes            TEXT,
  UNIQUE (wo_id, serial_id)
);

CREATE TABLE IF NOT EXISTS support_accessory_catalog (
  accessory_id SERIAL PRIMARY KEY,
  code    VARCHAR(24) NOT NULL UNIQUE,
  name    VARCHAR(80) NOT NULL,
  charge_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  active  BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO support_accessory_catalog (code, name, charge_amount) VALUES
  ('ADAPTER','Power adapter',2400), ('BAG','Laptop bag',900),
  ('MOUSE','Mouse',450), ('KEYBOARD','External keyboard',1200),
  ('DOCK','Docking station',6500), ('SLEEVE','Sleeve',400)
ON CONFLICT (code) DO NOTHING;
```

### Grade definitions — put these in the UI as helper text, not just in a spec
```
A  Like new. No visible marks. Fully functional.
B  Light cosmetic wear. Minor scuffs. Fully functional.
C  Visible wear — dents, deep scratches, worn keys. Functional.
D  Damaged — cracked screen/body, hinge broken, liquid, non-functional.
```
Grades C and D **require** at least one damage item and photos.

---

## 6.3 Backend

### `RETURN_PICKUP.onCreate`
1. Asset is currently deployed with this customer.
2. **Lock-in check** — if the contract has a lock-in end date in the future, create a
   `support_approvals` row of type `EARLY_TERMINATION` with the computed charge, and hold the WO in
   `DRAFT` until approved or waived.
3. **Dues check** — if the customer has overdue invoices, notify Accounts. Do **not** block:
   blocking a return is bad practice and creates disputes. Flag it, do not gate it.
4. Generate the Return DC (`dc_purpose = 'return'`). If the consignment value exceeds ₹50,000,
   flag `requires_eway_bill = true` on the WO so the Zoho integration can pick it up.
5. Mint one `customer_otp`.

### `RETURN_PICKUP.onComplete` (technician side, at the customer)
```js
await inventorySM.markInTransit(client, serialId, { reason: 'SUPPORT_RETURN_PICKUP', woId });
await removeFromCustomerInventory(client, serialId, { reason: 'Returned by customer', woId });
await recordBillingStop(client, { serialId, customerId, stopDate: today, woId });
// NO credit note here — it is raised at warehouse receipt, once. See 6.4.
```

### Warehouse receipt — the one place a credit note is raised
This is PLAN D10. There were two competing implementations; there is now one.

```js
// backend/services/workOrderEffects/returnPickup.js
async function onWarehouseReceipt(client, wo, { serialIds, userId }) {
  for (const serialId of serialIds) {
    await inventorySM.markReturned(client, serialId, { qcStatus: 'pending', woId: wo.wo_id });
    await createFloorQcTicket(client, { serialId, source: 'SUPPORT_RETURN', woId: wo.wo_id });
    await raiseReturnCreditNoteOnce(client, { serialId, customerId: wo.customer_id,
                                              stopDate: wo.billing_stop_date, woId: wo.wo_id });
  }
}
```

`raiseReturnCreditNoteOnce` must be genuinely idempotent — a unique key on
`(serial_id, wo_id)` in `customer_credit_notes` (add it in this migration) so a retry or a
double-click cannot double-credit.

### Endpoints
```
POST /tickets/:id/work-orders                    type RETURN_PICKUP    requireWoType('create')
POST /work-orders/:woId/condition                cp('support_bucket','edit')   own only
       body: { serial_id, grade, damage_items[], accessories{}, missing_items[], notes, attachment_ids[] }
POST /work-orders/:woId/warehouse-receipt        cp('support_pickup_return','edit')
       body: { serial_ids[], scanned: true }
POST /returns/bulk                               cp('support_pickup_return','create')
GET  /returns/bulk/:groupId                      cp('support_pickup_return','view')
```

### `POST /returns/bulk` — the mass-return path
```json
{ "customer_id": 88, "site_id": 141, "reason": "END_OF_CONTRACT",
  "serial_ids": [ … 40 ids … ], "target_date": "2026-08-20",
  "vehicle_capacity": 25 }
```
Creates **one ticket** (class REQUEST, `LOG-RET-EOC`), 40 asset lines, and groups the work into
`RETURN_PICKUP` WOs **by site and by vehicle capacity** — 40 laptops at one site with capacity 25
becomes 2 WOs, not 40. All share a `bulk_group_id`.

> One WO per laptop would be operationally useless. This grouping rule is the difference between
> the feature being used and being worked around.

---

## 6.4 Chargeable damage

When a technician grades C or D, or records missing accessories:
1. `chargeable_total` is computed = sum of damage item charges + accessory catalogue charges.
2. A `customer_invoice_extra_lines` row per charge type, status `PENDING`, with the photo
   attachment ids in `evidence_urls`.
3. A `support_approvals` row (`DAMAGE_CHARGE`), approver = support lead, or manager above ₹10,000.
4. Nothing is billed until approved. Waiving writes `status = 'WAIVED'` with a reason.

**No charge without evidence.** The API rejects a chargeable line with zero photo attachments.

---

## 6.5 Frontend

### Bulk return wizard — `pages/BulkReturnPage.jsx`
Step 1 customer + site + reason · Step 2 asset multi-select with "select all at site" and a running
count/value · Step 3 lock-in warning + early-termination charge with an approval notice ·
Step 4 schedule and grouping preview ("40 assets → 2 work orders on 20 Aug").

### Condition grading — `components/ConditionGradingSheet.jsx`
Used inside the job screen at the `CONDITION_GRADE` step. For each serial on the WO:
grade selector (A/B/C/D as four large tap targets with the definitions as helper text),
damage checklist, accessories checklist (Present / Missing / Damaged per accessory),
photo capture, notes. A running "Chargeable so far: ₹X" total that updates live, so the technician
knows what they are about to propose in front of the customer.

### Warehouse receipt — `pages/WarehouseReceiptPage.jsx`
Scan-driven. Scan a serial → it ticks off the expected list. Shows expected vs scanned vs missing.
Cannot submit with unscanned serials unless a short-shipment reason is given.

---

## VERIFICATION CHECKLIST — Phase 6

**Type separation — the regression this phase exists to prevent**
- [ ] Create a repair pickup and a return pickup on the same customer, same day
- [ ] Each has its own WO row with its own `wo_type`; no nullable flag anywhere
- [ ] Completing the return pickup raises exactly one credit note; the repair pickup raises none
- [ ] Completing the repair pickup opens a billing hold; the return pickup records a billing stop
- [ ] Both DCs have correct, sequential, unbroken numbers

**Credit note idempotency**
- [ ] Warehouse-receipt the same serial twice → still exactly one credit note
- [ ] Double-click the submit button → one credit note
- [ ] The unique constraint on `(serial_id, wo_id)` exists and is enforced

**Grading**
- [ ] Grade C without a damage item → rejected
- [ ] Grade D without a photo → rejected
- [ ] Missing adapter adds ₹2,400 to the chargeable total from the catalogue, not hard-coded
- [ ] Chargeable > 0 creates a `customer_invoice_extra_lines` row and an approval, both PENDING
- [ ] Nothing appears on an invoice until the approval is decided

**Bulk**
- [ ] A 40-asset return at one site with capacity 25 creates **2** work orders, not 40
- [ ] Both share a `bulk_group_id` and one parent ticket
- [ ] A 40-asset return across 3 sites creates work orders grouped by site

**Lock-in**
- [ ] Returning inside the lock-in creates an `EARLY_TERMINATION` approval and holds the WO in DRAFT
- [ ] Approving releases it to `PENDING_ASSIGNMENT`
- [ ] Waiving releases it and writes the waiver reason
- [ ] Overdue invoices notify Accounts but **do not block** the return

**Permissions**
- [ ] `support_pickup_return` removed → the Return pickup chip disappears from S9 and the endpoint 403s,
      while repair pickups still work fully
- [ ] Warehouse receipt requires `support_pickup_return · edit`, not just `support_bucket`

**Build**
- [ ] `npm test` green · `npm run build` clean · phase report written
