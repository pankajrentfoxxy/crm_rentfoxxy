/**
 * Support CSAT (claude/carret-support.md S6). When a ticket closes, a trigger
 * (migration 347) makes a feedback row with a random token. This service mails
 * (and, once the Interakt template is approved, WhatsApps) the customer a link
 * to the public feedback page, takes the 1–5 rating and
 * comment, and summarises it for the lead — overall and per technician.
 *
 * The public endpoints are internet-facing: they return only the ticket number
 * and first name of the company, never contact details.
 */
const pool = require('../config/db');
const { escapeHtml } = require('../utils/escapeHtml');

function publicBase() {
  return (process.env.CRM_PUBLIC_URL || process.env.PUBLIC_APP_URL
    || String(process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find((s) => /^https?:\/\//.test(s))
    || 'https://crm.rentfoxxy.com').replace(/\/$/, '');
}

/** Queue feedback mails for closed tickets not yet asked (runs with the email queue worker). */
async function queueFeedbackMails() {
  const { enqueueEmail } = require('./emailQueueService');
  const rows = (await pool.query(
    `SELECT c.id, c.token, t.id AS ticket_id, t.customer_name,
            COALESCE(NULLIF(t.ticket_email, ''), cu.email) AS email
       FROM support_csat c
       JOIN support_tickets t ON t.id = c.ticket_id
       LEFT JOIN customers cu ON cu.customer_id = t.customer_id
      WHERE c.sent_at IS NULL AND c.send_error IS NULL AND c.submitted_at IS NULL AND c.expires_at > NOW()
      ORDER BY c.id LIMIT 50`
  )).rows;
  const { notifySupportFeedback } = require('./supportWhatsApp');
  for (const r of rows) {
    const link = `${publicBase()}/feedback/${r.token}`;
    // WhatsApp as well, once its template is approved (off otherwise).
    const wa = await notifySupportFeedback(r.ticket_id, link);
    if (!r.email) {
      if (wa?.ok && !wa.skipped) await pool.query('UPDATE support_csat SET sent_at = NOW() WHERE id = $1', [r.id]);
      else await pool.query(`UPDATE support_csat SET send_error = 'no email on the ticket or customer' WHERE id = $1`, [r.id]);
      continue;
    }
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a">
      <p>Dear ${escapeHtml(r.customer_name || 'Customer')},</p>
      <p>Your support ticket <strong>#${r.ticket_id}</strong> is resolved. How did we do? It takes 10 seconds:</p>
      <p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#0e7490;color:#fff;border-radius:8px;text-decoration:none">Rate our service</a></p>
      <p style="color:#64748b">Or open: ${escapeHtml(link)}</p>
      <p>Thanks and Regards,<br/>Team Rentfoxxy</p></div>`;
    const queued = await enqueueEmail({
      toEmail: r.email,
      subject: `How did we do? Support ticket #${r.ticket_id}`,
      bodyText: `Your support ticket #${r.ticket_id} is resolved. Rate our service: ${link}`,
      bodyHtml: html,
      dedupeKey: `support-csat-${r.ticket_id}`,
    });
    await pool.query('UPDATE support_csat SET sent_at = NOW() WHERE id = $1', [r.id]);
  }
  return rows.length;
}

async function getPublicFeedback(token) {
  const r = (await pool.query(
    `SELECT c.ticket_id, c.rating, c.submitted_at, c.expires_at, split_part(COALESCE(t.customer_name, ''), ' ', 1) AS company
       FROM support_csat c JOIN support_tickets t ON t.id = c.ticket_id
      WHERE c.token = $1`,
    [String(token || '')]
  )).rows[0];
  if (!r) return null;
  return {
    ticket_id: r.ticket_id,
    company: r.company || null,
    submitted: Boolean(r.submitted_at),
    rating: r.submitted_at ? r.rating : null,
    expired: new Date(r.expires_at) < new Date(),
  };
}

async function submitFeedback(token, { rating, comment }) {
  const n = Number(rating);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw Object.assign(new Error('Choose 1 to 5 stars'), { status: 400 });
  const r = await pool.query(
    `UPDATE support_csat SET rating = $2, comment = NULLIF($3, ''), submitted_at = NOW()
      WHERE token = $1 AND submitted_at IS NULL AND expires_at > NOW()
      RETURNING ticket_id`,
    [String(token || ''), n, String(comment || '').trim().slice(0, 2000)]
  );
  if (!r.rowCount) throw Object.assign(new Error('This feedback link has been used or has expired'), { status: 409 });
  return { ok: true };
}

/** Lead: overall score, per technician, and the latest comments. */
async function csatSummary({ days = 90 } = {}) {
  const d = Math.min(365, Math.max(1, Number(days) || 90));
  const overall = (await pool.query(
    `SELECT COUNT(*)::int AS asked, COUNT(submitted_at)::int AS answered,
            ROUND(AVG(rating)::numeric, 2)::float AS average
       FROM support_csat WHERE created_at > NOW() - ($1::text || ' days')::interval`,
    [d]
  )).rows[0];
  const byTech = (await pool.query(
    `SELECT c.technician_id, u.name, COUNT(c.submitted_at)::int AS answered, ROUND(AVG(c.rating)::numeric, 2)::float AS average
       FROM support_csat c LEFT JOIN users u ON u.user_id = c.technician_id
      WHERE c.created_at > NOW() - ($1::text || ' days')::interval AND c.submitted_at IS NOT NULL
      GROUP BY c.technician_id, u.name ORDER BY average NULLS LAST`,
    [d]
  )).rows;
  const latest = (await pool.query(
    `SELECT c.ticket_id, c.rating, c.comment, c.submitted_at, t.customer_name, u.name AS technician
       FROM support_csat c JOIN support_tickets t ON t.id = c.ticket_id LEFT JOIN users u ON u.user_id = c.technician_id
      WHERE c.submitted_at IS NOT NULL ORDER BY c.submitted_at DESC LIMIT 20`
  )).rows;
  return { days: d, ...overall, by_technician: byTech, latest };
}

module.exports = { queueFeedbackMails, getPublicFeedback, submitFeedback, csatSummary, publicBase };
