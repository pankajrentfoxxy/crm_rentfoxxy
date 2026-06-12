const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middleware/auth');
const ctrl = require('../controllers/customerBillingController');

const viewRoles = ['admin', 'manager', 'accounts', 'sales'];
const editRoles = ['admin', 'manager', 'accounts'];

router.use(authMiddleware);

router.get('/invoices', checkRole(...viewRoles), ctrl.listInvoices);
router.post('/invoices/generate', checkRole(...editRoles), ctrl.generateInvoice);
router.get('/invoices/:invoiceId/pdf', checkRole(...viewRoles), ctrl.downloadInvoicePdf);
router.get('/invoices/:invoiceId', checkRole(...viewRoles), ctrl.getInvoice);
router.post('/invoices/:id/send', checkRole(...editRoles), ctrl.sendInvoice);
router.patch('/invoices/:id/paid', checkRole(...editRoles), ctrl.markPaid);

router.get('/credit-notes', checkRole(...viewRoles), ctrl.listCreditNotes);
router.post('/credit-notes', checkRole(...editRoles), ctrl.createCreditNote);
router.patch('/credit-notes/:id/approve', checkRole('admin', 'manager'), ctrl.approveCreditNote);

router.get('/security-deposits', checkRole(...viewRoles), ctrl.listSecurityDeposits);
router.post('/security-deposits', checkRole(...editRoles), ctrl.recordSecurityDeposit);
router.patch('/security-deposits/:id/refund', checkRole(...editRoles), ctrl.refundSecurityDeposit);

module.exports = router;
