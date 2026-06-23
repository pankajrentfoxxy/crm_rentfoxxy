const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { multerLimits, wrapMulter } = require('../config/uploadLimits');
const router = express.Router();
const { authMiddleware, checkSectionPermission, checkRole } = require('../middleware/auth');
const cp = checkSectionPermission;

// POD photo uploads -> backend/uploads/pod (served at /uploads/pod/...)
const podStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/pod');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `pod_${req.params.dcNumber}_${Date.now()}${ext}`);
  },
});
const uploadPod = multer({
  storage: podStorage,
  limits: multerLimits(),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files allowed'));
    cb(null, true);
  },
});
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
const tbView = cp('technician_bucket', 'view');
const tbEdit = cp('technician_bucket', 'edit');
const ctrl = require('../controllers/salesManagementController');
const sosCtrl = require('../controllers/salesOrderSerialController');
const flowCtrl = require('../controllers/deliveryFlowController');
const supportCtrl = require('../controllers/supportController');
const { soRoute, bindSoNumber, bindSoSerialDetach } = require('../middleware/soNumberRoutes');
const { dcRoute, bindDcNumber } = require('../middleware/dcNumberRoutes');

router.use(authMiddleware);

// SO-level serial allocation (warehouse attaches laptops -> 1 QC ticket each)
router.get(...soRoute('/serials', dcView, sosCtrl.listSerials));
router.post(...soRoute('/serials', dcEdit, sosCtrl.attachSerial));
router.delete(/^\/sales-orders\/(.+)\/serials\/([^/]+)$/, bindSoSerialDetach, dcEdit, sosCtrl.detachSerial);

// Phase 13 — per-serial delivery addresses on the SO
router.patch('/so-serials/:allocationId/address', dcEdit, ctrl.updateSoSerialAddress);
router.patch(...soRoute('/serial-addresses', dcEdit, ctrl.bulkUpdateSoSerialAddresses));
// Phase 14 — line-level delivery address (before serials are attached)
router.patch('/so-lines/:lineId/address', dcEdit, ctrl.updateSoLineAddress);

// Phase 13 — delivery flow (technician bucket / my deliveries / OTP / POD)
router.get('/delivery-flow', tbView, flowCtrl.listDeliveryFlow);
router.get('/my-deliveries', tbView, flowCtrl.getMyDeliveries);
router.patch(...dcRoute('/reached', tbEdit, flowCtrl.markTechReached));
router.post(...dcRoute('/verify-serial', tbEdit, flowCtrl.verifySerialAndGenerateOtp));
router.post(...dcRoute('/deliver', tbEdit, wrapMulter(uploadPod.single('pod_photo')), flowCtrl.submitDeliveryWithPod));
router.patch(...dcRoute('/admin-deliver', checkRole('admin', 'manager', 'super_admin'), wrapMulter(uploadPod.single('pod_photo')), flowCtrl.adminDeliverOverride));

router.get('/counts', quoteView, ctrl.getOperationCounts);
router.get('/inventory/available-serials', dcView, ctrl.getAvailableSerials);

router.get('/quotations/meta/add', quoteView, ctrl.getAddQuotationMeta);
router.get('/quotations', quoteView, ctrl.listQuotations);
router.get('/quotations/:quotationNumber', quoteView, ctrl.getQuotation);
router.post('/quotations/:quotationNumber/pdf', quoteView, ctrl.regenerateQuotationPdf);
router.post('/quotations', quoteCreate, ctrl.storeQuotation);
router.patch('/quotations/:quotationNumber/status', quoteEdit, ctrl.updateQuotationStatus);

router.get('/sales-orders/meta/add', soView, ctrl.getAddSalesOrderMeta);
router.get('/sales-orders', soView, ctrl.listSalesOrders);
router.get(...soRoute('/full', soView, ctrl.getSoWithPayments));
router.get(...soRoute('/payments', payView, ctrl.listPayments));
router.post(...soRoute('/payments', payCreate, ctrl.recordPayment));
router.post(...soRoute('/pdf', soView, ctrl.regenerateSalesOrderPdf));
router.get(/^\/sales-orders\/(.+)$/, bindSoNumber, soView, ctrl.getSalesOrder);
router.post('/sales-orders', soCreate, ctrl.storeSalesOrder);

router.get('/delivery-challans/meta/add', dcView, ctrl.getAddDeliveryChallanMeta);
router.get('/delivery-challans', dcView, ctrl.listDeliveryChallans);
router.get(/^\/delivery-challans\/(.+)$/, bindDcNumber, dcView, ctrl.getDeliveryChallan);
router.post(...dcRoute('/pdf', dcView, ctrl.regenerateDcPdf));
router.post('/delivery-challans', dcCreate, ctrl.storeDeliveryChallan);
// Phase 15 — create one DC per delivery-address group from QC-passed serials
router.post('/create-dcs-by-address', dcCreate, ctrl.createDcsByAddress);
// Edit an existing DC in place — Super Admin only.
router.patch(/^\/delivery-challans\/(.+)$/, bindDcNumber, checkRole('super_admin'), ctrl.updateDeliveryChallan);
router.post(...dcRoute('/send-otp', dcEdit, ctrl.sendDeliveryOtp));
router.post(...dcRoute('/verify-otp', dcEdit, ctrl.verifyDeliveryOtp));
router.post(...dcRoute('/delivery-register', dcEdit, ctrl.submitDeliveryRegister));
router.post(...dcRoute('/qc-ticket', dcEdit, ctrl.createPreDispatchQcTicket));
router.get(...dcRoute('/qc-status', dcView, ctrl.getDcQcStatus));
router.patch(...dcRoute('/dispatch', dcEdit, ctrl.updateDcDispatch));
router.patch(...dcRoute('/delivered', dcEdit, ctrl.markDcDelivered));
router.patch(...dcRoute('/rejected', dcEdit, ctrl.markDcRejected));

router.get('/return-dc', rdcView, ctrl.listReturnDeliveryChallans);
router.get('/return-dc/:rdcNumber/detail', rdcView, ctrl.getReturnDcDetail);
router.post('/return-dc/:rdcNumber/pdf', rdcView, ctrl.regenerateReturnDcPdf);
router.post('/return-dc/:rdcNumber/warehouse-confirm', rdcEdit, supportCtrl.confirmReturnDcWarehouseReceipt);
router.post('/return-dc/tickets/:ticketId/assign-number', rdcEdit, ctrl.assignReturnDcNumber);
router.post('/return-dc/tickets/:ticketId/generate', rdcEdit, ctrl.generateReturnDc);

router.post('/customers/:customerId/shipping-address', cp('customers', 'edit'), ctrl.storeCustomerShippingAddress);

module.exports = router;
