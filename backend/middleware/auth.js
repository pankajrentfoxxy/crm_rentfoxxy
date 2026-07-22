const jwt = require('jsonwebtoken');

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authentication token, access denied'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Token is not valid'
    });
  }
};

const checkRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    if (req.user.role === 'super_admin') {
      return next();
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access forbidden: insufficient permissions'
      });
    }

    next();
  };
};

// Allow if user has any of the roles OR any of the permissions
const checkRoleOrPermission = (roles = [], permissions = []) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (req.user.role === 'super_admin') return next();
    const hasRole = roles.length === 0 || roles.includes(req.user.role);
    const userPerms = req.user.permissions || [];
    const hasPermission = permissions.length === 0 || permissions.some(p => userPerms.includes(p));
    if (hasRole || hasPermission) return next();
    return res.status(403).json({ success: false, message: 'Access forbidden' });
  };
};

// Check Granular Permission or Role
const checkPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (req.user.role === 'super_admin') return next();

    const userPermissions = req.user.permissions || [];

    if (userPermissions.includes(permission)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Access denied: Requires '${permission}' permission`
    });
  };
};

// DB-backed permission check — the role_permissions matrix is the source of
// truth, with per-user overrides from user_permissions. Delegates to the
// canonical section-permission middleware (caching + status-aware) so there is
// a single implementation across the codebase.
// action: 'view' | 'create' | 'edit' | 'delete'
const checkSectionPermission = (section, action = 'view') => {
  const { checkPermission: sectionCheck } = require('./checkPermission');
  return sectionCheck(section, action);
};

const checkAnySectionPermission = (sections, action = 'view') => {
  const { checkAnySectionPermission: anyCheck } = require('./checkPermission');
  return anyCheck(sections, action);
};

module.exports = {
  authMiddleware,
  checkRole,
  checkPermission,
  checkRoleOrPermission,
  checkSectionPermission,
  checkAnySectionPermission,
};
