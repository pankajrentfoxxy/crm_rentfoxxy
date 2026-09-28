const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');

// Part 5.6 (finding R13) — most of this router had auth and no permission, so
// any logged-in user could rewrite a production asset's configuration or record
// a QC2 verification against it.
const PA_SECTIONS = ['pending_inventory', 'floor_tickets', 'floor_pipeline', 'qc_management'];
const paView = checkAnySectionPermission(PA_SECTIONS, 'view');
const paEdit = checkAnySectionPermission(PA_SECTIONS, 'edit');
const ctrl = require('../controllers/productionAssetController');

router.use(authMiddleware);

router.get(
  '/pending-inventory',
  checkSectionPermission('pending_inventory', 'view'),
  ctrl.listPending
);
router.get(
  '/carret-availability',
  checkSectionPermission('pending_inventory', 'view'),
  ctrl.getCarretAvailability
);
router.post('/backfill', checkRole('admin', 'super_admin'), ctrl.backfill);
router.get('/by-ticket/:ticketId', paView, ctrl.getByTicket);
router.get('/:id', paView, ctrl.getById);
router.patch('/:id/config', paEdit, ctrl.updateConfig);
router.post('/:id/qc1-checklist', paEdit, ctrl.saveQc1Checklist);
router.post('/:id/qc2-verify', paEdit, ctrl.verifyQc2);
router.post(
  '/:id/receive',
  checkSectionPermission('pending_inventory', 'edit'),
  ctrl.receive
);

module.exports = router;
