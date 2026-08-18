# PHASE 4 — The complaint flow: create wizard, ticket detail, resolve

> Read `00_MASTER_CONTEXT.md` first.
> **Screens:** S3, S4, S5, S6 (wizard), S7 (ticket detail), S8 (resolve machine modal).
> **Depends on:** Phase 3.
> **This phase makes the module usable.** After it, a support agent can run a whole complaint that
> needs no field job. Field jobs arrive in Phase 5.

---

## 4.1 The rule this phase exists to enforce

> Classification is mandatory, three levels deep, **per machine**, always.

The current form renders the issue dropdown only when the class is `complaint` **and exactly one
machine is selected** (`SupportTicketCreate.jsx:542`). Every multi-machine ticket — the common case
for a B2B rental business — is therefore created with no classification at all.

Enforcement is at three layers, all of them required:
1. **DB** — `support_ticket_assets.reported_type_id / reported_subtype_id / reported_issue_id` are `NOT NULL`
2. **API** — `POST /tickets` rejects with 400 and a per-line error map if any line is unclassified
3. **UI** — the Continue button is disabled and the offending rows are outlined in `pri1`

---

## 4.2 Backend — create and read

### `POST /api/support/v2/tickets` · `cp('support_tickets','create')`

```json
{
  "ticket_class": "INCIDENT",
  "channel": "PHONE",
  "customer_id": 88,
  "site_id": 141,
  "contact_name": "Ravi Menon",
  "contact_phone": "98xxxxxx21",
  "contact_email": "ravi.m@acme.in",
  "contact_is_vip": false,
  "subject": "3 laptops down at Acme Corp — Sector 44, Gurugram",
  "assignment_group_id": 3,
  "assigned_to": null,
  "preferred_slot_start": "2026-08-14T04:30:00Z",
  "preferred_slot_end":   "2026-08-14T07:30:00Z",
  "internal_note": "",
  "asset_lines": [
    { "serial_id": 20187, "ttspl_id": "TTSPL002187",
      "reported_issue_id": 148, "reported_description": "Nothing happens when the power button…",
      "impact": 2, "urgency": 2, "attachment_ids": [] }
  ],
  "link": { "target_ticket_id": null, "link_type": null }
}
```

Server behaviour, in one transaction:
1. Validate the customer and site; validate every `serial_id` belongs to this customer.
2. For each line, resolve `reported_issue_id` up the catalogue to fill `reported_type_id` and
   `reported_subtype_id` — **the client only sends the level-3 id**; the server derives the chain.
   This makes it impossible for the three levels to disagree.
3. Reject 400 if any line is missing `reported_issue_id` or `reported_description` (< 15 chars):
   ```json
   { "success": false, "message": "Every machine must be classified",
     "errors": { "0": ["reported_issue_id is required"], "2": ["reported_description too short"] } }
   ```
4. Repeat detection — for each line, look for a resolved ticket on the same `serial_id` with the
   same `reported_subtype_id` within 30 days. If found: set the line's `is_repeat`, create a
   `REPEAT_OF` link on the ticket, and pass `isRepeat: true` into the priority calc.
5. Ticket priority = **max severity across lines** (i.e. the numerically lowest priority) after
   `computePriority` runs per line with the customer's tier, VIP flag and safety flag.
6. `recalcTicketSla` sets both due dates.
7. Number from `sm_document_sequences` doc_type `support_ticket_v2` → `STK-26-27-00412`
   (use the FY-formatted helper, same pattern as `nextFinancialYearNumber`).
8. Status: `NEW` if unassigned, `ASSIGNED` if `assigned_to` given — via `computeTicketStatus`, never directly.
9. Write events: `TICKET_CREATED`, one `LINE_ADDED` per line, `PRIORITY_COMPUTED` (with `reasons[]`
   in `detail`), `SLA_SET`.
10. Fire the customer notification (Phase 10 adds real templates; for now enqueue via the existing
    `emailQueueService` with a plain-text body).

### Other endpoints this phase adds
```
GET   /customers/:id/context        cp('support_tickets','view')
        → tier, fleet size, contract end, open tickets, overdue invoices, buffer stock, sites, contacts
GET   /customers/:id/assets         cp('support_tickets','view')
        → deployed assets with complaint_count_90d, open_ticket_count, warranty_status, assigned employee
PATCH /tickets/:id                  cp('support_tickets','edit')     subject, contact, site
POST  /tickets/:id/classify         cp('support_triage','edit')      per-line reclassification
POST  /tickets/:id/priority-override cp('support_triage','edit')     { priority, reason }
POST  /tickets/:id/assign           cp('support_tickets','edit')     { group_id, user_id }
POST  /tickets/:id/status           cp('support_tickets','edit')     { status, pending_reason, note }
POST  /tickets/:id/pause            cp('support_tickets','edit')     { reason, customer_side, note }
POST  /tickets/:id/resume           cp('support_tickets','edit')
POST  /tickets/:id/resolve          cp('support_tickets','edit')
POST  /tickets/:id/close            cp('support_tickets','edit')
POST  /tickets/:id/reopen           cp('support_tickets','edit')     { reason }
POST  /tickets/:id/cancel           cp('support_tickets','delete')   { reason }
POST  /tickets/:id/link             cp('support_tickets','edit')     { target_ticket_id, link_type }
POST  /tickets/:id/comment          cp('support_tickets','view')     { body, is_customer_visible }
POST  /tickets/:id/attachments      cp('support_tickets','edit')     multipart, existing multer setup
POST  /lines/:lineId/found          cp('support_tickets','edit')     { found_issue_id }
POST  /lines/:lineId/resolve        cp('support_tickets','edit')     see below
```

### `POST /lines/:lineId/resolve` — the hard gate
```json
{ "found_issue_id": 152,
  "resolution_code_id": 3, "root_cause_id": 1,
  "liability": "COMPANY", "chargeable_amount": null,
  "action_code_ids": [4, 11, 19],
  "resolution_notes": "Power IC (PU701) found shorted…",
  "time_spent_minutes": 260 }
```
Reject 400 unless **all** of: `found_issue_id`, `resolution_code_id`, `root_cause_id`, `liability`,
at least one `action_code_ids`, and `resolution_notes.length >= 20`.
If `liability === 'CUSTOMER_CHARGEABLE'` then `chargeable_amount > 0` **and** at least one
attachment of kind `PHOTO_*` on this line are also required — no charge without evidence.

Side effects:
- If found ≠ reported, write a `RECLASSIFIED` event (this feeds the accuracy report).
- If `liability === 'CUSTOMER_CHARGEABLE'`, insert `customer_invoice_extra_lines` (status `PENDING`)
  and a `support_approvals` row; set ticket `PENDING_APPROVAL` only if the approval is customer-side.
- If `liability === 'VENDOR_WARRANTY'`, insert `vendor_warranty_claims`.
- Recompute line status, then `computeTicketStatus`.

### `POST /tickets/:id/resolve`
Calls `computeTicketStatus`; if it returns `blockers`, respond 400 with them so the UI can say
exactly which machine is missing what:
```json
{ "success": false, "message": "Cannot resolve yet",
  "blockers": [ { "line_code": "A1", "missing": ["resolution_code", "root_cause"] },
                { "wo_number": "WO-000955", "status": "ASSIGNED" } ] }
```
If the ticket is SLA-breached, also require `breach_reason`.

---

## 4.3 Frontend — the wizard (S3–S6)

`features/support-v2/pages/NewTicketPage.jsx` with four step components under
`components/wizard/`. State lives in the page; steps are controlled.

### Step 1 — Customer & contact (S3)
Two columns: form (1.4fr) and a live **Customer context** panel (1fr).

The context panel is the duplicate-prevention mechanism. It shows tier, fleet, contract end, SLA
policy, buffer units on site, overdue invoices, and an amber block listing **open tickets for this
customer** with a "Link to existing" button. If someone rings about a problem already logged, the
agent sees it before creating a sixth copy.

Required: customer, site, channel, contact name, contact phone (validated Indian mobile).

### Step 2 — Machines (S4)
Asset grid from `GET /customers/:id/assets`, filtered by the selected site by default.
Columns: checkbox · TTSPL ID + serial · Model & config · Assigned to · Deployed · History · Warranty.

- **History** column shows `N complaints · 90 d`. At `>= 3` it renders in `pri1` with a second line
  "Consider replacement". This is the repeat-offender flag (PLAN G13) and it is the single cheapest
  feature in the whole revamp — surface it prominently.
- "Select all at this site" for mass events.
- An "Unknown asset" toggle for when the customer cannot identify the machine — creates a line with
  `asset_unknown = true` that the technician resolves by scanning on site.

### Step 3 — Classify (S5) — the gate
One card per selected machine. Each card:

```
[A1]  TTSPL002187   Dell Latitude 5420 · Ravi Menon              [P2 High]
 Type *      Subtype *        Issue type *
 [Hardware ▾][Boot / POST ▾]  [Does not power on ▾]
 What the customer described *  [textarea, min 15 chars]
 Impact [2 ▾]  Urgency [2 ▾]  Photos [＋ Attach]
 ┌─ suggestion strip ───────────────────────────────────────────┐
 │ Suggested next step: Repair pickup · KB-208 "…" — try this   │
 └──────────────────────────────────────────────────────────────┘
```

Behaviours that must be implemented:
- **"Same issue for all N machines"** toggle at the top copies row 1 down. Without it, a 40-machine
  outage is unusable and agents will find a way around the mandatory field.
- **One search box** across all three levels (`GET /taxonomy/catalog/search?q=`). Typing "cracked"
  and picking the result fills Type and Subtype automatically.
- Selecting a level-3 issue **auto-fills** impact/urgency from `default_impact`/`default_urgency`
  (agent can override) and shows the suggestion strip with `default_wo_type` and the KB article.
- `chargeable_default` shows an amber warning: "This issue type is usually chargeable. Photos are
  mandatory before a charge can be raised."
- `requires_photo` makes the photo attachment mandatory — Continue stays disabled without it.
- `is_safety` immediately forces the chip to P1 and shows "Safety — forced P1".
- Repeat detection runs live (debounced) as soon as machine + subtype are known, and shows the
  crimson repeat block with a link to the previous ticket.
- The per-card priority chip updates live from a local mirror of `computePriority`
  — **but the server recomputes on submit and its answer wins.** Never trust the client.

### Step 4 — Route & confirm (S6)
Left: assignment group (auto-selected from the site pincode → zone), assign-to, preferred slot,
skill required (read-only, derived), internal note.
Right: a **"What will happen"** panel calling `POST /sla/preview` — ticket priority with the reason
chain ("Highest of the three lines · Platinum −1 applied"), response due, resolution due, calendar,
and the **suggested work orders** as non-committal cards marked "Suggested".

> Suggested, never automatic. The system proposes; the lead confirms at triage. Auto-creating work
> orders from a classification is the fastest way to lose the team's trust in classification.

---

## 4.4 Frontend — Ticket detail (S7)

`pages/TicketDetailPage.jsx`. One call to `GET /tickets/:id` renders everything.

**Header** — priority spine on the whole card. Row 1: `PriorityChip` (with label) · ticket number
(mono, 15px, bold) · status pill · class pill · channel pill · breach pill. Row 2: subject as H2.
Row 3: raised-by, contact, group, owner. Right side: two labelled SLA clocks (Response ✓ 09:31,
Resolution countdown) and the action buttons.

**Tabs:** Overview · Machines (n) · Work orders (n) · Timeline (n) · Attachments (n) ·
Costs & charges · Approvals (n).

**Overview** = a two-column grid: asset-line cards on the left (main), right rail with Timeline,
Costs on this ticket, and Quick actions.

**Asset line card** — the most important component in the module:
- Header: `A1` tag · TTSPL (mono) · model · line status pill · assigned employee
- Two columns: **Reported by customer** and **Found by technician**, each as a
  `ClassificationChain`. When they differ, show a `Reclassified at diagnosis` pill; when they match,
  `Matched`. When Found is empty, show a muted "Not yet diagnosed".
- Once resolved: a 4-up row — Resolution · Root cause · Liability · Amount. Liability
  `CUSTOMER_CHARGEABLE` renders in `pri2`.
- Then the line's work orders as `WorkOrderCard`s (Phase 5 fills these; Phase 4 shows an empty state
  with a "＋ Work order" button).
- Actions: `＋ Work order` (gated `support_work_orders · create`), `Resolve this machine`.

**Timeline** — the single event stream. Dot colours: crimson for breaches/failures, teal for
notable actions, green for completions, hollow for informational. Events flagged
`is_customer_visible` get a small "customer visible" suffix — that is exactly what the portal renders.

**Quick actions rail:** Create work order · Pause — waiting on customer · Link or merge ticket ·
Escalate to manager · Send update to customer · Cancel ticket. Each gated on its section.

---

## 4.5 Frontend — Resolve machine modal (S8)

`components/ResolveLineModal.jsx`, using the `Modal` primitive from Phase 0.

Sections in order:
1. **What was actually wrong** — three dependent selects, pre-filled with the reported chain.
   If the agent changes it, show the informational bar: "Different from what was reported (…). This
   is recorded as a reclassification and feeds the accuracy report — it is not an error."
   That sentence matters: without it, agents leave Found = Reported to avoid looking wrong, and the
   data becomes useless.
2. **Resolution code · Root cause · Liability** — three selects, all required.
   Selecting a root cause **pre-fills** liability from `support_root_causes.default_liability`.
   Choosing `CUSTOMER_CHARGEABLE` reveals amount + evidence uploader + an approval notice.
3. **Action taken** — multi-select chips grouped by `group_name` (Diagnostics / Repair / Software /
   Logistics / Outcome). At least one required.
4. **Notes** — textarea, live character counter, `148 / minimum 20`.
5. **Parts consumed** — read-only, pulled from the line's work orders.
6. **Time spent** — auto-calculated from work order timestamps, editable.

Footer: Cancel · **Resolve machine** (disabled until valid). On success, close, toast, reload the ticket.

---

## 4.6 Global search
Extend the CRM's existing global search so `STK-…` and legacy `#1234` both resolve to
`/support-v2/tickets/:id`. A customer on the phone will quote whichever number they were given.

---

## VERIFICATION CHECKLIST — Phase 4

**The mandatory-classification gate — test every path**
- [ ] Select 3 machines, classify only 2 → Continue is disabled, the third card is outlined in `pri1`
- [ ] `curl POST /tickets` with a line missing `reported_issue_id` → 400 with a per-line `errors` map
- [ ] Try to insert a `support_ticket_assets` row directly with NULL classification → DB rejects it
- [ ] "Same issue for all" copies row 1 to all rows including impact and urgency
- [ ] Searching "cracked" auto-fills Hardware → Display → Cracked panel

**Priority and SLA**
- [ ] A Platinum customer's P3 ticket is created as P2, and the reason chain shows "Platinum: −1"
- [ ] Selecting "Battery swollen" jumps the card to P1 and shows "Safety — forced P1"
- [ ] The ticket's priority equals the most severe of its lines
- [ ] Response and resolution due dates match `POST /sla/preview` shown in step 4
- [ ] The client-side priority preview and the server's stored priority agree

**Repeat detection**
- [ ] Resolve a ticket for serial X with subtype `HW-BAT`. Raise another within 30 days on the same
      serial and subtype → repeat block shows, ticket is linked `REPEAT_OF`, priority bumped
- [ ] Beyond 30 days → no repeat

**Ticket detail**
- [ ] One network call renders the page — check the Network tab
- [ ] Reported vs Found renders side by side; changing Found shows the Reclassified pill
- [ ] Timeline shows every event in order, newest first
- [ ] Quick actions hide correctly for a user missing the matching section

**Resolve gate**
- [ ] Resolve modal will not submit without all five required fields
- [ ] Notes at 19 characters → blocked; at 20 → allowed
- [ ] `CUSTOMER_CHARGEABLE` without a photo → blocked, with a clear message
- [ ] `CUSTOMER_CHARGEABLE` with amount + photo → creates a `customer_invoice_extra_lines` row
      (status PENDING) and a `support_approvals` row
- [ ] Selecting root cause "Physical damage by user" pre-fills liability to Customer chargeable
- [ ] Selecting "Manufacturing defect" pre-fills Vendor warranty and creates a claim row on resolve

**Ticket resolve/close**
- [ ] Resolving a ticket with one unresolved line → 400 listing that line and what is missing
- [ ] Resolving a breached ticket without `breach_reason` → 400
- [ ] After all lines resolve, ticket auto-moves to RESOLVED via `computeTicketStatus`
- [ ] Reopen within 7 days works, increments `reopen_count`, bumps priority, starts a fresh clock
- [ ] Reopen after 8 days is refused

**Pause**
- [ ] Pausing `PENDING_CUSTOMER` requires a logged contact attempt
- [ ] The SLA chip switches to `‖ paused` immediately
- [ ] Resuming pushes the due date forward by exactly the paused business time

**Permissions**
- [ ] `support_tickets · view` only → can open a ticket, cannot edit, resolve or add a work order
- [ ] `support_triage · edit` removed → the priority override control disappears and the endpoint 403s
- [ ] `support_charges` removed → the chargeable section of the resolve modal is hidden and
      submitting `CUSTOMER_CHARGEABLE` is rejected server-side

**Build**
- [ ] `npm test` green · `npm run build` clean · phase report written
