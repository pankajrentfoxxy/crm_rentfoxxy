# Route inventory

Part 1 §5. **A deliverable, not a deletion. Nothing in this document has been
deleted — bucket B goes to a human.**

Generated from the router itself by `frontend/scripts/route-inventory.js`, so it
can be regenerated rather than maintained by hand. Run `npm run check:routes` in
`frontend/` to verify it still holds.

---

## The numbers

| | |
|---|---:|
| Routed paths | 88 |
| — with a URL parameter (detail pages, never in a menu) | 8 |
| — concrete | 80 |
| **Unreachable from the legacy menu** | **53** |
| Recovered into `navigation.js` (bucket C) | 8 |
| Correctly absent, now on the explicit allowlist | 45 |
| Routes declaring **no** `(section, action)` | **54 of 88** |

### Two corrections to the audit

**Finding X3 says "about 64 routed pages are unreachable from the menu". The
measured figure is 53.** The difference is mostly wildcard coverage: a menu entry
for `/sales-pipeline/quotations` reaches the router's `/sales-pipeline/*`, and
counting those as unreachable overstates the problem. 53 is the number
`check-routes` enforces from here.

**The more alarming number is one the audit does not give: 54 of 88 routes
declare no `(section, action)` at all.** That is hard rule 8 and finding R13 seen
from the frontend — and it is why `navigation.js` had to supply the section for
every leaf rather than reading it off the route. Part 6.1 is where those routes
get their middleware; until then the menu is stricter than the router.

---

## Bucket A — legacy chain

Belongs to `/api/sales` (`Orders.jsx`, `Sales.jsx`, `QCOrders.jsx`,
`Dispatch.jsx`). **Retired in Part 4, Decision 1.** Deliberately given no menu
entry now: adding one would be the redesign "giving both copies a nicer menu
entry", which is precisely what the audit warns against.

| Path | Guard |
|---|---|
| `/orders` | none |
| `/sales` | none |
| `/qc-orders` | `qc_management/view` |
| `/dispatch` | `dispatch/view` |
| `/inventory` | none |
| `/leads` | none |
| `/customers` | none |
| `/follow-ups` | none |
| `/lead-orders` | none |
| `/warehouse` | `warehouse/view` |
| `/procurement` | `procurement/view` |

`/procurement` and `/warehouse` are the two writers of the legacy `inventory`
table that Part 4 does *not* remove — Part 2.4 migrates them onto
`vendor_serial_numbers` first (findings I8, B4).

---

## Bucket B — candidate duplicates

**Do not delete. This list goes to a human — BLOCKER 3.**

Each of these is reachable, works, and is answered by a screen already in the
new menu. That makes them candidates, not condemned.

| Path | Already answered by | Confidence |
|---|---|---|
| `/operation-management/quotations` | `/sales-pipeline/quotations` | High — same documents, newer screen |
| `/operation-management/quotations/add` | `/sales-pipeline/quotations` | High |
| `/operation-management/sales-orders` | `/sales-pipeline/sales-orders` | High |
| `/operation-management/sales-orders/add` | `/sales-pipeline/sales-orders` | High |
| `/operation-management/delivery-challans` | `/sales-pipeline/delivery-challans` | High |
| `/operation-management/delivery-challans/add` | `/sales-pipeline/delivery-challans` | High |
| `/operation-management/return-dc` | `/sales-pipeline/return-dc` | High |
| `/delivery-register-management` | `/sales-pipeline/delivery-register` | Medium — check which the delivery team actually uses |
| `/delivery-register-management/in-transit` | `/sales-pipeline/delivery-register/in-transit` | Medium |
| `/delivery-register-management/delivered` | `/sales-pipeline/delivery-register/delivered` | Medium |
| `/delivery-register-management/rejected` | `/sales-pipeline/delivery-register/rejected` | Medium |
| `/delivery-register-management/bucket-list` | `/sales-pipeline/technician-bucket` | Medium |
| `/customer-management/customers/add` | `/customer-management/customers` | Medium — an "add" route with no list beside it |
| `/customer-billing/*` | `/finance/*` | Medium — superseded, still routed |
| `/vendor-billing/*` | `/finance/*` | Medium |
| `/parts` | `/inventory-management/parts` | High — `/parts` is a redirect component |
| `/settings/asset-configuration` | `/asset-configuration` | **Declared twice**, in two different route files |

**`/settings/asset-configuration` is a genuine defect, not just a duplicate.**
`assetConfigurationRoutes.jsx` and `settingsRoutes.jsx` both declare it. Whichever
loads second wins, silently. That one is worth fixing regardless of what is
decided about the rest.

---

## Bucket C — finished work that only needed a menu entry

**These now have one.** This is the cheapest recovery in the whole programme:
eight screens that were built, shipped and then lost.

| Path | Now under | Guard |
|---|---|---|
| `/dashboard` | Control → Overview | `dashboard/view` |
| `/asset-configuration` | Stock → Asset Configuration | `asset_configuration/view` |
| `/customer-inventory` | Stock → Customer Inventory | `support_tickets/view` |
| `/customer-management/customers` | Sell → Customers | none declared |
| `/tickets` | Produce → Production Tickets | `tickets/view` |
| `/teams` | Control → Teams | `teams/view` |
| `/qc-management/*` | Produce → QC Management | `qc_management/view` |
| `/finance/dc-invoice`, `/finance/sale-invoice-queue`, `/finance/einvoice-queue` | Money | mixed |

The three purchase-type pages the audit calls out (`rent-to-own`,
`rental-purchase`, `direct-purchase`) live *inside* `/inventory-management/*`, so
they were never separately routed and are reached from the Stock screens. The
"Returned" column Part 5.7 mentions still does not exist.

---

## Correctly absent — the allowlist

45 paths, in `UNREACHABLE_BY_DESIGN` in `navigation.js`. Every entry is a
decision with a reason beside it, which is the difference between this list and
the 53 that were simply lost.

**Public, unauthenticated capture links** — the six route families mounted in
`server.js`, reached by a token in a link, never by a menu:
`/`, `/login`, `/access`, `/auth/impersonate`, `/register/customer`,
`/register/vendor`, `/support/request`, `/dispatch-qc-config-match`,
`/qc2-config-match`, `/rdc-config-match`, `/vendor-return-config-match`

**The technician shell** — its own app at field density, reached by its own
login: `/technician`, `/technician/login`, `/technician/dashboard`,
`/technician/profile`, `/technician/auth/callback`

**Sub-pages reached from their parent screen**, not from the menu:
`/asset-configuration/laptop`, `/asset-configuration/spare-parts`,
`/guard/scanner` *(also given a menu entry, since the gate is load-bearing under
Decision 4)*, `/tickets/create`, `/sales-management/*`

Plus bucket A and bucket B above, which stay routed and stay out of the menu
until Part 4 and your decision respectively.

---

## What keeps this from happening again

`npm run check:routes` fails CI when:

1. a route exists with no navigation entry and no allowlist entry, **and**
2. a navigation entry points at a path no route serves.

The second direction is not in the Part 1 spec and was added because it caught
five real mistakes while this file was being written — `/pending-inventory`,
`/gate-dashboard`, `/dispatch-qc`, `/bluedart-tracking` and `/settings/company`
were all plausible-looking paths that would have rendered a blank page. A menu
entry to nowhere is the same failure as a page with no menu entry, seen from the
other end.
