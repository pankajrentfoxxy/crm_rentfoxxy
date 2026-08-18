'use strict';

const crypto = require('crypto');
const { notifyEvent } = require('./supportNotificationService');
const { logEvent } = require('./supportTicketStateService');

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function csatPublicUrl(token) {
  const base = (process.env.CUSTOMER_PORTAL_URL || process.env.FRONTEND_URL || 'http://localhost:3002')
    .split(',')[0].trim().replace(/\/$/, '');
  return `${base}/csat/${token}`;
}

async function issueCsatToken(db, ticketId, days = 14) {
  const token = newToken();
  const expires = new Date(Date.now() + days * 86400000);
  await db.query(
    `INSERT INTO support_csat_tokens (token, ticket_id, expires_at) VALUES ($1,$2,$3)`,
    [token, ticketId, expires]
  );
  await db.query(
    `UPDATE support_tickets_v2 SET csat_requested_at = NOW(), updated_at = NOW() WHERE ticket_id = $1`,
    [ticketId]
  );
  return { token, expires_at: expires, url: csatPublicUrl(token) };
}

async function loadCsatToken(db, token) {
  const r = await db.query(
    `SELECT tok.*, t.ticket_number, t.csat_score, t.csat_responded_at,
            COALESCE(c.company_name, c.name) AS customer_name
       FROM support_csat_tokens tok
       JOIN support_tickets_v2 t ON t.ticket_id = tok.ticket_id
       LEFT JOIN customers c ON c.customer_id = t.customer_id
      WHERE tok.token = $1`,
    [token]
  );
  return r.rows[0] || null;
}

function csatTokenState(row, now = new Date()) {
  if (!row) return { ok: false, reason: 'not_found', message: 'This feedback link is not valid.' };
  if (row.used_at) return { ok: false, reason: 'used', message: 'Thanks — this rating was already submitted.' };
  if (new Date(row.expires_at).getTime() < new Date(now).getTime()) {
    return { ok: false, reason: 'expired', message: 'This feedback link has expired. Thank you for your time.' };
  }
  return { ok: true };
}

async function submitCsat(db, token, { score, comment }, now = new Date()) {
  const row = await loadCsatToken(db, token);
  const state = csatTokenState(row, now);
  if (!state.ok) {
    throw Object.assign(new Error(state.message), { status: state.reason === 'not_found' ? 404 : 400, reason: state.reason });
  }
  const n = Number(score);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw Object.assign(new Error('score must be 1–5'), { status: 400 });
  }
  await db.query(
    `UPDATE support_csat_tokens SET used_at = $2 WHERE token = $1`,
    [token, now]
  );
  const flag = n <= 2;
  await db.query(
    `UPDATE support_tickets_v2
        SET csat_score = $2,
            csat_comment = $3,
            csat_responded_at = $4,
            csat_flag = csat_flag OR $5,
            updated_at = NOW()
      WHERE ticket_id = $1`,
    [row.ticket_id, n, comment ? String(comment).slice(0, 2000) : null, now, flag]
  );
  await logEvent(db, {
    ticketId: row.ticket_id,
    eventType: 'CSAT_RECEIVED',
    actorKind: 'CUSTOMER',
    summary: `CSAT ${n}/5`,
    detail: { score: n, comment: comment || null },
    isCustomerVisible: true,
  });
  if (flag) {
    await notifyEvent(db, {
      eventCode: 'CSAT_LOW',
      ticketId: row.ticket_id,
      audiences: ['MANAGER'],
      vars: {
        ticket_number: row.ticket_number,
        csat_score: n,
        csat_comment: comment || '',
      },
    });
  }
  return { ticket_id: row.ticket_id, score: n, flagged: flag };
}

module.exports = {
  newToken,
  csatPublicUrl,
  issueCsatToken,
  loadCsatToken,
  csatTokenState,
  submitCsat,
};
