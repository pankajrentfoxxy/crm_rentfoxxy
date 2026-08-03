/**
 * PATCH /delivery-challans/:dcNumber/admin-deliver
 *
 * Allow POD/admin delivery override for:
 * 1. Standard ops roles (including dispatch — must stay in this list)
 * 2. Any user with delivery_register_management Edit (DB role + user overrides)
 *
 * Do not replace with checkRole() alone — dispatch was blocked when omitted.
 */
const { checkSectionPermission } = require('./auth');

const deliveryRegisterEdit = checkSectionPermission('delivery_register_management', 'edit');

/** Roles that may admin-deliver without an extra section-permission lookup. */
const ADMIN_DELIVER_ROLES = new Set([
  'admin',
  'manager',
  'warehouse',
  'support_tech',
  'dispatch',
]);

function checkAdminDeliverAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  if (req.user.role === 'super_admin') return next();
  if (ADMIN_DELIVER_ROLES.has(req.user.role)) return next();
  return deliveryRegisterEdit(req, res, next);
}

module.exports = {
  ADMIN_DELIVER_ROLES,
  checkAdminDeliverAccess,
};
