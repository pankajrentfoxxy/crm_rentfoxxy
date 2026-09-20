/**
 * Access control for /uploads (P0-2).
 *
 * Both /uploads mounts were plain express.static with no auth, so 14,433 files
 * (1.3 GB) — delivery proofs and customer e-signatures, KYC documents, customer
 * invoices, e-way bills, vendor bills — were readable by anyone who guessed a
 * filename. Filenames are predictable (`pod_${dcNumber}_${Date.now()}.jpg`) and
 * document numbers are sequential, so the namespace is walkable.
 *
 * Why a cookie rather than the Authorization header: the CRM builds absolute
 * URLs and uses them as <img src> and <a href>. Browser-initiated requests like
 * those never carry Authorization — the bearer token lives in sessionStorage and
 * is attached by axios only. Requiring a header would break every image and
 * document link in the CRM. A cookie the browser sends automatically needs zero
 * frontend changes. nginx proxies /uploads on crm.rentfoxxy.com, so it is
 * same-origin and there is no cross-subdomain cookie problem.
 *
 * Three accepted credentials, in order:
 *   1. the uploads cookie (browser <img>/<a> — the common case)
 *   2. an Authorization bearer token (programmatic callers)
 *   3. ?sig= + ?exp= signed URL (for sharing a single file outside the CRM)
 *
 * MODE, from UPLOADS_AUTH_MODE:
 *   off      — no checking (pre-P0-2 behaviour)
 *   grace    — log anonymous hits but SERVE them. Deploy in this mode first and
 *              read the log: it tells you what still reaches /uploads
 *              anonymously before anything is broken.
 *   enforce  — anonymous hits get 403.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'uploads_tk';
/**
 * Deliberately short. The cookie is verified by HMAC alone — checking
 * users.token_version on every request would mean a DB round trip per image, and
 * a single page can load dozens. The trade-off is that a user revoked via
 * token_version keeps file access until their cookie expires, so this bounds
 * that window. It costs nothing in practice: authMiddleware reissues the cookie
 * on every authenticated API call, so anyone actively using the CRM never sees
 * it lapse.
 */
const COOKIE_TTL_MS = 2 * 60 * 60 * 1000; // 2h, refreshed on every API call

const mode = () => String(process.env.UPLOADS_AUTH_MODE || 'grace').toLowerCase();

const secret = () => process.env.JWT_SECRET || '';

/** value = base64(payload).hmac — payload carries the user and token version. */
function signCookie(userId, tokenVersion) {
  const payload = Buffer.from(JSON.stringify({
    u: userId,
    tv: tokenVersion ?? 1,
    e: Date.now() + COOKIE_TTL_MS,
  })).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function verifyCookie(value) {
  if (!value || typeof value !== 'string' || !value.includes('.')) return null;
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  // timingSafeEqual throws on length mismatch, so compare lengths first.
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || typeof data.e !== 'number' || data.e < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Signed URL for handing one file to someone outside the CRM. Not used by any
 * current flow — emails attach their PDFs rather than linking — but it is the
 * supported way to add such a flow without reopening the whole tree.
 */
function signedUploadUrl(relativePath, ttlSeconds = 3600, origin = '') {
  const clean = String(relativePath || '').replace(/^\/+/, '').replace(/^uploads\//, '');
  const exp = Date.now() + ttlSeconds * 1000;
  const mac = crypto.createHmac('sha256', secret()).update(`${clean}:${exp}`).digest('base64url');
  return `${origin}/uploads/${clean}?exp=${exp}&sig=${mac}`;
}

function verifySignedUrl(pathname, query) {
  const exp = Number(query?.exp || 0);
  const sig = String(query?.sig || '');
  if (!exp || !sig || exp < Date.now()) return false;
  const clean = String(pathname || '').replace(/^\/+/, '').replace(/^uploads\//, '');
  const expected = crypto.createHmac('sha256', secret()).update(`${clean}:${exp}`).digest('base64url');
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** Sets/refreshes the uploads cookie. Called from authMiddleware and at login. */
function issueUploadsCookie(res, user) {
  if (!res || !user?.user_id || !secret()) return;
  try {
    res.cookie(COOKIE_NAME, signCookie(user.user_id, user.tv ?? user.token_version ?? 1), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || process.env.UPLOADS_COOKIE_SECURE === 'true',
      sameSite: 'lax',
      path: '/uploads',
      maxAge: COOKIE_TTL_MS,
    });
  } catch (e) {
    console.warn('[uploadsAuth] could not set cookie:', e.message);
  }
}

function clearUploadsCookie(res) {
  try {
    res.clearCookie(COOKIE_NAME, { path: '/uploads' });
  } catch { /* nothing to clear */ }
}

const uploadsAuth = (req, res, next) => {
  const m = mode();
  if (m === 'off') return next();

  let who = null;

  const cookie = verifyCookie(req.cookies?.[COOKIE_NAME]);
  if (cookie) who = `cookie:user=${cookie.u}`;

  if (!who) {
    const bearer = req.header('Authorization')?.replace('Bearer ', '');
    if (bearer && secret()) {
      try {
        const decoded = jwt.verify(bearer, secret());
        if (decoded) who = `bearer:user=${decoded.user_id || decoded.vendor_id || 'portal'}`;
      } catch { /* fall through to anonymous */ }
    }
  }

  if (!who && verifySignedUrl(req.path, req.query)) who = 'signed-url';

  if (who) return next();

  if (m === 'grace') {
    // Deliberately still serving. This is the observation window: the log tells
    // us which consumers we would break before we break them.
    console.warn('[uploadsAuth][grace] anonymous upload access served:', req.path,
      '| referer:', req.header('Referer') || '-', '| ip:', req.ip);
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'This file requires you to be signed in to the CRM.',
  });
};

module.exports = {
  uploadsAuth,
  issueUploadsCookie,
  clearUploadsCookie,
  signedUploadUrl,
  COOKIE_NAME,
};
