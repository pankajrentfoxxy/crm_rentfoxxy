const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { logPermissionAudit } = require('../services/permissionAuditService');
const {
  getPermissionSections,
  listRolePermissions,
  listAllRolePermissions,
  buildUserPermissionsPayload,
  upsertRolePermissions,
  upsertUserPermissions,
  resetUserPermissions,
} = require('../services/permissionService');

const hasRbacAccess = (user) => ['admin', 'super_admin'].includes(user?.role);

const slugifyRoleName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

exports.ensureRbacSchema = async () => {
  const sqlPath = path.join(__dirname, '../migrations/040_rbac_roles_module.sql');
  if (!fs.existsSync(sqlPath)) return;
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
};

exports.getPermissionSections = async (req, res) => {
  try {
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const result = await pool.query(
      `SELECT id, section, description, sort_order
       FROM permission_sections
       ORDER BY sort_order ASC, section ASC`
    );
    res.json({ success: true, sections: result.rows });
  } catch (error) {
    console.error('getPermissionSections error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching sections' });
  }
};

exports.listRoles = async (req, res) => {
  try {
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();

    const params = [];
    let whereClause = '';
    if (search) {
      params.push(`%${search}%`);
      whereClause = `WHERE name ILIKE $1 OR display_name ILIKE $1 OR description ILIKE $1`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM roles ${whereClause}`,
      params
    );
    const listParams = [...params, limit, offset];
    const listResult = await pool.query(
      `SELECT id, name, display_name, description, is_system_role, created_at, updated_at
       FROM roles
       ${whereClause}
       ORDER BY is_system_role DESC, name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams
    );

    res.json({
      success: true,
      roles: listResult.rows,
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
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { name, display_name, description } = req.body;
    const slug = slugifyRoleName(name);
    if (!slug) {
      return res.status(400).json({ success: false, message: 'Role name is required' });
    }

    const result = await pool.query(
      `INSERT INTO roles (name, display_name, description, is_system_role)
       VALUES ($1, $2, $3, false)
       RETURNING id, name, display_name, description, is_system_role, created_at, updated_at`,
      [slug, display_name || slug, description || null]
    );

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
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { id } = req.params;
    const { display_name, description } = req.body;

    const existing = await pool.query('SELECT * FROM roles WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Role not found' });
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
      payload: result.rows[0],
    });

    res.json({ success: true, role: result.rows[0] });
  } catch (error) {
    console.error('updateRole error:', error);
    res.status(500).json({ success: false, message: 'Server error updating role' });
  }
};

exports.deleteRole = async (req, res) => {
  try {
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM roles WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    const role = existing.rows[0];
    if (role.is_system_role) {
      return res.status(400).json({ success: false, message: 'System roles cannot be deleted' });
    }

    const usersCount = await pool.query(
      'SELECT COUNT(*)::int AS total FROM users WHERE role = $1 AND active = true',
      [role.name]
    );
    if (usersCount.rows[0]?.total > 0) {
      return res.status(400).json({ success: false, message: 'Role is assigned to active users' });
    }

    await pool.query('DELETE FROM role_permissions WHERE role = $1', [role.name]);
    await pool.query('DELETE FROM roles WHERE id = $1', [id]);

    await logPermissionAudit({
      actorUserId: req.user.user_id,
      targetType: 'role',
      targetId: role.name,
      action: 'role_deleted',
      payload: { id: role.id, name: role.name },
    });

    res.json({ success: true, message: 'Role deleted successfully' });
  } catch (error) {
    console.error('deleteRole error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting role' });
  }
};

exports.getRolePermissions = async (req, res) => {
  try {
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { role } = req.params;
    const roleExists = await pool.query('SELECT name FROM roles WHERE name = $1', [role]);
    if (roleExists.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    const permissions = await listRolePermissions(role);
    const sections = await getPermissionSections();

    res.json({ success: true, role, sections, permissions });
  } catch (error) {
    console.error('getRolePermissions error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching role permissions' });
  }
};

exports.updateRolePermissions = async (req, res) => {
  try {
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { role } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      return res.status(400).json({ success: false, message: 'Permissions must be an array' });
    }

    const roleExists = await pool.query('SELECT name FROM roles WHERE name = $1', [role]);
    if (roleExists.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    const updated = await upsertRolePermissions(role, permissions);

    await logPermissionAudit({
      actorUserId: req.user.user_id,
      targetType: 'role_permissions',
      targetId: role,
      action: 'role_permissions_updated',
      payload: { count: updated.length },
    });

    res.json({ success: true, message: 'Permissions saved', permissions: updated });
  } catch (error) {
    console.error('updateRolePermissions error:', error);
    res.status(500).json({ success: false, message: 'Server error updating role permissions' });
  }
};

/** Legacy shape for existing PermissionsPage tab */
exports.listAllRolePermissionsLegacy = async (req, res) => {
  try {
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const permissions = await listAllRolePermissions();
    res.json(permissions);
  } catch (error) {
    console.error('listAllRolePermissionsLegacy error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching permissions' });
  }
};

exports.patchAllRolePermissionsLegacy = async (req, res) => {
  try {
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const { permissions } = req.body;
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ success: false, message: 'Permissions must be an array' });
    }

    const grouped = permissions.reduce((acc, row) => {
      if (!acc[row.role]) acc[row.role] = [];
      acc[row.role].push(row);
      return acc;
    }, {});

    const results = [];
    for (const [role, rows] of Object.entries(grouped)) {
      const updated = await upsertRolePermissions(role, rows);
      results.push(...updated);
    }

    await logPermissionAudit({
      actorUserId: req.user.user_id,
      targetType: 'role_permissions',
      targetId: 'bulk',
      action: 'role_permissions_bulk_updated',
      payload: { count: results.length },
    });

    res.json({ success: true, message: 'Permissions saved', permissions: results });
  } catch (error) {
    console.error('patchAllRolePermissionsLegacy error:', error);
    res.status(500).json({ success: false, message: 'Server error saving permissions' });
  }
};

exports.getUsersByRole = async (req, res) => {
  try {
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

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

exports.getUserPermissions = async (req, res) => {
  try {
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const userId = parseInt(req.params.userId || req.params.id, 10);
    const payload = await buildUserPermissionsPayload(userId);
    if (!payload) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      user: payload.user,
      role_permissions: payload.role_permissions,
      user_permissions: payload.user_permissions,
      sections: payload.sections,
      effective: payload.effective,
    });
  } catch (error) {
    console.error('getUserPermissions error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching user permissions' });
  }
};

exports.updateUserPermissionsById = async (req, res) => {
  try {
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const userId = parseInt(req.params.userId || req.params.id, 10);
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      return res.status(400).json({ success: false, message: 'Permissions must be an array' });
    }

    const targetResult = await pool.query('SELECT user_id, role, email FROM users WHERE user_id = $1', [userId]);
    if (targetResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updatedPermissions = await upsertUserPermissions(userId, permissions, req.user.user_id);

    await logPermissionAudit({
      actorUserId: req.user.user_id,
      targetType: 'user_permissions',
      targetId: userId,
      action: 'user_permissions_updated',
      payload: { count: updatedPermissions.length },
    });

    res.json({ success: true, message: 'Permissions updated', permissions: updatedPermissions });
  } catch (error) {
    console.error('updateUserPermissionsById error:', error);
    res.status(500).json({ success: false, message: 'Server error updating permissions' });
  }
};

exports.resetUserPermissionsById = async (req, res) => {
  try {
    if (!hasRbacAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const userId = parseInt(req.params.userId || req.params.id, 10);
    const targetResult = await pool.query('SELECT user_id FROM users WHERE user_id = $1', [userId]);
    if (targetResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const removed = await resetUserPermissions(userId);

    await logPermissionAudit({
      actorUserId: req.user.user_id,
      targetType: 'user_permissions',
      targetId: userId,
      action: 'user_permissions_reset',
      payload: { removed: removed.map((r) => r.section) },
    });

    res.json({ success: true, message: 'User permissions reset to role defaults' });
  } catch (error) {
    console.error('resetUserPermissionsById error:', error);
    res.status(500).json({ success: false, message: 'Server error resetting permissions' });
  }
};
