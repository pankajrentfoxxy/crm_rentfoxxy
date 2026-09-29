# Move leftovers — plan (29 Sep 2026, pending item 10)

The last Movement menu entries that still opened old screens: Dispatch Chargers,
Part Inward, Pending Dispatch, Delivery Technicians, Dispatch QC. Rule as before: the new
screens call the existing APIs; old screens stay under "Old view" until sign-off.

## What was wrong (found 29 Sep)

| Entry | Problem |
|---|---|
| Dispatch Chargers | Pending rows showed only request no. / TTSPL / brand / model. No requester, no request date, no customer, no configuration, often no SO — yet "Approve & hand over" was always active. The backend handed a kit over for any pending request, even one whose ticket was cancelled or whose laptop had left the order. It was also a stand-alone screen, detached from the order it serves. |
| Part Inward | Menu link `/inventory-management/physical-part-inward` does not exist (the route is `/inventory-management/physical-parts/inward`), so it fell through to the inventory index. Wrong section too (`parts_inventory`; the API is `physical_dead_parts`). |
| Pending Dispatch | Old screen only. It is the dispatch team's acceptance inbox (SOs round-robin assigned, `waiting_acceptance`), i.e. step 0 of Order to delivery. |
| Delivery Technicians | Old screens. Menu gated on `delivery_register_management`, route on `delivery_technicians`, API on `technician_bucket` — three different sections, so users saw a link they could not open or opened a page the API refused. |
| Dispatch QC | Linked to the old floor pipeline, although Dispatch QC runs on the new floor board / ticket. |

## Decisions

**M1 — Charger handover is part of Order to delivery, not a separate screen.** The request
is raised at Dispatch QC; the handover now happens in the same process:
- *Sales order → Laptops*: a **Charger** column per laptop (not chosen / waiting for
  warehouse / handed over / attached / with customer). A warehouse user sees **Hand over**
  right there.
- *Floor ticket → Dispatch QC*: the waiting-for-warehouse box shows the full request and
  what is missing, and a warehouse user can hand over from the ticket.
- *Movement → Outward → Chargers to hand over*: the warehouse's to-do list of the same step;
  every row names the laptop, the order and the requester and links to both.
One drawer (`ChargerHandoverDrawer`) is used from all three places.

**M2 — No handover without the details.** A pending request shows *Hand over* only when it
has: laptop TTSPL, serial, brand/model, sales order, requester and request date; and the
Dispatch QC ticket is not cancelled, the laptop is still on the order, the order is not
cancelled and the laptop is not already on a challan. Otherwise the row lists what is
missing ("fix at Dispatch QC: cancel and raise again"). The backend enforces the same rule
(`handoverBlockers`, 409) and now locks the request row, so two warehouse users cannot
hand two kits to one request.

**M3 — Pending Dispatch = "Orders to accept"** in Movement → Outward (first entry). Same
API (`/dispatch-workflow/pending-orders`, accept), live countdown, overdue in red; accepting
opens the order in the new UI.

**M4 — Delivery Technicians** in Movement → Gate & tracking, new screen with list, add /
edit (drawer, photo + ID images), active toggle, password change, login-as (super admin),
delete. Menu and route use `technician_bucket` — the section the API has always enforced —
so nobody gains a power they did not already have through the API.

**M5 — Part Inward** in Movement → Inward, new screen: inwards list, dead/physical parts
list with counts, and *Record inward* (reason, warehouse, date, part lines with quantity,
condition, per-unit serial + photos). Outward (scrap / vendor challan) stays on the old
screen, linked from the page. Section `physical_dead_parts`.

**M6 — Dispatch QC** menu entry opens the new floor board filtered to the Dispatch QC stage.

## Backend changes
- `dispatchChargerService`: `REQUEST_DETAIL_SQL` (laptop from the asset record, SO +
  customer, challan, requester, ticket state), `handoverBlockers`, `detailedRequest`,
  `getRequestDetail(forUpdate)`; `listWarehouseQueue` takes `search`, `so`, `request_id`;
  `approveAndHandover` locks and refuses with blockers.
- `GET /dispatch-chargers/ticket/:id` returns the detailed request.
- `GET /sales-management/sales-orders/:so/serials` adds `charger_*` per allocation.
- Test: `test/dispatchChargerHandover.test.js`.
No migration.

## Click-through on QA
1. Floor ticket at Dispatch QC → Charger attach → request raised.
2. SO record → Laptops: Charger column says "Waiting for warehouse"; as warehouse, Hand over
   → drawer shows laptop, config, SO, customer, requester → scan adapter + cable.
3. Movement → Chargers to hand over: same request, full row; a request with missing details
   shows why and no button.
4. Movement → Orders to accept / Delivery Technicians / Part Inward / Dispatch QC open the new
   screens.
