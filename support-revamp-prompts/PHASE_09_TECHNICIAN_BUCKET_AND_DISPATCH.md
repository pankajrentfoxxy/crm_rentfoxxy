# PHASE 9 — One technician bucket, one identity, and the dispatch board

> Read `00_MASTER_CONTEXT.md` first.
> **Screens:** S11 (bucket, mobile), S12/S13 (job execution, mobile polish), S10 (dispatch board).
> **Depends on:** Phase 8 — every work order type must exist before the bucket can show them all.

---

## 9.1 What this replaces

Today a technician's work is spread across **three buckets keyed by two identity tables**:

| Bucket | Source | Keyed by |
|---|---|---|
| Support parts | `support_part_requests` | `users.user_id` |
| Laptop pickups | `support_ticket_items` | `users.user_id` |
| Deliveries | `delivery_challan_lines` | `delivery_technicians.technician_id` — **behind a separate login** |

And `delivery_challan_lines.delivery_person_id` is read as a `technician_id` in one service and as a
`user_id` in another, so the bucket list and the technician's own dashboard can disagree about what
they have to do today (PLAN D22).

**After this phase: one query, one identity, one screen, one sort.**

---

## 9.2 Finish the identity migration

Phase 2 added `delivery_technicians.user_id` and a resolver. Now complete it.

### Migration `204_support_v2_identity.sql`
```sql
-- Add the canonical column alongside the ambiguous one. Do NOT drop the old one yet.
ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS assigned_user_id INT REFERENCES users(user_id);

-- Backfill: delivery_person_id may be either id space. Resolve both ways.
UPDATE delivery_challan_lines d SET assigned_user_id = u.user_id
  FROM users u WHERE d.assigned_user_id IS NULL AND d.delivery_person_id = u.user_id;

UPDATE delivery_challan_lines d SET assigned_user_id = dt.user_id
  FROM delivery_technicians dt
 WHERE d.assigned_user_id IS NULL
   AND d.delivery_person_id = dt.technician_id
   AND dt.user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dcl_assigned_user ON delivery_challan_lines(assigned_user_id);
```

Write the unresolved rows to `docs/support-revamp/IDENTITY_UNRESOLVED.md` for manual fixing.
`delivery_person_id` stays, still written by legacy code, and is dropped in Phase 11.

**From now on, all new code reads `assigned_user_id`.** Add a test asserting no new support-v2 file
references `delivery_person_id`.

---

## 9.3 The one bucket query

```sql
-- GET /api/support/v2/me/bucket
SELECT wo.*, t.priority, t.ticket_number, c.company_name, …
  FROM support_work_orders wo
  JOIN support_tickets_v2 t ON t.ticket_id = wo.ticket_id
 WHERE wo.assigned_to = $1                       -- ALWAYS the caller. Never a parameter.
   AND wo.status NOT IN ('COMPLETED','CANCELLED')
 ORDER BY
   CASE WHEN wo.sla_due_at < NOW() THEN 0 ELSE 1 END,   -- breached first
   wo.priority ASC,                                     -- P1 → P4
   wo.slot_start ASC NULLS LAST,
   wo.distance_km ASC NULLS LAST;
```

`assigned_to` is taken from `req.user.user_id`, never from the request body. There is no endpoint
that lets one technician read another's bucket — a lead sees the same data through the dispatch
board, which is a different endpoint with a different permission.

### Endpoints
```
GET  /me/bucket            cp('support_bucket','view')    ?tab=today|overdue|upcoming|completed&group_by=
GET  /me/bucket/summary    cp('support_bucket','view')    counts for the top strip
POST /me/bucket/sync       cp('support_bucket','edit')    offline queue flush, idempotent, batched
GET  /dispatch/board       cp('support_dispatch','view')  ?date=&zone=&group=
POST /dispatch/assign      cp('support_dispatch','edit')  { wo_id, user_id, slot_start, slot_end }
POST /dispatch/auto-assign cp('support_dispatch','edit')  { date, zone } → dry_run supported
GET  /dispatch/capacity    cp('support_dispatch','view')  ?date=&zone=
```

---

## 9.4 Grouped visits — the operational win

If a technician has several jobs at the **same customer, same site, same day**, the bucket returns
them as **one card with sub-jobs**:

```json
{ "group_key": "88:141:2026-08-14",
  "customer_name": "Acme Corp", "site_label": "Sector 44, Gurugram",
  "priority": 1, "slot_start": "…", "distance_km": 4.2,
  "jobs": [
    { "wo_id": 902, "wo_type": "REPAIR_PICKUP",  "asset_count": 3, "status": "ASSIGNED" },
    { "wo_id": 891, "wo_type": "FIELD_VISIT",    "asset_count": 3, "status": "ASSIGNED" },
    { "wo_id": 915, "wo_type": "PART_DELIVERY",  "asset_count": 1, "status": "ASSIGNED" }
  ] }
```
One trip, one arrival GPS shared across the sub-jobs, three completions. Today these live in three
unrelated systems and the technician navigates three screens for one visit.

Group priority = the most severe of the group. Group SLA = the earliest due.

---

## 9.5 The auto-assignment engine

`backend/services/supportAssignmentEngine.js`. Rules evaluated in order; first match wins; fall
through to `PENDING_ASSIGNMENT` with an alert to the lead.

```js
const RULES = [
  zoneMatch,      // customer site pincode → support_zone_pincodes → group
  skillMatch,     // issue type's skill_required ∈ user_skills
  availability,   // on shift today, not on approved leave
  capacity,       // open jobs today < user_shifts.max_jobs_per_day
  continuity,     // already visited this customer for this ticket → prefer them
  proximity,      // nearest to another job they already have that day
  loadBalance,    // fewest jobs today
];
```

`POST /dispatch/auto-assign` supports `dry_run: true` and returns the full explanation per WO:
```json
{ "wo_id": 961, "assigned_to": null, "reason": "No available technician with skill CHIP_LEVEL in zone NCR",
  "considered": [ { "user_id": 9, "name": "Rahul Kumar", "rejected_by": "capacity", "detail": "8 of 6" } ] }
```
An assignment engine that cannot explain itself will not be trusted, and a lead who does not trust
it will assign everything by hand.

**A chip-level fault must never auto-assign to a delivery-only technician.** That is `skillMatch`,
and it is the rule most worth testing.

---

## 9.6 Frontend — the bucket (mobile-first)

`features/support-v2/pages/BucketPage.jsx`. Build for 375px first; the desktop view is the same
component in a wider container.

**Top strip** (dark, `bg-sup-ink`): date, technician name, zone · `8 jobs · 2 done · 1 overdue` ·
progress bar · "Next — 09:00 Acme Corp, Sector 44 · 4.2 km".

**Tabs:** Today · Overdue (in `pri1`) · Upcoming · Done. **Group by:** time slot (default) ·
customer · job type · area.

**Job card** — exactly as the mockup:
```
│ ●P1  REPAIR PICKUP                          ⏱ −0h 22m
│ Acme Corp
│ Sector 44, Gurugram · 4.2 km
│ 3 machines · TTSPL002187 +2
│ Hardware › Does not power on
│ ┌ Grouped trip — 3 jobs at this address ┐
│ [Navigate] [Call] [Start job ▶]
```
Left edge is the priority spine. The SLA chip ticks live. Buttons are `min-h-[44px]`.

**Bottom nav:** My day · History · My parts · Profile.

### Job execution (S12) polish
The checklist from Phase 5, now with: a sticky progress header, one step expanded at a time,
large tap targets, camera capture inline, and the **Complete** button visibly disabled with the
reason ("2 steps remaining") rather than silently inert.

### Offline (finish what Phase 5 started)
- Service worker caching the app shell and today's bucket payload
- IndexedDB queue for every mutation, with the `Idempotency-Key` generated at enqueue time
- A persistent banner: "3 actions pending sync" with a manual retry
- Photos queued as blobs and uploaded on reconnect
- **Test it properly:** airplane mode, complete a whole job, land, watch it sync

Add to `frontend/public/manifest.json` so the technician can install it to their home screen.

---

## 9.7 Frontend — dispatch board (S10)

`pages/DispatchBoardPage.jsx`. Grid: technicians as columns, time slots as rows, unassigned jobs in
a left rail. Drag a job onto a cell to assign.

- Job blocks are coloured by priority (`bd-job c1..c4` in the mockup).
- Column header shows `8 jobs · over capacity` in `pri1` when over.
- A job whose slot would breach its SLA shows `⚠ will breach — slot too late` inside the block.
- Three insight cards below: Capacity warning · Grouped visits · Skill match — each with a concrete
  suggestion and an action button, as in the mockup.
- Use HTML5 drag-and-drop; no drag library.
- Keyboard fallback: select a job in the rail, then Enter on a cell. Drag-only is not acceptable.

`POST /dispatch/assign` validates capacity and skill and returns a **warning**, not an error, if the
lead is overriding — the lead is allowed to overload someone, they just have to see it.

---

## VERIFICATION CHECKLIST — Phase 9

**One bucket**
- [ ] A technician with a laptop pickup, a part delivery and a field visit sees **all three** in one list
- [ ] Order is: breached first, then P1→P4, then earliest slot, then nearest
- [ ] Three jobs at the same customer/site/day render as **one grouped card** with three sub-jobs
- [ ] Completing one sub-job leaves the others open and the group card intact

**Identity**
- [ ] `assigned_user_id` is backfilled for every DC line that had a resolvable person
- [ ] The unresolved list is written to `IDENTITY_UNRESOLVED.md`
- [ ] The technician's bucket and the dispatch board show the **same** jobs for the same person
      (this is the disagreement we are fixing — verify explicitly)
- [ ] No new support-v2 file references `delivery_person_id`

**Isolation**
- [ ] Technician A cannot see Technician B's jobs — `GET /me/bucket` ignores any user id in the query
- [ ] Technician A gets 403 acting on Technician B's WO even with `support_bucket · edit`
- [ ] A lead with `support_dispatch · view` sees everyone via the board, not via `/me/bucket`

**Auto-assignment**
- [ ] A `HW-MBD` chip-level ticket is never assigned to a technician without `CHIP_LEVEL`
- [ ] A technician on approved leave is never assigned
- [ ] A technician at `max_jobs_per_day` is skipped, and `dry_run` explains why
- [ ] With no eligible technician, the WO stays `PENDING_ASSIGNMENT` and the lead is alerted
- [ ] Continuity: the technician who already visited this ticket is preferred for the follow-up

**Dispatch board**
- [ ] Drag a job from the rail to a technician → assigned, and it appears in that technician's bucket
- [ ] Keyboard assignment works without a mouse
- [ ] Over-capacity assignment shows a warning but is allowed
- [ ] A slot that would breach SLA is flagged on the block

**Offline — test on a real phone**
- [ ] Install to home screen from the browser
- [ ] Airplane mode: open the app, today's jobs are there
- [ ] Complete a full job offline including 4 photos, OTP and signature
- [ ] Reconnect: everything syncs, in order, exactly once, and the photos arrive
- [ ] Kill the app mid-queue and reopen — the queue survives

**Build**
- [ ] `npm test` green · `npm run build` clean · Lighthouse PWA installable · phase report written
