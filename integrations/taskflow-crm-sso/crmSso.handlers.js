/**
 * TaskFlow CRM SSO — plain Express handlers matching live error shape:
 *   { "error": "..." }
 *
 * Wire into TaskFlow auth router (same place as POST /auth/login):
 *
 *   const crmSso = require('./crmSso.handlers'); // adjust path
 *   router.get('/sso', crmSso.getSso);
 *   router.get('/crm/pending-count', crmSso.getPendingCount);
 *
 * Env on TaskFlow (must match CRM TASKFLOW_*):
 *   CRM_SSO_SECRET=...
 *   CRM_SSO_ISSUER=rentfoxxy-crm
 *   CRM_SSO_AUDIENCE=taskflow
 *   BASE_URL=https://task.rentfoxxy.com
 *
 * Then: pm2 reload <taskflow-api> --update-env
 *
 * Search ADAPT for TaskFlow-specific user/token/task model hooks.
 */
const jwt = require('jsonwebtoken');

const SECRET = () => String(process.env.CRM_SSO_SECRET || '').trim();
const ISSUER = () => process.env.CRM_SSO_ISSUER || 'rentfoxxy-crm';
const AUDIENCE = () => process.env.CRM_SSO_AUDIENCE || 'taskflow';
const FRONTEND = () =>
  String(process.env.BASE_URL || process.env.FRONTEND_URL || 'https://task.rentfoxxy.com').replace(/\/+$/, '');

function verifyCrmToken(token, expectedPurpose) {
  if (!SECRET()) {
    const err = new Error('CRM_SSO_SECRET is not configured on TaskFlow');
    err.status = 503;
    throw err;
  }
  let payload;
  try {
    payload = jwt.verify(String(token || ''), SECRET(), {
      issuer: ISSUER(),
      audience: AUDIENCE(),
    });
  } catch (e) {
    const err = new Error(e.message || 'Invalid CRM SSO token');
    err.status = 401;
    throw err;
  }
  if (payload.purpose !== expectedPurpose) {
    const err = new Error('Invalid CRM SSO token purpose');
    err.status = 401;
    throw err;
  }
  const email = String(payload.email || '').toLowerCase().trim();
  if (!email) {
    const err = new Error('CRM SSO token missing email');
    err.status = 401;
    throw err;
  }
  return { ...payload, email };
}

/** ADAPT — look up active TaskFlow user by email; return null if missing. */
async function findUserByEmail(email) {
  // ---- REPLACE THIS BLOCK with your real user lookup ----
  // Examples:
  //   return User.findOne({ email });
  //   return prisma.user.findUnique({ where: { email } });
  throw new Error('ADAPT findUserByEmail: wire to TaskFlow User model');
}

/** ADAPT — same token pair your POST /auth/login returns. */
async function issueAuthTokens(user) {
  // ---- REPLACE THIS BLOCK ----
  // return tokenService.generateAuthTokens(user);
  throw new Error('ADAPT issueAuthTokens: wire to TaskFlow token service');
}

/** ADAPT — integer pending/open task count for assignee. */
async function countPending(user) {
  // ---- REPLACE THIS BLOCK ----
  return 0;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

/**
 * GET /api/auth/sso?token=...
 * CRM opens this in a new tab. On success redirect into the TaskFlow UI logged-in.
 */
async function getSso(req, res) {
  try {
    const token = req.query.token || req.body?.token;
    if (!token) {
      return res.status(400).json({ error: 'token query parameter is required' });
    }
    const payload = verifyCrmToken(token, 'crm_sso');
    const user = await findUserByEmail(payload.email);
    if (!user) {
      return res.status(403).json({
        error: `No TaskFlow user for CRM email ${payload.email}. Create/link that user first.`,
        mapped: false,
      });
    }
    const tokens = await issueAuthTokens(user);
    const access = tokens?.access?.token || tokens?.accessToken || tokens?.access;
    const refresh = tokens?.refresh?.token || tokens?.refreshToken || tokens?.refresh;
    if (!access) {
      return res.status(500).json({ error: 'TaskFlow did not issue an access token' });
    }

    // Prefer redirect for browser SSO (CRM opens this URL).
    // Frontend must read hash params and store the session (add /crm-sso page if missing).
    const q = new URLSearchParams({
      access_token: String(access),
      source: 'crm_sso',
    });
    if (refresh) q.set('refresh_token', String(refresh));
    return res.redirect(302, `${FRONTEND()}/crm-sso#${q.toString()}`);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'SSO failed' });
  }
}

/**
 * GET /api/auth/crm/pending-count
 * Authorization: Bearer <CRM jwt purpose=crm_pending_count>
 */
async function getPendingCount(req, res) {
  try {
    const token = bearer(req);
    if (!token) {
      return res.status(401).json({ error: 'Please authenticate' });
    }
    const payload = verifyCrmToken(token, 'crm_pending_count');
    const user = await findUserByEmail(payload.email);
    if (!user) {
      return res.json({ success: true, count: 0, mapped: false });
    }
    const count = await countPending(user);
    return res.json({ success: true, count: Number(count) || 0, mapped: true });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'pending-count failed' });
  }
}

module.exports = {
  getSso,
  getPendingCount,
  verifyCrmToken,
};
