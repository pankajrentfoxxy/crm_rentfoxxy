const router = require('express').Router();
const ctrl = require('../controllers/customerPortalController');
const { customerPortalAuth, blockImpersonatedWrites } = require('../middleware/customerPortalAuth');

router.post('/login', ctrl.login);
router.post('/logout', customerPortalAuth, ctrl.logout);

router.use(customerPortalAuth);
router.get('/me', ctrl.me);
router.get('/dashboard', ctrl.getDashboard);
router.get('/laptops', ctrl.listLaptops);
router.get('/orders', ctrl.listOrders);
router.get('/invoices', ctrl.listInvoices);
router.get('/invoices/:invoiceId', ctrl.getInvoice);
router.get('/invoices/:invoiceId/pdf', ctrl.downloadInvoicePdf);
router.get('/credit-notes', ctrl.listCreditNotes);
router.get('/deliveries', ctrl.listDeliveries);
// SO and DC numbers contain slashes (SO/26-27/1023), so they are captured
// greedily by regex the same way the CRM's DC routes are.
router.get(/^\/orders\/(.+)$/, ctrl.getOrder);
router.get(/^\/deliveries\/(.+)$/, ctrl.getDelivery);
router.post('/tickets', blockImpersonatedWrites, ctrl.raiseTicket);
router.get('/tickets', ctrl.listTickets);
router.get('/tickets/:ticketId', ctrl.getTicket);
router.get('/support-requests', ctrl.listPendingRequests);
router.post('/change-password', blockImpersonatedWrites, ctrl.changePassword);

module.exports = router;
