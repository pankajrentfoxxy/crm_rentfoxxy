const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middleware/auth');
const ctrl = require('../controllers/vendorBillingController');

const viewRoles = ['admin', 'manager', 'accounts'];
const editRoles = ['admin', 'manager', 'accounts'];
const approveRoles = ['admin', 'manager'];

router.use(authMiddleware);

router.get('/bills', checkRole(...viewRoles), ctrl.listVendorBills);
router.get('/bills/:billId', checkRole(...viewRoles), ctrl.getVendorBill);
router.post('/bills/generate', checkRole(...editRoles), ctrl.generateVendorBill);
router.patch('/bills/:id/approve', checkRole(...approveRoles), ctrl.approveVendorBill);
router.patch('/bills/:id/paid', checkRole(...editRoles), ctrl.markVendorBillPaid);

router.get('/debit-notes', checkRole(...viewRoles), ctrl.listDebitNotes);
router.post('/debit-notes', checkRole(...editRoles), ctrl.createDebitNote);
router.patch('/debit-notes/:id/approve', checkRole(...approveRoles), ctrl.approveDebitNote);

module.exports = router;
