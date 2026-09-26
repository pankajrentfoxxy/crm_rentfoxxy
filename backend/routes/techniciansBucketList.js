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
    // technician_bucket is a technician's OWN work; it opens this all-technicians
    // list only for supervising roles (support lead, dispatch). A field technician
    // seeing every colleague's bucket is what migration 257 closed
    // (claude/carret-support.md safety fixes).
    const FIELD_ROLES = new Set(['support_tech', 'technician', 'delivery']);
    const sections = FIELD_ROLES.has(String(req.user.role || '').toLowerCase())
      ? ['technicians_bucket_list']
      : ['technicians_bucket_list', 'technician_bucket'];
    for (const section of sections) {
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
