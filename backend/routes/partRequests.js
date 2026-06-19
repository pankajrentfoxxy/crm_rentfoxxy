const router = require('express').Router();
const ctrl = require('../controllers/partRequestController');
const { authMiddleware, checkRole, checkSectionPermission } = require('../middleware/auth');

router.use(authMiddleware);

// Queues + summaries (literal paths must precede the /:requestId param route)
router.get('/warehouse-queue', checkRole('warehouse', 'admin', 'manager'), ctrl.getWarehouseQueue);
router.get('/procurement-queue', checkRole('procurement', 'admin', 'manager'), ctrl.getProcurementQueue);
router.get('/cost-summary/:ttsplId', ctrl.getPartCostSummary);

router.post('/', checkSectionPermission('parts_requests', 'create'), ctrl.createPartRequest);
router.get('/', checkSectionPermission('parts_requests', 'view'), ctrl.listPartRequests);

router.get('/:requestId', ctrl.getPartRequest);
router.patch('/:requestId/approve', checkRole('warehouse', 'admin', 'manager'), ctrl.approvePartRequest);
router.patch('/:requestId/reject', checkRole('warehouse', 'admin', 'manager'), ctrl.rejectPartRequest);
router.patch('/:requestId/escalate', checkRole('warehouse', 'admin', 'manager'), ctrl.escalateToProcurement);
router.patch('/:requestId/link-spo', checkRole('procurement', 'admin'), ctrl.linkRequestToSpo);
router.patch('/:requestId/received', checkRole('warehouse', 'admin', 'manager'), ctrl.markPartReceived);
router.post('/:requestId/attach', checkSectionPermission('parts_requests', 'create'), ctrl.attachPartAndReturnOld);
router.patch('/:requestId/cancel', ctrl.cancelPartRequest);

module.exports = router;
