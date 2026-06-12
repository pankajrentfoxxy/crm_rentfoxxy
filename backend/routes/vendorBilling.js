const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/vendorBillingController');

// RBAC driven by the role_permissions matrix.
const cp = checkSectionPermission;

router.use(authMiddleware);

router.get('/bills', cp('vendor_billing_mgmt', 'view'), ctrl.listVendorBills);
router.get('/bills/:billId', cp('vendor_billing_mgmt', 'view'), ctrl.getVendorBill);
router.post('/bills/generate', cp('vendor_billing_mgmt', 'create'), ctrl.generateVendorBill);
router.patch('/bills/:id/approve', cp('vendor_billing_mgmt', 'edit'), ctrl.approveVendorBill);
router.patch('/bills/:id/paid', cp('vendor_billing_mgmt', 'edit'), ctrl.markVendorBillPaid);

router.get('/debit-notes', cp('debit_notes', 'view'), ctrl.listDebitNotes);
router.post('/debit-notes', cp('debit_notes', 'create'), ctrl.createDebitNote);
router.patch('/debit-notes/:id/approve', cp('debit_notes', 'edit'), ctrl.approveDebitNote);

module.exports = router;
