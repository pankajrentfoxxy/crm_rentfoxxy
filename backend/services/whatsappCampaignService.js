/**
 * WhatsApp campaigns: CRUD, guarded status transitions, counters, contact queries
 * and Interakt delivery-status webhooks.
 *
 * Campaign lifecycle
 *   DRAFT ──import (≥1 valid)──▶ READY ──start──▶ QUEUED ──worker──▶ PROCESSING ──▶ COMPLETED | FAILED
 *                                                   ▲  │ pause                │
 *                                         resume ───┘  ▼                      │
 *                                                    PAUSED ◀──── pause ──────┘
 *   READY / QUEUED / PROCESSING / PAUSED ──cancel──▶ CANCELLED
 *
 * Every transition is a single UPDATE ... WHERE status IN (allowed), so two users
 * clicking at once cannot both win.
 */
const logger = require('../utils/logger');
const { isEnabled: isInteraktEnabled } = require('./interaktWhatsAppService');
const {
  validateBodyVariables, buildBodyValues, renderPreview, sanitizeText,
} = require('./whatsappCampaignTemplate');

const STATUSES = ['DRAFT', 'READY', 'QUEUED', 'PROCESSING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'];
const EDITABLE = ['DRAFT', 'READY'];

const CONTACT_FILTERS = {
  pending: "c.status IN ('PENDING','QUEUED','SENDING')",
  sent: "c.status IN ('SENT','DELIVERED','READ')",
  delivered: "c.status IN ('DELIVERED','READ')",
  read: "c.status = 'READ'",
  failed: "c.status = 'FAILED'",
  skipped: "c.status = 'SKIPPED'",
  invalid: "c.validation_status = 'invalid'",
  duplicate: "c.validation_status = 'duplicate'",
  rejected: "c.validation_status IN ('invalid','duplicate')",
};

class CampaignError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CampaignError';
    this.status = status;
  }
}

const log = logger.child ? logger.child({ module: 'whatsapp-campaigns' }) : logger;

function sendingConfig() {
  return {
    sendingEnabled: isInteraktEnabled(),
    ratePerMinute: Math.max(1, parseInt(process.env.WHATSAPP_RATE_LIMIT_PER_MINUTE || '200', 10)),
    batchSize: Math.max(1, parseInt(process.env.WHATSAPP_BATCH_SIZE || '100', 10)),
    maxRetries: Math.max(0, parseInt(process.env.WHATSAPP_MAX_RETRIES || '3', 10)),
    webhookConfigured: Boolean(String(process.env.INTERAKT_WEBHOOK_TOKEN || '').trim()),
  };
}

/** Validate create/update input. `partial` skips required checks for fields not sent. */
function validateCampaignInput(body = {}, { partial = false } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (!partial || has('name')) {
    const name = sanitizeText(body.name, 150);
    if (!name) throw new CampaignError('Campaign name is required');
    out.name = name;
  }
  if (!partial || has('template_name')) {
    const t = String(body.template_name || '').trim();
    if (!/^[a-z0-9_]{1,120}$/.test(t)) {
      throw new CampaignError('Template name must match the approved Interakt template (lowercase letters, numbers and _)');
    }
    out.template_name = t;
  }
  if (!partial || has('language_code')) {
    const l = String(body.language_code || 'en').trim();
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(l)) throw new CampaignError('Language code looks wrong (e.g. en, en_US, hi)');
    out.language_code = l;
  }
  if (!partial || has('header_media_url')) {
    const u = String(body.header_media_url || '').trim();
    if (u) {
      let parsed;
      try { parsed = new URL(u); } catch { throw new CampaignError('Header media URL is not a valid URL'); }
      if (parsed.protocol !== 'https:') throw new CampaignError('Header media URL must start with https://');
      if (u.length > 2000) throw new CampaignError('Header media URL is too long');
    }
    out.header_media_url = u || null;
  }
  if (!partial || has('body_variables')) {
    const v = validateBodyVariables(body.body_variables);
    if (!v.ok) throw new CampaignError(v.error);
    out.body_variables = v.variables;
  }
  if (!partial || has('preview_body')) {
    const p = String(body.preview_body || '').replace(/\r\n/g, '\n').slice(0, 1024);
    out.preview_body = p.trim() ? p : null;
  }
  return out;
}

async function getCampaignRow(db, id) {
  const r = await db.query(
    `SELECT w.*, u.name AS created_by_name
       FROM whatsapp_campaigns w
       LEFT JOIN users u ON u.user_id = w.created_by
      WHERE w.id = $1`,
    [id]
  );
  return r.rows[0] || null;
}

async function requireCampaign(db, id) {
  const row = await getCampaignRow(db, id);
  if (!row) throw new CampaignError('Campaign not found', 404);
  return row;
}

async function createCampaign(db, body, userId) {
  const v = validateCampaignInput(body);
  const r = await db.query(
    `INSERT INTO whatsapp_campaigns
       (name, template_name, language_code, header_media_url, body_variables, preview_body, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
     RETURNING id`,
    [v.name, v.template_name, v.language_code, v.header_media_url, JSON.stringify(v.body_variables), v.preview_body, userId || null]
  );
  log.info({ campaignId: r.rows[0].id, template: v.template_name, userId }, 'WhatsApp campaign created');
  return getCampaignRow(db, r.rows[0].id);
}

/** Edits are allowed only before sending. Changing the variable mapping drops imported contacts. */
async function updateCampaign(db, id, body) {
  const v = validateCampaignInput(body, { partial: true });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const cur = (await client.query('SELECT * FROM whatsapp_campaigns WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw new CampaignError('Campaign not found', 404);
    if (!EDITABLE.includes(cur.status)) throw new CampaignError(`A ${cur.status} campaign cannot be edited`, 409);

    const mappingChanged = v.body_variables
      && JSON.stringify(v.body_variables) !== JSON.stringify(cur.body_variables);
    const next = { ...cur, ...v };
    await client.query(
      `UPDATE whatsapp_campaigns
          SET name = $2, template_name = $3, language_code = $4, header_media_url = $5,
              body_variables = $6::jsonb, preview_body = $7, updated_at = NOW()
        WHERE id = $1`,
      [id, next.name, next.template_name, next.language_code, next.header_media_url,
        JSON.stringify(next.body_variables), next.preview_body]
    );
    let contactsCleared = false;
    if (mappingChanged && cur.total_contacts > 0) {
      await client.query('DELETE FROM whatsapp_campaign_contacts WHERE campaign_id = $1', [id]);
      await client.query(
        `UPDATE whatsapp_campaigns
            SET status = 'DRAFT', total_contacts = 0, valid_contacts = 0, invalid_contacts = 0,
                duplicate_contacts = 0, skipped_count = 0, queued_count = 0
          WHERE id = $1`,
        [id]
      );
      contactsCleared = true;
    }
    await client.query('COMMIT');
    return { campaign: await getCampaignRow(db, id), contactsCleared };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function deleteCampaign(db, id) {
  const r = await db.query(
    `DELETE FROM whatsapp_campaigns WHERE id = $1 AND status = ANY($2::text[]) RETURNING id`,
    [id, EDITABLE]
  );
  if (!r.rowCount) {
    await requireCampaign(db, id);
    throw new CampaignError('Only DRAFT or READY campaigns can be deleted', 409);
  }
}

async function listCampaigns(db, { page = 1, limit = 25, search = '', status = '' } = {}) {
  const params = [];
  const where = [];
  const s = String(search || '').trim();
  if (s) {
    params.push(`%${s}%`);
    where.push(`(w.name ILIKE $${params.length} OR w.template_name ILIKE $${params.length})`);
  }
  const st = String(status || '').trim().toUpperCase();
  if (st && STATUSES.includes(st)) {
    params.push(st);
    where.push(`w.status = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM whatsapp_campaigns w ${whereSql}`, params)).rows[0].n;
  params.push(lim, (pg - 1) * lim);
  const rows = (await db.query(
    `SELECT w.*, u.name AS created_by_name
       FROM whatsapp_campaigns w
       LEFT JOIN users u ON u.user_id = w.created_by
       ${whereSql}
      ORDER BY w.created_at DESC, w.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )).rows;
  return { rows, total, page: pg, limit: lim, totalPages: Math.max(1, Math.ceil(total / lim)) };
}

/** Recompute stored counters from the contacts table — exact and idempotent. */
async function refreshCounts(db, campaignIds) {
  const ids = [...new Set((campaignIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return;
  await db.query(
    `UPDATE whatsapp_campaigns w
        SET queued_count    = s.queued,
            sent_count      = s.sent,
            delivered_count = s.delivered,
            read_count      = s.read,
            failed_count    = s.failed,
            skipped_count   = s.skipped,
            updated_at      = NOW()
       FROM (
         SELECT campaign_id,
                COUNT(*) FILTER (WHERE status IN ('PENDING','QUEUED','SENDING'))::int AS queued,
                COUNT(*) FILTER (WHERE status IN ('SENT','DELIVERED','READ'))::int    AS sent,
                COUNT(*) FILTER (WHERE status IN ('DELIVERED','READ'))::int           AS delivered,
                COUNT(*) FILTER (WHERE status = 'READ')::int                          AS read,
                COUNT(*) FILTER (WHERE status = 'FAILED')::int                        AS failed,
                COUNT(*) FILTER (WHERE status = 'SKIPPED')::int                       AS skipped
           FROM whatsapp_campaign_contacts
          WHERE campaign_id = ANY($1::int[])
          GROUP BY campaign_id
       ) s
      WHERE w.id = s.campaign_id`,
    [ids]
  );
}

async function getStats(db, id) {
  await refreshCounts(db, [id]);
  const c = await requireCampaign(db, id);
  const breakdown = (await db.query(
    `SELECT status, COUNT(*)::int AS n FROM whatsapp_campaign_contacts WHERE campaign_id = $1 GROUP BY status`,
    [id]
  )).rows.reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});
  const recent = (await db.query(
    `SELECT COUNT(*)::int AS n FROM whatsapp_campaign_contacts
      WHERE campaign_id = $1 AND sent_at > NOW() - INTERVAL '1 minute'`,
    [id]
  )).rows[0].n;
  const valid = c.valid_contacts || 0;
  const processed = (c.sent_count || 0) + (c.failed_count || 0);
  const cancelledSkips = Math.max(0, (c.skipped_count || 0) - (c.invalid_contacts || 0) - (c.duplicate_contacts || 0));
  const remaining = c.queued_count || 0;
  const cfg = sendingConfig();
  const perMinute = recent || cfg.ratePerMinute;
  return {
    status: c.status,
    total: c.total_contacts,
    valid,
    invalid: c.invalid_contacts,
    duplicate: c.duplicate_contacts,
    queued: remaining,
    sent: c.sent_count,
    delivered: c.delivered_count,
    read: c.read_count,
    failed: c.failed_count,
    skipped: c.skipped_count,
    cancelled: cancelledSkips,
    sending: breakdown.SENDING || 0,
    processed,
    progressPercent: valid ? Math.min(100, Math.round(((processed + cancelledSkips) / valid) * 1000) / 10) : 0,
    sentLastMinute: recent,
    etaMinutes: ['QUEUED', 'PROCESSING'].includes(c.status) && remaining ? Math.ceil(remaining / perMinute) : null,
    breakdown,
    startedAt: c.started_at,
    completedAt: c.completed_at,
    lastError: c.last_error,
  };
}

async function getPreview(db, campaign) {
  const r = await db.query(
    `SELECT id, name, country_code, phone_number, variables
       FROM whatsapp_campaign_contacts
      WHERE campaign_id = $1 AND validation_status = 'valid'
      ORDER BY row_number ASC NULLS LAST, id ASC
      LIMIT 1`,
    [campaign.id]
  );
  const contact = r.rows[0] || null;
  const built = buildBodyValues(campaign.body_variables, contact || { name: 'Rahul', variables: { name: 'Rahul' } });
  const values = built.ok ? built.values : [];
  return {
    contact,
    sample: !contact,
    bodyValues: values,
    error: built.ok ? null : built.error,
    text: campaign.preview_body ? renderPreview(campaign.preview_body, values) : null,
    headerMediaUrl: campaign.header_media_url,
  };
}

async function getCampaignDetail(db, id) {
  const campaign = await requireCampaign(db, id);
  const imports = (await db.query(
    `SELECT i.*, u.name AS imported_by_name
       FROM whatsapp_campaign_imports i
       LEFT JOIN users u ON u.user_id = i.imported_by
      WHERE i.campaign_id = $1
      ORDER BY i.imported_at DESC, i.id DESC`,
    [id]
  )).rows;
  return {
    campaign,
    latestImport: imports[0] || null,
    imports,
    preview: await getPreview(db, campaign),
    config: sendingConfig(),
  };
}

async function listContacts(db, id, { page = 1, limit = 50, filter = 'all', search = '' } = {}) {
  await requireCampaign(db, id);
  const params = [id];
  const where = ['c.campaign_id = $1'];
  const f = String(filter || 'all').toLowerCase();
  if (CONTACT_FILTERS[f]) where.push(CONTACT_FILTERS[f]);
  const s = String(search || '').trim();
  if (s) {
    params.push(`%${s}%`);
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 3) {
      params.push(`%${digits}%`);
      where.push(`(c.name ILIKE $${params.length - 1} OR c.original_mobile ILIKE $${params.length - 1} OR c.phone_number LIKE $${params.length})`);
    } else {
      where.push(`(c.name ILIKE $${params.length} OR c.original_mobile ILIKE $${params.length})`);
    }
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM whatsapp_campaign_contacts c ${whereSql}`, params)).rows[0].n;
  params.push(lim, (pg - 1) * lim);
  const rows = (await db.query(
    `SELECT c.id, c.row_number, c.name, c.country_code, c.phone_number, c.original_mobile,
            c.validation_status, c.validation_error, c.status, c.message_id, c.error_message,
            c.error_code, c.http_status, c.retry_count, c.next_attempt_at, c.sent_at,
            c.delivered_at, c.read_at, c.failed_at, c.updated_at
       FROM whatsapp_campaign_contacts c
       ${whereSql}
      ORDER BY c.row_number ASC NULLS LAST, c.id ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )).rows;
  return { rows, total, page: pg, limit: lim, totalPages: Math.max(1, Math.ceil(total / lim)) };
}

/** Rows for the Excel/CSV download. `type`: rejected | invalid | duplicate | failed | all. */
async function exportContacts(db, id, type = 'rejected') {
  const campaign = await requireCampaign(db, id);
  const key = String(type || 'rejected').toLowerCase();
  const filterSql = key === 'all' ? 'TRUE' : (CONTACT_FILTERS[key] || CONTACT_FILTERS.rejected);
  const imp = (await db.query(
    'SELECT columns FROM whatsapp_campaign_imports WHERE campaign_id = $1 ORDER BY imported_at DESC, id DESC LIMIT 1',
    [id]
  )).rows[0];
  const extra = (imp?.columns || []).filter((c) => !['name', 'mobile'].includes(c.key));
  const rows = (await db.query(
    `SELECT c.* FROM whatsapp_campaign_contacts c
      WHERE c.campaign_id = $1 AND ${filterSql}
      ORDER BY c.row_number ASC NULLS LAST, c.id ASC`,
    [id]
  )).rows;
  const iso = (d) => (d ? new Date(d).toISOString() : '');
  const data = rows.map((c) => {
    const row = {
      Row: c.row_number,
      Name: c.name || '',
      Mobile: c.original_mobile || '',
      'Normalised Mobile': c.phone_number ? `${c.country_code}${c.phone_number}` : '',
      Validation: c.validation_status,
      Reason: c.validation_error || '',
      Status: c.status,
      Error: c.error_message || '',
      'Message ID': c.message_id || '',
      'Retry Count': c.retry_count,
      'Sent At': iso(c.sent_at),
      'Delivered At': iso(c.delivered_at),
      'Read At': iso(c.read_at),
    };
    extra.forEach((col) => { row[col.label || col.key] = c.variables?.[col.key] ?? ''; });
    return row;
  });
  return { campaign, rows: data, type: key };
}

// ── Transitions ─────────────────────────────────────────────────────────────

async function startCampaign(db, id, userId) {
  if (!isInteraktEnabled()) {
    throw new CampaignError(
      'WhatsApp sending is turned off on the server (OUTBOUND_MESSAGING_ENABLED / INTERAKT_API_KEY). Ask an administrator.',
      409
    );
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const cur = (await client.query('SELECT * FROM whatsapp_campaigns WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw new CampaignError('Campaign not found', 404);
    if (cur.status !== 'READY') throw new CampaignError(`A ${cur.status} campaign cannot be started`, 409);
    const q = await client.query(
      `UPDATE whatsapp_campaign_contacts
          SET status = 'QUEUED', next_attempt_at = NULL, updated_at = NOW()
        WHERE campaign_id = $1 AND status = 'PENDING' AND validation_status = 'valid'`,
      [id]
    );
    if (!q.rowCount) throw new CampaignError('This campaign has no valid contacts to send to', 409);
    await client.query(
      `UPDATE whatsapp_campaigns
          SET status = 'QUEUED', queued_count = $2, last_error = NULL, updated_at = NOW()
        WHERE id = $1`,
      [id, q.rowCount]
    );
    await client.query('COMMIT');
    log.info({ campaignId: id, userId, queued: q.rowCount, template: cur.template_name }, 'WhatsApp campaign started');
    return q.rowCount;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function guardedTransition(db, id, from, setSql, label) {
  const r = await db.query(
    `UPDATE whatsapp_campaigns SET ${setSql}, updated_at = NOW()
      WHERE id = $1 AND status = ANY($2::text[])
      RETURNING id, status`,
    [id, from]
  );
  if (!r.rowCount) {
    const cur = await requireCampaign(db, id);
    throw new CampaignError(`A ${cur.status} campaign cannot be ${label}`, 409);
  }
  return r.rows[0];
}

async function pauseCampaign(db, id, userId) {
  await guardedTransition(db, id, ['QUEUED', 'PROCESSING'], "status = 'PAUSED', paused_at = NOW()", 'paused');
  log.info({ campaignId: id, userId }, 'WhatsApp campaign paused');
}

async function resumeCampaign(db, id, userId) {
  if (!isInteraktEnabled()) {
    throw new CampaignError('WhatsApp sending is turned off on the server. Ask an administrator.', 409);
  }
  await guardedTransition(db, id, ['PAUSED'], "status = 'QUEUED', paused_at = NULL, last_error = NULL", 'resumed');
  log.info({ campaignId: id, userId }, 'WhatsApp campaign resumed');
}

async function cancelCampaign(db, id, userId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE whatsapp_campaigns
          SET status = 'CANCELLED', cancelled_at = NOW(), completed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status IN ('READY','QUEUED','PROCESSING','PAUSED')
        RETURNING id`,
      [id]
    );
    if (!r.rowCount) {
      const cur = (await client.query('SELECT status FROM whatsapp_campaigns WHERE id = $1', [id])).rows[0];
      if (!cur) throw new CampaignError('Campaign not found', 404);
      throw new CampaignError(`A ${cur.status} campaign cannot be cancelled`, 409);
    }
    const s = await client.query(
      `UPDATE whatsapp_campaign_contacts
          SET status = 'SKIPPED', error_code = 'CANCELLED', error_message = 'Campaign cancelled before this message was sent',
              next_attempt_at = NULL, updated_at = NOW()
        WHERE campaign_id = $1 AND status IN ('PENDING','QUEUED')`,
      [id]
    );
    await client.query('COMMIT');
    await refreshCounts(db, [id]);
    log.info({ campaignId: id, userId, skipped: s.rowCount }, 'WhatsApp campaign cancelled');
    return s.rowCount;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Interakt webhook ────────────────────────────────────────────────────────

const WEBHOOK_EVENTS = {
  message_api_sent: 'SENT',
  message_api_delivered: 'DELIVERED',
  message_api_read: 'READ',
  message_api_failed: 'FAILED',
};

function parseTimestamp(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Pull what we need out of an Interakt webhook body. Returns null when not a message status event. */
function parseWebhookEvent(body) {
  const message = body?.data?.message || body?.message || null;
  if (!message) return null;
  let status = WEBHOOK_EVENTS[String(body?.type || '').toLowerCase()];
  if (!status) {
    const ms = String(message.message_status || message.status || '').toUpperCase();
    if (['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(ms)) status = ms;
  }
  if (!status) return null;
  const messageId = message.id ? String(message.id) : null;
  const cb = String(message.callback_data || message.callbackData || body?.data?.callback_data || '');
  const m = /^wac:(\d+):(\d+)$/.exec(cb);
  if (!messageId && !m) return null;
  const at = parseTimestamp(
    status === 'READ' ? message.seen_at_utc || message.read_at_utc
      : status === 'DELIVERED' ? message.delivered_at_utc
        : status === 'FAILED' ? message.failed_at_utc
          : message.received_at_utc || message.sent_at_utc
  );
  const reason = message.channel_failure_reason || message.failure_reason || message.error || null;
  return {
    status,
    messageId,
    campaignId: m ? Number(m[1]) : null,
    contactId: m ? Number(m[2]) : null,
    at,
    reason: reason ? (typeof reason === 'string' ? reason : JSON.stringify(reason)).slice(0, 1000) : null,
  };
}

// Status only moves forward. A FAILED row whose outcome was unknown (timeout, crash)
// is promoted if Interakt later reports it went out.
const UPGRADE_FROM = {
  SENT: "c.status = 'SENDING' OR (c.status = 'FAILED' AND c.error_code = 'OUTCOME_UNKNOWN')",
  DELIVERED: "c.status IN ('SENDING','SENT') OR (c.status = 'FAILED' AND c.error_code = 'OUTCOME_UNKNOWN')",
  READ: "c.status IN ('SENDING','SENT','DELIVERED') OR (c.status = 'FAILED' AND c.error_code = 'OUTCOME_UNKNOWN')",
  FAILED: "c.status IN ('SENDING','SENT')",
};

async function applyWebhookEvent(db, event, rawBody) {
  const params = [event.messageId, event.contactId, event.campaignId, event.at];
  // $5 / $6 (failure reason, raw body) are only referenced by the FAILED statement.
  if (event.status === 'FAILED') params.push(event.reason, JSON.stringify(rawBody || null));
  const upgrade = UPGRADE_FROM[event.status];
  // Promoting an OUTCOME_UNKNOWN failure clears its error.
  const clearFailure = `CASE WHEN c.status = 'FAILED' AND (${upgrade})`;
  const clearSql = `error_message = ${clearFailure} THEN NULL ELSE c.error_message END,
                    error_code = ${clearFailure} THEN NULL ELSE c.error_code END,
                    failed_at = ${clearFailure} THEN NULL ELSE c.failed_at END`;
  const sets = {
    SENT: `sent_at = COALESCE(c.sent_at, $4::timestamptz, NOW()), ${clearSql}`,
    DELIVERED: `delivered_at = COALESCE(c.delivered_at, $4::timestamptz, NOW()),
                sent_at = COALESCE(c.sent_at, $4::timestamptz, NOW()), ${clearSql}`,
    READ: `read_at = COALESCE(c.read_at, $4::timestamptz, NOW()),
           delivered_at = COALESCE(c.delivered_at, $4::timestamptz, NOW()),
           sent_at = COALESCE(c.sent_at, $4::timestamptz, NOW()), ${clearSql}`,
    FAILED: `failed_at = CASE WHEN ${upgrade} THEN COALESCE($4::timestamptz, NOW()) ELSE c.failed_at END,
             error_message = CASE WHEN ${upgrade} THEN COALESCE($5, 'WhatsApp could not deliver this message') ELSE c.error_message END,
             error_code = CASE WHEN ${upgrade} THEN 'CHANNEL_FAILED' ELSE c.error_code END,
             provider_response = CASE WHEN ${upgrade} THEN $6::jsonb ELSE c.provider_response END`,
  }[event.status];
  const r = await db.query(
    `UPDATE whatsapp_campaign_contacts c
        SET ${sets},
            status = CASE WHEN ${upgrade} THEN '${event.status}' ELSE c.status END,
            message_id = COALESCE(c.message_id, $1),
            updated_at = NOW()
      WHERE ($1::text IS NOT NULL AND c.message_id = $1)
         OR ($2::bigint IS NOT NULL AND c.id = $2 AND c.campaign_id = $3)
      RETURNING c.campaign_id`,
    params
  );
  const ids = r.rows.map((x) => x.campaign_id);
  if (ids.length) await refreshCounts(db, ids);
  return ids.length;
}

module.exports = {
  STATUSES,
  CONTACT_FILTERS,
  CampaignError,
  sendingConfig,
  validateCampaignInput,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  listCampaigns,
  getCampaignDetail,
  getStats,
  listContacts,
  exportContacts,
  refreshCounts,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  parseWebhookEvent,
  applyWebhookEvent,
};
