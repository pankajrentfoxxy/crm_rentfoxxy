const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { buildEffectivePermissionsForUser, upsertUserPermissions: upsertUserPermissionsService } = require('../services/permissionService');
const { getDisplayTeams, normalizeTeamIds } = require('../utils/teamUtils');

const MANAGEABLE_ROLES = [
  'team_member', 'team_lead', 'sales', 'floor_manager', 'procurement', 'qc', 'dispatch',
  'manager', 'admin', 'support_lead', 'support_tech', 'accounts', 'warehouse', 'dispatch_qc',
];
const FLOOR_ROLES = ['team_member', 'team_lead', 'floor_manager', 'qc'];
const CRM_EXCLUDED_ROLES = ['vendor', 'customer', 'technician'];
const hasUserMgmtAccess = (user) => ['admin', 'manager', 'super_admin'].includes(user?.role);
const canViewUsers = (user) => ['admin', 'manager', 'super_admin', 'floor_manager'].includes(user?.role);
const canManageTargetUser = (actor, target) => {
  if (!actor || !target) return false;
  if (['super_admin', 'admin'].includes(actor.role)) return true;
  if (actor.role === 'manager') return !['admin', 'manager', 'super_admin'].includes(target.role);
  return false;
};

const generatePassword = (length = 10) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
};

// Register User
exports.register = async (req, res) => {
  const {
    name, email, password, role, team_id, team_ids, mobile_no,
    designation, department, employee_id, joining_date, notes,
  } = req.body;

  try {
    if (!hasUserMgmtAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Only manager/admin can create users' });
    }

    const normalizedRole = String(role || 'team_member').trim().toLowerCase();
    if (!MANAGEABLE_ROLES.includes(normalizedRole)) {
      return res.status(400).json({ success: false, message: 'Invalid role selected' });
    }

    if (req.user.role === 'manager' && ['manager', 'admin', 'super_admin'].includes(normalizedRole)) {
      return res.status(403).json({ success: false, message: 'Manager can only create non-admin users' });
    }

    // For procurement/qc/dispatch roles: auto-set permissions (standalone like Sales, no team)
    let permissions = [];
    let resolvedTeamIds = [];
    if (normalizedRole === 'procurement') {
      permissions = ['procurement_access'];
    } else if (normalizedRole === 'qc' || normalizedRole === 'dispatch_qc') {
      permissions = ['qc_access'];
    } else if (normalizedRole === 'dispatch') {
      permissions = ['dispatch_access'];
    } else if (normalizedRole === 'support_lead') {
      permissions = ['support_access'];
    } else if (normalizedRole === 'support_tech') {
      permissions = ['support_access', 'customer_inventory_access'];
    } else {
      // team_member, team_lead, floor_manager: support multiple teams
      if (Array.isArray(team_ids) && team_ids.length > 0) {
        resolvedTeamIds = await normalizeTeamIds(team_ids);
      } else if (team_id && team_id !== 'null' && team_id !== '') {
        resolvedTeamIds = await normalizeTeamIds([team_id]);
      }
    }
    const primaryTeamId = resolvedTeamIds[0] || null; // First team as primary for backward compat

    // Check if user exists
    const userExists = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const mobileNo = mobile_no ? String(mobile_no).trim() : null;
    const result = await pool.query(
      `INSERT INTO users (
         name, email, password_hash, role, team_id, active, permissions, mobile_no,
         designation, department, employee_id, joining_date, notes, status
       )
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10, $11::date, $12, 'active')
       RETURNING user_id, name, email, role, team_id, mobile_no, designation, department,
         employee_id, joining_date, notes, status, created_at`,
      [
        name, email, password_hash, normalizedRole, primaryTeamId, permissions, mobileNo || null,
        designation || null, department || null, employee_id || null, joining_date || null, notes || null,
      ]
    );

    const user = result.rows[0];

    // Link support/dispatch CRM users to delivery_technicians for DC assignment + My Deliveries
    if (['support_tech', 'support_lead', 'dispatch', 'dispatch_qc'].includes(normalizedRole)) {
      const { ensureLinkedDeliveryTechnician } = require('../services/deliveryTechnicianService');
      ensureLinkedDeliveryTechnician(user.user_id).catch((err) => {
        console.warn('ensureLinkedDeliveryTechnician:', err.message);
      });
    }

    // Insert user_teams for multi-team support
    if (resolvedTeamIds.length > 0) {
      for (const tid of resolvedTeamIds) {
        await pool.query(
          'INSERT INTO user_teams (user_id, team_id) VALUES ($1, $2) ON CONFLICT (user_id, team_id) DO NOTHING',
          [user.user_id, tid]
        );
      }
    }

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: { ...user, team_ids: resolvedTeamIds }
    });
  } catch (error) {
    console.error('Register error:', error);
    if (error.code === '23514') {
      return res.status(400).json({
        success: false,
        message: 'This role is not enabled in the database yet. Redeploy the backend so support user-role migration can run.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

exports.ensureUserSchema = async () => {
  const migrationFiles = ['028_support_user_roles.sql', '029_rbac_system.sql', '040_rbac_roles_module.sql', '041_application_sections.sql'];
  for (const file of migrationFiles) {
    const sqlPath = path.join(__dirname, '../migrations', file);
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
  }
};

const hasRbacUserMgmtAccess = (user) => ['admin', 'super_admin'].includes(user?.role);

const upsertUserPermissionRows = async (userId, permissions, grantedBy) =>
  upsertUserPermissionsService(userId, permissions, grantedBy);

// Helper: get user's team_ids (from user_teams, fallback to team_id)
const getUserTeamIds = async (userId, fallbackTeamId) => {
  try {
    const utRes = await pool.query(
      'SELECT team_id FROM user_teams WHERE user_id = $1 ORDER BY team_id',
      [userId]
    );
    if (utRes.rows.length > 0) {
      return normalizeTeamIds(utRes.rows.map((r) => r.team_id));
    }
  } catch (e) {
    // user_teams table may not exist before migration
  }
  return fallbackTeamId != null ? normalizeTeamIds([fallbackTeamId]) : [];
};

const getUserTeamNames = async (userId, fallbackTeamId) => {
  const teamIds = await getUserTeamIds(userId, fallbackTeamId);
  if (!teamIds.length) return [];
  const res = await pool.query(
    'SELECT team_name FROM teams WHERE team_id = ANY($1::int[]) ORDER BY team_name',
    [teamIds]
  );
  return res.rows.map((r) => r.team_name);
};

// Login User
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT u.*, t.team_name 
       FROM users u 
       LEFT JOIN teams t ON u.team_id = t.team_id 
       WHERE u.email = $1 AND u.active = true`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (user.status === 'pending_approval') {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending approval from admin'
      });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({
        success: false,
        message: user.rejection_reason || 'Your registration was rejected'
      });
    }
    if (user.status === 'blocked') {
      return res.status(403).json({ success: false, message: 'Your account has been blocked' });
    }

    const teamIds = await getUserTeamIds(user.user_id, user.team_id);
    const teamNames = await getUserTeamNames(user.user_id, user.team_id);

    try {
      await pool.query(
        'UPDATE users SET last_login = NOW(), last_login_ip = $1 WHERE user_id = $2',
        [req.ip || req.headers['x-forwarded-for'] || null, user.user_id]
      );
    } catch (e) {
      // non-fatal if columns missing before migration
    }

    const token = jwt.sign(
      {
        user_id: user.user_id,
        email: user.email,
        role: user.role,
        status: user.status || 'active',
        user_type: user.user_type || 'internal',
        team_id: user.team_id,
        team_ids: teamIds,
        team_names: teamNames,
        permissions: user.permissions || []
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    delete user.password_hash;
    user.permissions = Array.isArray(user.permissions) ? user.permissions : [];
    user.team_ids = teamIds;
    user.team_names = teamNames;
    user.effective_permissions = await buildEffectivePermissionsForUser(user.user_id, user.role);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// Get Current User
exports.getCurrentUser = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.user_id, u.name, u.email, u.mobile_no, u.role, u.team_id, u.active, u.created_at, u.permissions, t.team_name
       FROM users u
       LEFT JOIN teams t ON u.team_id = t.team_id
       WHERE u.user_id = $1`,
      [req.user.user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.rows[0];
    user.permissions = Array.isArray(user.permissions) ? user.permissions : [];
    user.team_ids = req.user.team_ids || await getUserTeamIds(user.user_id, user.team_id);
    user.team_names = req.user.team_names || await getUserTeamNames(user.user_id, user.team_id);
    user.effective_permissions = await buildEffectivePermissionsForUser(user.user_id, user.role);
    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Login with Barcode
exports.loginBarcode = async (req, res) => {
  const { barcode } = req.body;

  if (!barcode) return res.status(400).json({ success: false, message: 'Barcode is required' });

  try {
    const result = await pool.query(
      `SELECT u.*, t.team_name 
       FROM users u 
       LEFT JOIN teams t ON u.team_id = t.team_id 
       WHERE u.barcode = $1 AND u.active = true`,
      [barcode]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid barcode or inactive user' });
    }

    const user = result.rows[0];
    const teamIds = await getUserTeamIds(user.user_id, user.team_id);
    const teamNames = await getUserTeamNames(user.user_id, user.team_id);

    const token = jwt.sign(
      {
        user_id: user.user_id,
        email: user.email,
        role: user.role,
        team_id: user.team_id,
        team_ids: teamIds,
        team_names: teamNames,
        permissions: user.permissions || []
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    delete user.password_hash;
    user.team_ids = teamIds;
    user.team_names = teamNames;

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user
    });
  } catch (error) {
    console.error('Barcode login error:', error);
    res.status(500).json({ success: false, message: 'Server error during barcode login' });
  }
};

// Update Mobile (Admin/Manager)
exports.updateMobile = async (req, res) => {
  const { id } = req.params;
  const { mobile_no } = req.body;

  try {
    if (!hasUserMgmtAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Only manager/admin can update mobile' });
    }

    const targetResult = await pool.query(
      `SELECT user_id, role, email FROM users WHERE user_id = $1`,
      [id]
    );
    if (targetResult.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

    const target = targetResult.rows[0];
    if (!canManageTargetUser(req.user, target)) {
      return res.status(403).json({ success: false, message: 'You cannot modify this user' });
    }

    const mobileNo = mobile_no ? String(mobile_no).trim() : null;
    const result = await pool.query(
      `UPDATE users SET mobile_no = $1 WHERE user_id = $2 RETURNING user_id, name, mobile_no`,
      [mobileNo, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, message: 'Mobile updated', user: result.rows[0] });
  } catch (error) {
    console.error('Update mobile error:', error);
    res.status(500).json({ success: false, message: 'Server error updating mobile' });
  }
};

// Update Barcode (Admin/Manager)
exports.updateBarcode = async (req, res) => {
  const { id } = req.params;
  const { barcode } = req.body;

  try {
    if (!hasUserMgmtAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Only manager/admin can update barcode' });
    }

    const targetResult = await pool.query(
      `SELECT user_id, role, email FROM users WHERE user_id = $1`,
      [id]
    );
    if (targetResult.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

    const target = targetResult.rows[0];
    if (!canManageTargetUser(req.user, target)) {
      return res.status(403).json({ success: false, message: 'You cannot modify this user' });
    }

    const result = await pool.query(
      `UPDATE users SET barcode = $1 WHERE user_id = $2 RETURNING user_id, name, barcode`,
      [barcode, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, message: 'Barcode updated', user: result.rows[0] });
  } catch (error) {
    console.error('Update barcode error:', error);
    if (error.code === '23505') { // Unique constraint
      return res.status(400).json({ success: false, message: 'Barcode already in use' });
    }
    res.status(500).json({ success: false, message: 'Server error updating barcode' });
  }
};

exports.getTeams = async (req, res) => {
  try {
    const teams = await getDisplayTeams();
    res.json({ success: true, teams });
  } catch (error) {
    console.error('getTeams error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching teams' });
  }
};

// Get All Users (for Managers/Admins to assign tasks)
exports.getAllUsers = async (req, res) => {
  try {
    if (!canViewUsers(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
    const offset = (page - 1) * limit;
    const roleFilter = String(req.query.role || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || '').trim().toLowerCase();
    const departmentFilter = String(req.query.department || '').trim();
    const search = String(req.query.search || '').trim();
    const includeInactive = req.query.include_inactive === 'true'
      && ['admin', 'super_admin'].includes(req.user.role);

    const conditions = [`u.role NOT IN ('vendor', 'customer')`];
    const params = [];

    if (!includeInactive) {
      conditions.push(`(u.active = true OR COALESCE(u.status, 'active') = 'active')`);
    }

    if (roleFilter) {
      params.push(roleFilter);
      conditions.push(`u.role = $${params.length}`);
    }

    if (statusFilter) {
      params.push(statusFilter);
      conditions.push(`COALESCE(u.status, CASE WHEN u.active THEN 'active' ELSE 'inactive' END) = $${params.length}`);
    }

    if (departmentFilter) {
      params.push(departmentFilter);
      conditions.push(`u.department = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const statsResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE COALESCE(u.status, 'active') = 'active' AND u.active = true)::int AS active,
         COUNT(*) FILTER (WHERE COALESCE(u.status, 'active') = 'inactive' OR u.active = false)::int AS inactive,
         COUNT(*) FILTER (WHERE COALESCE(u.status, 'active') = 'pending_approval')::int AS pending_approval,
         COUNT(*) FILTER (WHERE COALESCE(u.status, 'active') = 'blocked')::int AS blocked
       FROM users u
       WHERE u.role NOT IN ('vendor', 'customer')`
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users u ${whereClause}`,
      params
    );

    const listParams = [...params, limit, offset];
    const result = await pool.query(
      `SELECT u.user_id, u.name, u.email, u.mobile_no, u.role, u.team_id, u.barcode, u.permissions,
              u.active, COALESCE(u.status, CASE WHEN u.active THEN 'active' ELSE 'inactive' END) AS status,
              u.designation, u.department, u.employee_id, u.joining_date, u.notes,
              u.last_login, u.created_at, u.deactivated_at, u.deactivation_reason,
              t.team_name
       FROM users u
       LEFT JOIN teams t ON u.team_id = t.team_id
       ${whereClause}
       ORDER BY u.name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams
    );

    for (const u of result.rows) {
      try {
        const utRes = await pool.query(
          'SELECT team_id FROM user_teams WHERE user_id = $1 ORDER BY team_id',
          [u.user_id]
        );
        u.team_ids = utRes.rows.length > 0
          ? await normalizeTeamIds(utRes.rows.map((r) => r.team_id))
          : (u.team_id != null ? await normalizeTeamIds([u.team_id]) : []);
      } catch (e) {
        u.team_ids = u.team_id != null ? [u.team_id] : [];
      }
    }

    const total = countResult.rows[0]?.total || 0;
    res.json({
      success: true,
      users: result.rows,
      stats: statsResult.rows[0] || {},
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching users' });
  }
};

exports.updateUser = async (req, res) => {
  const { id } = req.params;

  try {
    if (!hasUserMgmtAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const target = await pool.query('SELECT * FROM users WHERE user_id = $1', [id]);
    if (!target.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (!canManageTargetUser(req.user, target.rows[0])) {
      return res.status(403).json({ success: false, message: 'Cannot edit this user' });
    }

    const {
      name, email, mobile_no, role, team_id, team_ids,
      designation, department, employee_id, joining_date, notes,
    } = req.body;

    if (role) {
      const normalizedRole = String(role).trim().toLowerCase();
      if (!MANAGEABLE_ROLES.includes(normalizedRole)) {
        return res.status(400).json({ success: false, message: 'Invalid role' });
      }
      if (req.user.role === 'manager' && ['manager', 'admin', 'super_admin'].includes(normalizedRole)) {
        return res.status(403).json({ success: false, message: 'Cannot assign admin/manager role' });
      }
    }

    await pool.query(
      `UPDATE users SET
         name = COALESCE($1, name),
         email = COALESCE($2, email),
         mobile_no = COALESCE($3, mobile_no),
         role = COALESCE($4, role),
         team_id = COALESCE($5::int, team_id),
         designation = COALESCE($6, designation),
         department = COALESCE($7, department),
         employee_id = COALESCE($8, employee_id),
         joining_date = COALESCE($9::date, joining_date),
         notes = COALESCE($10, notes),
         updated_at = NOW()
       WHERE user_id = $11`,
      [
        name || null, email || null, mobile_no != null ? String(mobile_no).trim() : null,
        role ? String(role).trim().toLowerCase() : null,
        team_id != null ? team_id : null,
        designation || null, department || null, employee_id || null,
        joining_date || null, notes || null, id,
      ]
    );

    const effectiveRole = role
      ? String(role).trim().toLowerCase()
      : target.rows[0].role;

    if (Array.isArray(team_ids) && FLOOR_ROLES.includes(effectiveRole)) {
      const validTeamIds = await normalizeTeamIds(team_ids);
      await pool.query('DELETE FROM user_teams WHERE user_id = $1', [id]);
      for (const tid of validTeamIds) {
        await pool.query(
          'INSERT INTO user_teams (user_id, team_id) VALUES ($1, $2) ON CONFLICT (user_id, team_id) DO NOTHING',
          [id, tid]
        );
      }
      const primaryTeamId = validTeamIds[0] || null;
      await pool.query('UPDATE users SET team_id = $1 WHERE user_id = $2', [primaryTeamId, id]);
    } else if (role && !FLOOR_ROLES.includes(effectiveRole)) {
      await pool.query('DELETE FROM user_teams WHERE user_id = $1', [id]);
      await pool.query('UPDATE users SET team_id = NULL WHERE user_id = $1', [id]);
    }

    const updated = await pool.query(
      `SELECT u.user_id, u.name, u.email, u.mobile_no, u.role, u.team_id, u.designation, u.department,
              u.employee_id, u.joining_date, u.notes, u.status, u.active, t.team_name
       FROM users u LEFT JOIN teams t ON u.team_id = t.team_id WHERE u.user_id = $1`,
      [id]
    );

    res.json({ success: true, message: 'User updated', user: updated.rows[0] });
  } catch (error) {
    console.error('Update user error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }
    res.status(500).json({ success: false, message: 'Server error updating user' });
  }
};

exports.updateUserStatus = async (req, res) => {
  const { status, reason } = req.body;
  const VALID = ['active', 'inactive', 'blocked'];

  try {
    if (!hasUserMgmtAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (!VALID.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const target = await pool.query('SELECT * FROM users WHERE user_id = $1', [req.params.id]);
    if (!target.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (!canManageTargetUser(req.user, target.rows[0])) {
      return res.status(403).json({ success: false, message: 'Cannot modify this user' });
    }
    if (req.user.role === 'manager' && status === 'blocked') {
      return res.status(403).json({ success: false, message: 'Only admin can block users' });
    }
    if (parseInt(target.rows[0].user_id, 10) === parseInt(req.user.user_id, 10)) {
      return res.status(400).json({ success: false, message: 'You cannot change your own status' });
    }

    const userId = parseInt(req.params.id, 10);
    const actorId = parseInt(req.user.user_id, 10);
    const isActive = status === 'active';

    await pool.query(
      `UPDATE users SET
         status = $1,
         active = $2,
         deactivated_at = $3,
         deactivated_by = $4,
         deactivation_reason = $5,
         updated_at = NOW()
       WHERE user_id = $6`,
      [
        status,
        isActive,
        isActive ? null : new Date(),
        isActive ? null : actorId,
        isActive ? null : (reason || null),
        userId,
      ]
    );

    res.json({ success: true, status });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ success: false, message: 'Server error updating status' });
  }
};

exports.resetUserPassword = async (req, res) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const target = await pool.query('SELECT user_id, role FROM users WHERE user_id = $1', [req.params.id]);
    if (!target.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (CRM_EXCLUDED_ROLES.includes(target.rows[0].role)) {
      return res.status(400).json({ success: false, message: 'Cannot reset password for portal users' });
    }

    const { new_password } = req.body;
    const plain = new_password || generatePassword();
    const hash = await bcrypt.hash(plain, 10);

    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2',
      [hash, req.params.id]
    );

    res.json({
      success: true,
      new_password: plain,
      message: 'Password reset. Share the new password with the user.',
    });
  } catch (error) {
    console.error('Reset user password error:', error);
    res.status(500).json({ success: false, message: 'Server error resetting password' });
  }
};

// Update User Teams (Admin/Manager) - multi-team assignment for team_member/team_lead
exports.updateUserTeams = async (req, res) => {
  const { id } = req.params;
  const { team_ids } = req.body;

  if (!Array.isArray(team_ids)) {
    return res.status(400).json({ success: false, message: 'team_ids must be an array' });
  }

  try {
    if (!hasUserMgmtAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const targetResult = await pool.query(
      'SELECT user_id, role FROM users WHERE user_id = $1',
      [id]
    );
    if (targetResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const target = targetResult.rows[0];
    if (!canManageTargetUser(req.user, target)) {
      return res.status(403).json({ success: false, message: 'You cannot modify this user' });
    }

    const validTeamIds = await normalizeTeamIds(team_ids);

    await pool.query('DELETE FROM user_teams WHERE user_id = $1', [id]);
    for (const tid of validTeamIds) {
      await pool.query(
        'INSERT INTO user_teams (user_id, team_id) VALUES ($1, $2) ON CONFLICT (user_id, team_id) DO NOTHING',
        [id, tid]
      );
    }

    const primaryTeamId = validTeamIds[0] || null;
    await pool.query('UPDATE users SET team_id = $1 WHERE user_id = $2', [primaryTeamId, id]);

    res.json({
      success: true,
      message: 'Team assignments updated',
      team_ids: validTeamIds
    });
  } catch (error) {
    console.error('Update user teams error:', error);
    res.status(500).json({ success: false, message: 'Server error updating teams' });
  }
};

// Update User Permissions (Admin/Super Admin) — RBAC per-section overrides
exports.updateUserPermissions = async (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body;

  if (!Array.isArray(permissions)) {
    return res.status(400).json({ success: false, message: 'Permissions must be an array' });
  }

  try {
    if (!hasRbacUserMgmtAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const targetResult = await pool.query(
      `SELECT user_id, role, email FROM users WHERE user_id = $1`,
      [id]
    );
    if (targetResult.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
    const target = targetResult.rows[0];

    if (req.user.role !== 'super_admin' && !canManageTargetUser(req.user, target)) {
      return res.status(403).json({ success: false, message: 'You cannot update access for this user' });
    }

    const updatedPermissions = await upsertUserPermissionRows(
      parseInt(id, 10),
      permissions,
      req.user.user_id
    );

    res.json({ success: true, message: 'Permissions updated', permissions: updatedPermissions });
  } catch (error) {
    console.error('Update permissions error:', error);
    res.status(500).json({ success: false, message: 'Server error updating permissions' });
  }
};

// Register Customer (public)
exports.registerCustomer = async (req, res) => {
  const { name, email, password, mobile_no } = req.body;

  try {
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
    }

    const userExists = await pool.query('SELECT user_id FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const mobileNo = mobile_no ? String(mobile_no).trim() : null;

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, user_type, status, active, mobile_no)
       VALUES ($1, $2, $3, 'customer', 'customer', 'active', true, $4)
       RETURNING user_id, name, email, role, user_type, status, mobile_no, created_at`,
      [name, email, password_hash, mobileNo]
    );

    res.status(201).json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Register customer error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
};

// Register Vendor (public, pending approval)
exports.registerVendor = async (req, res) => {
  const { name, email, password, mobile_no, company_name, gst_number } = req.body;

  try {
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
    }

    const userExists = await pool.query('SELECT user_id FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const mobileNo = mobile_no ? String(mobile_no).trim() : null;

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, user_type, status, active, mobile_no, company_name, gst_number)
       VALUES ($1, $2, $3, 'vendor', 'vendor', 'pending_approval', true, $4, $5, $6)
       RETURNING user_id, name, email, role, user_type, status, mobile_no, company_name, gst_number, created_at`,
      [
        name,
        email,
        password_hash,
        mobileNo,
        company_name ? String(company_name).trim() : null,
        gst_number ? String(gst_number).trim() : null,
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Registration submitted. Awaiting admin approval.',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Register vendor error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
};

// Register Technician (admin/super_admin only)
exports.registerTechnician = async (req, res) => {
  const { name, email, password, mobile_no, permissions } = req.body;

  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
    }

    const userExists = await pool.query('SELECT user_id FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const mobileNo = mobile_no ? String(mobile_no).trim() : null;

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, user_type, status, active, mobile_no)
       VALUES ($1, $2, $3, 'technician', 'technician', 'active', true, $4)
       RETURNING user_id, name, email, role, user_type, status, mobile_no, created_at`,
      [name, email, password_hash, mobileNo]
    );

    const user = result.rows[0];

    if (Array.isArray(permissions) && permissions.length > 0) {
      await upsertUserPermissionRows(user.user_id, permissions, req.user.user_id);
    }

    res.status(201).json({ success: true, user });
  } catch (error) {
    console.error('Register technician error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
};

// Approve or reject vendor (super_admin only)
exports.approveVendor = async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body;

  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: "action must be 'approve' or 'reject'" });
    }

    const vendorResult = await pool.query(
      `SELECT user_id, role, status FROM users WHERE user_id = $1`,
      [id]
    );
    if (vendorResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (vendorResult.rows[0].role !== 'vendor') {
      return res.status(400).json({ success: false, message: 'User is not a vendor' });
    }

    if (action === 'approve') {
      await pool.query(
        `UPDATE users
         SET status = 'active', approved_by = $1, approved_at = NOW(), rejection_reason = NULL
         WHERE user_id = $2`,
        [req.user.user_id, id]
      );
      return res.json({ success: true, message: 'Vendor approved successfully' });
    }

    await pool.query(
      `UPDATE users
       SET status = 'rejected', rejection_reason = $1, approved_by = NULL, approved_at = NULL
       WHERE user_id = $2`,
      [reason || null, id]
    );
    return res.json({ success: true, message: 'Vendor registration rejected' });
  } catch (error) {
    console.error('Approve vendor error:', error);
    res.status(500).json({ success: false, message: 'Server error processing vendor approval' });
  }
};

// List pending vendor registrations (admin/super_admin)
exports.getPendingVendors = async (req, res) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT user_id, name, email, company_name, gst_number, mobile_no, created_at
       FROM users
       WHERE role = 'vendor' AND status = 'pending_approval'
       ORDER BY created_at ASC`
    );

    res.json({ success: true, vendors: result.rows });
  } catch (error) {
    console.error('Get pending vendors error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching pending vendors' });
  }
};

// Soft Delete User (manager/admin with hierarchy checks)
exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    if (!hasUserMgmtAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const targetResult = await pool.query(
      `SELECT user_id, role, email, active FROM users WHERE user_id = $1`,
      [id]
    );
    if (targetResult.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
    const target = targetResult.rows[0];

    if (parseInt(target.user_id, 10) === parseInt(req.user.user_id, 10)) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
    }
    if (!canManageTargetUser(req.user, target)) {
      return res.status(403).json({ success: false, message: 'You cannot delete this user' });
    }

    await pool.query('DELETE FROM user_teams WHERE user_id = $1', [id]);
    await pool.query(
      `UPDATE users
       SET active = false,
           permissions = ARRAY[]::text[],
           team_id = NULL
       WHERE user_id = $1`,
      [id]
    );

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting user' });
  }
};
