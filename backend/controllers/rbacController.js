const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { logPermissionAudit } = require('../services/permissionAuditService');
const { applyRoleDefaults, hasRoleDefaults } = require('../services/roleDefaultsSeed');
const {
  getPermissionSections,
  getPermissionCatalogue,
  getKnownSectionSet,
  listRolePermissions,
  listAllRolePermissions,
  buildUserPermissionsPayload,
  upsertRolePermissions,
  upsertUserPermissions,
  resetUserPermissions,
  saveUserOverrides,
} = require('../services/permissionService');
const { userHasRoleOrSection } = require('../middleware/roleOrSection');
const {
  PROTECTED_ROLES,
  canEditRolePermissions,
  canManageUser,
  findUnknownSections,
  findDuplicateSections,
  normalizeRoleRow,
  isProtectedRole,
} = require('../services/rbacGuard');
const { SCOPE_VALUE_OPTIONS } = require('../constants/permissionCatalog');
const { ensureUsersRoleCheck } = require('../services/userRoleCheck');

/*
 * Access (decision CT1): each RBAC screen accepts the hardcoded roles it
 * always did OR the matching grant in the matrix. The escalation guard in
 * services/rbacGuard applies on top of both paths.
 *
 *   roles            view: admin, manager (or roles/role_permissions/user_permissions view)
 *                    create/edit/delete: admin (or roles create/edit/delete)
 *   role_permissions view: admin, manager (or role_permissions view)
 *                    edit: admin (or role_permissions edit). Managers may READ the matrix
 *                    but not write it — with write access a manager could grant their own
 *                    role every section.
 *   user_permissions view/edit: admin (or user_permissions view/edit)
 *   audit log        admin (or role_permissions / user_permissions view)
 */
const ACCESS = {
  rolesView: [['admin', 'manager'], ['roles', 'role_permissions', 'user_permissions'], 'view'],
  rolesCreate: [['admin'], 'roles', 'create'],
  rolesEdit: [['admin'], 'roles', 'edit'],
  rolesDelete: [['admin'], 'roles', 'delete'],
  sectionsView: [['admin', 'manager'], ['roles', 'role_permissions', 'user_permissions'], 'view'],
  rolePermView: [['admin', 'manager'], 'role_permissions', 'view'],
  rolePermEdit: [['admin'], 'role_permissions', 'edit'],
  userPermView: [['admin'], 'user_permissions', 'view'],
  userPermEdit: [['admin'], 'user_permissions', 'edit'],
  usersByRole: [['admin'], ['users', 'roles'], 'view'],
  auditView: [['admin'], ['role_permissions', 'user_permissions'], 'view'],
};

async function allowed(req, key) {
  const [roles, sections, action] = ACCESS[key];
  if (!req.permissionCache) req.permissionCache = {};
  return userHasRoleOrSection(req.user, roles, sections, action, req.permissionCache);
}

const deny = (res, message = 'Access denied') => res.status(403).json({ success: false, message });

const slugifyRoleName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);

async function roleExists(name, client = pool) {
  const r = await client.query('SELECT name FROM roles WHERE name = $1', [name]);
  return r.rows.length > 0;
}

/** Summarise a role-matrix change for the audit log (bounded). */
function diffRoleRows(beforeRows, afterRows) {
  const before = new Map((beforeRows || []).map((r) => [r.section, r]));
  const fields = ['can_view', 'can_create', 'can_edit', 'can_delete', 'data_scope', 'customer_access', 'inventory_tag_access'];
  const changed = [];
  for (const row of afterRows || []) {
    const old = before.get(row.section);
    const delta = {};
    for (const f of fields) {
      const a = old ? old[f] : null;
      if (a !== row[f] && !(a == null && (row[f] === false || row[f] === 'all'))) delta[f] = [a ?? null, row[f]];
    }
    if (Object.keys(delta).length) changed.push({ section: row.section, ...delta });
  }
  return changed;
}

exports.ensureRbacSchema = async () => {
  const sqlPath = path.join(__dirname, '../migrations/040_rbac_roles_module.sql');
  if (!fs.existsSync(sqlPath)) return;
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
};

/** GET /api/roles/sections — the grouped catalogue the matrix renders. */
exports.getPermissionSections = async (req, res) => {
  try {
    if (!(await allowed(req, 'sectionsView'))) return deny(res);
    const { sections, groups } = await getPermissionCatalogue();
    res.json({ success: true, sections, groups, scope_values: SCOPE_VALUE_OPTIONS });
  } catch (error) {
    console.error('getPermissionSections error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching sections' });
  }
};

exports.listRoles = async (req, res) => {
  try {
    if (!(await allowed(req, 'rolesView'))) return deny(res);

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();

    const params = [];
    let whereClause = '';
    if (search) {
      params.push(`%${search}%`);
      whereClause = `WHERE r.name ILIKE $1 OR r.display_name ILIKE $1 OR r.description ILIKE $1`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM roles r ${whereClause}`,
      params
    );
    const listParams = [...params, limit, offset];
    const listResult = await pool.query(
      `SELECT r.id, r.name, r.display_name, r.description, r.is_system_role, r.created_at, r.updated_at,
              (SELECT COUNT(*)::int FROM users u
               WHERE u.role = r.name AND u.active = true
                 AND u.role NOT IN ('vendor', 'customer')) AS active_users,
              (SELECT COUNT(*)::int FROM users u WHERE u.role = r.name) AS total_users,
              (SELECT COUNT(*)::int FROM role_permissions rp
                WHERE rp.role = r.name AND rp.can_view = true) AS sections_granted
       FROM roles r
       ${whereClause}
       ORDER BY r.is_system_role DESC, r.name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams
    );

    const roles = listResult.rows.map((r) => ({
      ...r,
      has_defaults: hasRoleDefaults(r.name),
      protected: isProtectedRole(r.name),
    }));

    res.json({
      success: true,
      roles,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        totalPages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
      },
    });
  } catch (error) {
    console.error('listRoles error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching roles' });
  }
};

exports.createRole = async (req, res) => {
  try {
    if (!(await allowed(req, 'rolesCreate'))) return deny(res);

    const { name, display_name, description } = req.body;
    const slug = slugifyRoleName(name);
    if (!slug) {
      return res.status(400).json({ success: false, message: 'Role name is required' });
    }
    if (PROTECTED_ROLES.includes(slug)) {
      return res.status(400).json({ success: false, message: 'Role already exists' });
    }

    const result = await pool.query(
      `INSERT INTO roles (name, display_name, description, is_system_role)
       VALUES ($1, $2, $3, false)
       RETURNING id, name, display_name, description, is_system_role, created_at, updated_at`,
      [slug, display_name || slug, description || null]
    );

    // Let the new role be assigned to users straight away.
    try {
      await ensureUsersRoleCheck();
    } catch (checkErr) {
      console.error('users_role_check rebuild after createRole failed:', checkErr.message);
    }

    await logPermissionAudit({
      actorUserId: req.user.user_id,
      targetType: 'role',
      targetId: slug,
      action: 'role_created',
      payload: result.rows[0],
    });

    res.status(201).json({ success: true, role: result.rows[0] });
  } catch (error) {
    console.error('createRole error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ success: false, message: 'Role already exists' });
    }
    res.status(500).json({ success: false, message: 'Server error creating role' });
  }
};

exports.updateRole = async (req, res) => {
  try {
    if (!(await allowed(req, 'rolesEdit'))) return deny(res);

    const { id } = req.params;
    const { display_name, description } = req.body;

    const existing = await pool.query('SELECT * FROM roles WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }
    if (isProtectedRole(existing.rows[0].name) && req.user.role !== 'super_admin') {
      return deny(res, 'Only a super admin can change the admin / super admin roles.');
    }

    const result = await pool.query(
      `UPDATE roles
       SET display_name = COALESCE($1, display_name),
           description = COALESCE($2, description),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, display_name, description, is_system_role, created_at, updated_at`,
      [display_name || null, description ?? null, id]
    );

    await logPermissionAudit({
      actorUserId: req.user.user_id,
      targetType: 'role',
      targetId: result.rows[0].name,
      action: 'role_updated',
      payload: {
        before: { display_name: existing.rows[0].display_name, description: existing.rows[0].description },
        after: { display_name: result.rows[0].display_name, description: result.rows[0].description },
      },
    });

    res.json({ success: true, role: result.rows[0] });
  } catch (error) {
    console.error('updateRole error:', error);
    res.status(500).json({ success: false, message: 'Server error updating role' });
  }
};

exports.deleteRole = async (req, res) => {
  const client = await pool.connect();
  try {
    if (!(await allowed(req, 'rolesDelete'))) return deny(res);

    const { id } = req.params;
    const existing = await client.query('SELECT * FROM roles WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    const role = existing.rows[0];
    if (role.is_system_role || isProtectedRole(role.name)) {
      return res.status(400).json({ success: false, message: 'System roles cannot be deleted' });
    }
    if (req.user.role === role.name) {
      return deny(res, 'You cannot delete your own role.');
    }

    const usersCount = await client.query(
      'SELECT COUNT(*)::int AS total FROM users WHERE role = $1',
      [role.name]
    );
    if (usersCount.rows[0]?.total > 0) {
      return res.status(400).json({
        success: false,
        message: `Role is assigned to ${usersCount.rows[0].total} user(s) (active or inactive). Move them to another role first.`,
      });
    }

    const before = await client.query(
      'SELECT section, can_view, can_create, can_edit, can_delete FROM role_permissions WHERE role = $1',
      [role.name]
    );
    await client.query('BEGIN');
    await client.query('DELETE FROM role_permissions WHERE role = $1', [role.name]);
    await client.query('DELETE FROM roles WHERE id = $1', [id]);
    await client.query('COMMIT');

    await logPermissionAudit({
      actorUserId: req.user.user_id,
      targetType: 'role',
      targetId: role.name,
      action: 'role_deleted',
      payload: { id: role.id, name: role.name, permissions: before.rows },
    });

    res.json({ success: true, message: 'Role deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('deleteRole error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting role' });
  } finally {
    client.release();
  }
};

exports.getRolePermissions = async (req, res) => {
  try {
    if (!(await allowed(req, 'rolePermView'))) return deny(res);

    const { role } = req.params;
    if (!(await roleExists(role))) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    const permissions = await listRolePermissions(role);
    const sections = await getPermissionSections();
    const canEdit = (await allowed(req, 'rolePermEdit')) && canEditRolePermissions(req.user, role).ok;

    res.json({
      success: true,
      role,
      sections,
      permissions,
      has_defaults: hasRoleDefaults(role),
      can_edit: canEdit,
    });
  } catch (error) {
    console.error('getRolePermissions error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching role permissions' });
  }
};

/**
 * Validate + write a role's rows in one transaction. Throws {status, message}
 * on a guard / validation failure.
 */
async function writeRolePermissions(req, role, permissions, auditAction) {
  const guard = canEditRolePermissions(req.user, role);
  if (!guard.ok) {
    const err = new Error(guard.reason);
    err.status = 403;
    throw err;
  }
  const rows = permissions.filter((p) => p && p.section).map(normalizeRoleRow);
  const dup = findDuplicateSections(rows);
  if (dup.length) {
    const err = new Error(`Duplicate sections: ${dup.join(', ')}`);
    err.status = 400;
    throw err;
  }
  // Known = catalogue ∪ code catalogue ∪ sections this role already has rows
  // for (so an old row outside the catalogue never blocks saving the matrix).
  const known = await getKnownSectionSet();
  (await pool.query('SELECT section FROM role_permissions WHERE role = $1', [role]))
    .rows.forEach((r) => known.add(r.section));
  const unknown = findUnknownSections(rows, known);
  if (unknown.length) {
    const err = new Error(`Unknown sections: ${unknown.join(', ')}`);
    err.status = 400;
    err.unknown_sections = unknown;
    throw err;
  }

  const client = await pool.connect();
  let before;
  let updated;
  try {
    await client.query('BEGIN');
    if (!(await roleExists(role, client))) {
      const err = new Error('Role not found');
      err.status = 404;
      throw err;
    }
    before = (await client.query(
      `SELECT section, can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access
         FROM role_permissions WHERE role = $1 FOR UPDATE`,
      [role]
    )).rows;
    updated = await upsertRolePermissions(role, rows, client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const changed = diffRoleRows(before, updated);
  await logPermissionAudit({
    actorUserId: req.user.user_id,
    targetType: 'role_permissions',
    targetId: role,
    action: auditAction,
    payload: { count: updated.length, changed_count: changed.length, changed: changed.slice(0, 200) },
  });
  return updated;
}

function sendWriteError(res, error, fallback) {
  if (error?.status) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
      ...(error.unknown_sections ? { unknown_sections: error.unknown_sections } : {}),
    });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
}

/** PUT /api/role-permissions/:role — the whole matrix, one transaction. */
exports.updateRolePermissions = async (req, res) => {
  try {
    if (!(await allowed(req, 'rolePermEdit'))) return deny(res);

    const { role } = req.params;
    const { permissions } = req.body;
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ success: false, message: 'Permissions must be an array' });
    }

    const updated = await writeRolePermissions(req, role, permissions, 'role_permissions_updated');
    res.json({ success: true, message: 'Permissions saved', permissions: updated });
  } catch (error) {
    sendWriteError(res, error, 'Server error updating role permissions');
  }
};

/** Legacy shape for existing PermissionsPage tab */
exports.listAllRolePermissionsLegacy = async (req, res) => {
  try {
    if (!(await allowed(req, 'rolePermView'))) return deny(res);
    const permissions = await listAllRolePermissions();
    res.json(permissions);
  } catch (error) {
    console.error('listAllRolePermissionsLegacy error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching permissions' });
  }
};

exports.patchAllRolePermissionsLegacy = async (req, res) => {
  try {
    if (!(await allowed(req, 'rolePermEdit'))) return deny(res);
    const { permissions } = req.body;
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ success: false, message: 'Permissions must be an array' });
    }

    const grouped = permissions.reduce((acc, row) => {
      if (!row?.role) return acc;
      if (!acc[row.role]) acc[row.role] = [];
      acc[row.role].push(row);
      return acc;
    }, {});

    // Check every role before writing any, so one refused role writes nothing.
    for (const role of Object.keys(grouped)) {
      const guard = canEditRolePermissions(req.user, role);
      if (!guard.ok) return deny(res, `${role}: ${guard.reason}`);
      // eslint-disable-next-line no-await-in-loop
      if (!(await roleExists(role))) {
        return res.status(400).json({ success: false, message: `Unknown role: ${role}` });
      }
    }

    const results = [];
    for (const [role, rows] of Object.entries(grouped)) {
      // eslint-disable-next-line no-await-in-loop
      const updated = await writeRolePermissions(req, role, rows, 'role_permissions_bulk_updated');
      results.push(...updated);
    }

    res.json({ success: true, message: 'Permissions saved', permissions: results });
  } catch (error) {
    sendWriteError(res, error, 'Server error saving permissions');
  }
};

exports.getUsersByRole = async (req, res) => {
  try {
    if (!(await allowed(req, 'usersByRole'))) return deny(res);

    const { role } = req.params;
    const search = String(req.query.search || '').trim();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = (page - 1) * limit;

    const params = [role];
    let searchClause = '';
    if (search) {
      params.push(`%${search}%`);
      searchClause = `AND (name ILIKE $2 OR email ILIKE $2)`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users WHERE role = $1 AND active = true ${searchClause}`,
      params
    );

    const listParams = [...params, limit, offset];
    const listResult = await pool.query(
      `SELECT user_id, name, email, role, mobile_no, status, created_at
       FROM users
       WHERE role = $1 AND active = true ${searchClause}
       ORDER BY name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams
    );

    res.json({
      success: true,
      role,
      users: listResult.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        totalPages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
      },
    });
  } catch (error) {
    console.error('getUsersByRole error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching users' });
  }
};

async function loadTargetUser(userId) {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const r = await pool.query('SELECT user_id, role, email, name FROM users WHERE user_id = $1', [userId]);
  return r.rows[0] || null;
}

exports.getUserPermissions = async (req, res) => {
  try {
    if (!(await allowed(req, 'userPermView'))) return deny(res);

    const userId = parseInt(req.params.userId || req.params.id, 10);
    const payload = await buildUserPermissionsPayload(userId);
    if (!payload) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const canEdit = (await allowed(req, 'userPermEdit')) && canManageUser(req.user, payload.user).ok;

    res.json({
      success: true,
      user: payload.user,
      role_permissions: payload.role_permissions,
      user_permissions: payload.user_permissions,
      sections: payload.sections,
      effective: payload.effective,
      sources: payload.sources,
      can_edit: canEdit,
    });
  } catch (error) {
    console.error('getUserPermissions error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching user permissions' });
  }
};

/** Shared gate for every user-override write: access + guard + section check. */
async function checkUserOverrideWrite(req, res, userId, permissions) {
  if (!(await allowed(req, 'userPermEdit'))) { deny(res); return null; }
  if (permissions !== undefined && !Array.isArray(permissions)) {
    res.status(400).json({ success: false, message: 'Permissions must be an array' });
    return null;
  }
  const target = await loadTargetUser(userId);
  if (!target) {
    res.status(404).json({ success: false, message: 'User not found' });
    return null;
  }
  const guard = canManageUser(req.user, target);
  if (!guard.ok) { deny(res, guard.reason); return null; }
  if (Array.isArray(permissions)) {
    const rows = permissions.filter(Boolean);
    const dup = findDuplicateSections(rows);
    if (dup.length) {
      res.status(400).json({ success: false, message: `Duplicate sections: ${dup.join(', ')}` });
      return null;
    }
    const known = await getKnownSectionSet();
    (await pool.query(
      `SELECT section FROM user_permissions WHERE user_id = $1
       UNION SELECT section FROM role_permissions WHERE role = $2`,
      [userId, target.role]
    )).rows.forEach((r) => known.add(r.section));
    const unknown = findUnknownSections(rows, known);
    if (unknown.length) {
      res.status(400).json({ success: false, message: `Unknown sections: ${unknown.join(', ')}`, unknown_sections: unknown });
      return null;
    }
  }
  return target;
}

exports.checkUserOverrideWrite = checkUserOverrideWrite;

/** Legacy PUT /api/user-permissions/:userId — stores rows as sent (null = inherit). */
exports.updateUserPermissionsById = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId || req.params.id, 10);
    const { permissions } = req.body;
    const target = await checkUserOverrideWrite(req, res, userId, permissions ?? null);
    if (!target) return;

    const updatedPermissions = await upsertUserPermissions(userId, permissions, req.user.user_id);

    await logPermissionAudit({
      actorUserId: req.user.user_id,
      targetType: 'user_permissions',
      targetId: userId,
      action: 'user_permissions_updated',
      payload: { count: updatedPermissions.length, sections: updatedPermissions.map((r) => r.section).slice(0, 200) },
    });

    res.json({ success: true, message: 'Permissions updated', permissions: updatedPermissions });
  } catch (error) {
    console.error('updateUserPermissionsById error:', error);
    res.status(500).json({ success: false, message: 'Server error updating permissions' });
  }
};

/**
 * PUT /api/user-permissions/:userId/overrides — the editor sends the
 * EFFECTIVE values it wants; only the differences from the role are stored,
 * all in one transaction (replaces the old delete-reset-then-PUT).
 */
exports.saveUserOverrides = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId || req.params.id, 10);
    const { permissions } = req.body;
    const target = await checkUserOverrideWrite(req, res, userId, permissions ?? null);
    if (!target) return;

    const result = await saveUserOverrides(userId, target.role, permissions, req.user.user_id);

    await logPermissionAudit({
      actorUserId: req.user.user_id,
      targetType: 'user_permissions',
      targetId: userId,
      action: 'user_overrides_saved',
      payload: {
        user: target.email,
        role: target.role,
        overrides: result.upserts.slice(0, 200),
        removed: result.deletes,
      },
    });

    res.json({ success: true, message: 'Overrides saved', overrides: result.rows, removed: result.deletes });
  } catch (error) {
    console.error('saveUserOverrides error:', error);
    res.status(500).json({ success: false, message: 'Server error saving overrides' });
  }
};

exports.applyRoleDefaults = async (req, res) => {
  try {
    if (!(await allowed(req, 'rolePermEdit'))) return deny(res);

    const { role } = req.params;
    if (!(await roleExists(role))) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }
    const guard = canEditRolePermissions(req.user, role);
    if (!guard.ok) return deny(res, guard.reason);
    if (!hasRoleDefaults(role)) {
      return res.status(400).json({
        success: false,
        message: `No default permissions are defined for role "${role}". Nothing was changed.`,
      });
    }

    const before = await listRolePermissions(role);
    await applyRoleDefaults(role);
    const permissions = await listRolePermissions(role);
    const changed = diffRoleRows(before, permissions);
    const afterSet = new Set(permissions.map((r) => r.section));

    await logPermissionAudit({
      actorUserId: req.user.user_id,
      targetType: 'role_permissions',
      targetId: role,
      action: 'role_permissions_defaults_applied',
      payload: {
        role,
        changed: changed.slice(0, 200),
        removed: before.filter((r) => !afterSet.has(r.section)).map((r) => r.section),
      },
    });

    const sections = await getPermissionSections();
    res.json({ success: true, message: 'Role defaults applied', role, sections, permissions });
  } catch (error) {
    sendWriteError(res, error, 'Server error applying role defaults');
  }
};

exports.resetUserPermissionsById = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId || req.params.id, 10);
    const target = await checkUserOverrideWrite(req, res, userId, undefined);
    if (!target) return;

    const removed = await resetUserPermissions(userId);

    await logPermissionAudit({
      actorUserId: req.user.user_id,
      targetType: 'user_permissions',
      targetId: userId,
      action: 'user_permissions_reset',
      payload: { user: target.email, removed: removed.map((r) => r.section) },
    });

    res.json({ success: true, message: 'User permissions reset to role defaults' });
  } catch (error) {
    console.error('resetUserPermissionsById error:', error);
    res.status(500).json({ success: false, message: 'Server error resetting permissions' });
  }
};

/** GET /api/roles/audit-log — permission_audit_logs with filters. */
exports.getAuditLog = async (req, res) => {
  try {
    if (!(await allowed(req, 'auditView'))) return deny(res);

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };
    const targetType = String(req.query.target_type || '').trim();
    const action = String(req.query.action || '').trim();
    const targetId = String(req.query.target_id || '').trim();
    const actorId = parseInt(req.query.actor_user_id, 10);
    const search = String(req.query.search || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

    if (targetType) add('l.target_type = ?', targetType);
    if (action) add('l.action = ?', action);
    if (targetId) add('l.target_id = ?', targetId);
    if (Number.isInteger(actorId) && actorId > 0) add('l.actor_user_id = ?', actorId);
    if (from && isDate(from)) add('l.created_at >= ?::date', from);
    if (to && isDate(to)) add("l.created_at < (?::date + INTERVAL '1 day')", to);
    if (search) {
      params.push(`%${search}%`);
      const p = `$${params.length}`;
      conditions.push(`(a.name ILIKE ${p} OR a.email ILIKE ${p} OR l.target_id ILIKE ${p}
        OR tu.name ILIKE ${p} OR tu.email ILIKE ${p} OR l.action ILIKE ${p})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const from_ = `FROM permission_audit_logs l
      LEFT JOIN users a ON a.user_id = l.actor_user_id
      LEFT JOIN users tu ON l.target_type IN ('user_permissions', 'user')
                        AND l.target_id ~ '^[0-9]+$' AND tu.user_id = l.target_id::int`;

    const count = await pool.query(`SELECT COUNT(*)::int AS total ${from_} ${where}`, params);
    const list = await pool.query(
      `SELECT l.id, l.actor_user_id, a.name AS actor_name, a.email AS actor_email,
              l.target_type, l.target_id,
              COALESCE(tu.name, l.target_id) AS target_label,
              l.action, l.payload, l.created_at
       ${from_} ${where}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const facets = await pool.query(
      `SELECT ARRAY(SELECT DISTINCT action FROM permission_audit_logs ORDER BY 1) AS actions,
              ARRAY(SELECT DISTINCT target_type FROM permission_audit_logs ORDER BY 1) AS target_types`
    );

    const total = count.rows[0]?.total || 0;
    res.json({
      success: true,
      logs: list.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
      actions: facets.rows[0]?.actions || [],
      target_types: facets.rows[0]?.target_types || [],
    });
  } catch (error) {
    console.error('getAuditLog error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching audit log' });
  }
};

// Exported for unit tests.
exports._diffRoleRows = diffRoleRows;
exports._slugifyRoleName = slugifyRoleName;
