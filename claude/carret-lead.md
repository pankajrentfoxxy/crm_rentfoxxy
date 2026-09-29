# Carret — Lead process (26 Sep 2026)

## Decisions (user, 26 Sep — all as recommended)
1. **Pipeline:** keep the existing status + stage values (no data change). Board groups them:
   New (Pending) → Call back / on hold → Interested (Cold, Warm) → Proposal / demo (Hot, Demo) → Deal
   (Deal, Repeat); Lost (Rejected, Gone) needs the lost reason (the stage) and is hidden unless asked.
2. **Deal = convert, one step:** Mark as Deal / Demo opens the customer form (GSTIN, billing, shipping,
   point of contact); saving creates or updates the customer with its addresses and sets the status in
   one transaction (`POST /leads/:id/win`). The silent customer creation at Deal/Demo is gone; a plain
   status change to Deal/Demo is refused (409 CONVERT_REQUIRED) until the lead has a customer.
3. **Auto-move** (`services/leadFlowService.advanceLead`, forward only): quote sent → Cold / Proposal
   Shared; quote accepted (customer link or staff) → Warm / Price Agreed; sales order for the lead's
   customer → Deal (also out of Rejected / Gone). Logged on the timeline as "moved automatically".
4. **Follow-ups with outcomes:** `POST /leads/:id/follow-ups/complete` — outcome (spoke / no answer /
   call back / meeting done / not interested) + note + next date (required unless lost / won).
   History in `lead_follow_up_log` (migration 349).

## Fixed on the way
- Creating a lead from the old drawer wiped the auto-assigned owner (null assignee now = no change).
- Assigned-only users could edit any lead by id (basic, profile, addresses, remarks, customer profile,
  send quotation) — all now go through the assigned-only check.
- Picking 5+ sources silently dropped the source filter.
- Follow-up dates saved from the profile were UTC midnight, not noon IST like everywhere else.
- Email leads: company is no longer "gmail.com" (personal domains → blank; a "Company" line in the
  enquiry is used); model / CPU / RAM / storage go on the lead; assignment history is written.
- Dashboard "Hot / Warm leads" links open the new list filtered.

## Screens (Sell → Leads)
- **Leads** `/carret/sell/leads` — board or list; filters in the URL (status, source, owner, follow-up);
  follow-up counts and the overdue warning on top; bulk assign in the list for managers.
- **Lead** `/carret/sell/leads/:id` — what they need, contact/company (+ look the company up), "What's
  next", Log follow-up, Change status, Send quotation (new Carret quotation form, prefilled, GST by
  state), Mark as Deal, Edit, owner; timeline of status moves, follow-ups with outcomes and remarks;
  quotations; addresses.
- **New lead** `/carret/sell/leads/new` — who, what they need, first call date; owner automatic.
- **Follow-ups** `/carret/sell/follow-ups` — overdue / today / next 7 days, Log without leaving.
Old lead screens stay under Old view. On the old screens, setting Deal / Demo now asks to use
Mark as Deal (the old Convert button still works for leads already at Deal).

## QA click-through
New lead → Log follow-up (spoke, next date) → Change status Warm / Price Negotiation → Send quotation
(check CGST+SGST vs IGST by state) → Mark as Deal (GST, billing, contact) → customer created → raise a
sales order for that customer → the lead shows Deal "moved automatically". Follow-ups page → Log.

## Leads page redesign (29 Sep 2026)
User: "Lead page is not looks good and filter is not looks proper… status can be updated from outside."
- Pipeline tabs with counts (All open · New · Call back / on hold · Interested · Proposal / demo · Deal · Lost · Everything) replace the status dropdown (its default value matched no option).
- One FilterBar: search, owner, source, enquiry type, next call (overdue / today / 7 days / not set), came in (today / 7 / 30 / 90 days), sort (newest, follow-up due, recently active, oldest, company), List / Board.
- API: `follow_up` and `inquiry_type` were sent by the page but ignored by GET /api/leads — now filtered (IST days).
- Status pill (LeadStatusChip) on every row and card opens the existing StatusDrawer in place; Deal / Demo loads the full lead and opens WinDrawer (customer creation) as on the record.
- Colours: one per pipeline group from theme tokens (GROUP_TONE in leadShared) — no hex; used for tabs' board columns, card edges, pills, record and follow-ups pages.
- Clickable summary tiles (calls overdue / today / next 7 days, new, proposal, deals); list shows contact + city, needs + enquiry + budget, status + stage, next call (red overdue, amber today), owner initials + source, last activity + came-in date; select-all + searchable bulk assign.
