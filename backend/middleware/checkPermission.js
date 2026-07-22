const { hasPermission, normalizeAction } = require('../services/permissionService');

const VALID_ACTIONS = new Set(['can_view', 'can_create', 'can_edit', 'can_delete']);

const STATUS_MESSAGES = {
  pending_approval: 'Your account is pending approval',
  rejected: 'Your registration was rejected',
  blocked: 'Your account has been blocked',
};

const checkPermission = (section, action) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      if (req.user.role === 'super_admin') {
        return next();
      }

      if (req.user.status && req.user.status !== 'active') {
        return res.status(403).json({
          success: false,
          message: STATUS_MESSAGES[req.user.status] || 'Account is not active',
        });
      }

      const normalizedAction = normalizeAction(action);
      if (!normalizedAction || !VALID_ACTIONS.has(normalizedAction)) {
        return res.status(500).json({ success: false, message: 'Invalid permission action' });
      }

      if (!req.permissionCache) {
        req.permissionCache = {};
      }

      const cacheKey = `${section}:${normalizedAction}`;
      if (Object.prototype.hasOwnProperty.call(req.permissionCache, cacheKey)) {
        if (req.permissionCache[cacheKey]) {
          return next();
        }
        return res.status(403).json({ success: false, message: 'Permission denied' });
      }

      const allowed = await hasPermission(
        req.user.user_id,
        req.user.role,
        section,
        normalizedAction,
        req.permissionCache
      );

      req.permissionCache[cacheKey] = allowed;
      if (allowed) return next();

      return res.status(403).json({ success: false, message: 'Permission denied' });
    } catch (error) {
      console.error('checkPermission error:', error);
      return res.status(500).json({ success: false, message: 'Server error checking permissions' });
    }
  };
};

/** Allow if the user has the requested action on ANY of the given sections. */
const checkAnySectionPermission = (sections, action = 'view') => {
  const sectionList = Array.isArray(sections) ? sections.filter(Boolean) : [];
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      if (req.user.role === 'super_admin') {
        return next();
      }

      if (req.user.status && req.user.status !== 'active') {
        return res.status(403).json({
          success: false,
          message: STATUS_MESSAGES[req.user.status] || 'Account is not active',
        });
      }

      const normalizedAction = normalizeAction(action);
      if (!normalizedAction || !VALID_ACTIONS.has(normalizedAction)) {
        return res.status(500).json({ success: false, message: 'Invalid permission action' });
      }

      if (!sectionList.length) {
        return res.status(500).json({ success: false, message: 'Invalid permission sections' });
      }

      if (!req.permissionCache) {
        req.permissionCache = {};
      }

      for (const section of sectionList) {
        const cacheKey = `${section}:${normalizedAction}`;
        let allowed;
        if (Object.prototype.hasOwnProperty.call(req.permissionCache, cacheKey)) {
          allowed = req.permissionCache[cacheKey];
        } else {
          allowed = await hasPermission(
            req.user.user_id,
            req.user.role,
            section,
            normalizedAction,
            req.permissionCache
          );
          req.permissionCache[cacheKey] = allowed;
        }
        if (allowed) return next();
      }

      return res.status(403).json({ success: false, message: 'Permission denied' });
    } catch (error) {
      console.error('checkAnySectionPermission error:', error);
      return res.status(500).json({ success: false, message: 'Server error checking permissions' });
    }
  };
};

module.exports = { checkPermission, checkAnySectionPermission, hasPermission };
