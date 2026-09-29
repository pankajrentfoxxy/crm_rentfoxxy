const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/customerBillingController');
const deliveryCharges = require('../controllers/deliveryChargesController');
const customerScope = require('../middleware/customerScope');

// RBAC is driven by the role_permissions matrix (section + action).
const cp = checkSectionPermission;

router.use(authMiddleware);
// Customer Access scope (customer_access all | sales | rental): every list and
// record below narrows to it, like every other customer-touching API.
router.use(customerScope);

// Part 6.2 — declared BEFORE /invoices/:invoiceId, or the parameterised route
// swallows them.
//
// BL9: the overdue sweep also runs on a schedule; this is the manual trigger, so
// finance can force it and see the result instead of waiting a day to find out
// whether it worked.
router.post('/invoices/run-overdue-sweep', cp('customer_billing', 'edit'), ctrl.runOverdueSweep);
// Neither of these views existed. "How much is owed, and how old is it" had no
// answer anywhere in this system.
router.get('/ageing', cp('customer_billing', 'view'), ctrl.getAgeing);
router.get('/customers/:customerId/statement', cp('customer_billing', 'view'), ctrl.getStatementOfAccount);

router.get('/invoices', cp('customer_billing', 'view'), ctrl.listInvoices);
router.get('/invoices/coverage', cp('customer_billing', 'view'), ctrl.listInvoiceCoverage);
router.get('/invoices/export.xlsx', cp('customer_billing', 'view'), ctrl.exportInvoiceSerialsExcel);
router.get('/invoices/pdf-zip', cp('customer_billing', 'view'), ctrl.downloadInvoicesZip);
router.post('/invoices/generate', cp('customer_billing', 'create'), ctrl.generateInvoice);
router.post('/invoices/generate-bulk', cp('customer_billing', 'create'), ctrl.generateInvoicesBulk);
router.get('/invoices/:invoiceId/payments', cp('customer_billing', 'view'), ctrl.listInvoicePayments);
// Finance -> Payments received. Same section as the per-invoice payments list;
// that list was the only way to see a payment before this.
router.get('/payments', cp('customer_billing', 'view'), ctrl.listCustomerPayments);
router.post('/invoices/:id/payments', cp('customer_billing', 'edit'), ctrl.recordInvoicePayment);
router.get('/invoices/:invoiceId/pdf', cp('customer_billing', 'view'), ctrl.downloadInvoicePdf);
router.get('/invoices/:invoiceId', cp('customer_billing', 'view'), ctrl.getInvoice);
router.post('/invoices/:id/send', cp('customer_billing', 'edit'), ctrl.sendInvoice);
router.post('/invoices/:id/mark-zoho', cp('customer_billing', 'edit'), ctrl.markInvoiceGeneratedOnZoho);
router.patch('/invoices/:id/paid', cp('customer_billing', 'edit'), ctrl.markPaid);
// BL13: cancelling is a delete-grade action — it withdraws a statutory document.
router.patch('/invoices/:id/cancel', cp('customer_billing', 'delete'), ctrl.cancelInvoice);
// BL11: the timeline the audit rows exist for.
router.get('/invoices/:invoiceId/timeline', cp('customer_billing', 'view'), ctrl.getInvoiceTimeline);

// Delivery charges are collected separately from the rental invoice.
router.get('/delivery-charges', cp('customer_billing', 'view'), deliveryCharges.getDeliveryCharges);
router.get('/delivery-charges/export.xlsx', cp('customer_billing', 'view'), deliveryCharges.exportDeliveryChargesExcel);
router.get('/delivery-charges/statement.pdf', cp('customer_billing', 'view'), deliveryCharges.downloadDeliveryChargesStatement);

router.get('/credit-notes', cp('credit_notes', 'view'), ctrl.listCreditNotes);
router.get('/credit-notes/laptops', cp('credit_notes', 'view'), ctrl.listCreditNoteLaptops);
router.get('/credit-notes/review-groups', cp('credit_notes', 'view'), ctrl.listCreditNoteReviewGroups);
router.post('/credit-notes/generate', cp('credit_notes', 'create'), ctrl.generateCreditNote);
router.post('/credit-notes/generate-bulk', cp('credit_notes', 'create'), ctrl.generateCreditNotesBulk);
router.post('/credit-notes', cp('credit_notes', 'create'), ctrl.createCreditNote);
router.post('/credit-notes/approve-bulk', cp('credit_notes', 'edit'), ctrl.approveCreditNotesBulk);
router.get('/credit-notes/pdf-zip', cp('credit_notes', 'view'), ctrl.downloadCreditNotesZip);
router.get('/credit-notes/:id/pdf', cp('credit_notes', 'view'), ctrl.downloadCreditNotePdf);
router.get('/credit-notes/:id', cp('credit_notes', 'view'), ctrl.getCreditNote);
router.patch('/credit-notes/:id/approve', cp('credit_notes', 'edit'), ctrl.approveCreditNote);
// MD2: withdrawing a note is the checker's decision, like approving it.
router.patch('/credit-notes/:id/cancel', cp('credit_notes', 'edit'), ctrl.cancelCreditNote);

router.get('/security-deposits', cp('security_deposits', 'view'), ctrl.listSecurityDeposits);
router.post('/security-deposits', cp('security_deposits', 'create'), ctrl.recordSecurityDeposit);
// MD3 / SD1: closed (410). Deposits are refunded only through account closure.
router.patch('/security-deposits/:id/refund', cp('security_deposits', 'edit'), ctrl.refundSecurityDeposit);

module.exports = router;
