const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = require('express').Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const { multerLimits, wrapMulter } = require('../config/uploadLimits');
const { prefixedDcRoute } = require('../middleware/dcNumberRoutes');
const ctrl = require('../controllers/physicalDeadPartController');

const photoDir = path.join(__dirname, '..', 'uploads', 'physical-parts');
fs.mkdirSync(photoDir, { recursive: true });

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: photoDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.jpg';
      cb(null, `pp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
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

const view = checkSectionPermission('physical_dead_parts', 'view');
const create = checkSectionPermission('physical_dead_parts', 'create');

router.get('/counts', view, ctrl.getCounts);
router.post('/photos', create, wrapMulter(photoUpload.array('photos', 20)), ctrl.uploadPhotos);
router.post('/inward', create, ctrl.createInward);
router.post('/outward', create, ctrl.createOutward);

router.get('/inwards', view, ctrl.listInwards);
router.get(...prefixedDcRoute('/inwards', '', view, ctrl.getInward));

router.get('/outwards', view, ctrl.listOutwards);
router.post(...prefixedDcRoute('/outwards', '/dispatch', create, ctrl.dispatchOutward));
router.post(...prefixedDcRoute('/outwards', '/cancel', create, ctrl.cancelDraftOutward));
router.get(...prefixedDcRoute('/outwards', '/pdf', view, ctrl.downloadPdf));
router.get(...prefixedDcRoute('/outwards', '', view, ctrl.getOutward));

router.get('/', view, ctrl.listParts);
router.get('/:dpNumber', view, ctrl.getPart);

module.exports = router;
