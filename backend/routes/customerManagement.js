const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { multerLimits } = require('../config/uploadLimits');
const { authMiddleware, checkSectionPermission, checkRole } = require('../middleware/auth');
const ctrl = require('../controllers/customerManagementController');

const router = express.Router();
const cp = checkSectionPermission;

const uploadDir = path.join('uploads', 'customers', 'tmp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: multerLimits(),
});

router.use(authMiddleware);

router.get('/customers/meta/add', cp('customers', 'view'), ctrl.getAddCustomerMeta);
router.get('/customers/export.xlsx', checkRole('admin', 'super_admin'), ctrl.exportCustomersExcel);
router.get('/customers', cp('customers', 'view'), ctrl.listCustomers);
router.post(
  '/customers',
  cp('customers', 'create'),
  upload.fields([
    { name: 'upload_docs', maxCount: 10 },
    { name: 'profile', maxCount: 1 },
  ]),
  ctrl.storeCustomer
);
// Specific /customers/:id/* routes must be registered before /customers/:customerId
router.put('/customers/:customerId/verify-kyc', cp('kyc_management', 'edit'), ctrl.verifyCustomerKyc);
router.patch('/customers/:customerId/portal-access', cp('customers', 'edit'), ctrl.enableCustomerPortal);
router.get('/customers/:customerId/laptops', cp('customer_assets', 'view'), ctrl.getCustomerLaptops);
router.get('/customers/:customerId/addresses', cp('customers', 'view'), ctrl.getCustomerAddresses);
router.post('/customers/:customerId/addresses', cp('customers', 'edit'), ctrl.addCustomerAddress);
router.put('/customers/:customerId/addresses/:addressId', cp('customers', 'edit'), ctrl.updateCustomerAddress);
router.delete('/customers/:customerId/addresses/:addressId', cp('customers', 'edit'), ctrl.deleteCustomerAddress);
router.patch('/customers/:customerId/addresses/:addressId/default', cp('customers', 'edit'), ctrl.setDefaultCustomerAddress);
router.get('/customers/:customerId', cp('customers', 'view'), ctrl.getCustomer);
router.put('/customers/:customerId', cp('customers', 'edit'), ctrl.updateCustomer);
router.delete('/customers/:customerId', cp('customers', 'delete'), ctrl.deleteCustomer);

module.exports = router;
