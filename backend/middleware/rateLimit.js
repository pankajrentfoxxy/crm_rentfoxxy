/**
 * Rate limiting for credential and OTP endpoints.
 *
 * There was none anywhere: five rapid failed logins against the live site all
 * returned 401 with no throttle, delay or lockout. That left every login (CRM,
 * customer portal, vendor portal, technician), barcode login, password-reset
 * OTP, delivery-OTP verify and the public capture endpoints open to unlimited
 * guessing. Each portal login also runs a bcrypt cost-10 hash server-side, so
 * the same request stream doubles as a CPU-exhaustion DoS on a single-process
 * server.
 *
 * Counting is per IP, which only works because server.js now sets
 * `trust proxy`; before that every request looked like 127.0.0.1.
 *
 * Requires `express-rate-limit`. If it is missing the exports degrade to
 * pass-through middleware and log once, so a missed npm install cannot take the
 * API down.
 */
let rateLimit = null;
try {
  rateLimit = require('express-rate-limit');
} catch {
  console.warn('[rateLimit] express-rate-limit unavailable — limiters disabled. Run npm install in backend/');
}

const passthrough = (_req, _res, next) => next();

const WINDOW_MS = 15 * 60 * 1000;

function build({ max, message, skipSuccessfulRequests = false, keyGenerator }) {
  if (!rateLimit) return passthrough;
  return rateLimit({
    windowMs: WINDOW_MS,
    max,
    skipSuccessfulRequests,
    ...(keyGenerator ? { keyGenerator } : {}),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
    // Same JSON shape as the rest of the API so clients render it, rather than
    // express-rate-limit's default plain-text body.
    handler: (_req, res, _next, options) => res.status(options.statusCode).json(options.message),
  });
}

/**
 * Credential endpoints. Successful logins are not counted, so a busy office
 * behind one public IP cannot lock itself out by working normally — only
 * repeated FAILURES burn the budget.
 */
const loginLimiter = build({
  max: 10,
  message: 'Too many failed attempts. Please wait 15 minutes and try again.',
  skipSuccessfulRequests: true,
});

/** OTP verification — same budget, failures only. */
const otpLimiter = build({
  max: 10,
  message: 'Too many incorrect codes. Please wait 15 minutes and try again.',
  skipSuccessfulRequests: true,
});

/**
 * Sending an OTP or a password-reset mail. Counts every request, successful or
 * not, since the abuse here is flooding someone's inbox rather than guessing.
 */
const otpSendLimiter = build({
  max: 5,
  message: 'Too many requests. Please wait 15 minutes before requesting another code.',
});

/**
 * Public capture link resolution (GRN, QC2, dispatch QC, vendor return, RDC).
 * These take a 6-digit access number over a 900,000 space with no attempt
 * counter, so enumeration was free — and for GRN it also burned a real access
 * number per resolve, making it a denial of service on goods receipt.
 */
const captureLimiter = build({
  max: 20,
  message: 'Too many attempts. Please wait 15 minutes and try again.',
  skipSuccessfulRequests: true,
});

/**
 * Part 6.3 (finding U24) — the public support endpoints.
 *
 * /api/support-public has no auth by design: it is the QR-code intake a
 * customer scans on a laptop. But the TTSPL lookup took any code and, for a
 * valid one, returned the customer id and company name — unauthenticated fleet
 * enumeration, one guess at a time, with no throttle at all. TTSPL codes are
 * sequential, so walking the fleet was a for-loop.
 *
 * Lookups count every request, successful or not: a legitimate customer looks
 * up the one laptop in front of them, so a budget of 30 in fifteen minutes is
 * generous for them and useless for a scan.
 */
const publicLookupLimiter = build({
  max: 30,
  message: 'Too many lookups. Please wait a few minutes and try again.',
});

/** Raising a support request is heavier and rarer — a tighter budget. */
const publicIntakeLimiter = build({
  max: 10,
  message: 'Too many requests. Please wait 15 minutes before submitting another.',
});

/**
 * Production safety D (Q22): configuration-check submissions. A mismatch
 * answers 200, so captureLimiter (which skips successes) never counted
 * repeated guesses. Every verify counts here.
 */
// Counted per IP *and* per link: every laptop on the warehouse network shares
// one public IP, so a per-IP budget would stop a normal 50-laptop GRN. Ten
// tries on one link is plenty for a real check and useless for guessing.
const captureVerifyLimiter = build({
  max: 10,
  message: 'Too many checks on this link. Generate a new access number and try again in 15 minutes.',
  keyGenerator: (req) => `${rateLimit?.ipKeyGenerator ? rateLimit.ipKeyGenerator(req.ip) : req.ip}|${req.baseUrl}${req.path}`,
});

module.exports = {
  captureVerifyLimiter,
  loginLimiter,
  otpLimiter,
  otpSendLimiter,
  captureLimiter,
  publicLookupLimiter,
  publicIntakeLimiter,
};
