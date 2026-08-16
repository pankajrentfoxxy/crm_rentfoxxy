# PHASE 10 — SLA engine, escalation, notifications, CSAT, approvals

> Read `00_MASTER_CONTEXT.md` first.
> **Screens:** S16 (Approvals inbox), S17 (SLA & breach register — the top half), S21 (Customer portal).
> **Depends on:** Phase 9.
> **This is the phase that makes SLA real** rather than a number on a screen.

---

## 10.1 The escalation worker

`backend/services/supportSlaWorker.js`, started in `server.listen` behind the existing
`ENABLE_BACKGROUND_WORKERS` flag, following the `startDispatchSlaWorker` pattern already in the codebase.

```js
const cron = require('node-cron');
// every 5 minutes
cron.schedule('*/5 * * * *', () => runSlaSweep().catch(e => console.error('slaSweep:', e)));
```

Each sweep, for every ticket not in `RESOLVED|CLOSED|CANCELLED`:
1. Skip if currently paused.
2. Compute elapsed % against `sla_resolution_due_at`.
3. Cross a threshold → write an event, set `escalation_level`, fire the notification, and
   **record that this level has fired** so the next sweep does not re-fire it.

| % elapsed | `escalation_level` | Notify |
|---|---|---|
| 50 | 1 | Assignee (in-app) |
| 75 | 2 | Assignee + Support Lead (push + email) |
| 100 — breach | 3 | Lead + Manager; set `sla_resolution_breached = true`; add to the breach register |
| 125 | 4 | Manager + Ops Head |
| 150 | 5 | Ops Head + Business Head; pin to the top of the manager dashboard |

Also sweep the **response** clock (breach at 100%) and **work order** clocks
(a WO not `ACCEPTED` 30 minutes before its slot start → alert the lead, per PLAN §10.1).

### Breach reason is mandatory
```sql
ALTER TABLE support_tickets_v2
  ADD CONSTRAINT chk_breach_reason_on_close CHECK (
    NOT (status = 'CLOSED' AND sla_resolution_breached = true AND breach_reason IS NULL)
  );
```
Reasons: `PART_UNAVAILABLE, TECHNICIAN_UNAVAILABLE, CUSTOMER_UNAVAILABLE, SITE_ACCESS, VENDOR_DELAY,
WRONGLY_PRIORITISED, VOLUME_SPIKE, OTHER`.

> A breach count tells you nothing. A breach count *by reason* tells you whether to hire technicians
> or buy more spare batteries. This constraint is the whole reason the monthly review works.

### Anti-abuse on pause
- Setting `PENDING_CUSTOMER` requires a contact attempt logged in the same request
  (`contact_method: CALL|EMAIL|WHATSAPP`, plus a reference). The API rejects it otherwise.
- Three consecutive pauses on one ticket raises a flag to the support lead.

---

## 10.2 Notifications

### Migration `205_support_v2_notifications.sql`
```sql
CREATE TABLE IF NOT EXISTS support_notification_templates (
  template_id SERIAL PRIMARY KEY,
  event_code  VARCHAR(48) NOT NULL,
  channel     VARCHAR(12) NOT NULL CHECK (channel IN ('EMAIL','WHATSAPP','PUSH','INAPP')),
  audience    VARCHAR(24) NOT NULL CHECK (audience IN
                ('CUSTOMER','ASSIGNEE','LEAD','MANAGER','OPS_HEAD','WAREHOUSE','ACCOUNTS')),
  subject     VARCHAR(200),
  body        TEXT NOT NULL,          -- {{ticket_number}}, {{customer_name}}, {{tech_name}}, {{eta}} …
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (event_code, channel, audience)
);

CREATE TABLE IF NOT EXISTS support_notification_log (
  log_id      BIGSERIAL PRIMARY KEY,
  ticket_id   INT REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  wo_id       INT REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  event_code  VARCHAR(48) NOT NULL,
  channel     VARCHAR(12) NOT NULL,
  audience    VARCHAR(24) NOT NULL,
  recipient   VARCHAR(200) NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'QUEUED'
                CHECK (status IN ('QUEUED','SENT','FAILED','SKIPPED')),
  error       TEXT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_log_ticket ON support_notification_log(ticket_id, created_at DESC);
```

The log is not optional. "Did the customer get told?" must be answerable from the ticket, and today
it is not.

### Seed the matrix from PLAN §18
Reuse the **existing** `emailQueueService`, `whatsappService` and `notificationService`. Do not add
a provider. Every send writes a `support_notification_log` row first (`QUEUED`), then updates it.

The three customer-facing ones that matter most operationally:
- **Technician assigned** — name, photo, phone, ETA window
- **Technician en route** — live ETA
- **Ticket resolved** — summary + the CSAT link

---

## 10.3 CSAT

```sql
-- already on support_tickets_v2 from Phase 2: csat_score, csat_comment, csat_requested_at, csat_responded_at
CREATE TABLE IF NOT EXISTS support_csat_tokens (
  token       VARCHAR(64) PRIMARY KEY,
  ticket_id   INT NOT NULL REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
```

Flow: on `RESOLVED`, generate a single-use token, send it in the resolution email/WhatsApp as a
one-tap 👍/👎 link. Clicking opens a tiny public page (no login) that captures 1–5 stars and an
optional comment.

- `POST /public/csat/:token` — the **only** unauthenticated endpoint in this module. Rate limit it.
- Score ≤ 2 → auto-notify the support manager and flag the ticket for review.
- CSAT is captured against the ticket; the reports break it down by technician via the WOs.

---

## 10.4 Auto-close and reopen

- `RESOLVED` → `CLOSED` automatically after 48 h (setting `auto_close_hours`), by the same cron.
- Reopen allowed for 7 days after close (`reopen_window_days`): status back to `IN_PROGRESS`,
  `reopen_count + 1`, mandatory `reopen_reason`, priority −1, **fresh resolution clock**.
- `reopen_count >= 2` puts the ticket on the quality report.

---

## 10.5 Approvals inbox (S16)

Everything awaiting a decision, in one place. Types already created by earlier phases:
`REPLACEMENT`, `DAMAGE_CHARGE`, `CHARGEABLE_PART`, `PART_VALUE`, `EARLY_TERMINATION`,
`RATE_CHANGE`, `SLA_WAIVER`, `PRIORITY_OVERRIDE`.

```
GET  /approvals            cp('support_approvals','view')    ?status=&type=&mine=true
POST /approvals/:id/decide cp('support_approvals','edit')    { decision: APPROVED|REJECTED, reason }
```

**Thresholds are configuration, not code:**
```sql
CREATE TABLE IF NOT EXISTS support_approval_rules (
  rule_id        SERIAL PRIMARY KEY,
  approval_type  VARCHAR(40) NOT NULL,
  min_amount     NUMERIC(12,2),
  approver_role  VARCHAR(40) NOT NULL,
  blocks         BOOLEAN NOT NULL DEFAULT TRUE,
  active         BOOLEAN NOT NULL DEFAULT TRUE
);
```
Seed from PLAN §17. Changing "manager approves above ₹40,000" to ₹50,000 must be a row update,
not a deploy.

**UI:** table with a priority spine (inherited from the ticket), type tag, what is being approved
with the context in a second line, amount, requester, ticket link, waiting time (in `pri1` beyond
4 h), and View evidence / Reject / Approve buttons. Tabs: Pending · Decided by me · All.

---

## 10.6 S17 top half — the breach register

Four KPI tiles (Response SLA %, Resolution SLA %, Avg time to resolve by priority, Total paused
time), a **breaches by reason** bar list, and a breached-tickets table with the over-by duration
and the reason. Rows with no reason yet show "Not yet given" in `sup-faint` — that is the lead's
to-do list.

---

## 10.7 Customer portal (S21)

In `customer-portal/`, using the same tokens and primitives.

```
GET  /portal/tickets                    customer auth
GET  /portal/tickets/:id                only events where is_customer_visible = true
POST /portal/tickets                    same mandatory classification, channel = PORTAL
POST /portal/tickets/:id/approve-charge
POST /portal/tickets/:id/dispute-charge { reason }
POST /portal/tickets/:id/reopen         { reason }
GET  /portal/tickets/:id/documents      RDC / SDC / DC PDFs
```

The customer sees: status in plain language, the **resolution** countdown only (never internal
escalation levels), their machines and what happened to each, any charge awaiting their approval
with the photo evidence, a progress timeline, and their documents.

> A portal ticket must go through exactly the same validation as an agent-raised one. If customers
> can create unclassified tickets, the classification data is worthless within a month.

---

## VERIFICATION CHECKLIST — Phase 10

**SLA worker**
- [ ] Create a P2 ticket, manually set `sla_resolution_due_at` to 30 minutes out, run the sweep →
      it fires level 2 (75%) once and only once
- [ ] Push it past due → level 3, `sla_resolution_breached = true`, appears in the breach register
- [ ] A paused ticket is skipped entirely by the sweep
- [ ] A WO unaccepted 30 min before its slot alerts the lead
- [ ] Running the sweep twice in a row does not double-notify

**Breach reason**
- [ ] Closing a breached ticket without a reason is rejected — both by the API and by the DB constraint
- [ ] The breach register groups by reason and the counts reconcile with the ticket list

**Pause discipline**
- [ ] `PENDING_CUSTOMER` without a logged contact attempt → 400
- [ ] With one → paused, chip shows `‖ paused`, and the contact appears on the timeline
- [ ] Third consecutive pause raises the lead flag

**Notifications**
- [ ] Every send writes a `support_notification_log` row, and failures are logged with the error
- [ ] The ticket timeline shows what was sent to the customer and when
- [ ] Technician-assigned WhatsApp includes name, phone and the ETA window
- [ ] Editing a template row changes the next message without a deploy
- [ ] Deactivating a template stops that message and logs `SKIPPED`

**CSAT**
- [ ] Resolution email contains a working one-tap link
- [ ] The public page needs no login and accepts a score once; the token is then dead
- [ ] An expired token shows a friendly message, not an error page
- [ ] A score of 2 notifies the manager and flags the ticket
- [ ] The endpoint is rate limited — hammer it and confirm

**Auto-close & reopen**
- [ ] A ticket resolved 49 hours ago auto-closes on the next sweep
- [ ] Reopen on day 6 works, bumps priority, resets the clock, requires a reason
- [ ] Reopen on day 8 is refused
- [ ] Second reopen puts it on the quality report

**Approvals**
- [ ] All eight types land in one inbox
- [ ] Changing a threshold row changes who is asked, with no code change
- [ ] A blocking approval genuinely blocks — the replacement WOs stay in DRAFT
- [ ] Deciding writes the reason, the actor and the timestamp, and unblocks the flow
- [ ] `support_approvals · view` without `edit` → sees the list, buttons hidden, API 403s

**Portal**
- [ ] A customer sees only `is_customer_visible` events — verify an internal note is absent
- [ ] Internal escalation level is nowhere in the payload (check the raw JSON, not just the UI)
- [ ] A portal-raised ticket has `channel = PORTAL` and full three-level classification
- [ ] Approving a charge from the portal moves the approval and the invoice line to APPROVED
- [ ] Disputing sets `DISPUTED` and notifies Accounts

**Build**
- [ ] `npm test` green · `npm run build` clean (all three apps) · phase report written
