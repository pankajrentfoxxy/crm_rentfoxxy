const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/productionAssetController');

router.use(authMiddleware);

router.get(
  '/pending-inventory',
  checkSectionPermission('pending_inventory', 'view'),
  ctrl.listPending
);
router.post('/backfill', checkRole('admin', 'super_admin'), ctrl.backfill);
router.get('/by-ticket/:ticketId', ctrl.getByTicket);
router.get('/:id', ctrl.getById);
router.patch('/:id/config', ctrl.updateConfig);
router.post('/:id/qc1-checklist', ctrl.saveQc1Checklist);
router.post('/:id/qc2-verify', ctrl.verifyQc2);
router.post(
  '/:id/receive',
  checkSectionPermission('pending_inventory', 'edit'),
  ctrl.receive
);

module.exports = router;
