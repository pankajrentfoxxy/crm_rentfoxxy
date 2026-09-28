/**
 * CT1 companion to roleOrSection for the older hand-written gates that mix a
 * role list with the legacy JWT `permissions[]` strings (routes/sales.js,
 * routes/warehouse.js, routes/procurement.js, …).
 *
 * The legacy check runs first, unchanged, so nobody who passes today loses
 * access. If it fails, the matching Roles & Permissions grant also opens the
 * door (super_admin always passes, as it does in checkSectionPermission).
 *
 *   const requireX = legacyOrSection(
 *     (u) => u.role === 'admin' || u.permissions?.includes('x_access'),
 *     'warehouse', 'edit',
 *     { message: 'Access denied: Warehouse access required' },
 *   );
 */
const { userHasRoleOrSection } = require('./roleOrSection');

function legacyOrSection(legacyAllows, sections, action = 'view', forbiddenBody = { message: 'Access denied' }) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
      if (legacyAllows(user)) return next();
      if (!req.permissionCache) req.permissionCache = {};
      if (await userHasRoleOrSection(user, [], sections, action, req.permissionCache)) return next();
      return res.status(403).json(forbiddenBody);
    } catch (error) {
      console.error('legacyOrSection error:', error);
      return res.status(500).json({ success: false, message: 'Server error checking permissions' });
    }
  };
}

/** True when the JWT's legacy permissions[] carries any of the given strings. */
function hasLegacyPermission(user, ...perms) {
  const list = Array.isArray(user?.permissions) ? user.permissions : [];
  return perms.some((p) => list.includes(p));
}

module.exports = { legacyOrSection, hasLegacyPermission };
