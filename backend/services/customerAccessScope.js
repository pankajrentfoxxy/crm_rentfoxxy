/**
 * Customer Access scope (Roles & Permissions -> customers row).
 *
 * Effective customer_access: user override -> role default -> 'all'.
 * Maps onto customers.customer_type:
 *   all    -> no filter (sales + rental + both)
 *   sales  -> ('sales', 'both')
 *   rental -> ('rental', 'both')
 *
 * NOT related to data_scope (all/assigned record-ownership) — sibling column.
 */
const pool = require('../config/db');

const FULL = ['sales', 'rental', 'both'];
const CUSTOMER_SECTIONS = ['customers', 'customer_management'];
const VALID_ACCESS = new Set(['all', 'sales', 'rental']);

/** Effective customer_access for a user: user override -> role default -> 'all'. */
async function getCustomerAccess(user) {
  if (!user) return 'all';
  if (user.role === 'super_admin' || user.role === 'admin') return 'all';

  const userId = user.userId || user.user_id;
  if (userId) {
    const u = await pool.query(
      `SELECT customer_access FROM user_permissions
        WHERE user_id = $1 AND section = ANY($2) AND customer_access IS NOT NULL
        LIMIT 1`,
      [userId, CUSTOMER_SECTIONS]
    );
    if (VALID_ACCESS.has(u.rows[0]?.customer_access)) return u.rows[0].customer_access;
  }

  if (user.role) {
    const r = await pool.query(
      `SELECT customer_access FROM role_permissions
        WHERE role = $1 AND section = ANY($2) AND customer_access <> 'all'
        LIMIT 1`,
      [user.role, CUSTOMER_SECTIONS]
    );
    if (VALID_ACCESS.has(r.rows[0]?.customer_access)) return r.rows[0].customer_access;
  }

  return 'all';
}

/** Allowed customers.customer_type values for a user. Length 3 = unrestricted. */
async function getAllowedCustomerTypes(user) {
  const access = await getCustomerAccess(user);
  if (access === 'sales') return ['sales', 'both'];
  if (access === 'rental') return ['rental', 'both'];
  return FULL;
}

/** True when the given allowed-types list restricts anything. */
function isRestricted(allowedTypes) {
  return Array.isArray(allowedTypes) && allowedTypes.length > 0 && allowedTypes.length < FULL.length;
}

/** Check a single customer_type value against the allowed list. */
function isCustomerTypeAllowed(allowedTypes, customerType) {
  if (!isRestricted(allowedTypes)) return true;
  const t = String(customerType || 'both').trim().toLowerCase();
  return allowedTypes.includes(FULL.includes(t) ? t : 'both');
}

/**
 * SQL helper — appends "column = ANY($n::text[])" to conditions/params
 * (matching the conditions[] + params style used by listCustomers).
 * No-op when unrestricted.
 */
function appendCustomerTypeCondition(allowedTypes, conditions, params, column = 'c.customer_type') {
  if (!isRestricted(allowedTypes)) return;
  params.push(allowedTypes);
  conditions.push(`${column} = ANY($${params.length}::text[])`);
}

module.exports = {
  FULL,
  CUSTOMER_SECTIONS,
  getCustomerAccess,
  getAllowedCustomerTypes,
  isRestricted,
  isCustomerTypeAllowed,
  appendCustomerTypeCondition,
};
