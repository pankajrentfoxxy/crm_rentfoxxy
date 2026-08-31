const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/customerBillingController');

// RBAC is driven by the role_permissions matrix (section + action).
const cp = checkSectionPermission;

router.use(authMiddleware);

router.get('/invoices', cp('customer_billing', 'view'), ctrl.listInvoices);
router.post('/invoices/generate', cp('customer_billing', 'create'), ctrl.generateInvoice);
router.post('/invoices/generate-bulk', cp('customer_billing', 'create'), ctrl.generateInvoicesBulk);
router.get('/invoices/:invoiceId/payments', cp('customer_billing', 'view'), ctrl.listInvoicePayments);
router.post('/invoices/:id/payments', cp('customer_billing', 'edit'), ctrl.recordInvoicePayment);
router.get('/invoices/:invoiceId/pdf', cp('customer_billing', 'view'), ctrl.downloadInvoicePdf);
router.get('/invoices/:invoiceId', cp('customer_billing', 'view'), ctrl.getInvoice);
router.post('/invoices/:id/send', cp('customer_billing', 'edit'), ctrl.sendInvoice);
router.patch('/invoices/:id/paid', cp('customer_billing', 'edit'), ctrl.markPaid);

router.get('/credit-notes', cp('credit_notes', 'view'), ctrl.listCreditNotes);
router.post('/credit-notes', cp('credit_notes', 'create'), ctrl.createCreditNote);
router.patch('/credit-notes/:id/approve', cp('credit_notes', 'edit'), ctrl.approveCreditNote);

router.get('/security-deposits', cp('security_deposits', 'view'), ctrl.listSecurityDeposits);
router.post('/security-deposits', cp('security_deposits', 'create'), ctrl.recordSecurityDeposit);
router.patch('/security-deposits/:id/refund', cp('security_deposits', 'edit'), ctrl.refundSecurityDeposit);

module.exports = router;
