# Carret — Support: the plan

Asked 26 Sep 2026: build Support end to end in Carret — easy for the technician (phone) and the Support
Lead (desk), fully working. Same method as the other processes: decisions → safety fixes (each with a test)
→ screens → menu → QA click-through; old screens stay under "Old view" until sign-off.
Survey: subagent report 26 Sep (file:line references in the session); key facts below.

## Where it stands today
- **Runs on v1 tables only** (`support_tickets`, `support_ticket_items`, `support_requests`,
  `support_part_requests`, `support_replacement_orders`, DCs in `delivery_challan_lines`). The 25 Support v2
  tables on QA (301–326) are read by **nothing**; 323 (technician access revoke) held back.
- **Intake:** staff desk ticket, staff pickup ticket, extra phases, public QR page, customer portal. QR/portal
  land as requests a lead converts. No inbound email/WhatsApp.
- **Statuses:** ticket 4 values, item 15 values, no CHECK constraints; a replacement-order status is written
  unchecked from the body (U2); `recomputeTicketStatus` has a dead branch (U3).
- **Technician:** work spread over 4 screens and 2 identities (`users.support_tech` for tickets,
  `delivery_technicians` for DCs). A complaint = 7 separate actions; a pickup is worked on the old
  My Deliveries screen. Technicians are probably **locked out of their own parts bucket** (403) since the
  U21/U22 fix gates it on a warehouse section they don't hold.
- **Lead:** 20+ v1 pages; assignment manual, no load view; `visit_scheduled_at` never shown; SLA = one 48-hour
  "overdue" flag; no CSAT; WhatsApp outbound only, no log.
- **Repair loop:** pickup → gate → warehouse confirm (3 duplicate endpoints) → floor ticket → **nothing tells
  support the floor finished** (U13) → lead creates the Service DC → My Deliveries OTP → repair-window credit.
- **Money:** customer-charged parts never reach an invoice (U9); mark-used writes no cost row (U11);
  replacement delivery hardcodes rental / Rentfoxxy entity (wrong for sale / other-entity customers).
- **Holes still open:** technician can see every delivery technician's bucket (`technician_bucket:view`
  reopens 257); "reached" on a DC has no ownership check (V5); ticket list ignores customer-type scope;
  settings/categories editable by the `admin` role string only (support_lead and super_admin refused).

## Target process
**Ticket (lead desk)** — one Queue: every open ticket and incoming request with SLA clock, priority, customer,
laptop, type (complaint / pickup-repair / replacement), assignee, next step. Requests (QR/portal) convert in
one click. Create ticket from customer + laptop (asset picker), issue category, priority, visit slot.
**Assign** — lead picks a technician from a list showing each one's open jobs today and area; the suggested
one is first. The technician sees the job with the appointment.
**Technician (phone, "My work")** — one list for the day across complaints, pickups, Service-DC / replacement
deliveries and part handovers, in visit order. Each job is one screen with the next step as the big button:
- Complaint: **Arrived** (GPS + scan TTSPL) → **Result**: fixed / needs parts / needs pickup (photo + note)
  → **Customer OTP** closes it. (3 taps instead of 7.)
- Needs parts: request from the job; the part arrives in "My parts"; fit it; return the old one.
- Pickup: Arrived → scan laptop + charger → customer OTP → drop at warehouse (gate).
- Delivery (repaired / replacement): the existing Carret delivery flow.
**Repair loop** — gate inward → warehouse confirm (one endpoint) → floor ticket → floor QC pass
**automatically** marks the support item "repaired — ready to return" and puts it on the lead's list → lead
creates the Service DC in one click → delivery → credit.
**Replacement** — sales order and DC use the customer's own deal (rental/sale, entity), not hardcoded.
**Close** — customer OTP (or lead close with reason); CSAT link on WhatsApp; SLA stops.

## Decisions needed (my recommendation first)
- **S1 Data.** Keep the v1 tables the running code uses; take from v2 only what is new — events (history),
  SLA policies/clocks, CSAT tokens, attachments, customer invoice extra lines. Leave the rest of v2 unused.
- **S2 Technician identity.** Keep both; "My work" merges them through the existing bridge (a support_tech
  user linked to their delivery_technicians row). No new login.
- **S3 Assignment.** Lead assigns; the screen suggests the least-loaded technician in the customer's
  area; no accept step (fewer taps). Auto-assign later if wanted.
- **S4 Complaint steps.** Collapse to Arrived → Result → Customer OTP, over the existing endpoints (one
  backend call per tap); retire the duplicate routes from the new UI.
- **S5 SLA.** Priority targets (business hours 9:00–19:00 Mon–Sat): Urgent — visit 4 h / resolve 1 day;
  High — 8 h / 2 days; Normal — 1 day / 3 days; Low — 2 days / 5 days. Clock pauses while waiting on the
  customer or a part. (Numbers are the user's call.)
- **S6 CSAT.** After close, WhatsApp link: 1–5 stars + comment; shown on the lead's board and per technician.
- **S7 Repair loop.** Floor QC pass on a support pickup laptop auto-advances the support item and notifies
  the lead (fixes U13).
- **S8 Customer-charged parts.** Added as a line on the customer's next invoice (v2
  `customer_invoice_extra_lines`); Accounts sees them before the invoice run.
- **S9 Replacement deal.** Take rental/sale and entity from the customer's original sales order/DC.
- **S10 Intake.** Keep QR + portal + staff; inbound email/WhatsApp later.
- **S11 Access.** Technicians see only their own jobs and parts (apply 323's intent through the new rules at
  cutover); leads see all; settings/categories editable by support_lead and super_admin too.
- **S12 Status rules.** One allowed-transition map for item status (like the asset state machine), every
  change audited from→to; unknown statuses refused (fixes U1, U2, U17).

## Build order (after decisions)
0. Safety fixes, each with a test: technician parts-bucket lockout; own-scope for technician bucket and V5;
   U2/U3; status transition map + audit (S12); customer-type scope on ticket list; settings roles.
1. Repair loop (S7) + replacement deal (S9) + parts cost/charge (U11, S8).
2. SLA + events + CSAT (S5, S6) — backend first.
3. Technician "My work" (FieldShell): list, job screen, complaint 3-step, pickup, parts.
4. Lead desk: Queue (tickets + requests), ticket record, create, assign with load, repair-loop list,
   SLA board, technicians, settings.
5. Menu (Serve opens the new screens; old under "Old view"), QA click-through.

## Progress
- **Step 0 — safety fixes: DONE** (3ff00bdf, migration 344).
- **Step 1 — repair loop, deal, charges: DONE** (migrations 345, 346):
  S7 trigger stamps `repair_ready_at` when the floor completes the repair; such a laptop can't be reserved for a
  sale. S9 replacement SO + delivery take the replaced laptop's deal (rental/sale, entity). Parts: free by default;
  Support marks chargeable (reason) → warehouse prices (`PATCH /support-parts/requests/:id/price`, or on the
  customer-DC approve) → used/delivered → APPROVED line in `customer_invoice_extra_lines` → Accounts adds it to the
  customer's draft invoice (`GET /support-parts/charges-to-bill`, `POST /support-parts/charges/add-to-invoice`).
  Mark-used now writes the laptop cost row (U11). WFH: `GET /support/tickets/:id/wfh`, asset picker shows `is_wfh`,
  `POST /support/items/:id/wfh-charge` (lead) puts Rs 799 on the return DC / replacement SO+DC `shiping_charges`.
  **After the live merge:** extend Delivery Charges (`deliveryChargesService.DC_CHARGES_CTE`, outbound only today) to
  include return DCs with a charge, so WFH return pickups show there too.
