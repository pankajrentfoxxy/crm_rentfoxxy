const pool = require('../config/db');

const VALID_ACTIONS = new Set(['can_view', 'can_create', 'can_edit', 'can_delete']);

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
    `SELECT can_view, can_create, can_edit, can_delete
     FROM role_permissions
     WHERE role = $1 AND section = $2`,
    [role, section]
  );
  return result.rows[0] || null;
}

async function getUserPermissionRow(userId, section) {
  const result = await pool.query(
    `SELECT can_view, can_create, can_edit, can_delete
     FROM user_permissions
     WHERE user_id = $1 AND section = $2`,
    [userId, section]
  );
  return result.rows[0] || null;
}

/**
 * Resolve effective permission: user override (if non-null) ?? role default ?? false
 */
async function getEffectivePermission(userId, role, section, action) {
  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) return false;

  const userRow = await getUserPermissionRow(userId, section);
  if (userRow && userRow[normalizedAction] !== null && userRow[normalizedAction] !== undefined) {
    return userRow[normalizedAction] === true;
  }

  const roleRow = await getRolePermissionRow(role, section);
  if (roleRow && roleRow[normalizedAction] === true) return true;

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
    `SELECT role, section, can_view, can_create, can_edit, can_delete
     FROM role_permissions
     WHERE role = $1
     ORDER BY section ASC`,
    [role]
  );
  return result.rows;
}

async function listAllRolePermissions() {
  const result = await pool.query(
    `SELECT role, section, can_view, can_create, can_edit, can_delete
     FROM role_permissions
     ORDER BY role ASC, section ASC`
  );
  return result.rows;
}

async function listUserPermissionOverrides(userId) {
  const result = await pool.query(
    `SELECT id, user_id, section, can_view, can_create, can_edit, can_delete, granted_by, granted_at
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
    const { section, can_view, can_create, can_edit, can_delete } = perm;
    if (!section) continue;
    const result = await pool.query(
      `INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (role, section)
       DO UPDATE SET
         can_view = EXCLUDED.can_view,
         can_create = EXCLUDED.can_create,
         can_edit = EXCLUDED.can_edit,
         can_delete = EXCLUDED.can_delete
       RETURNING role, section, can_view, can_create, can_edit, can_delete`,
      [role, section, !!can_view, !!can_create, !!can_edit, !!can_delete]
    );
    results.push(result.rows[0]);
  }
  return results;
}

async function upsertUserPermissions(userId, permissions, grantedBy) {
  const results = [];
  for (const perm of permissions) {
    const { section, can_view, can_create, can_edit, can_delete } = perm;
    if (!section) continue;
    const result = await pool.query(
      `INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete, granted_by, granted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id, section)
       DO UPDATE SET
         can_view = EXCLUDED.can_view,
         can_create = EXCLUDED.can_create,
         can_edit = EXCLUDED.can_edit,
         can_delete = EXCLUDED.can_delete,
         granted_by = EXCLUDED.granted_by,
         granted_at = NOW()
       RETURNING id, user_id, section, can_view, can_create, can_edit, can_delete, granted_by, granted_at`,
      [userId, section, can_view ?? null, can_create ?? null, can_edit ?? null, can_delete ?? null, grantedBy]
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
