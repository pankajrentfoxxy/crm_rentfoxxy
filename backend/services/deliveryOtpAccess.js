/**
 * Who may see delivery / warehouse return OTP codes in the CRM UI.
 * Field delivery staff never see the code — they ask the customer.
 * Office roles use permission section `delivery_register_otp` (View checkbox).
 */
const { hasPermission } = require('./permissionService');

const LEGACY_OTP_ROLES = new Set([
  'admin', 'manager', 'super_admin', 'support_lead', 'warehouse', 'floor_manager',
]);

/** Delivery boy / in-house technician roles — OTP is WhatsApp-only to the customer. */
const FIELD_DELIVERY_ROLES = new Set([
  'dispatch', 'technician', 'delivery', 'delivery_boy', 'support_tech',
]);

function isFieldDeliveryRole(user) {
  return FIELD_DELIVERY_ROLES.has(String(user?.role || '').toLowerCase());
}

async function userCanViewDeliveryRegisterOtp(user, cache) {
  if (!user?.user_id) return false;
  if (isFieldDeliveryRole(user)) return false;
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
  FIELD_DELIVERY_ROLES,
  isFieldDeliveryRole,
  userCanViewDeliveryRegisterOtp,
};
