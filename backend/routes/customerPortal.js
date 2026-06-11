const router = require('express').Router();
const ctrl = require('../controllers/customerPortalController');
const { customerPortalAuth } = require('../middleware/customerPortalAuth');

router.post('/login', ctrl.login);
router.post('/logout', customerPortalAuth, ctrl.logout);

router.use(customerPortalAuth);
router.get('/me', ctrl.me);
router.get('/laptops', ctrl.listLaptops);
router.get('/orders', ctrl.listOrders);
router.get('/invoices', ctrl.listInvoices);
router.get('/invoices/:invoiceId', ctrl.getInvoice);
router.get('/invoices/:invoiceId/pdf', ctrl.downloadInvoicePdf);
router.get('/credit-notes', ctrl.listCreditNotes);
router.get('/deliveries', ctrl.listDeliveries);
router.post('/tickets', ctrl.raiseTicket);
router.get('/tickets', ctrl.listTickets);
router.post('/change-password', ctrl.changePassword);

module.exports = router;
