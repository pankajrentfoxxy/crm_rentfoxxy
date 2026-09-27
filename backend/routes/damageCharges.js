const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = require('express').Router();
const ctrl = require('../controllers/damageChargeController');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const { multerLimits, wrapMulter } = require('../config/uploadLimits');

// Damage charges (claude/carret-customers-returns-control.md, DM1). Photos of a
// customer's laptop go to private-uploads/ (never the public uploads/ folder) and
// are streamed back only through the authenticated /photo route.
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../private-uploads/damage-cases', new Date().toISOString().slice(0, 7));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${(path.extname(file.originalname) || '.jpg').toLowerCase()}`),
  }),
  limits: multerLimits({ files: 6 }),
  fileFilter: (req, file, cb) => (/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(file.mimetype) ? cb(null, true) : cb(new Error('Only photos (JPG, PNG, WEBP, HEIC)'))),
});

router.use(authMiddleware);

// Report: the technician (visit / pickup) or the warehouse (receive).
const report = checkAnySectionPermission(['damage_charges', 'support_tickets', 'return_dc'], 'create');
const view = checkAnySectionPermission(['damage_charges', 'customer_billing', 'support_tickets', 'return_dc'], 'view');

router.get('/catalog', view, ctrl.catalog);
router.get('/photo', view, ctrl.photo);
router.post('/photos', report, wrapMulter(photoUpload.array('photos', 6)), ctrl.uploadPhotos);
router.get('/', view, ctrl.list);
router.get('/:id', view, ctrl.get);
router.post('/', report, ctrl.create);
// The warehouse prices the parts.
router.post('/:id/price', checkAnySectionPermission(['parts_inventory', 'support_part_challan', 'return_dc'], 'edit'), ctrl.price);
// Sales / Accounts agree it with the customer and email them.
router.post('/:id/propose', checkAnySectionPermission(['damage_charges', 'customers', 'customer_billing'], 'edit'), ctrl.propose);
// Accounts decide.
router.post('/:id/decide', checkSectionPermission('customer_billing', 'edit'), ctrl.decide);
router.post('/:id/cancel', report, ctrl.cancel);

module.exports = router;
