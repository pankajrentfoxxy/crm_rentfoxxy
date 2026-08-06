const { hasPermission } = require('../services/permissionService');

/** Partial / line sales-order cancel — dedicated permission assignable per user/role. */
async function checkSalesOrderCancel(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (req.user.role === 'super_admin' || req.user.role === 'admin') {
      return next();
    }
    if (!req.permissionCache) req.permissionCache = {};
    if (await hasPermission(req.user.user_id, req.user.role, 'sales_order_cancel', 'can_edit', req.permissionCache)) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Permission denied — Sales order cancel required' });
  } catch (e) {
    console.error('checkSalesOrderCancel:', e);
    return res.status(500).json({ success: false, message: 'Server error checking permissions' });
  }
}

module.exports = { checkSalesOrderCancel };
