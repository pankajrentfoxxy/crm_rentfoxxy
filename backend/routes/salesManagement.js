const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const cp = checkSectionPermission;
// Section guards
const quoteView = cp('sales_quotations', 'view');
const quoteCreate = cp('sales_quotations', 'create');
const quoteEdit = cp('sales_quotations', 'edit');
const soView = cp('sales_orders_doc', 'view');
const soCreate = cp('sales_orders_doc', 'create');
const dcView = cp('delivery_challans', 'view');
const dcCreate = cp('delivery_challans', 'create');
const dcEdit = cp('delivery_challans', 'edit');
const payView = cp('payment_records', 'view');
const payCreate = cp('payment_records', 'create');
const rdcView = cp('return_dc', 'view');
const rdcEdit = cp('return_dc', 'edit');
const ctrl = require('../controllers/salesManagementController');

router.use(authMiddleware);

router.get('/counts', quoteView, ctrl.getOperationCounts);
router.get('/inventory/available-serials', dcView, ctrl.getAvailableSerials);

router.get('/quotations/meta/add', quoteView, ctrl.getAddQuotationMeta);
router.get('/quotations', quoteView, ctrl.listQuotations);
router.get('/quotations/:quotationNumber', quoteView, ctrl.getQuotation);
router.post('/quotations', quoteCreate, ctrl.storeQuotation);
router.patch('/quotations/:quotationNumber/status', quoteEdit, ctrl.updateQuotationStatus);

router.get('/sales-orders/meta/add', soView, ctrl.getAddSalesOrderMeta);
router.get('/sales-orders', soView, ctrl.listSalesOrders);
router.get('/sales-orders/:salesOrderNumber', soView, ctrl.getSalesOrder);
router.get('/sales-orders/:soNumber/payments', payView, ctrl.listPayments);
router.post('/sales-orders/:soNumber/payments', payCreate, ctrl.recordPayment);
router.get('/sales-orders/:soNumber/full', soView, ctrl.getSoWithPayments);
router.post('/sales-orders', soCreate, ctrl.storeSalesOrder);

router.get('/delivery-challans/meta/add', dcView, ctrl.getAddDeliveryChallanMeta);
router.get('/delivery-challans', dcView, ctrl.listDeliveryChallans);
router.get('/delivery-challans/:dcNumber', dcView, ctrl.getDeliveryChallan);
router.post('/delivery-challans', dcCreate, ctrl.storeDeliveryChallan);
router.post('/delivery-challans/:dcNumber/send-otp', dcEdit, ctrl.sendDeliveryOtp);
router.post('/delivery-challans/:dcNumber/verify-otp', dcEdit, ctrl.verifyDeliveryOtp);
router.post('/delivery-challans/:dcNumber/delivery-register', dcEdit, ctrl.submitDeliveryRegister);
router.post('/delivery-challans/:dcNumber/qc-ticket', dcEdit, ctrl.createPreDispatchQcTicket);
router.get('/delivery-challans/:dcNumber/qc-status', dcView, ctrl.getDcQcStatus);
router.patch('/delivery-challans/:dcNumber/dispatch', dcEdit, ctrl.updateDcDispatch);
router.patch('/delivery-challans/:dcNumber/delivered', dcEdit, ctrl.markDcDelivered);
router.patch('/delivery-challans/:dcNumber/rejected', dcEdit, ctrl.markDcRejected);

router.get('/return-dc', rdcView, ctrl.listReturnDeliveryChallans);
router.post('/return-dc/tickets/:ticketId/assign-number', rdcEdit, ctrl.assignReturnDcNumber);

router.post('/customers/:customerId/shipping-address', cp('customers', 'edit'), ctrl.storeCustomerShippingAddress);

module.exports = router;
