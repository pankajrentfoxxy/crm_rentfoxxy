const { hasPermission } = require('../services/permissionService');

/** SO line rate/config edit: admin, legacy grant, or replacement SO permissions. */
async function checkSoLineRateConfigEdit(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (req.user.role === 'super_admin' || req.user.role === 'admin') {
      return next();
    }
    if ((req.user.permissions || []).includes('so_line_rate_config_edit')) {
      return next();
    }
    if (!req.permissionCache) req.permissionCache = {};
    for (const section of [
      'sales_orders_replacement',
      'replacement_so_laptop_qc',
      'so_laptop_qc',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      if (await hasPermission(req.user.user_id, req.user.role, section, 'can_edit', req.permissionCache)) {
        return next();
      }
    }
    return res.status(403).json({ success: false, message: 'Permission denied' });
  } catch (e) {
    console.error('checkSoLineRateConfigEdit:', e);
    return res.status(500).json({ success: false, message: 'Server error checking permissions' });
  }
}

module.exports = { checkSoLineRateConfigEdit };
