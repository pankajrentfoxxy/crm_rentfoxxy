/**
 * QC Management REST API — ported from Laravel admin qc/orders routes.
 * Base path: /api/qc-management
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { multerLimits, multerErrorMessage } = require('../config/uploadLimits');
const { authMiddleware } = require('../middleware/auth');
const { legacyOrSection, hasLegacyPermission } = require('../middleware/legacyOrSection');
const orders = require('../controllers/qcManagement/orders.controller');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads', 'return_and_repare_files');
fs.mkdirSync(uploadDir, { recursive: true });

const returnRepareUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    }
  }),
  limits: multerLimits(),
  fileFilter: (_req, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'].includes(file.mimetype);
    cb(ok ? null : new Error('Only PDF, JPG, JPEG, PNG allowed'), ok);
  }
});

// CT1: role / legacy qc_access as before, OR the qc_management grant
// (view for reads, edit for QC actions).
const qcLegacy = (u) => ['admin', 'manager', 'floor_manager', 'qc'].includes(u.role) || hasLegacyPermission(u, 'qc_access');
const authorize = [
  authMiddleware,
  legacyOrSection(qcLegacy, 'qc_management', 'view', { success: false, message: 'Access forbidden' }),
];
const authorizeEdit = [
  authMiddleware,
  legacyOrSection(qcLegacy, 'qc_management', 'edit', { success: false, message: 'Access forbidden' }),
];

router.get('/', authorize, (req, res) =>
  res.json({
    success: true,
    module: 'QC Management',
    endpoints: [
      '/orders/counts',
      '/orders/:status',
      '/pending-orders/:poId',
      '/order-details',
      '/qc-check',
      '/hardware-qc-check',
      '/return-and-repare-check'
    ]
  })
);

router.get('/orders/counts', authorize, orders.getStatusCounts);
router.get('/spare-parts', authorize, orders.listSpareParts);
router.get('/orders/:status', authorize, orders.listValidators, orders.listOrdersByStatus);
router.get(
  '/pending-orders/:poId/:status?',
  authorize,
  orders.pendingPoValidators,
  orders.listPendingProductsByPo
);
router.post('/order-details', authorize, orders.orderDetailsValidators, orders.getOrderDetails);
router.post('/qc-check', authorizeEdit, orders.qcCheckValidators, orders.qcCheck);
router.post('/hardware-qc-check', authorizeEdit, orders.hardwareQcValidators, orders.hardwareQcCheck);
router.post(
  '/return-and-repare-check',
  authorizeEdit,
  (req, res, next) => {
    returnRepareUpload.array('files', 10)(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: multerErrorMessage(err) });
      }
      next();
    });
  },
  orders.returnAndRepareCheckValidators,
  orders.returnAndRepareCheck
);

module.exports = router;
