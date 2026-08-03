const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = require('express').Router();
const ctrl = require('../controllers/partRequestController');
const { authMiddleware, checkRole, checkSectionPermission } = require('../middleware/auth');
const { multerLimits, wrapMulter } = require('../config/uploadLimits');

const photoDir = path.join(__dirname, '..', 'uploads', 'part-requests');
fs.mkdirSync(photoDir, { recursive: true });

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: photoDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.jpg';
      cb(null, `battery_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: multerLimits(),
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

router.use(authMiddleware);

router.post('/', checkSectionPermission('parts_requests', 'create'), ctrl.createPartRequest);
router.post(
  '/upload-photos',
  checkSectionPermission('parts_requests', 'create'),
  wrapMulter(photoUpload.array('photos', 8)),
  ctrl.uploadPartRequestPhotos
);
router.get('/', checkSectionPermission('parts_requests', 'view'), ctrl.listPartRequests);

// Specific routes before the generic :requestId matcher
router.get('/warehouse-queue', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.getWarehouseQueue);
router.get('/procurement-queue', checkRole('procurement', 'admin', 'manager', 'super_admin'), ctrl.getProcurementQueue);
router.get('/cost-summary/:ttsplId', checkSectionPermission('ttspl_history', 'view'), ctrl.getPartCostSummary);
router.get('/instances', ctrl.listPartInstances);
router.post('/instances', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.addPartInstances);
router.patch('/instances/:instanceId', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.updatePartInstance);
router.get('/ticket/:ticketId', ctrl.getTicketPartRequests);

router.get('/:requestId', ctrl.getPartRequest);
router.patch('/:requestId/approve', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.approvePartRequest);
router.patch('/:requestId/reject', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.rejectPartRequest);
router.patch('/:requestId/escalate', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.escalateToProcurement);
router.patch('/:requestId/link-spo', checkRole('procurement', 'admin', 'super_admin'), ctrl.linkRequestToSpo);
router.patch('/:requestId/received', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.markPartReceived);
router.post('/:requestId/attach', checkSectionPermission('parts_requests', 'create'), ctrl.attachPartAndReturnOld);
router.post('/:requestId/detach', checkSectionPermission('parts_requests', 'create'), ctrl.detachAttachedPart);
router.patch('/:requestId/cancel', ctrl.cancelPartRequest);

module.exports = router;
