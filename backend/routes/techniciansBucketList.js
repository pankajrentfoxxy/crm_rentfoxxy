const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { hasPermission } = require('../services/permissionService');
const ctrl = require('../controllers/techniciansBucketController');

const router = express.Router();

router.use(authMiddleware);

// Admin bucket list: technicians_bucket_list (ERP parity). Also allow technician_bucket for legacy roles.
router.use(async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (req.user.role === 'super_admin') return next();

    req.permissionCache = req.permissionCache || {};
    for (const section of ['technicians_bucket_list', 'technician_bucket']) {
      const allowed = await hasPermission(
        req.user.user_id,
        req.user.role,
        section,
        'can_view',
        req.permissionCache
      );
      if (allowed) return next();
    }
    return res.status(403).json({ success: false, message: 'Permission denied' });
  } catch (e) {
    console.error('techniciansBucketList permission', e);
    return res.status(500).json({ success: false, message: 'Server error checking permissions' });
  }
});

router.get('/meta', ctrl.getMeta);
router.get('/details', ctrl.fetchDetails);

module.exports = router;
