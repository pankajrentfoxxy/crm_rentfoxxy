const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middleware/auth');
const ctrl = require('../controllers/salesManagementController');

const roles = ['admin', 'manager', 'sales'];
const paymentRoles = ['admin', 'manager', 'accounts'];
const dispatchRoles = ['admin', 'manager', 'dispatch', 'warehouse'];
const qcRoles = ['admin', 'manager', 'warehouse'];

router.use(authMiddleware);

router.get('/counts', checkRole(...roles), ctrl.getOperationCounts);
router.get('/inventory/available-serials', checkRole(...roles), ctrl.getAvailableSerials);

router.get('/quotations/meta/add', checkRole(...roles), ctrl.getAddQuotationMeta);
router.get('/quotations', checkRole(...roles), ctrl.listQuotations);
router.get('/quotations/:quotationNumber', checkRole(...roles), ctrl.getQuotation);
router.post('/quotations', checkRole(...roles), ctrl.storeQuotation);
router.patch('/quotations/:quotationNumber/status', checkRole(...roles), ctrl.updateQuotationStatus);

router.get('/sales-orders/meta/add', checkRole(...roles), ctrl.getAddSalesOrderMeta);
router.get('/sales-orders', checkRole(...roles), ctrl.listSalesOrders);
router.get('/sales-orders/:salesOrderNumber', checkRole(...roles), ctrl.getSalesOrder);
router.get('/sales-orders/:soNumber/payments', checkRole(...roles, 'accounts'), ctrl.listPayments);
router.post('/sales-orders/:soNumber/payments', checkRole(...paymentRoles), ctrl.recordPayment);
router.get('/sales-orders/:soNumber/full', checkRole(...roles, 'accounts'), ctrl.getSoWithPayments);
router.post('/sales-orders', checkRole(...roles), ctrl.storeSalesOrder);

router.get('/delivery-challans/meta/add', checkRole(...roles), ctrl.getAddDeliveryChallanMeta);
router.get('/delivery-challans', checkRole(...roles), ctrl.listDeliveryChallans);
router.get('/delivery-challans/:dcNumber', checkRole(...roles), ctrl.getDeliveryChallan);
router.post('/delivery-challans', checkRole(...roles), ctrl.storeDeliveryChallan);
router.post('/delivery-challans/:dcNumber/send-otp', checkRole(...roles), ctrl.sendDeliveryOtp);
router.post('/delivery-challans/:dcNumber/verify-otp', checkRole(...roles), ctrl.verifyDeliveryOtp);
router.post('/delivery-challans/:dcNumber/delivery-register', checkRole(...roles), ctrl.submitDeliveryRegister);
router.post('/delivery-challans/:dcNumber/qc-ticket', checkRole(...qcRoles), ctrl.createPreDispatchQcTicket);
router.get('/delivery-challans/:dcNumber/qc-status', checkRole(...roles, 'warehouse', 'dispatch'), ctrl.getDcQcStatus);
router.patch('/delivery-challans/:dcNumber/dispatch', checkRole(...dispatchRoles), ctrl.updateDcDispatch);
router.patch('/delivery-challans/:dcNumber/delivered', checkRole('admin', 'manager', 'dispatch'), ctrl.markDcDelivered);
router.patch('/delivery-challans/:dcNumber/rejected', checkRole('admin', 'manager', 'dispatch'), ctrl.markDcRejected);

router.get('/return-dc', checkRole(...roles), ctrl.listReturnDeliveryChallans);
router.post('/return-dc/tickets/:ticketId/assign-number', checkRole('admin', 'manager'), ctrl.assignReturnDcNumber);

router.post('/customers/:customerId/shipping-address', checkRole(...roles), ctrl.storeCustomerShippingAddress);

module.exports = router;
