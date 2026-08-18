# Phase 10 report — SLA engine, notifications, CSAT, approvals, portal

Branch: `support-revamp` (no per-phase branch).  
Depends on: Phase 00–09 (uncommitted on this branch).  
Legacy `/support/*` was not rewritten.

## The rule

SLA is a worker, not a number on a screen. Each threshold fires once. A breach without a reason cannot close. A portal ticket uses the same classification as an agent ticket. Customers never see `escalation_level`.

## Migration numbers

Prompt asked for `205_support_v2_notifications.sql`. 205 is ticket flow.

| File | Purpose |
|---|---|
| `backend/migrations/211_support_v2_notifications.sql` | Escalation columns, notification templates + log, CSAT tokens, approval rules, settings, close-without-reason CHECK |

## Worker

`supportSlaWorker.js` — `*/5 * * * *` behind `ENABLE_BACKGROUND_WORKERS`, same pattern as dispatch SLA.

| % elapsed | level | Who |
|---|---|---|
| 50 | 1 | Assignee (in-app) |
| 75 | 2 | Assignee + Lead |
| 100 | 3 | Lead + Manager; `sla_resolution_breached` |
| 125 | 4 | Manager + Ops Head |
| 150 | 5 | Ops Head + Business Head; pin on command centre |

Paused tickets are skipped. Response-clock breach at 100%. WO not `ACCEPTED` 30 minutes before `slot_start` alerts the lead once. `RESOLVED` → `CLOSED` after `auto_close_hours` (48), unless the ticket is breached with no reason.

## Notifications

Templates in `support_notification_templates`. Every send writes `support_notification_log` as `QUEUED` then `SENT` / `FAILED` / `SKIPPED`. Inactive template → `SKIPPED`. Reuses `emailQueueService`, `whatsappService`, `notificationService`.

## CSAT

On resolve: one-use token, link in the resolution message.  
`GET/POST /api/support/v2/public/csat/:token` — only unauthenticated support-v2 route, rate limited. Score ≤ 2 flags the ticket and notifies the manager. Public pages: CRM `/csat/:token` and customer-portal `/csat/:token`.

## Approvals (S16)

`GET /approvals` · existing `POST /approvals/:id/decide`. Thresholds live in `support_approval_rules` (manager above ₹40,000 is a row, not a deploy). View without edit: list visible, buttons hidden, decide 403s.

## Breach register (S17 top)

Four KPI tiles, breaches-by-reason bar, breached-ticket table. Missing reason shows “Not yet given” in `sup-faint`.

## Portal (S21)

Customer-auth routes on `/api/customer-portal/v2/*`. Same `createTicket` validation, `channel = PORTAL`. Payload stripped of `escalation_level` and internal notes. Charge approve / dispute / reopen / documents.

## How to check (after Docker migrations)

```bash
cd backend
node scripts/run-all-migrations.js
npm test
```

Do not apply these migrations from this machine. Do not run them against Railway.
