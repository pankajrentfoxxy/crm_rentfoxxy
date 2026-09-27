# Customers, customer returns + damage charges, Control (27 Sep 2026)

## Decisions (user, 27 Sep)
- **CU1 Customer tag automatic**: Rental / Sales / Both follows what the customer does — a rental
  (or demo) order or rented laptop → Rental; a sale order or sold laptop → Sales; both → Both.
  All customers re-tagged from their orders / laptops; admin may override with a reason.
- **CT1 Role gates**: every hardcoded role list also accepts the matching permission grant, so
  the Roles & Permissions screen controls access and nobody loses access today. Role lists are
  removed after sign-off.
- **RT1 Rent stops on the WAREHOUSE RECEIVE day** (not the pickup day).
- **DM1 Damage charges** — for a return pickup, a repair pickup, and a technician's complaint
  visit:
  1. The technician (at the visit / pickup) or the warehouse (at receive) records each damaged /
     missing part with the issue and photos.
  2. The warehouse prices each part.
  3. Sales / Accounts talk to the customer and propose the charges; the customer gets an email
     with the details (parts, issues, photos, amounts).
  4. Accounts mark it approved (or waived / reduced with a reason).
  5. Approved charges go on the next month's invoice as "Damage charges".
- **SD1 Security deposit** is refunded only when the customer's account is closed — never on a
  laptop return. Account closure: no laptops with the customer, no open dues → Accounts refund
  the deposit (minus anything owed) → customer closed.
- Menu renamed: Procure → Procurement, Move → Movement, Serve → Support, Money → Finance (done).

## Found (27 Sep)
- Warehouse receive of every customer return crashed (undefined transitionAsset) — FIXED 87887703,
  with three more undefined-name crashes (floor tickets Completed tab — also on live — support
  ticket cancel, support OTP log, ERP sync).
- Customers: `customers.customer_type` (sales / rental / both, default both) is manual; ~43 disagree
  with activity; lead conversion never sets it. New UI has only a thin list, no record page.
- Returns: new UI return-challan list only (its Received tab is a no-op, row click loses the RDC);
  rent stops at POD; no damage / missing-charger charging (support_damage_catalog unused); 41
  returned laptops without a floor ticket; security-deposit refund can over-refund when
  refund_amount is omitted.
- Control: role change / password reset do not end sessions (token_version not bumped); Apply
  Role Defaults wipes non-admin roles; user-override save is delete-then-put; no escalation guard;
  several enforced sections cannot be granted, several grantable ones are enforced nowhere;
  role-level data scope not editable; support_agent / support_manager / custom roles cannot be
  assigned (users_role_check); ~40 hardcoded role gates.

## Build
1. **Customers** — tag service + backfill; list (tag, laptops rented / sold / returned, monthly
   rent, security, KYC, status; filters); record page (header + tag, summary, Rented / Returned /
   Purchased tabs with export, orders, tickets, billing statement, addresses & contacts).
2. **Returns** — rent stop at warehouse receive (billing + state machine); new-UI Return challans
   (proper status tabs, awaiting-warehouse, open one RDC) and RDC record with warehouse receive
   (condition, damage per laptop); floor tickets for the 41 stranded returned laptops.
3. **Damage charges** (DM1) — cases + lines + photos; warehouse pricing; sales/accounts proposal
   + customer email; accounts approval; invoice line via Support charges to bill (charge_type
   'damage'); from technician visits (Support job page), repair / return pickups and warehouse
   receive.
4. **Control** — new-UI Users, Roles, Role permissions (all enforced sections, grouped, with data
   scope / customer access / ready-stock access at role level), User overrides (differences
   only, saved in one go), audit log; backend fixes above; CT1 across the hardcoded gates.
5. **Account closure + deposit refund** (SD1), with the refund over-refund fix.
