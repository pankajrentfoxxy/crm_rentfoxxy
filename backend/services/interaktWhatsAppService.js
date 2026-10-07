/**
 * Reusable Interakt WhatsApp template sender.
 *
 *   sendWhatsAppTemplate({ phone, templateName, values })
 *
 * POST https://api.interakt.ai/v1/public/message/
 * Auth: Basic <INTERAKT_API_KEY>  (or full INTERAKT_AUTH_KEY header value)
 *
 * Never throws to the caller of fire-and-forget helpers. The CRM write path
 * must not fail because WhatsApp is down.
 */
const axios = require('axios');
const pool = require('../config/db');
const logger = require('../utils/logger');
const { normalizeIndianMobile } = require('../utils/phoneValidation');
const { TEMPLATES, resolveTemplate } = require('../constants/whatsappTemplates');

const INTERAKT_URL = process.env.INTERAKT_API_URL || 'https://api.interakt.ai/v1/public/message/';
const DEFAULT_COUNTRY = '+91';
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

function isEnabled() {
  if (!require('./outboundMessagingGuard').isOutboundMessagingEnabled()) return false;
  const flag = String(process.env.INTERAKT_WHATSAPP_ENABLED || '').toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no' || flag === 'off') return false;
  return Boolean(buildAuthHeader());
}

function buildAuthHeader() {
  const raw = String(process.env.INTERAKT_AUTH_KEY || process.env.INTERAKT_API_KEY || '').trim();
  if (!raw) return null;
  if (/^(Basic|Bearer)\s/i.test(raw)) return raw;
  return `Basic ${raw}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBodyValue(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function sanitizeValues(values) {
  if (!Array.isArray(values)) return { ok: false, error: 'values must be an array' };
  const bodyValues = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = toBodyValue(values[i]);
    if (v == null) {
      return { ok: false, error: `bodyValues[${i}] is empty, null, or undefined` };
    }
    bodyValues.push(v);
  }
  return { ok: true, bodyValues };
}

function validateTemplatePayload({ templateName, values }) {
  const name = String(templateName || '').trim();
  const spec = resolveTemplate(name);
  if (!spec) {
    return { ok: false, error: `Unknown template "${name}". Must match Interakt exactly.` };
  }
  const sanitized = sanitizeValues(values);
  if (!sanitized.ok) return sanitized;
  if (sanitized.bodyValues.length !== spec.varCount) {
    return {
      ok: false,
      error: `Template ${name} expects ${spec.varCount} bodyValues, got ${sanitized.bodyValues.length}`,
    };
  }
  return { ok: true, spec, bodyValues: sanitized.bodyValues };
}

function normalizePhone(phone) {
  const digits = normalizeIndianMobile(phone);
  return digits.length === 10 ? digits : '';
}

function redactValues(specOrName, values) {
  const eventType = specOrName && specOrName.eventType
    ? specOrName.eventType
    : resolveTemplate(specOrName)?.eventType;
  if (eventType === 'delivery_otp') return ['******'];
  return values;
}

function maskPhone(phone) {
  const p = String(phone || '');
  if (p.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, p.length - 4))}${p.slice(-4)}`;
}

function shouldRetry(httpStatus, err) {
  if (err && !httpStatus) return true;
  if (httpStatus === 429) return true;
  if (httpStatus >= 500) return true;
  return false;
}

function isProviderSuccess(httpStatus, data) {
  if (httpStatus < 200 || httpStatus >= 300) return false;
  if (data && data.result === false) return false;
  if (data && data.success === false) return false;
  return true;
}

function buildInteraktPayload({
  phone,
  templateName,
  bodyValues,
  countryCode,
  callbackData,
  buttonValues,
}) {
  const payload = {
    countryCode: countryCode || process.env.INTERAKT_COUNTRY_CODE || DEFAULT_COUNTRY,
    phoneNumber: phone,
    type: 'Template',
    template: {
      name: templateName,
      languageCode: 'en',
      bodyValues,
    },
  };
  if (buttonValues) payload.template.buttonValues = buttonValues;
  if (callbackData) payload.callbackData = String(callbackData).slice(0, 512);
  return payload;
}

async function persist(db, sql, params) {
  try {
    const r = await db.query(sql, params);
    return r;
  } catch (err) {
    logger.warn({ err: err.message }, 'whatsapp_messages persist skipped');
    return null;
  }
}

async function insertPending(db, row) {
  const r = await persist(
    db,
    `INSERT INTO whatsapp_messages (
        phone, country_code, template_name, event_type, body_values, status,
        ref_type, ref_id, sales_order_number, dc_number
      ) VALUES ($1,$2,$3,$4,$5::jsonb,'pending',$6,$7,$8,$9)
      RETURNING id`,
    [
      row.phone,
      row.countryCode,
      row.templateName,
      row.eventType,
      JSON.stringify(row.bodyValues),
      row.refType || null,
      row.refId || null,
      row.salesOrderNumber || null,
      row.dcNumber || null,
    ]
  );
  return r?.rows?.[0]?.id || null;
}

async function updateResult(db, id, fields) {
  if (!id) return;
  await persist(
    db,
    `UPDATE whatsapp_messages
        SET status = $2,
            attempts = $3,
            last_error = $4,
            provider_response = $5::jsonb,
            http_status = $6,
            sent_at = CASE WHEN $2::varchar = 'sent' THEN NOW() ELSE sent_at END,
            updated_at = NOW()
      WHERE id = $1`,
    [
      id,
      fields.status,
      fields.attempts,
      fields.lastError || null,
      JSON.stringify(fields.providerResponse || null),
      fields.httpStatus || null,
    ]
  );
}

async function alreadySent(db, { eventType, refType, refId }) {
  if (!refType || !refId || eventType === 'delivery_otp') return false;
  const r = await persist(
    db,
    `SELECT id FROM whatsapp_messages
      WHERE event_type = $1 AND ref_type = $2 AND ref_id = $3 AND status = 'sent'
      LIMIT 1`,
    [eventType, refType, refId]
  );
  return Boolean(r?.rows?.length);
}

async function postInterakt({ authHeader, payload, httpPost, timeoutMs }) {
  const post = httpPost || ((url, body, config) => axios.post(url, body, config));
  const res = await post(INTERAKT_URL, payload, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    timeout: timeoutMs || 15000,
    validateStatus: () => true,
  });
  return {
    httpStatus: res.status,
    data: res.data,
    headers: res.headers || {},
  };
}

// Network failures where the request provably never reached Interakt, so resending
// cannot produce a duplicate. A timeout or a reset mid-request is NOT in this list:
// Interakt may already have accepted the message.
const SAFE_TO_RETRY_NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);
const OUTCOME_UNKNOWN_NETWORK_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ERR_CANCELED']);

function parseRetryAfterMs(headers) {
  const raw = headers && (headers['retry-after'] || headers['Retry-After']);
  if (raw == null || raw === '') return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 10 * 60 * 1000);
  const at = Date.parse(raw);
  if (!Number.isNaN(at)) return Math.max(0, Math.min(at - Date.now(), 10 * 60 * 1000));
  return null;
}

function extractProviderError(data, httpStatus) {
  if (!data) return `HTTP ${httpStatus}`;
  if (typeof data === 'string') return data.slice(0, 500);
  const msg = data.message || data.error?.message || data.error || data.detail;
  const code = data.statusCode || data.code || data.error?.code;
  const text = typeof msg === 'string' ? msg : JSON.stringify(msg || data).slice(0, 500);
  return code ? `${text} (code ${code})` : text;
}

function buildTemplatePayload({
  countryCode, phoneNumber, templateName, languageCode, headerValues, bodyValues, callbackData,
}) {
  const template = {
    name: templateName,
    languageCode: languageCode || 'en',
    bodyValues: bodyValues || [],
  };
  if (Array.isArray(headerValues) && headerValues.length) template.headerValues = headerValues;
  const payload = {
    countryCode: countryCode || DEFAULT_COUNTRY,
    phoneNumber,
    type: 'Template',
    template,
  };
  if (callbackData) payload.callbackData = String(callbackData).slice(0, 512);
  return payload;
}

/**
 * Single attempt at sending any approved template — used by bulk campaigns, which own
 * their own retry, back-off and rate limiting. Never throws.
 *
 * @returns {Promise<{
 *   ok: boolean, httpStatus: number|null, data: any, messageId: string|null,
 *   error: string|null, errorCode: string|null,
 *   retryable: boolean, outcomeUnknown: boolean, rateLimited: boolean, retryAfterMs: number|null,
 * }>}
 */
async function sendTemplateMessage(opts = {}, deps = {}) {
  const base = {
    ok: false, httpStatus: null, data: null, messageId: null, error: null, errorCode: null,
    retryable: false, outcomeUnknown: false, rateLimited: false, retryAfterMs: null,
  };
  if (!isEnabled()) {
    return { ...base, error: 'WhatsApp sending is disabled (OUTBOUND_MESSAGING_ENABLED / INTERAKT_API_KEY)', errorCode: 'DISABLED' };
  }
  const payload = buildTemplatePayload(opts);
  try {
    const { httpStatus, data, headers } = await postInterakt({
      authHeader: buildAuthHeader(),
      payload,
      httpPost: deps.httpPost,
      timeoutMs: deps.timeoutMs || 20000,
    });
    if (isProviderSuccess(httpStatus, data)) {
      const messageId = data?.id || data?.messageId || data?.data?.id || null;
      return { ...base, ok: true, httpStatus, data, messageId: messageId ? String(messageId) : null };
    }
    const rateLimited = httpStatus === 429;
    return {
      ...base,
      httpStatus,
      data,
      error: extractProviderError(data, httpStatus),
      errorCode: rateLimited ? 'RATE_LIMITED' : `HTTP_${httpStatus}`,
      retryable: shouldRetry(httpStatus, null),
      rateLimited,
      retryAfterMs: rateLimited ? parseRetryAfterMs(headers) : null,
    };
  } catch (err) {
    const code = err?.code || null;
    if (err?.response) {
      // Custom httpPost that throws on non-2xx.
      const httpStatus = err.response.status;
      return {
        ...base,
        httpStatus,
        data: err.response.data || null,
        error: extractProviderError(err.response.data, httpStatus),
        errorCode: httpStatus === 429 ? 'RATE_LIMITED' : `HTTP_${httpStatus}`,
        retryable: shouldRetry(httpStatus, null),
        rateLimited: httpStatus === 429,
        retryAfterMs: httpStatus === 429 ? parseRetryAfterMs(err.response.headers) : null,
      };
    }
    const message = err?.message || String(err);
    if (SAFE_TO_RETRY_NETWORK_CODES.has(code)) {
      return { ...base, error: `Network error: ${message}`, errorCode: code, retryable: true };
    }
    // Timeout / reset / anything unclassified: the request may have been accepted.
    return {
      ...base,
      error: `No response from Interakt (${code || 'unknown error'}): the message may or may not have been delivered`,
      errorCode: OUTCOME_UNKNOWN_NETWORK_CODES.has(code) ? 'OUTCOME_UNKNOWN' : (code || 'OUTCOME_UNKNOWN'),
      outcomeUnknown: true,
    };
  }
}

/**
 * Send an approved Interakt template.
 *
 * @param {{
 *   phone: string,
 *   templateName: string,
 *   values: string[],
 *   countryCode?: string,
 *   refType?: string,
 *   refId?: string,
 *   salesOrderNumber?: string,
 *   dcNumber?: string,
 *   callbackData?: string,
 * }} opts
 * @param {{ db?: object, httpPost?: Function }} [deps]
 */
async function sendWhatsAppTemplate(opts = {}, deps = {}) {
  const db = deps.db || pool;
  const templateName = String(opts.templateName || '').trim();
  const phone = normalizePhone(opts.phone);
  const countryCode = opts.countryCode || process.env.INTERAKT_COUNTRY_CODE || DEFAULT_COUNTRY;

  const validated = validateTemplatePayload({ templateName, values: opts.values });
  if (!validated.ok) {
    logger.warn({ templateName, error: validated.error }, 'WhatsApp template validation failed');
    return { ok: false, skipped: false, error: validated.error };
  }

  if (!phone) {
    const error = 'Invalid Indian mobile (need 10 digits)';
    logger.warn({ templateName }, error);
    return { ok: false, skipped: true, error };
  }

  if (!isEnabled()) {
    logger.info({ templateName, phone: maskPhone(phone) }, 'WhatsApp skipped — Interakt not configured');
    return { ok: false, skipped: true, error: 'Interakt not configured' };
  }

  const { spec, bodyValues } = validated;
  const interaktName = spec.interaktName || spec.key || templateName;

  if (await alreadySent(db, { eventType: spec.eventType, refType: opts.refType, refId: opts.refId })) {
    logger.info(
      { templateName: interaktName, refType: opts.refType, refId: opts.refId },
      'WhatsApp skipped — already sent for this document'
    );
    return { ok: true, skipped: true, error: 'already_sent' };
  }

  const payload = buildInteraktPayload({
    phone,
    templateName: interaktName,
    bodyValues,
    countryCode,
    callbackData: opts.callbackData || opts.refId || null,
    buttonValues: spec.copyOtpToButton ? { 0: [bodyValues[0]] } : undefined,
  });

  const messageId = await insertPending(db, {
    phone,
    countryCode,
    templateName: interaktName,
    eventType: spec.eventType,
    bodyValues,
    refType: opts.refType,
    refId: opts.refId,
    salesOrderNumber: opts.salesOrderNumber,
    dcNumber: opts.dcNumber,
  });

  const authHeader = buildAuthHeader();
  let lastError = null;
  let lastStatus = null;
  let lastData = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      const result = await postInterakt({
        authHeader,
        payload,
        httpPost: deps.httpPost,
      });
      lastStatus = result.httpStatus;
      lastData = result.data;
      logger.info(
        {
          templateName: interaktName,
          phone: maskPhone(phone),
          attempt,
          httpStatus: lastStatus,
          values: redactValues(spec, bodyValues),
          response: lastData,
        },
        'Interakt WhatsApp response'
      );
      if (isProviderSuccess(lastStatus, lastData)) {
        await updateResult(db, messageId, {
          status: 'sent',
          attempts,
          providerResponse: lastData,
          httpStatus: lastStatus,
        });
        return { ok: true, skipped: false, httpStatus: lastStatus, data: lastData, id: messageId };
      }
      lastError = (lastData && (lastData.message || lastData.error)) || `HTTP ${lastStatus}`;
      if (!shouldRetry(lastStatus, null)) break;
    } catch (err) {
      lastError = err.message || String(err);
      lastStatus = err.response?.status || null;
      lastData = err.response?.data || null;
      logger.error(
        { templateName: interaktName, phone: maskPhone(phone), attempt, err: lastError, httpStatus: lastStatus },
        'Interakt WhatsApp request failed'
      );
      if (!shouldRetry(lastStatus, err)) break;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }

  await updateResult(db, messageId, {
    status: 'failed',
    attempts,
    lastError: lastError ? String(lastError).slice(0, 1000) : 'unknown error',
    providerResponse: lastData,
    httpStatus: lastStatus,
  });
  return {
    ok: false,
    skipped: false,
    error: lastError || 'send failed',
    httpStatus: lastStatus,
    id: messageId,
  };
}

function fireAndForget(factory, label) {
  setImmediate(() => {
    Promise.resolve()
      .then(factory)
      .catch((err) => logger.error({ err: err.message, label }, 'WhatsApp notify failed'));
  });
}

module.exports = {
  TEMPLATES,
  sendWhatsAppTemplate,
  sendTemplateMessage,
  buildTemplatePayload,
  parseRetryAfterMs,
  maskPhone,
  validateTemplatePayload,
  sanitizeValues,
  normalizePhone,
  buildAuthHeader,
  buildInteraktPayload,
  isEnabled,
  isProviderSuccess,
  shouldRetry,
  fireAndForget,
  formatDdMmYyyy,
};

function formatDdMmYyyy(value = new Date()) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(dt);
  const pick = (type) => parts.find((p) => p.type === type)?.value || '';
  const d = pick('day');
  const m = pick('month');
  const y = pick('year');
  return d && m && y ? `${d}-${m}-${y}` : '';
}
