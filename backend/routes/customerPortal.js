const router = require('express').Router();
const ctrl = require('../controllers/customerPortalController');
const portalV2 = require('../controllers/supportV2PortalController');
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
router.get('/v2/assets', portalV2.listAssets);
router.get('/v2/catalog', portalV2.catalog);
router.get('/v2/tickets', portalV2.listTickets);
router.get('/v2/tickets/:id', portalV2.getTicket);
router.post('/v2/tickets', portalV2.createTicket);
router.post('/v2/tickets/:id/approve-charge', portalV2.approveCharge);
router.post('/v2/tickets/:id/dispute-charge', portalV2.disputeCharge);
router.post('/v2/tickets/:id/reopen', portalV2.reopen);
router.get('/v2/tickets/:id/documents', portalV2.documents);
router.post('/change-password', ctrl.changePassword);

module.exports = router;
