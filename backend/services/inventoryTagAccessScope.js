/**
 * Ready to Rent/Sell tag visibility (Roles & Permissions -> inventory_management row).
 *
 * inventory_tag_access:
 *   all          -> no filter; SO-attached units visible with badge
 *   rental_only  -> rental tag only; hide SO-attached
 *   rental_both  -> rental + both; hide SO-attached
 *   sale_only    -> sale tag only; hide SO-attached
 *   sale_both    -> sale + both; hide SO-attached
 *
 * Legacy: sales -> sale_both, rental -> rental_both
 */
const pool = require('../config/db');

const INVENTORY_SECTIONS = ['inventory_management', 'inventory'];

const CANONICAL_ACCESS = [
  'all',
  'rental_only',
  'rental_both',
  'sale_only',
  'sale_both',
];

const LEGACY_ACCESS_MAP = {
  sales: 'sale_both',
  rental: 'rental_both',
};

const VALID_ACCESS = new Set([
  ...CANONICAL_ACCESS,
  ...Object.keys(LEGACY_ACCESS_MAP),
]);

const ACCESS_LABELS = {
  all: 'All stock',
  rental_only: 'Rental only',
  rental_both: 'Rental + Both',
  sale_only: 'Sale only',
  sale_both: 'Sale + Both',
  sales: 'Sale + Both',
  rental: 'Rental + Both',
};

function normalizeAccess(access) {
  const raw = String(access || 'all').trim();
  if (LEGACY_ACCESS_MAP[raw]) return LEGACY_ACCESS_MAP[raw];
  if (CANONICAL_ACCESS.includes(raw)) return raw;
  return 'all';
}

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
  if (fromEffective) {
    const normalized = normalizeAccess(fromEffective);
    if (normalized !== 'all' || fromEffective === 'all') return normalized;
  }

  const userId = user.userId || user.user_id;
  if (userId) {
    const u = await pool.query(
      `SELECT inventory_tag_access FROM user_permissions
        WHERE user_id = $1 AND section = ANY($2) AND inventory_tag_access IS NOT NULL
        LIMIT 1`,
      [userId, INVENTORY_SECTIONS]
    );
    if (u.rows[0]?.inventory_tag_access) {
      return normalizeAccess(u.rows[0].inventory_tag_access);
    }
  }

  if (user.role) {
    const r = await pool.query(
      `SELECT inventory_tag_access FROM role_permissions
        WHERE role = $1 AND section = ANY($2) AND inventory_tag_access <> 'all'
        LIMIT 1`,
      [user.role, INVENTORY_SECTIONS]
    );
    if (r.rows[0]?.inventory_tag_access) {
      return normalizeAccess(r.rows[0].inventory_tag_access);
    }
  }

  return 'all';
}

function allowedTagsForAccess(access) {
  const normalized = normalizeAccess(access);
  switch (normalized) {
    case 'rental_only':
      return ['rental'];
    case 'rental_both':
      return ['rental', 'both'];
    case 'sale_only':
      return ['sale'];
    case 'sale_both':
      return ['sale', 'both'];
    default:
      return null;
  }
}

function isRestricted(access) {
  return normalizeAccess(access) !== 'all';
}

/**
 * SQL fragment for Ready to Rent/Sell (passed segment) when access is narrowed.
 * Mutates params array.
 */
function appendInventoryTagAccessFilter(access, params, alias = 's') {
  if (!isRestricted(access)) return '';

  const tags = allowedTagsForAccess(access);
  if (!tags?.length) return '';

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
  return ACCESS_LABELS[normalizeAccess(access)] || ACCESS_LABELS.all;
}

module.exports = {
  INVENTORY_SECTIONS,
  CANONICAL_ACCESS,
  VALID_ACCESS,
  normalizeAccess,
  getInventoryTagAccess,
  allowedTagsForAccess,
  isRestricted,
  appendInventoryTagAccessFilter,
  accessLabel,
};
