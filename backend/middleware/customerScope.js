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
    // Fail CLOSED. This used to hand out FULL access on any error, so a
    // transient DB fault — pool exhaustion, a lock held by a boot-time ALTER,
    // a statement timeout — silently promoted a sales-only or rental-only user
    // to every customer, across customer management, leads, sales, support and
    // documents. A fresh-install concern was being paid for with a permanent
    // authorization bypass. super_admin still short-circuits in
    // permissionService, so an admin can always recover.
    console.error('customerScope middleware error (failing closed):', e.message);
    res.status(503).json({
      success: false,
      message: 'Could not resolve your customer access scope. Please retry.',
    });
  }
};
