/**
 * Express routes for DC numbers that may contain slashes (e.g. DC/26-27/0765).
 */
function bindDcNumber(req, _res, next) {
  const raw = req.params[0];
  if (raw == null) return next();
  try {
    req.params.dcNumber = decodeURIComponent(raw);
  } catch {
    req.params.dcNumber = raw;
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

/** Vendor repair DC routes (VRDC/26-27/0001 may contain slashes). */
function vrdcSuffixPattern(suffix) {
  const esc = String(suffix || '').replace(/\//g, '\\/');
  return new RegExp(`^/dc/(.+)${esc}$`);
}

function vrdcRoute(suffix, ...handlers) {
  return [vrdcSuffixPattern(suffix), bindDcNumber, ...handlers];
}

module.exports = { dcRoute, vrdcRoute, bindDcNumber, dcSuffixPattern, vrdcSuffixPattern };
