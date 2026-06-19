const router = require('express').Router();
const ctrl = require('../controllers/partRequestController');
const { authMiddleware, checkRole, checkSectionPermission } = require('../middleware/auth');

router.use(authMiddleware);

router.post('/', checkSectionPermission('parts_requests', 'create'), ctrl.createPartRequest);
router.get('/', checkSectionPermission('parts_requests', 'view'), ctrl.listPartRequests);

// Specific routes before the generic :requestId matcher
router.get('/warehouse-queue', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.getWarehouseQueue);
router.get('/procurement-queue', checkRole('procurement', 'admin', 'manager', 'super_admin'), ctrl.getProcurementQueue);
router.get('/cost-summary/:ttsplId', ctrl.getPartCostSummary);
router.get('/instances', ctrl.listPartInstances);
router.get('/ticket/:ticketId', ctrl.getTicketPartRequests);

router.get('/:requestId', ctrl.getPartRequest);
router.patch('/:requestId/approve', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.approvePartRequest);
router.patch('/:requestId/reject', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.rejectPartRequest);
router.patch('/:requestId/escalate', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.escalateToProcurement);
router.patch('/:requestId/link-spo', checkRole('procurement', 'admin', 'super_admin'), ctrl.linkRequestToSpo);
router.patch('/:requestId/received', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.markPartReceived);
router.post('/:requestId/attach', checkSectionPermission('parts_requests', 'create'), ctrl.attachPartAndReturnOld);
router.patch('/:requestId/cancel', ctrl.cancelPartRequest);

module.exports = router;
