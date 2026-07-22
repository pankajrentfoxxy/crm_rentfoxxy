/**
 * Express routes for sales order numbers that may contain slashes (e.g. SO/26-27/0590).
 */
function bindSoNumber(req, _res, next) {
  const raw = req.params[0];
  if (raw == null) return next();
  try {
    req.params.soNumber = decodeURIComponent(raw);
  } catch {
    req.params.soNumber = raw;
  }
  req.params.salesOrderNumber = req.params.soNumber;
  req.soNumber = req.params.soNumber;
  next();
}

function soSuffixPattern(suffix) {
  const esc = suffix.replace(/\//g, '\\/');
  return new RegExp(`^/sales-orders/(.+)${esc}$`);
}

function bindSoSerialDetach(req, _res, next) {
  const raw = req.params[0];
  try {
    req.params.soNumber = decodeURIComponent(raw);
  } catch {
    req.params.soNumber = raw;
  }
  req.params.salesOrderNumber = req.params.soNumber;
  req.params.allocId = req.params[1];
  next();
}

function soRoute(suffix, ...handlers) {
  return [soSuffixPattern(suffix), bindSoNumber, ...handlers];
}

module.exports = { soRoute, bindSoNumber, bindSoSerialDetach };
