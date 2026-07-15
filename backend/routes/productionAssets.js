const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middleware/auth');
const ctrl = require('../controllers/productionAssetController');

router.use(authMiddleware);

// Inventory/Admin receive only
const canReceive = checkRole('admin', 'super_admin', 'manager', 'warehouse');

router.get('/pending-inventory', ctrl.listPending);
router.post('/backfill', checkRole('admin', 'super_admin'), ctrl.backfill);
router.get('/by-ticket/:ticketId', ctrl.getByTicket);
router.get('/:id', ctrl.getById);
router.patch('/:id/config', ctrl.updateConfig);
router.post('/:id/qc1-checklist', ctrl.saveQc1Checklist);
router.post('/:id/qc2-verify', ctrl.verifyQc2);
router.post('/:id/receive', canReceive, ctrl.receive);

module.exports = router;
