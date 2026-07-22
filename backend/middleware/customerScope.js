/**
 * Resolves the caller's Customer Access scope once per request and exposes it
 * as req.allowedCustomerTypes (['sales','rental','both'] when unrestricted).
 * Mount after authMiddleware on customer-touching routes.
 */
const { getAllowedCustomerTypes, FULL } = require('../services/customerAccessScope');

module.exports = async (req, res, next) => {
  try {
    req.allowedCustomerTypes = await getAllowedCustomerTypes(req.user);
    next();
  } catch (e) {
    // Fail open to full access rather than breaking the request pipeline —
    // permission rows may not exist yet (fresh install / pre-migration).
    console.error('customerScope middleware error:', e.message);
    req.allowedCustomerTypes = FULL;
    next();
  }
};
