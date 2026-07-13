/**
 * Express routes for DC numbers that may contain slashes (e.g. DC/26-27/0765).
 */

const DC_ACTION_SUFFIXES = [
  '/assignment',
  '/dispatch',
  '/cancel',
  '/delivered',
  '/rejected',
  '/customer-rejected',
  '/courier-rejected',
  '/reached',
  '/admin-deliver',
  '/pdf',
  '/qc-status',
  '/qc-ticket',
  '/send-otp',
  '/verify-otp',
  '/delivery-register',
  '/warehouse-return-otp',
  '/verify-serial',
  '/deliver',
];

/**
 * Decode and normalize a DC number from route params or path segments.
 * Strips accidental action suffixes (e.g. when catch-all routes swallow /assignment).
 */
function normalizeDcNumber(raw) {
  if (raw == null || raw === '') return '';
  let s = String(raw).trim();
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(s);
      if (decoded === s) break;
      s = decoded;
    } catch {
      break;
    }
  }
  for (const suffix of DC_ACTION_SUFFIXES) {
    if (s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  return s.trim();
}

function extractDcFromPath(path) {
  if (!path) return null;
  const clean = String(path).replace(/\?.*$/, '');
  const m = clean.match(/^\/delivery-challans\/(.+)$/);
  return m ? m[1] : null;
}

function bindDcNumber(req, _res, next) {
  const raw = req.params[0] ?? req.params.dcNumber ?? extractDcFromPath(req.path);
  if (raw == null || raw === '') return next();
  req.params.dcNumber = normalizeDcNumber(raw);
  next();
}

/** Skip catch-all DC handlers when the path targets a sub-resource action. */
function rejectDcActionSuffix(req, _res, next) {
  const path = String(req.path || req.url || '').replace(/\?.*$/, '');
  const lower = path.toLowerCase();
  if (DC_ACTION_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return next('route');
  }
  next();
}

function dcSuffixPattern(suffix) {
  const esc = suffix.replace(/\//g, '\\/');
  return new RegExp(`^/delivery-challans/(.+)${esc}$`);
}

function dcRoute(suffix, ...handlers) {
  return [dcSuffixPattern(suffix), bindDcNumber, ...handlers];
}

module.exports = {
  DC_ACTION_SUFFIXES,
  normalizeDcNumber,
  bindDcNumber,
  rejectDcActionSuffix,
  dcRoute,
  dcSuffixPattern,
};
/** Vendor repair DC routes (VRDC/26-27/0001 may contain slashes). */
function vrdcSuffixPattern(suffix) {
  const esc = String(suffix || '').replace(/\//g, '\\/');
  return new RegExp(`^/dc/(.+)${esc}$`);
}

function vrdcRoute(suffix, ...handlers) {
  return [vrdcSuffixPattern(suffix), bindDcNumber, ...handlers];
}

module.exports = { dcRoute, vrdcRoute, bindDcNumber, dcSuffixPattern, vrdcSuffixPattern };
