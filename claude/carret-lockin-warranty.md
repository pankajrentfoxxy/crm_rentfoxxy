# Lock-in on replacement + early return, and gorefurbo warranty (27 Sep 2026)

## Decisions (user, 27 Sep)
- **L1** A replacement keeps the ORIGINAL laptop's lock-in end date — the remaining days,
  not a fresh lock-in.
- **L2** Support sees lock-in on the laptop when creating a ticket. A **return** pickup is
  refused while lock-in is running. (Repair pickups and the old unit's pickup in a
  replacement are not returns and are allowed.)
- **L3** Early return: Support raises an *early-return request* → **Sales** proposes
  (full remaining rent / negotiated amount / waive) → **Accounts** approves or rejects.
  Only an approved request lets Support create the return pickup for that laptop.
- **L4** The approved amount is one **"Lock-in break"** charge on the customer's next
  invoice (Money → Support charges to bill). Full = remaining days × monthly rate / 30.
- **W1** Gorefurbo sold laptop out of warranty: **paid repair only**. Parts are always
  chargeable, a service charge can be added, and a free replacement is refused.
- **W2** Out-of-warranty charges for a sale customer: Accounts approve → the CRM raises a
  gorefurbo **service sales order** (no laptops, no DC); Accounts attach the Zoho invoice
  on the sale-invoice queue, the same way as in-place sales.

## What the code does today (found 27 Sep)
- Lock-in = `sales_order_lines.locking_period` (months) only. No per-laptop date. Billing,
  pickups, support never read it. Replacement SO lines are written with `locking_period = 0`
  and the new laptop gets a fresh rent start → lock-in lost.
- Warranty = `sales_order_lines.technical_warranty` / `battery_charger_warranty` (months)
  only. No start/end date; every support action on a sold laptop is free.
- QA data: 3,140 rented laptops, 2,556 with lock-in > 0 (mostly 1 month; 3/6/12 too).
  287 sold, 191 with technical warranty > 0.

## Design
### Data (migration 350)
- `vendor_serial_numbers`: `lock_in_start_date`, `lock_in_end_date`, `warranty_start_date`,
  `warranty_end_date`, `battery_warranty_end_date` (DATE).
  Lock-in end = rent start + N months; a return is free on/after that day.
  Warranty = delivery date + N months.
- `support_replacement_orders`: `old_lock_in_end_date`, `old_warranty_end_date`,
  `old_battery_warranty_end_date` — captured when the replacement is raised.
- `lock_in_break_requests` — one row per laptop: raised → `pending_sales` →
  `pending_accounts` → `approved` / `rejected` (or `cancelled`); `used` once the pickup is made.
- `support_ticket_items.warranty_status` (`in` / `out` / `battery_only`) stamped on sold laptops.
- `support_service_charges` — service charges on a ticket (out of warranty), and the
  service SO they were billed on.

### Stamping
- `inventoryStateMachine.markDelivered`: rental → lock-in from the SO line; sale → warranty
  from the SO line. A caller may pass carried dates (replacement), which win.
- Replacement delivery (`onReplacementOutboundDelivered`, legacy `bridgeSupportReplacement`):
  pass the old laptop's dates.
- `markSoldInPlace`: warranty from the in-place SO line, starting the sale day.
- Backfill script (dry-run first) for laptops already out.

### Support
- `GET /support/customers/:id/assets` adds deal, lock-in end + days left, warranty end +
  status, and any open / approved early-return request.
- Every return-pickup path checks lock-in: `executePickupWithReturnDc` (ticket pickup, pickup
  ticket, portal request convert, public pickup). Error `LOCK_IN_ACTIVE` names the laptops.
- Out-of-warranty sold laptop: part requests forced to `charge_customer`; replacement
  refused (`OUT_OF_WARRANTY`); service charge can be added on the ticket.

### Screens (new UI)
- New ticket + ticket record: lock-in / warranty badges; "Ask for early return" when a return
  is blocked.
- **Sell → Early returns** (Sales: propose) and **Money → Early returns** (Accounts:
  approve/reject) — one page, actions by permission.
- **Money → Service billing (gorefurbo)**: approved out-of-warranty charges per customer →
  "Raise service SO"; then the SO shows in the sale-invoice queue.

### Permissions
- Raise early return: `support_tickets` create. Propose: any sales-order section edit.
  Approve: `customer_billing` edit. Service charges: support lead adds; `customer_billing`
  edit approves / raises the SO.

## Build order
1. Migration + stamping + backfill (dry-run, then QA).
2. Lock-in: asset API, pickup block, early-return API + page, charge line.
3. Warranty: stamping, asset API, forced chargeable parts, replacement refusal.
4. Service charges + service SO + sale-invoice queue.
5. Screens, build, QA click-through list.

## Status 27 Sep 2026 — built on QA
- Migrations 350–352 applied to QA; backfill committed (3,040 rented + 287 sold stamped; 403
  rented in lock-in today, 98 replacements traced to the original laptop; 100 rented laptops
  have no rent start, so no lock-in).
- Backend: `lockInWarrantyService`, `lockInBreakService` (/api/early-returns),
  `supportServiceBillingService` (/api/service-billing). Tests: `test/lockInWarranty.test.js`.
- Screens: New ticket (lock-in / warranty column + notices), ticket record (pickup blocks a
  locked return and offers "Ask for early return"; early returns listed; warranty per laptop;
  Service charges panel), Sell / Serve / Money → Early Returns, Money → Service Billing.

### QA click-through
1. New ticket for a customer with a laptop in lock-in (e.g. customer 263, TTSPL4317) → the
   column shows "Lock-in till 21 Feb 2027".
2. Ticket → Schedule pickup → Return → the lock-in notice → Ask for early return.
3. Sell → Early Returns → Propose (negotiated) → Money → Early Returns → Decide → Approve.
4. Money → Support charges to bill shows the "Lock-in break" line; the ticket's pickup now goes through.
5. Sold laptop out of warranty (e.g. customer 279, TTSPL1025): ticket shows "OUT of warranty";
   Start replacement is refused; a part request is charged automatically; add a service charge.
6. Money → Service Billing → approve → Raise service order → Attach invoice.
7. A replacement delivered for a rented laptop keeps the old lock-in end (Asset record / API).

### Not done / later
- Customer portal: a return request is accepted as before; the lock-in stops it at conversion
  (Support then raises the early return). The portal does not show lock-in yet.
- The old ticket screens show the server's lock-in / warranty message but no new buttons.
