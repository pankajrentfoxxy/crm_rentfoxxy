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
router.post(
  '/customers',
  checkRole(...roles),
  upload.fields([
    { name: 'upload_docs', maxCount: 10 },
    { name: 'profile', maxCount: 1 },
  ]),
  ctrl.storeCustomer
);
// Specific /customers/:id/* routes must be registered before /customers/:customerId
router.put('/customers/:customerId/verify-kyc', checkRole('admin', 'manager'), ctrl.verifyCustomerKyc);
router.patch('/customers/:customerId/portal-access', checkRole('admin', 'manager'), ctrl.enableCustomerPortal);
router.get('/customers/:customerId/laptops', checkRole(...roles), ctrl.getCustomerLaptops);
router.get('/customers/:customerId/addresses', checkRole(...roles), ctrl.getCustomerAddresses);
router.post('/customers/:customerId/addresses', checkRole(...roles), ctrl.addCustomerAddress);
router.delete('/customers/:customerId/addresses/:addressId', checkRole(...roles), ctrl.deleteCustomerAddress);
router.patch('/customers/:customerId/addresses/:addressId/default', checkRole(...roles), ctrl.setDefaultCustomerAddress);
router.get('/customers/:customerId', checkRole(...roles), ctrl.getCustomer);
router.put('/customers/:customerId', checkRole(...roles), ctrl.updateCustomer);
router.delete('/customers/:customerId', checkRole('admin', 'manager'), ctrl.deleteCustomer);

module.exports = router;
