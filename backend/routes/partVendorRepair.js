const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { vrdcRoute } = require('../middleware/dcNumberRoutes');
const ctrl = require('../controllers/partVendorRepairController');

// Dedicated section; also allow parts/procurement/inventory viewers for continuity.
const viewAny = (req, res, next) => {
  const { hasPermission } = require('../services/permissionService');
  (async () => {
    try {
      const cache = {};
      for (const section of [
        'part_vendor_repair',
        'parts_procurement',
        'parts_inventory',
        'inventory_management',
      ]) {
        // eslint-disable-next-line no-await-in-loop
        if (await hasPermission(req.user.user_id, req.user.role, section, 'can_view', cache)) {
          return next();
        }
      }
      return res.status(403).json({ success: false, message: 'Permission denied' });
    } catch (e) {
      return res.status(500).json({ success: false, message: e.message });
    }
  })();
};

router.use(authMiddleware);

router.get('/dc', viewAny, ctrl.listPartVendorReturns);
router.post('/return', ctrl.requireWarehouse, ctrl.createPartVendorReturn);
router.get('/qc-pending', viewAny, ctrl.listQcPending);
router.post('/qc-pending/:instanceId/pass', ctrl.requireWarehouse, ctrl.passQc);
router.post('/qc-pending/:instanceId/fail', ctrl.requireWarehouse, ctrl.failQc);

router.post(...vrdcRoute('/dispatch-sign', ctrl.requireWarehouse, ctrl.dispatchPartVendorReturn));
router.post(...vrdcRoute('/receive-back', ctrl.requireWarehouse, ctrl.receivePartsFromVendor));
router.get(...vrdcRoute('/pdf', viewAny, ctrl.downloadPdf));
router.get(...vrdcRoute('', viewAny, ctrl.getPartVendorReturnDc));

module.exports = router;
