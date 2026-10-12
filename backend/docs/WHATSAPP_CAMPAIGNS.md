# WhatsApp Campaigns — runbook

Bulk Interakt template sends from `/whatsapp-campaigns`.

## Moving parts

| Piece | File |
|---|---|
| Schema + permission sections | `migrations/260_whatsapp_campaigns.sql` |
| Interakt single-attempt send | `services/interaktWhatsAppService.js` → `sendTemplateMessage()` |
| File parsing / validation | `services/whatsappCampaignImportService.js` |
| Variable mapping / preview | `services/whatsappCampaignTemplate.js` |
| CRUD, transitions, counters, webhook | `services/whatsappCampaignService.js` |
| Sender | `services/whatsappCampaignWorker.js` + `services/whatsappRateLimiter.js` |
| API | `routes/whatsappCampaigns.js` → `/api/whatsapp-campaigns` |

The contacts table is the queue. The worker (started with the other background
workers) polls every `WHATSAPP_POLL_INTERVAL_MS`, holds a Postgres advisory lock for
the whole send loop, takes a rate-limiter token, then claims each contact with
`UPDATE … SET status='SENDING' WHERE status='QUEUED' AND campaign is PROCESSING`.
That compare-and-set is what prevents double sends and makes pause/cancel immediate.

## Duplicate safety rules

- A contact is only ever sent from `QUEUED`, and only by the worker that won the CAS.
- Retried automatically: HTTP 429, 5xx, and connection errors where the request never
  left (`ECONNREFUSED`, `ENOTFOUND`, …). Back-off 2s / 5s / 15s, or Retry-After if longer.
- **Not** retried: timeouts / connection resets (Interakt may have accepted the message)
  and `SENDING` rows left by a crash (recovered after `WHATSAPP_SENDING_STALE_MINUTES`).
  Both become `FAILED` with `error_code = OUTCOME_UNKNOWN`. A later delivery webhook
  promotes them to `DELIVERED` / `READ`.
- A unique index allows one valid row per number per campaign.

## Deploy

1. Apply the migration out of band (CI/CD does not): `node scripts/run-all-migrations.js`.
2. `.env`: `INTERAKT_API_KEY`, `OUTBOUND_MESSAGING_ENABLED=true`, optional `WHATSAPP_*` tuning
   and `INTERAKT_WEBHOOK_TOKEN` (see `.env.example`). Restart.
3. Interakt → Developer Settings → Webhooks:
   `https://<crm-host>/api/whatsapp-campaigns/webhooks/interakt?token=<INTERAKT_WEBHOOK_TOKEN>`
   with message status events enabled. Without it, Delivered/Read stay 0.
4. Roles & Permissions → *Marketing*: grant `whatsapp_campaigns` (view/create/edit/delete)
   and Edit on `whatsapp_campaigns_start`, `_pause`, `_cancel`. No role has them by default.

## Operating

- Kill switch: `OUTBOUND_MESSAGING_ENABLED=false` (or no API key) — queued contacts wait,
  nothing is marked failed. Start/Resume are refused while it is off.
- Logs (pino, `module: whatsapp-campaign-worker`): *started / paused / resumed / completed*,
  *message sent / failed*, *retry scheduled*, *rate limit encountered*. Phones are masked;
  the API key is never logged.
- Stuck campaign? Check `SELECT status, COUNT(*) FROM whatsapp_campaign_contacts WHERE campaign_id = $1 GROUP BY 1;`
  and that only one backend process is running the worker.
