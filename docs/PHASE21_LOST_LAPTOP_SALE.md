# PHASE 21 — Sale in Place (lost / damaged / buyout rental laptops)

**Status:** proposal v2, decisions incorporated, awaiting go-ahead. Nothing implemented.

## Context

A customer ends up keeping a laptop they hold on rent — it is lost, damaged beyond repair,
or they simply want to buy it. We stop charging rent, credit the unused prepaid portion,
and sell them the unit they already physically hold.

Because the goods never move, **no Delivery Challan and no e-way bill is generated** — a DC
is a statutory record of a movement, and issuing one for a movement that never happened is
worse than having no document at all.

Trigger case: customer **25 — Synergie Network Engineering India Pvt Ltd**, 5 laptops.

### Decisions taken

| # | Decision |
|---|---|
| 1 | Sale entity is **gorefurbo** (`GSO-` series, Gorefurbo GSTIN) |
| 2 | Vendor-rented units **can** be sold. Vendor bills us for the unit; it becomes owned. |
| 3 | Sale price is **entered manually** per line |
| 4 | September draft INV-1184 is **left untouched**; the refund lands as a **credit line on the October invoice** |
| 5 | Build **all three reasons** — lost, damaged, buyout — selectable at report time |
| 6 | Credit notes are **correctly zero-GST**; Zoho adds GST when accounts raises the real document |
| 7 | *(new)* Accounts **attaches the Zoho invoice number + PDF against the Sale Order** |

> **Correction to my earlier review.** I had flagged zero-GST credit notes as defect P1-19.
> For the first half — the missing GST — you're right and I was wrong: the CRM figure is a
> pre-GST working number and Zoho applies tax on the real credit note. I've retracted that
> from the register. The *second* half of P1-19 still stands and is unrelated to GST:
> `Math.max(0, …)` in `invoiceMoneyTotals` silently destroys credit that exceeds the
> invoice it is applied to (₹20,284 across INV-1187 and INV-1121), with no carry-forward.

### Verified starting state (production, 2026-09-16)

| TTSPL | serial_id | Rent/mo | rent_billed_until | Acquisition |
|---|---|---|---|---|
| TTSPL2688 | 1212 | ₹1,349 | 2026-09-30 | owned (PO-0003, RENTFOXXY SELF) |
| TTSPL4803 | 1833 | ₹2,499 | 2026-09-30 | owned (PO-0005) |
| TTSPL4826 | 1545 | ₹2,499 | 2026-09-30 | owned (PO-0004) |
| TTSPL6817 | 1554 | ₹2,499 | 2026-09-30 | owned (PO-0004) |
| **TTSPL6323** | 2324 | ₹2,499 | 2026-09-30 | **vendor-rented — PO-0009, C Prompt Solutions (vendor 93), ₹1,200/mo** |

- All 5: `inventory_status='rented'`, `qc_status='passed'`, `current_customer_id=25`.
- Customer 25: `billing_type='prepaid'`, `customer_type='both'`, GST `06AANCS2014G1ZL`.
- **No security deposits exist for customer 25** — nothing to adjust or refund.
- Rent to stop: **₹11,345/month**. September already invoiced as draft INV-1184.

---

## ⚠️ The one thing that must not be done naively

**You cannot convert TTSPL6323 to Direct Purchase by changing PO-0009's type.**

PO-0009 carries **451 serials, 353 of them currently rented**. `purchase_order_type` lives
on `vendor_purchase_orders`, and `generateVendorBill` selects on
`vpo.purchase_order_type IN ('rental_purchase','rent_to_own')`
(`billingSchedulerService.js:3178-3181`). Flipping that one field to `direct_purchase`
would **silently drop all 353 rented units out of C Prompt's monthly bill** — we would stop
paying a vendor for 353 laptops we are still renting.

There is no per-serial ownership column today (`vendor_serial_numbers` has none).

**Two separate levers, and only one of them is about billing:**

1. **Stopping the vendor rent** → set `vendor_serial_numbers.vendor_rent_end_date` on that
   *one* serial. The bill query already honours it per serial
   (`vendor_rent_end_date IS NULL OR >= monthStart`), and `calcVendorLineAmount` pro-rates
   the final month correctly. This is safe and needs no schema change.
2. **Recording that we now own it** → a new **per-serial** `acquisition_type` override that
   shadows the PO type for reporting. The PO stays `rental_purchase` for the other 450.

---

## What already works — do not rebuild

1. **`sold` is already in `DEPLOYED_WITH_CUSTOMER_STATUSES`**
   (`services/customerDeployedAssets.js:7-15`). Sold units stay in the customer bucket and
   display as *Sold* with no new code.
2. **`rented → sold` already has a precedent.** `markDelivered`
   (`inventoryStateMachine.js:268-271`) carries an explicit correction for exactly this
   pair. The concept is accepted; it is only welded to a DC.
3. **Customer rent stops by itself.** `buildCustomerInvoiceLines` selects only
   `inventory_status IN ('rented','returned','in_transit')` — once `sold`, the unit leaves
   every future invoice automatically.
4. **The credit note function is reusable unchanged.** `createReturnCreditNote` already
   takes a `source` label and already skips postpaid customers.
5. **Accounts' invoice-attach pattern already exists**, at DC level:
   `sale_dc_compliance` stores `einvoice_number`, `einvoice_pdf_path`,
   `einvoice_uploaded_at`, `einvoice_uploaded_by`, gated on the `einvoice_ewb` permission
   (`migrations/171_sale_dc_compliance.sql`). The SO-level version mirrors it exactly
   rather than inventing a second shape.
6. **No entity guard on serial attach** — `salesOrderSerialController` reads `entity_code`
   from the SO header and stamps it through, so a Rentfoxxy-owned serial attaches to a
   Gorefurbo SO with no code change. *(Worth noting to Finance that this is genuinely an
   inter-company transfer: a Rentfoxxy asset sold under the Gorefurbo GSTIN.)*

---

## Blockers and fixes

| # | Blocker | Location | Fix |
|---|---|---|---|
| **B1** | Attach requires `inventory_status IN ('in_stock','passed')`; ours are `rented` | `salesOrderSerialController.js:194-199` | Narrow bypass: SO is `in_place` **and** serial is `rented` **and** `current_customer_id` = SO customer **and** an open `sale_in_place_events` row exists |
| **B2** | `ALLOWED.rented = ['returned']` | `inventoryStateMachine.js:48` | Add `rented → sold`, reachable only via the new named wrapper |
| **B3** | `sold` only reachable through `markDelivered`, which needs a DC | `inventoryStateMachine.js:262` | New `markSoldInPlace()` — no DC, explicit audit reason |
| **B4** | SO "delivered" counted from DC lines → in-place SO stuck `pending` | `salesManagementService.js:332-339`, `396-404` | Add an `in_place` branch counting `sales_order_serials` whose serial is `sold` |
| **B5** | `startWorkflow` opens `waiting_acceptance` → SLA worker nags forever | `dispatchWorkflowService.js:189-205` | Skip for `in_place` SOs |
| **B6** | Vendor rent keeps accruing | `billingSchedulerService.js:3178-3186` | Set `vendor_rent_end_date` per serial (see above) |
| **B7** | No place to record the Zoho invoice against an SO | — | New SO-level invoice-attach, mirroring `sale_dc_compliance` |
| **B8** | No per-serial ownership after vendor buyout | — | New `acquisition_type` override on the serial |

---

## Design decision: flag the SO, don't fake a DC

**Rejected — "virtual DC":** mark a DC `no_movement`, skip e-way and gate, let the existing
pipeline carry it to `markDelivered`. Least new code, but it mints a statutory delivery
document for goods that never moved, and pollutes every DC report and the e-way compliance
queue.

**Chosen — `fulfillment_mode` on the sales order.** No DC row is ever created. The
exception is visible, filterable and auditable rather than hidden inside a fake movement.

---

## Data model

**Migration `248_sale_in_place.sql`** *(verify the highest number on the branch first — this
repo already has 37 duplicate migration numbers)*

```sql
-- 1. Sales orders that fulfil without a movement
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS fulfillment_mode VARCHAR(16) NOT NULL DEFAULT 'dispatch';
ALTER TABLE sales_order_lines DROP CONSTRAINT IF EXISTS sol_fulfillment_mode_chk;
ALTER TABLE sales_order_lines ADD CONSTRAINT sol_fulfillment_mode_chk
  CHECK (fulfillment_mode IN ('dispatch','in_place'));

-- 2. Accounts attaches the Zoho invoice against the SO (mirrors sale_dc_compliance)
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS sale_invoice_number      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS sale_invoice_pdf_path    TEXT,
  ADD COLUMN IF NOT EXISTS sale_invoice_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sale_invoice_uploaded_by INT REFERENCES users(user_id);

-- 3. Per-serial ownership override — NEVER change purchase_order_type on a shared PO
ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS acquisition_type       VARCHAR(24),
  ADD COLUMN IF NOT EXISTS vendor_buyout_bill_no  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS vendor_buyout_amount   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS vendor_buyout_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vendor_buyout_by       INT REFERENCES users(user_id);

-- 4. The case record
CREATE TABLE IF NOT EXISTS sale_in_place_events (
  event_id           SERIAL PRIMARY KEY,
  serial_id          INT NOT NULL REFERENCES vendor_serial_numbers(serial_id),
  customer_id        INT NOT NULL REFERENCES customers(customer_id),
  reason             VARCHAR(16) NOT NULL CHECK (reason IN ('lost','damaged','buyout')),
  reported_on        DATE NOT NULL,           -- rent stops end of this day
  sales_order_number VARCHAR(50),
  credit_note_id     INT,
  vendor_id          INT REFERENCES vendors(vendor_id),
  vendor_settled     BOOLEAN NOT NULL DEFAULT FALSE,
  notes              TEXT,
  created_by         INT REFERENCES users(user_id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_in_place_open
  ON sale_in_place_events (serial_id) WHERE sales_order_number IS NULL;
```

`acquisition_type` is **nullable and read as an override**: effective type =
`COALESCE(vsn.acquisition_type, vpo.purchase_order_type)`. Only the vendor-billing and
ownership-reporting reads need to honour it; everything else is unaffected.

---

## The flow

### Step 1 — Report (new screen)

Customer detail → Assets tab → select rows → **Report Lost / Damaged / Buyout**.
`POST /api/customer-management/customers/:id/sale-in-place`
Body: `{ serial_ids: [...], reason: 'lost'|'damaged'|'buyout', reported_on, notes }`

Guards — reject the whole batch if any fails:
- every serial is `rented` and `current_customer_id` = this customer
- `reported_on` is not in the future and not before `rent_start_date`
- no open `sale_in_place_events` row for that serial

In one transaction, per serial (`SELECT … FOR UPDATE` first):
1. `rent_end_date = reported_on`. **Leave `inventory_status = 'rented'`** — the unit stays
   attachable and visible while the sale is priced.
2. Insert `sale_in_place_events`.
3. If effective acquisition type ∈ (`rental_purchase`, `rent_to_own`):
   - set `vendor_rent_end_date = reported_on` (stops vendor billing for **this serial
     only**)
   - stamp `vendor_id`, leave `vendor_settled = FALSE`
   - notify Procurement to obtain the vendor's buyout bill

After this step both meters have stopped — customer rent and vendor rent. Everything
downstream can happen at leisure.

### Step 2 — Credit note for unused prepaid rent

`createReturnCreditNote(client, { serialId, returnDate: reported_on, customerId, source: 'sale_in_place' })`

Worked example — reported 15 Sep, billed to 30 Sep, September = 30 days → 15 unused days:

| TTSPL | Rate | Daily | × 15 |
|---|---|---|---|
| TTSPL2688 | ₹1,349 | ₹44.97 | ₹674.50 |
| TTSPL4803 / 4826 / 6817 / 6323 | ₹2,499 | ₹83.30 | ₹1,249.50 each |
| | | **Total** | **₹5,672.50** (ex-GST, correct — Zoho adds tax) |

September draft INV-1184 is untouched. The credit surfaces as
`credit_note_adjustment` on the October invoice, which is what
`createMissingReturnCreditNotes` does at the top of `generateCustomerInvoice`.

> **Operational note:** `BILLING_CRON_ENABLED=false`, so the October run must be triggered
> manually or the credit will not appear.

### Step 3 — Vendor buyout (vendor-rented units only)

New action for Procurement: **Record Vendor Buyout** on the case.
`POST /api/vendor-management/serials/:serialId/buyout`
Body: `{ vendor_bill_no, amount, bill_pdf }`

Sets `acquisition_type='direct_purchase'`, `vendor_buyout_*`, and
`sale_in_place_events.vendor_settled = TRUE`.

**PO-0009 is not modified.** The other 450 serials keep billing normally.

### Step 4 — Create the sale SO

Normal SO creation, `quotation_type='sale'` → entity **gorefurbo** (`GSO-` series),
`fulfillment_mode='in_place'` on every line, **sale price entered manually**.

Gated on `in_place`: skip `startWorkflow` (B5); skip shipping charge, WFH and
delivery-address validation; force `security_type='none'`; UI hides *Create DC* and shows a
"Sale in place — no DC, no e-way bill" banner.

### Step 5 — Attach the serials

Existing endpoint with the B1 bypass:

```js
const lostSaleOk = inPlace
  && shelfStatus === 'rented'
  && Number(freshSerial.current_customer_id) === Number(soCustomerId)
  && await hasOpenSaleInPlaceEvent(client, freshSerial.serial_id);

if (!lostSaleOk && !['in_stock','passed'].includes(shelfStatus)) { …existing 400… }
```

Requiring an open event row means the bypass cannot attach an arbitrary rented laptop to an
arbitrary SO. Also skip pre-dispatch QC ticket creation — there is nothing to QC.

### Step 6 — Confirm sale

`POST /api/sales-management/sales-orders/:so/confirm-in-place-sale`, permission
`sales_orders_sale:edit`, with a confirmation dialog.

Blocked unless every line is `in_place`, every ordered unit has an attached serial, every
line has a rate > 0, and **every vendor-rented unit has `vendor_settled = TRUE`**.

Per serial, in one transaction:
1. `markSoldInPlace(client, { serialId, salesOrderNumber, customerId, actorUserId })` —
   `transitionAsset` to `SOLD`, **no `dcNumber`**, `current_customer_id` retained, audit
   reason `Sold in place on {SO} — {reason} at customer (no DC / no movement)`, with the
   normal `inventory_status_transitions` row and TTSPL audit event.
2. `sales_order_serials.status='dispatched'`, `dc_number = NULL`.
3. Stamp `sale_in_place_events.sales_order_number`.
4. Post-commit: regenerate SO PDF, email SO to the customer.

### Step 7 — Accounts attaches the Zoho invoice

New **Sale Invoice Pending** queue for accounts: in-place SOs that are confirmed but have
no `sale_invoice_number`. Mirrors `financeOverviewController.getDcInvoiceQueue`.

`POST /api/sales-management/sales-orders/:so/sale-invoice`
multipart: `{ sale_invoice_number, sale_invoice_pdf }`
Permission gate: the same one `sale_dc_compliance` uses — `einvoice_ewb` can_create /
can_edit, plus accounts and super_admin.

> **⚠️ Do not ship this into `backend/uploads/` as it stands.** That whole tree is currently
> served by `express.static` with **no authentication** (`server.js:78-79`) — 13,146 files
> are publicly readable today, which is P0-2 in the review register. Adding customer sale
> invoices there makes the exposure worse. Either fix P0-2 first, or serve this one folder
> exclusively through an authenticated download route from day one. My recommendation is to
> fix P0-2 first — it is a day of work and this feature is one of several that keep piling
> onto it.

### Step 8 — Result

- 5 units `inventory_status='sold'`, `current_customer_id=25`, **no DC anywhere**
- Shown in the customer bucket as **Sold**, against the `GSO-` order
- Zero customer rent from October; C Prompt billing stopped for TTSPL6323 only
- ₹5,672.50 credit line on the October invoice
- Zoho invoice number + PDF attached to the SO

---

## Edge cases

| Case | Handling |
|---|---|
| Laptop found after sale | No un-sell path. Handle commercially as buy-back → new GRN intake. |
| SO cancelled after attach, before confirm | Release serials back to `rented` (not `in_stock`); reopen the event row |
| SO cancelled after confirm | Block — needs a Zoho credit note; a sold in-place unit must not be silently reversed |
| Customer later returns a sold unit | Normal return pickup; `ALLOWED.sold = ['returned']` already permits it |
| Partial (3 of 5) | Fully supported — per-serial throughout |
| Postpaid customer | `createReturnCreditNote` returns null and logs; rent simply stops. Correct. |
| `reported_on` in an already-closed month | Credit spans >1 month; `monthSegments` handles it, but flag for finance review |
| Buyout reason, unit not lost | Identical flow; only the audit reason and customer comms differ |

---

## Files touched

| File | Change |
|---|---|
| `migrations/248_sale_in_place.sql` | new |
| `services/saleInPlaceService.js` | **new** — owns steps 1, 2, 3, 6 |
| `services/inventoryStateMachine.js` | `ALLOWED.rented += 'sold'`; `markSoldInPlace()` |
| `controllers/salesOrderSerialController.js` | B1 attach bypass |
| `services/salesManagementService.js` | B4 in-place fulfilment counting |
| `controllers/salesManagementController.js` | persist `fulfillment_mode`; skip workflow/shipping/security; `confirmInPlaceSale`; `uploadSaleInvoice` |
| `services/billingSchedulerService.js` | honour `acquisition_type` override in the vendor-bill query; `source` label |
| `controllers/customerManagementController.js` | `reportSaleInPlace` endpoint |
| `controllers/financeOverviewController.js` | Sale Invoice Pending queue |
| `controllers/vendorManagement/serialNumbers.controller.js` | Record Vendor Buyout |
| `frontend` — customer detail, SO detail, finance queue | 3 UI surfaces |

One new backend service, one migration, ~9 touched files, 3 UI surfaces. Most of the
behaviour is reuse.

---

## Verification plan

1. Migration applies; `fulfillment_mode` defaults to `'dispatch'` everywhere and **no
   existing SO behaviour changes**.
2. Unit-test `markSoldInPlace`: asserts `rented → sold`, no `dcNumber`, audit row written.
3. Unit-test the credit maths against the worked example (₹5,672.50 across the 5).
4. **Vendor-billing regression is the critical one:** generate C Prompt's October bill on
   staging and assert it contains **450 serials, not 451 and not 0**. This is the test that
   catches a mistaken PO-level change.
5. Staging dry run with customer 25's 5 serials — confirm: no `delivery_challan_lines` row;
   SO reaches `delivered` in the list; no `dispatch_workflow` row; October invoice for
   customer 25 excludes all 5 and carries the ₹5,672.50 credit line; `vendor_rent_end_date`
   set on serial 2324 only.
6. Regression: one ordinary dispatch SO end-to-end — DC, e-way and gate flow untouched.

---

## Open points

1. **Sequencing vs P0-2.** Step 7 adds customer sale invoices to a publicly readable upload
   tree. Strong recommendation: fix `/uploads` authentication first.
2. **Inter-company transfer.** Selling Rentfoxxy-owned assets under the Gorefurbo GSTIN is
   a real inter-company movement. Confirm Finance is accounting for it — the CRM will
   happily record it either way.
3. **Buyout price floor.** With manual pricing there is no guard against selling below
   written-down value. Worth a soft warning in the UI if the price is under, say, 50% of
   purchase cost — cheap to add, easy to skip.
