/**
 * Background sender for WhatsApp campaigns.
 *
 * The contacts table is the queue (same Postgres-backed pattern as email_queue):
 *
 *   1. Recover:  SENDING rows older than WHATSAPP_SENDING_STALE_MINUTES belong to a worker
 *                that died mid-request. Interakt may or may not have accepted them, so they
 *                are marked FAILED / OUTCOME_UNKNOWN and never resent automatically. A later
 *                delivery webhook still promotes them to DELIVERED / READ.
 *   2. Activate: QUEUED campaigns become PROCESSING.
 *   3. Send:     pick up to WHATSAPP_BATCH_SIZE due QUEUED contacts; WHATSAPP_CONCURRENCY
 *                senders drain the batch, each taking a token from the rate limiter and
 *                then claiming its contact with a compare-and-set
 *                   QUEUED -> SENDING  (only while the campaign is still PROCESSING)
 *                so a paused/cancelled campaign stops at once and no contact is sent twice.
 *   4. Settle:   SENT | retry (QUEUED + next_attempt_at, exponential back-off) | FAILED.
 *   5. Complete: PROCESSING campaigns with nothing left pending become COMPLETED (or FAILED
 *                when not a single message went out).
 *
 * One process sends at a time: each tick holds a Postgres advisory lock, so this stays
 * safe even if PM2 is ever scaled past one instance.
 */
const pool = require('../config/db');
const logger = require('../utils/logger');
const { sendTemplateMessage, isEnabled, maskPhone } = require('./interaktWhatsAppService');
const { buildBodyValues } = require('./whatsappCampaignTemplate');
const { refreshCounts } = require('./whatsappCampaignService');
const { AdaptiveRateLimiter } = require('./whatsappRateLimiter');

const log = logger.child ? logger.child({ module: 'whatsapp-campaign-worker' }) : logger;

const intEnv = (name, fallback, min = 0) => Math.max(min, parseInt(process.env[name] || String(fallback), 10) || fallback);

const RATE_PER_MINUTE = intEnv('WHATSAPP_RATE_LIMIT_PER_MINUTE', 200, 1);
const BATCH_SIZE = intEnv('WHATSAPP_BATCH_SIZE', 100, 1);
const MAX_RETRIES = intEnv('WHATSAPP_MAX_RETRIES', 3, 0);
const CONCURRENCY = intEnv('WHATSAPP_CONCURRENCY', 3, 1);
const POLL_INTERVAL_MS = intEnv('WHATSAPP_POLL_INTERVAL_MS', 3000, 500);
const STALE_SENDING_MINUTES = intEnv('WHATSAPP_SENDING_STALE_MINUTES', 2, 1);
const USE_BACKOFF = String(process.env.WHATSAPP_RETRY_BACKOFF || 'true').toLowerCase() !== 'false';
const BACKOFF_MS = [2000, 5000, 15000];
const MAX_TICK_MS = 5 * 60 * 1000;
const ADVISORY_LOCK_KEY = 7310260; // arbitrary, unique to this worker

function retryDelayMs(retryCount, retryAfterMs) {
  // 2s, 5s, 15s, then doubling if WHATSAPP_MAX_RETRIES is raised above 3.
  const last = BACKOFF_MS.length - 1;
  const base = USE_BACKOFF
    ? BACKOFF_MS[Math.min(retryCount, last)] * 2 ** Math.max(0, retryCount - last)
    : BACKOFF_MS[0];
  return Math.max(base, retryAfterMs || 0);
}

/** Pure decision for one send result — exported for tests. */
function decideOutcome(result, retryCount, maxRetries = MAX_RETRIES) {
  if (result.ok) return { action: 'sent' };
  if (result.errorCode === 'DISABLED') return { action: 'requeue' };
  if (result.outcomeUnknown) return { action: 'failed', errorCode: 'OUTCOME_UNKNOWN' };
  if (result.retryable && retryCount < maxRetries) {
    return { action: 'retry', delayMs: retryDelayMs(retryCount, result.retryAfterMs) };
  }
  return { action: 'failed', errorCode: result.errorCode || 'SEND_FAILED' };
}

const limiter = new AdaptiveRateLimiter({
  perMinute: RATE_PER_MINUTE,
  onChange: (info) => {
    if (info.event === 'slowdown') {
      log.warn(info, 'WhatsApp campaign rate limit encountered — slowing down');
    } else {
      log.info(info, 'WhatsApp campaign send rate recovering');
    }
  },
});

let timer = null;
let running = false;
let stopping = false;
let tablesChecked = false;
let lastDisabledWarnAt = 0;

async function tablesExist(db) {
  const r = await db.query("SELECT to_regclass('public.whatsapp_campaign_contacts') AS t");
  return Boolean(r.rows[0]?.t);
}

async function recoverStaleSending(db) {
  const r = await db.query(
    `UPDATE whatsapp_campaign_contacts
        SET status = 'FAILED', failed_at = NOW(), error_code = 'OUTCOME_UNKNOWN',
            error_message = 'Interrupted while sending (server restart or timeout). Not resent automatically to avoid a duplicate — it may or may not have been delivered.',
            updated_at = NOW()
      WHERE status = 'SENDING'
        AND sending_started_at < NOW() - make_interval(mins => $1)
      RETURNING campaign_id`,
    [STALE_SENDING_MINUTES]
  );
  if (r.rowCount) {
    log.warn({ recovered: r.rowCount }, 'Recovered stale SENDING WhatsApp contacts as outcome-unknown');
    await refreshCounts(db, r.rows.map((x) => x.campaign_id));
  }
}

async function activateQueued(db) {
  const r = await db.query(
    `UPDATE whatsapp_campaigns
        SET status = 'PROCESSING', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
      WHERE status = 'QUEUED'
      RETURNING id, name`
  );
  r.rows.forEach((c) => log.info({ campaignId: c.id }, 'WhatsApp campaign processing'));
}

async function pickBatch(db) {
  const r = await db.query(
    `SELECT c.id
       FROM whatsapp_campaign_contacts c
       JOIN whatsapp_campaigns w ON w.id = c.campaign_id
      WHERE w.status = 'PROCESSING'
        AND c.status = 'QUEUED'
        AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= NOW())
      ORDER BY w.started_at ASC NULLS LAST, c.campaign_id ASC, c.next_attempt_at ASC NULLS FIRST, c.id ASC
      LIMIT $1`,
    [BATCH_SIZE]
  );
  return r.rows.map((x) => x.id);
}

/** Compare-and-set QUEUED -> SENDING. Returns the contact + campaign, or null if no longer ours to send. */
async function claim(db, contactId) {
  const r = await db.query(
    `UPDATE whatsapp_campaign_contacts c
        SET status = 'SENDING', sending_started_at = NOW(), last_attempt_at = NOW(), updated_at = NOW()
       FROM whatsapp_campaigns w
      WHERE c.id = $1
        AND c.status = 'QUEUED'
        AND w.id = c.campaign_id
        AND w.status = 'PROCESSING'
      RETURNING c.id, c.campaign_id, c.name, c.country_code, c.phone_number, c.variables, c.retry_count,
                w.template_name, w.language_code, w.header_media_url, w.body_variables`,
    [contactId]
  );
  return r.rows[0] || null;
}

async function markSent(db, contact, result) {
  await db.query(
    `UPDATE whatsapp_campaign_contacts
        SET status = CASE WHEN status = 'SENDING' THEN 'SENT' ELSE status END,
            message_id = COALESCE(message_id, $2),
            sent_at = COALESCE(sent_at, NOW()),
            http_status = $3, provider_response = $4::jsonb,
            error_message = NULL, error_code = NULL, next_attempt_at = NULL, updated_at = NOW()
      WHERE id = $1`,
    [contact.id, result.messageId, result.httpStatus, JSON.stringify(result.data ?? null)]
  );
}

async function markRetry(db, contact, result, delayMs) {
  // If the campaign was cancelled while this request was in flight, do not requeue.
  await db.query(
    `UPDATE whatsapp_campaign_contacts c
        SET status = CASE WHEN w.status = 'CANCELLED' THEN 'SKIPPED' ELSE 'QUEUED' END,
            retry_count = c.retry_count + 1,
            next_attempt_at = NOW() + make_interval(secs => $2::double precision / 1000),
            error_message = $3, error_code = $4, http_status = $5, provider_response = $6::jsonb,
            updated_at = NOW()
       FROM whatsapp_campaigns w
      WHERE c.id = $1 AND c.status = 'SENDING' AND w.id = c.campaign_id`,
    [contact.id, delayMs, String(result.error || '').slice(0, 1000), result.errorCode,
      result.httpStatus, JSON.stringify(result.data ?? null)]
  );
}

async function markFailed(db, contact, { error, errorCode, httpStatus = null, data = null }) {
  await db.query(
    `UPDATE whatsapp_campaign_contacts
        SET status = 'FAILED', failed_at = NOW(), error_message = $2, error_code = $3,
            http_status = $4, provider_response = $5::jsonb, next_attempt_at = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'SENDING'`,
    [contact.id, String(error || 'Send failed').slice(0, 1000), errorCode, httpStatus, JSON.stringify(data ?? null)]
  );
}

async function requeue(db, contact) {
  await db.query(
    `UPDATE whatsapp_campaign_contacts SET status = 'QUEUED', updated_at = NOW() WHERE id = $1 AND status = 'SENDING'`,
    [contact.id]
  );
}

/** Cheap pre-check so a paused/cancelled batch drains at once instead of waiting for tokens. */
async function stillSendable(db, contactId) {
  const r = await db.query(
    `SELECT 1 FROM whatsapp_campaign_contacts c
       JOIN whatsapp_campaigns w ON w.id = c.campaign_id
      WHERE c.id = $1 AND c.status = 'QUEUED' AND w.status = 'PROCESSING'`,
    [contactId]
  );
  return r.rowCount > 0;
}

async function sendOne(db, contactId, touched) {
  if (!(await stillSendable(db, contactId))) return;
  await limiter.acquire();
  if (stopping) return;
  const contact = await claim(db, contactId);
  if (!contact) return; // paused, cancelled, or already handled
  touched.add(contact.campaign_id);
  const meta = { campaignId: contact.campaign_id, contactId: contact.id, phone: maskPhone(contact.phone_number) };

  const body = buildBodyValues(contact.body_variables, contact);
  if (!body.ok) {
    await markFailed(db, contact, { error: body.error, errorCode: 'VARIABLE_EMPTY' });
    log.warn({ ...meta, error: body.error }, 'WhatsApp campaign message failed');
    return;
  }

  const result = await sendTemplateMessage({
    countryCode: contact.country_code,
    phoneNumber: contact.phone_number,
    templateName: contact.template_name,
    languageCode: contact.language_code,
    headerValues: contact.header_media_url ? [contact.header_media_url] : [],
    bodyValues: body.values,
    callbackData: `wac:${contact.campaign_id}:${contact.id}`,
  });

  if (result.rateLimited) limiter.onRateLimited(result.retryAfterMs);
  else if (result.ok || result.httpStatus) limiter.onSuccess();

  const decision = decideOutcome(result, contact.retry_count);
  if (decision.action === 'sent') {
    await markSent(db, contact, result);
    log.info({ ...meta, messageId: result.messageId }, 'WhatsApp campaign message sent');
  } else if (decision.action === 'requeue') {
    await requeue(db, contact);
  } else if (decision.action === 'retry') {
    await markRetry(db, contact, result, decision.delayMs);
    log.warn(
      { ...meta, attempt: contact.retry_count + 1, delayMs: decision.delayMs, httpStatus: result.httpStatus, error: result.error },
      'WhatsApp campaign retry scheduled'
    );
  } else {
    await markFailed(db, contact, {
      error: result.error, errorCode: decision.errorCode, httpStatus: result.httpStatus, data: result.data,
    });
    log.warn(
      { ...meta, httpStatus: result.httpStatus, errorCode: decision.errorCode, error: result.error, retries: contact.retry_count },
      'WhatsApp campaign message failed'
    );
  }
}

/** Drain one batch with at most CONCURRENCY requests in flight. */
async function processBatch(db, ids, touched) {
  let next = 0;
  const lane = async () => {
    while (!stopping && next < ids.length) {
      const id = ids[next];
      next += 1;
      try {
        await sendOne(db, id, touched);
      } catch (err) {
        log.error({ contactId: id, err: err.message }, 'WhatsApp campaign send crashed');
      }
    }
  };
  const lanes = [];
  for (let i = 0; i < Math.min(CONCURRENCY, ids.length); i += 1) lanes.push(lane());
  await Promise.all(lanes);
}

async function completeFinished(db) {
  const r = await db.query(
    `UPDATE whatsapp_campaigns w
        SET status = CASE WHEN EXISTS (
                       SELECT 1 FROM whatsapp_campaign_contacts c
                        WHERE c.campaign_id = w.id AND c.status IN ('SENT','DELIVERED','READ'))
                     THEN 'COMPLETED' ELSE 'FAILED' END,
            last_error = CASE WHEN EXISTS (
                       SELECT 1 FROM whatsapp_campaign_contacts c
                        WHERE c.campaign_id = w.id AND c.status IN ('SENT','DELIVERED','READ'))
                     THEN w.last_error ELSE 'No message could be sent — check the errors on the contacts' END,
            completed_at = NOW(), updated_at = NOW()
      WHERE w.status = 'PROCESSING'
        AND NOT EXISTS (
          SELECT 1 FROM whatsapp_campaign_contacts c
           WHERE c.campaign_id = w.id AND c.status IN ('PENDING','QUEUED','SENDING'))
      RETURNING w.id, w.status`
  );
  if (!r.rowCount) return;
  await refreshCounts(db, r.rows.map((x) => x.id));
  const stats = await db.query(
    `SELECT id, status, valid_contacts, sent_count, delivered_count, read_count, failed_count
       FROM whatsapp_campaigns WHERE id = ANY($1::int[])`,
    [r.rows.map((x) => x.id)]
  );
  stats.rows.forEach((s) => log.info(
    {
      campaignId: s.id, status: s.status, total: s.valid_contacts, sent: s.sent_count,
      delivered: s.delivered_count, read: s.read_count, failed: s.failed_count,
    },
    'WhatsApp campaign completed'
  ));
}

async function tick() {
  if (running || stopping) return;
  running = true;
  const started = Date.now();
  let lockClient = null;
  let locked = false;
  try {
    lockClient = await pool.connect();
    locked = (await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_LOCK_KEY])).rows[0].ok;
    if (!locked) return;

    if (!tablesChecked) {
      if (!(await tablesExist(pool))) {
        log.warn('WhatsApp campaign tables missing — apply migration 260_whatsapp_campaigns.sql');
        return;
      }
      tablesChecked = true;
    }

    await recoverStaleSending(pool);
    await activateQueued(pool);

    if (!isEnabled()) {
      if (Date.now() - lastDisabledWarnAt > 10 * 60 * 1000) {
        const waiting = await pool.query("SELECT COUNT(*)::int AS n FROM whatsapp_campaigns WHERE status = 'PROCESSING'");
        if (waiting.rows[0].n) {
          log.warn({ campaigns: waiting.rows[0].n }, 'WhatsApp campaigns waiting — sending is disabled (OUTBOUND_MESSAGING_ENABLED / INTERAKT_API_KEY)');
          lastDisabledWarnAt = Date.now();
        }
      }
      return;
    }

    while (!stopping && Date.now() - started < MAX_TICK_MS) {
      const ids = await pickBatch(pool);
      if (!ids.length) break;
      const touched = new Set();
      await processBatch(pool, ids, touched);
      await refreshCounts(pool, [...touched]);
      if (ids.length < BATCH_SIZE) break;
    }
    await completeFinished(pool);
  } catch (err) {
    log.error({ err: err.message }, 'WhatsApp campaign worker tick failed');
  } finally {
    if (lockClient) {
      if (locked) await lockClient.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
      lockClient.release();
    }
    running = false;
  }
}

function startWhatsAppCampaignWorker() {
  if (timer) return;
  stopping = false;
  timer = setInterval(() => { tick(); }, POLL_INTERVAL_MS);
  if (timer.unref) timer.unref();
  log.info(
    { ratePerMinute: RATE_PER_MINUTE, batchSize: BATCH_SIZE, concurrency: CONCURRENCY, maxRetries: MAX_RETRIES },
    'WhatsApp campaign worker started'
  );
  setImmediate(tick);
}

function stopWhatsAppCampaignWorker() {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
}

/** Run a tick now (e.g. right after Start / Resume) instead of waiting for the next poll. */
function nudgeWhatsAppCampaignWorker() {
  if (timer) setImmediate(tick);
}

module.exports = {
  startWhatsAppCampaignWorker,
  stopWhatsAppCampaignWorker,
  nudgeWhatsAppCampaignWorker,
  decideOutcome,
  retryDelayMs,
};
