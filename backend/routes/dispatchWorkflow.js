const express = require('express');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/dispatchWorkflowController');

const router = express.Router();
const cp = checkSectionPermission;
const cpAny = checkAnySectionPermission;

router.use(authMiddleware);

router.get('/pending-orders', cp('dispatch_pending_orders', 'view'), ctrl.listPendingOrders);
router.get('/pending-alerts', cp('dispatch_pending_orders', 'view'), ctrl.listPendingAlerts);
router.get('/pending-qc-alerts', ctrl.listPendingQcAlerts);
router.get('/inventory/matching-serials', cp('dispatch_pending_orders', 'view'), ctrl.getMatchingInventory);
router.get('/dashboard', cp('dispatch_workflow', 'view'), ctrl.listDashboard);
router.post(
  '/:salesOrderNumber/snooze-alert',
  cp('dispatch_pending_orders', 'edit'),
  ctrl.snoozeAlert
);
router.post(
  '/:salesOrderNumber/snooze-qc-alert',
  cpAny(['dispatch_pending_orders', 'floor_tickets', 'dispatch_qc', 'floor_pipeline'], 'edit'),
  ctrl.snoozeQcAlert
);
router.get('/:salesOrderNumber', cp('dispatch_workflow', 'view'), ctrl.getWorkflow);
router.post(
  '/:salesOrderNumber/accept',
  cpAny(['dispatch_pending_orders', 'dispatch_workflow'], 'edit'),
  ctrl.acceptWorkflow
);

module.exports = router;
