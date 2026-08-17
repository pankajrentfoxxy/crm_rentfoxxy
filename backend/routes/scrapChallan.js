const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { vrdcRoute } = require('../middleware/dcNumberRoutes');
const ctrl = require('../controllers/scrapChallanController');

// Dedicated scrap challans RBAC (+ legacy viewers during rollout).
const viewAny = (req, res, next) => {
  const { hasPermission } = require('../services/permissionService');
  (async () => {
    try {
      const cache = {};
      for (const section of [
        'scrap_challans',
        'parts_discarded',
        'parts_procurement',
        'parts_inventory',
        'part_vendor_repair',
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

router.get('/dc', viewAny, ctrl.listScrapChallans);
router.post('/create', ctrl.requireWarehouse, ctrl.createScrapChallan);

// challan_number may contain slashes (SCRAP/26-27/0001) — reuse VRDC slash-aware helpers
router.post(...vrdcRoute('/dispatch', ctrl.requireWarehouse, ctrl.dispatchScrapChallan));
router.post(...vrdcRoute('/cancel', ctrl.requireWarehouse, ctrl.cancelDraftScrapChallan));
router.get(...vrdcRoute('/pdf', viewAny, ctrl.downloadPdf));
router.get(...vrdcRoute('', viewAny, ctrl.getScrapChallan));

module.exports = router;
