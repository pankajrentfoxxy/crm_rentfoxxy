const pool = require('../config/db');

const VALID_ACTIONS = new Set(['can_view', 'can_create', 'can_edit', 'can_delete']);

// Customer Access selector on the customers permission row (all/sales/rental).
// Sibling of data_scope — do NOT conflate the two.
const CUSTOMER_ACCESS_VALUES = new Set(['all', 'sales', 'rental']);
const INVENTORY_TAG_ACCESS_VALUES = new Set([
  'all',
  'rental_only',
  'rental_both',
  'sale_only',
  'sale_both',
  'sales',
  'rental',
]);

const SECTION_ALIASES = {
  reports_access: ['reports_access', 'reports'],
  reports: ['reports', 'reports_access'],
  follow_ups: ['follow_ups', 'lead_follow_ups'],
  lead_follow_ups: ['follow_ups', 'lead_follow_ups'],
  sales_orders: ['sales_orders', 'sales_orders_doc'],
  sales_orders_doc: ['sales_orders', 'sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental'],
  sales_orders_sale: ['sales_orders_sale', 'sales_orders_doc', 'sales_orders'],
  sales_orders_rental: ['sales_orders_rental', 'sales_orders_doc', 'sales_orders'],
  sales_orders_replacement: ['sales_orders_replacement'],
  replacement_so_laptop_qc: ['replacement_so_laptop_qc'],
  so_laptop_qc: ['so_laptop_qc'],
};

function sectionsToCheck(section) {
  return SECTION_ALIASES[section] || [section];
}

async function getEffectivePermissionForKey(userId, role, section, normalizedAction) {
  const userRow = await getUserPermissionRow(userId, section);
  if (userRow && userRow[normalizedAction] !== null && userRow[normalizedAction] !== undefined) {
    return userRow[normalizedAction] === true;
  }

  const roleRow = await getRolePermissionRow(role, section);
  if (roleRow && roleRow[normalizedAction] === true) return true;

  return false;
}

const DEFAULT_SECTIONS = [
  'dashboard', 'inventory', 'tickets', 'leads', 'sales_orders', 'follow_ups', 'lead_orders',
  'customers', 'manager_dashboard', 'reports', 'parts', 'procurement', 'vendor_management',
  'warehouse', 'qc_management', 'inventory_management', 'dispatch', 'support_tickets',
  'customer_inventory', 'teams', 'roles', 'role_permissions', 'user_permissions',
  'customer_management',
];

const ACTION_ALIASES = {
  view: 'can_view',
  create: 'can_create',
  edit: 'can_edit',
  delete: 'can_delete',
};

const normalizeAction = (action) => {
  if (!action) return null;
  const key = String(action).trim();
  if (VALID_ACTIONS.has(key)) return key;
  return ACTION_ALIASES[key] || null;
};

async function getPermissionSections() {
  try {
    const result = await pool.query(
      `SELECT section, description, sort_order
       FROM permission_sections
       ORDER BY sort_order ASC, section ASC`
    );
    if (result.rows.length > 0) return result.rows.map((r) => r.section);
  } catch (error) {
    console.error('getPermissionSections error:', error);
  }
  return DEFAULT_SECTIONS;
}

async function getUserRole(userId) {
  const result = await pool.query('SELECT role FROM users WHERE user_id = $1', [userId]);
  return result.rows[0]?.role || null;
}

async function getRolePermissionRow(role, section) {
  const result = await pool.query(
    `SELECT can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access
     FROM role_permissions
     WHERE role = $1 AND section = $2`,
    [role, section]
  );
  return result.rows[0] || null;
}

async function getUserPermissionRow(userId, section) {
  const result = await pool.query(
    `SELECT can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access
     FROM user_permissions
     WHERE user_id = $1 AND section = $2`,
    [userId, section]
  );
  return result.rows[0] || null;
}

/**
 * Resolve effective permission: user override (if non-null) ?? role default ?? false.
 * Checks section aliases (e.g. follow_ups / lead_follow_ups).
 */
async function getEffectivePermission(userId, role, section, action) {
  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) return false;

  for (const key of sectionsToCheck(section)) {
    const allowed = await getEffectivePermissionForKey(userId, role, key, normalizedAction);
    if (allowed) return true;
  }

  return false;
}

async function hasPermission(userId, role, section, action, cache) {
  if (role === 'super_admin') return true;

  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) return false;

  const cacheKey = `${section}:${normalizedAction}`;
  if (cache && Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
    return cache[cacheKey];
  }

  const allowed = await getEffectivePermission(userId, role, section, normalizedAction);
  if (cache) cache[cacheKey] = allowed;
  return allowed;
}

async function listRolePermissions(role) {
  const result = await pool.query(
    `SELECT role, section, can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access
     FROM role_permissions
     WHERE role = $1
     ORDER BY section ASC`,
    [role]
  );
  return result.rows;
}

async function listAllRolePermissions() {
  const result = await pool.query(
    `SELECT role, section, can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access
     FROM role_permissions
     ORDER BY role ASC, section ASC`
  );
  return result.rows;
}

async function listUserPermissionOverrides(userId) {
  const result = await pool.query(
    `SELECT id, user_id, section, can_view, can_create, can_edit, can_delete,
            data_scope, customer_access, inventory_tag_access, granted_by, granted_at
     FROM user_permissions
     WHERE user_id = $1
     ORDER BY section ASC`,
    [userId]
  );
  return result.rows;
}

async function buildUserPermissionsPayload(userId) {
  const userResult = await pool.query(
    `SELECT user_id, name, email, role FROM users WHERE user_id = $1`,
    [userId]
  );
  if (userResult.rows.length === 0) return null;

  const user = userResult.rows[0];
  const sections = await getPermissionSections();
  const rolePermissions = await listRolePermissions(user.role);
  const userPermissions = await listUserPermissionOverrides(userId);

  const roleMap = rolePermissions.reduce((acc, row) => {
    acc[row.section] = row;
    return acc;
  }, {});

  const userMap = userPermissions.reduce((acc, row) => {
    acc[row.section] = row;
    return acc;
  }, {});

  const effective = {};
  for (const section of sections) {
    effective[section] = {};
    for (const action of VALID_ACTIONS) {
      const override = userMap[section]?.[action];
      if (override === true || override === false) {
        effective[section][action] = override;
      } else {
        effective[section][action] = roleMap[section]?.[action] === true;
      }
    }
    const userScope = userMap[section]?.data_scope;
    const roleScope = roleMap[section]?.data_scope;
    effective[section].data_scope = userScope === 'all' || userScope === 'assigned'
      ? userScope
      : (roleScope === 'assigned' ? 'assigned' : 'all');

    // Customer Access (all/sales/rental): user override beats role default,
    // mirroring data_scope. Meaningful only on the customers section rows.
    const userAccess = userMap[section]?.customer_access;
    const roleAccess = roleMap[section]?.customer_access;
    effective[section].customer_access = CUSTOMER_ACCESS_VALUES.has(userAccess)
      ? userAccess
      : (CUSTOMER_ACCESS_VALUES.has(roleAccess) ? roleAccess : 'all');

    const userTagAccess = userMap[section]?.inventory_tag_access;
    const roleTagAccess = roleMap[section]?.inventory_tag_access;
    effective[section].inventory_tag_access = INVENTORY_TAG_ACCESS_VALUES.has(userTagAccess)
      ? userTagAccess
      : (INVENTORY_TAG_ACCESS_VALUES.has(roleTagAccess) ? roleTagAccess : 'all');
  }

  return {
    user,
    role_permissions: rolePermissions,
    user_permissions: userPermissions,
    sections,
    effective,
  };
}

async function upsertRolePermissions(role, permissions) {
  const results = [];
  for (const perm of permissions) {
    const { section, can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access } = perm;
    if (!section) continue;
    const scope = data_scope === 'assigned' ? 'assigned' : 'all';
    const access = CUSTOMER_ACCESS_VALUES.has(customer_access) ? customer_access : 'all';
    const tagAccess = INVENTORY_TAG_ACCESS_VALUES.has(inventory_tag_access) ? inventory_tag_access : 'all';
    const result = await pool.query(
      `INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (role, section)
       DO UPDATE SET
         can_view = EXCLUDED.can_view,
         can_create = EXCLUDED.can_create,
         can_edit = EXCLUDED.can_edit,
         can_delete = EXCLUDED.can_delete,
         data_scope = EXCLUDED.data_scope,
         customer_access = EXCLUDED.customer_access,
         inventory_tag_access = EXCLUDED.inventory_tag_access
       RETURNING role, section, can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access`,
      [role, section, !!can_view, !!can_create, !!can_edit, !!can_delete, scope, access, tagAccess]
    );
    results.push(result.rows[0]);
  }
  return results;
}

async function upsertUserPermissions(userId, permissions, grantedBy) {
  const results = [];
  for (const perm of permissions) {
    const { section, can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access } = perm;
    if (!section) continue;
    const scope = data_scope === 'all' || data_scope === 'assigned' ? data_scope : null;
    const access = CUSTOMER_ACCESS_VALUES.has(customer_access) ? customer_access : null;
    const tagAccess = INVENTORY_TAG_ACCESS_VALUES.has(inventory_tag_access) ? inventory_tag_access : null;
    const result = await pool.query(
      `INSERT INTO user_permissions
        (user_id, section, can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access, granted_by, granted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (user_id, section)
       DO UPDATE SET
         can_view = EXCLUDED.can_view,
         can_create = EXCLUDED.can_create,
         can_edit = EXCLUDED.can_edit,
         can_delete = EXCLUDED.can_delete,
         data_scope = EXCLUDED.data_scope,
         customer_access = EXCLUDED.customer_access,
         inventory_tag_access = EXCLUDED.inventory_tag_access,
         granted_by = EXCLUDED.granted_by,
         granted_at = NOW()
       RETURNING id, user_id, section, can_view, can_create, can_edit, can_delete, data_scope,
                 customer_access, inventory_tag_access, granted_by, granted_at`,
      [userId, section, can_view ?? null, can_create ?? null, can_edit ?? null, can_delete ?? null, scope, access, tagAccess, grantedBy]
    );
    results.push(result.rows[0]);
  }
  return results;
}

async function buildEffectivePermissionsForUser(userId, role) {
  if (role === 'super_admin') {
    const sections = await getPermissionSections();
    const effective = {};
    for (const section of sections) {
      effective[section] = {
        can_view: true,
        can_create: true,
        can_edit: true,
        can_delete: true,
        data_scope: 'all',
        customer_access: 'all',
        inventory_tag_access: 'all',
      };
    }
    return effective;
  }

  const payload = await buildUserPermissionsPayload(userId);
  return payload?.effective || {};
}

async function resetUserPermissions(userId) {
  const result = await pool.query(
    `DELETE FROM user_permissions WHERE user_id = $1 RETURNING section`,
    [userId]
  );
  return result.rows;
}

module.exports = {
  VALID_ACTIONS,
  normalizeAction,
  getPermissionSections,
  getUserRole,
  getRolePermissionRow,
  getUserPermissionRow,
  getEffectivePermission,
  hasPermission,
  listRolePermissions,
  listAllRolePermissions,
  listUserPermissionOverrides,
  buildUserPermissionsPayload,
  upsertRolePermissions,
  upsertUserPermissions,
  buildEffectivePermissionsForUser,
  resetUserPermissions,
};
