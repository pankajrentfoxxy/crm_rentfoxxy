/**
 * Role OR section access (decision CT1, 27 Sep 2026).
 *
 * Every hardcoded role gate keeps its role list and ALSO accepts the matching
 * grant in the Roles & Permissions matrix, so the matrix controls access and
 * nobody who has access today loses it. The role lists are removed after
 * sign-off; until then both paths open the door.
 *
 *   router.post('/x', roleOrSection(['admin', 'warehouse'], 'warehouse', 'edit'), handler)
 *   if (!(await userHasRoleOrSection(req.user, ROLES, 'return_dc', 'edit', req.permissionCache))) ...
 *
 * `sections` may be one section or an array (any one grant is enough).
 * super_admin always passes, as it does everywhere else.
 */
const { hasPermission } = require('../services/permissionService');

function toList(value) {
  if (value == null) return [];
  if (value instanceof Set) return [...value];
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

async function userHasRoleOrSection(user, roles, sections, action = 'view', cache) {
  if (!user) return false;
  const role = user.role;
  if (role === 'super_admin') return true;
  if (toList(roles).includes(role)) return true;
  const userId = user.user_id ?? user.userId;
  if (!userId) return false;
  for (const section of toList(sections)) {
    // eslint-disable-next-line no-await-in-loop
    if (await hasPermission(userId, role, section, action, cache)) return true;
  }
  return false;
}

function roleOrSection(roles, sections, action = 'view') {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      if (!req.permissionCache) req.permissionCache = {};
      if (await userHasRoleOrSection(req.user, roles, sections, action, req.permissionCache)) {
        return next();
      }
      return res.status(403).json({
        success: false,
        message: 'Access forbidden: insufficient permissions',
      });
    } catch (error) {
      console.error('roleOrSection error:', error);
      return res.status(500).json({ success: false, message: 'Server error checking permissions' });
    }
  };
}

module.exports = { roleOrSection, userHasRoleOrSection };
