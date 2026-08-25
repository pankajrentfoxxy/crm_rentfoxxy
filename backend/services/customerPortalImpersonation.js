const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

/**
 * Super-admin hand-off into the customer portal.
 *
 * A hand-off is just a normal customer_portal_sessions row tagged with the CRM
 * user who minted it. Tagging (rather than a separate token format) means the
 * portal's existing auth middleware keeps working untouched, while the tag lets
 * us surface a banner and refuse writes for the duration of the session.
 *
 * These sessions are deliberately short-lived and are never written to
 * customers.portal_last_login, so admin visits cannot be mistaken for the
 * customer actually logging in.
 */

const MIGRATIONS = ['206_customer_portal_impersonation.sql'];
const SESSION_TTL_MINUTES = 60;

let schemaEnsured = false;
let schemaEnsurePromise = null;

async function ensureImpersonationSchema() {
  if (schemaEnsured) return;
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = (async () => {
      for (const file of MIGRATIONS) {
        const migrationPath = path.join(__dirname, '../migrations', file);
        if (fs.existsSync(migrationPath)) {
          await pool.query(fs.readFileSync(migrationPath, 'utf8'));
        }
      }
      schemaEnsured = true;
    })().finally(() => {
      schemaEnsurePromise = null;
    });
  }
  return schemaEnsurePromise;
}

function generateToken() {
  return crypto.randomBytes(48).toString('hex');
}

/** First hop of x-forwarded-for is the client; fall back to the socket. */
function clientIp(req) {
  const fwd = req?.headers?.['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().slice(0, 64);
  return String(req?.ip || req?.socket?.remoteAddress || '').slice(0, 64) || null;
}

/**
 * Mint a read-only portal session for `customerId` on behalf of a CRM user.
 * Existing customer sessions are left alone so the customer is not logged out.
 */
async function createImpersonationSession({ customerId, actor, req, ttlMinutes = SESSION_TTL_MINUTES }) {
  await ensureImpersonationSchema();

  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  await pool.query(
    `INSERT INTO customer_portal_sessions (customer_id, token, expires_at, impersonated_by)
     VALUES ($1, $2, $3, $4)`,
    [customerId, token, expiresAt, actor?.user_id || null]
  );

  try {
    await pool.query(
      `INSERT INTO customer_portal_impersonation_log
         (customer_id, actor_user_id, actor_email, actor_role, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        customerId,
        actor?.user_id || null,
        actor?.email || null,
        actor?.role || null,
        clientIp(req),
        (req?.headers?.['user-agent'] || '').slice(0, 1000) || null,
        expiresAt,
      ]
    );
  } catch (err) {
    // The session is already usable; losing the audit row must not break the
    // hand-off, but it should be loud in the logs.
    console.error('customer portal impersonation audit log failed:', err.message);
  }

  return { token, expiresAt, ttlMinutes };
}

module.exports = {
  SESSION_TTL_MINUTES,
  ensureImpersonationSchema,
  createImpersonationSession,
};
