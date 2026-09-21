/**
 * One request, one correlation id (Part 2.1, Decision 5).
 *
 * Mounted before the routes, so every event any handler writes during this
 * request can carry the same id without threading a parameter through eight
 * call layers. `req.correlationId` is the only thing a handler needs to read.
 *
 * This is what makes finding V1 measurable rather than merely described: one
 * delivery currently writes `status='delivered'` from up to five paths, and
 * with a shared id you can select the whole set and count it. After Part 3 the
 * same query is the regression test.
 *
 * The header is accepted from the caller so a correlation id can span the
 * frontend and the API, but never trusted blindly — an attacker-supplied value
 * would let unrelated events be grouped together, so anything that is not a
 * well-formed UUID is replaced rather than rejected. Refusing the request would
 * turn a cosmetic header into an outage.
 */
const { newCorrelationId } = require('../services/eventService');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = function correlationId(req, res, next) {
  const supplied = req.get('X-Correlation-Id');
  req.correlationId = UUID_RE.test(supplied || '') ? supplied : newCorrelationId();

  // Echo it so a caller can find its own writes in the event log, and so a
  // support conversation can start from "what happened at 14:32" rather than
  // from a guess.
  res.set('X-Correlation-Id', req.correlationId);
  next();
};
