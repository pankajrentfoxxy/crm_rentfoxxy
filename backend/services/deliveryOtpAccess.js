/**
 * Who may see delivery / warehouse return OTP codes in the CRM UI.
 * Controlled via permission section `delivery_register_otp` (View checkbox).
 */
const { hasPermission } = require('./permissionService');

const LEGACY_OTP_ROLES = new Set([
  'admin', 'manager', 'super_admin', 'support_lead', 'warehouse', 'floor_manager',
]);

async function userCanViewDeliveryRegisterOtp(user, cache) {
  if (!user?.user_id) return false;
  if (user.role === 'super_admin') return true;

  const allowed = await hasPermission(
    user.user_id,
    user.role,
    'delivery_register_otp',
    'can_view',
    cache
  );
  if (allowed) return true;

  return LEGACY_OTP_ROLES.has(user.role);
}

module.exports = {
  LEGACY_OTP_ROLES,
  userCanViewDeliveryRegisterOtp,
};
