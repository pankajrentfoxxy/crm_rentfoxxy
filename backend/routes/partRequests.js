const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = require('express').Router();
const ctrl = require('../controllers/partRequestController');
const { authMiddleware, checkRole, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
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

const allowPartInstanceWrite = (req, res, next) => {
  if (req.user?.role === 'super_admin') return next();
  if (['warehouse', 'admin', 'manager'].includes(req.user?.role)) return next();
  return checkAnySectionPermission(['parts_inventory', 'parts_approval'], 'edit')(req, res, next);
};

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
router.post('/instances', allowPartInstanceWrite, ctrl.addPartInstances);
router.patch('/instances/:instanceId', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.updatePartInstance);
const allowTtsplPartDetach = (req, res, next) => {
  if (req.user?.role === 'super_admin') return next();
  return checkSectionPermission('parts_detach', 'edit')(req, res, next);
};
router.post('/instances/:instanceId/detach-from-ttspl', allowTtsplPartDetach, ctrl.detachInstalledPartFromTtspl);
router.get('/ticket/:ticketId', ctrl.getTicketPartRequests);

router.get('/:requestId', ctrl.getPartRequest);
router.patch('/:requestId/approve', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.approvePartRequest);
router.patch('/:requestId/reject', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.rejectPartRequest);
router.patch('/:requestId/escalate', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.escalateToProcurement);
router.patch('/:requestId/link-spo', checkRole('procurement', 'admin', 'super_admin'), ctrl.linkRequestToSpo);
router.patch('/:requestId/received', checkRole('warehouse', 'admin', 'manager', 'super_admin'), ctrl.markPartReceived);
router.post('/:requestId/attach', checkSectionPermission('parts_requests', 'create'), ctrl.attachPartAndReturnOld);
const allowPartDetach = (req, res, next) => {
  if (req.body?.return_to_inventory === true) {
    if (req.user?.role === 'super_admin') return next();
    return checkSectionPermission('parts_detach', 'edit')(req, res, next);
  }
  return checkSectionPermission('parts_requests', 'create')(req, res, next);
};
router.post('/:requestId/detach', allowPartDetach, ctrl.detachAttachedPart);
router.patch('/:requestId/cancel', ctrl.cancelPartRequest);

module.exports = router;
