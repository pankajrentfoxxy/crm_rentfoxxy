const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authMiddleware, checkRole } = require('../middleware/auth');
const ctrl = require('../controllers/customerManagementController');

const router = express.Router();
const roles = ['admin', 'manager', 'sales'];

const uploadDir = path.join('uploads', 'customers', 'tmp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(authMiddleware);

router.get('/customers/meta/add', checkRole(...roles), ctrl.getAddCustomerMeta);
router.get('/customers', checkRole(...roles), ctrl.listCustomers);
router.get('/customers/:customerId', checkRole(...roles), ctrl.getCustomer);
router.post(
  '/customers',
  checkRole(...roles),
  upload.fields([
    { name: 'upload_docs', maxCount: 10 },
    { name: 'profile', maxCount: 1 },
  ]),
  ctrl.storeCustomer
);
router.delete('/customers/:customerId', checkRole('admin', 'manager'), ctrl.deleteCustomer);

module.exports = router;
