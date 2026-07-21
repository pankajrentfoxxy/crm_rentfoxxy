/**
 * Ready to Rent/Sell tag visibility (Roles & Permissions -> inventory_management row).
 *
 * inventory_tag_access:
 *   all    -> no filter; SO-attached units visible with badge
 *   sales  -> extra.inventory_tag in (sale, both); hide SO-attached
 *   rental -> extra.inventory_tag in (rental, both); hide SO-attached
 */
const pool = require('../config/db');

const INVENTORY_SECTIONS = ['inventory_management', 'inventory'];
const VALID_ACCESS = new Set(['all', 'sales', 'rental']);

const ACCESS_LABELS = {
  all: 'All stock',
  sales: 'Sale + Both only',
  rental: 'Rental + Both only',
};

function normalizeTagExpr(alias = 's') {
  return `LOWER(CASE
    WHEN COALESCE(NULLIF(TRIM(${alias}.extra->>'inventory_tag'), ''), '') = 'sales' THEN 'sale'
    ELSE COALESCE(NULLIF(TRIM(${alias}.extra->>'inventory_tag'), ''), '')
  END)`;
}

/** Effective inventory_tag_access: user override -> role default -> 'all'. */
async function getInventoryTagAccess(user) {
  if (!user) return 'all';
  if (user.role === 'super_admin' || user.role === 'admin') return 'all';

  const fromEffective = user.effective_permissions?.inventory_management?.inventory_tag_access
    || user.effective_permissions?.inventory?.inventory_tag_access;
  if (VALID_ACCESS.has(fromEffective)) return fromEffective;

  const userId = user.userId || user.user_id;
  if (userId) {
    const u = await pool.query(
      `SELECT inventory_tag_access FROM user_permissions
        WHERE user_id = $1 AND section = ANY($2) AND inventory_tag_access IS NOT NULL
        LIMIT 1`,
      [userId, INVENTORY_SECTIONS]
    );
    if (VALID_ACCESS.has(u.rows[0]?.inventory_tag_access)) return u.rows[0].inventory_tag_access;
  }

  if (user.role) {
    const r = await pool.query(
      `SELECT inventory_tag_access FROM role_permissions
        WHERE role = $1 AND section = ANY($2) AND inventory_tag_access <> 'all'
        LIMIT 1`,
      [user.role, INVENTORY_SECTIONS]
    );
    if (VALID_ACCESS.has(r.rows[0]?.inventory_tag_access)) return r.rows[0].inventory_tag_access;
  }

  return 'all';
}

function allowedTagsForAccess(access) {
  if (access === 'sales') return ['sale', 'both'];
  if (access === 'rental') return ['rental', 'both'];
  return null;
}

function isRestricted(access) {
  return access === 'sales' || access === 'rental';
}

/**
 * SQL fragment for Ready to Rent/Sell (passed segment) when access is narrowed.
 * Mutates params array.
 */
function appendInventoryTagAccessFilter(access, params, alias = 's') {
  if (!isRestricted(access)) return '';

  const tags = allowedTagsForAccess(access);
  params.push(tags);
  const tagExpr = normalizeTagExpr(alias);
  const tagParam = params.length;

  return ` AND ${tagExpr} = ANY($${tagParam}::text[])
           AND NOT EXISTS (
             SELECT 1 FROM sales_order_serials sos
              WHERE sos.serial_id = ${alias}.serial_id
                AND sos.status = 'attached'
           )`;
}

function accessLabel(access) {
  return ACCESS_LABELS[access] || ACCESS_LABELS.all;
}

module.exports = {
  INVENTORY_SECTIONS,
  VALID_ACCESS,
  getInventoryTagAccess,
  allowedTagsForAccess,
  isRestricted,
  appendInventoryTagAccessFilter,
  accessLabel,
};
