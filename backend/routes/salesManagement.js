const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { multerLimits, wrapMulter } = require('../config/uploadLimits');
const router = express.Router();
const { authMiddleware, checkSectionPermission, checkAnySectionPermission, checkRole } = require('../middleware/auth');
const { SO_VIEW_SECTIONS } = require('../services/dataScopeService');
const cp = checkSectionPermission;
const cpAny = checkAnySectionPermission;

// POD photo uploads -> backend/uploads/pod (served at /uploads/pod/...)
const podStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/pod');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    // DC numbers contain slashes (DC/26-27/0779) — sanitize so we don't create
    // phantom sub-directories / ENOENT when writing the file.
    const safeDc = String(req.params.dcNumber || 'dc').replace(/[^\w-]+/g, '_');
    cb(null, `pod_${safeDc}_${Date.now()}${ext}`);
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
const saleComplianceStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const safeDc = String(req.params.dcNumber || 'dc').replace(/[^\w-]+/g, '_');
    const dir = path.join(__dirname, '../uploads/sale-dc-compliance', safeDc);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.pdf';
    const prefix = file.fieldname === 'eway_bill_pdf' ? 'eway' : 'einvoice';
    cb(null, `${prefix}_${Date.now()}${ext}`);
  },
});
const uploadSaleCompliance = multer({
  storage: saleComplianceStorage,
  limits: multerLimits({ files: 2 }),
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(jpeg|jpg|png|webp|gif)|application\/pdf)$/i.test(file.mimetype);
    if (!ok) return cb(new Error('Only PDF or image files allowed'));
    cb(null, true);
  },
});
// Section guards
const quoteView = cp('sales_quotations', 'view');
const quoteCreate = cp('sales_quotations', 'create');
const quoteEdit = cp('sales_quotations', 'edit');
const soView = cpAny(SO_VIEW_SECTIONS, 'view');
const soCreate = cpAny(SO_VIEW_SECTIONS, 'create');
const soEdit = cpAny(SO_VIEW_SECTIONS, 'edit');
const dcView = cp('delivery_challans', 'view');
const dcCreate = cp('delivery_challans', 'create');
const dcEdit = cp('delivery_challans', 'edit');
/** SO laptop attach/QC flow — sales users need sales_orders_doc; warehouse uses delivery_challans. */
const soSerialsView = cpAny([...SO_VIEW_SECTIONS, 'delivery_challans'], 'view');
const soSerialsEdit = cpAny([...SO_VIEW_SECTIONS, 'delivery_challans'], 'edit');
/** DC from sales order — sales creates DCs for their SOs without full delivery_challans module access. */
const soDcView = cpAny([...SO_VIEW_SECTIONS, 'delivery_challans'], 'view');
const soDcCreate = cpAny([...SO_VIEW_SECTIONS, 'delivery_challans'], 'create');
const soDcEdit = cpAny([...SO_VIEW_SECTIONS, 'delivery_challans'], 'edit');
const payView = cp('payment_records', 'view');
const payCreate = cp('payment_records', 'create');
const rdcView = cp('return_dc', 'view');
const rdcEdit = cp('return_dc', 'edit');
const tbView = cp('technician_bucket', 'view');
const tbEdit = cp('technician_bucket', 'edit');
/** Warehouse return OTP — warehouse/sales (send) and technicians (verify) both need access. */
const whReturnEdit = cpAny(['delivery_challans', 'technician_bucket'], 'edit');
const drView = cpAny(['delivery_register_management', 'technician_bucket'], 'view');
const ctrl = require('../controllers/salesManagementController');
const saleComplianceCtrl = require('../controllers/saleDcComplianceController');
const sosCtrl = require('../controllers/salesOrderSerialController');
const flowCtrl = require('../controllers/deliveryFlowController');
const supportCtrl = require('../controllers/supportController');
const { soRoute, bindSoNumber, bindSoSerialDetach } = require('../middleware/soNumberRoutes');
const { dcRoute, bindDcNumber, rejectDcActionSuffix } = require('../middleware/dcNumberRoutes');
const {
  checkSoViewOrAssignedDispatch,
  checkSoSerialOrAssignedDispatch,
} = require('../middleware/dispatchSoAccess');

router.use(authMiddleware);
router.use(require('../middleware/customerScope')); // Customer Access scope -> req.allowedCustomerTypes

// SO-level serial allocation (warehouse attaches laptops -> 1 QC ticket each)
router.get(...soRoute('/serials', checkSoViewOrAssignedDispatch, sosCtrl.listSerials));
router.post(...soRoute('/serials', checkSoSerialOrAssignedDispatch, sosCtrl.attachSerial));
router.delete(/^\/sales-orders\/(.+)\/serials\/([^/]+)$/, bindSoSerialDetach, checkSoSerialOrAssignedDispatch, sosCtrl.detachSerial);

// Phase 13 — per-serial delivery addresses on the SO
router.patch('/so-serials/:allocationId/address', soSerialsEdit, ctrl.updateSoSerialAddress);
router.patch(...soRoute('/serial-addresses', soSerialsEdit, ctrl.bulkUpdateSoSerialAddresses));
// Phase 14 — line-level delivery address (before serials are attached)
router.patch('/so-lines/:lineId/address', soSerialsEdit, ctrl.updateSoLineAddress);
// Super Admin — correct sales-side line config (processor / gen / RAM / storage)
router.patch('/so-lines/:lineId/config', checkRole('super_admin'), ctrl.updateSoLineConfig);
// Super Admin — correct monthly rate (regenerates SO + linked DC PDFs)
router.patch('/so-lines/:lineId/rate', checkRole('super_admin'), ctrl.updateSoLineRate);
// Admin / Super Admin — override line HSN/SAC
router.patch('/so-lines/:lineId/hsn', checkRole('admin', 'super_admin'), ctrl.updateSoLineHsn);

// Phase 13 — delivery flow (technician bucket / my deliveries / OTP / POD)
router.get('/delivery-flow', drView, flowCtrl.listDeliveryFlow);
router.get('/my-deliveries', tbView, flowCtrl.getMyDeliveries);
router.patch(...dcRoute('/reached', tbEdit, flowCtrl.markTechReached));
router.post(...dcRoute('/verify-serial', tbEdit, flowCtrl.verifySerialAndGenerateOtp));
router.post(...dcRoute('/deliver', tbEdit, wrapMulter(uploadPod.single('pod_photo')), flowCtrl.submitDeliveryWithPod));
router.patch(...dcRoute('/admin-deliver', checkRole('admin', 'manager', 'super_admin', 'warehouse', 'support_tech'), wrapMulter(uploadPod.single('pod_photo')), flowCtrl.adminDeliverOverride));

router.get('/counts', quoteView, ctrl.getOperationCounts);
router.get('/inventory/available-serials', soSerialsView, ctrl.getAvailableSerials);

router.get('/quotations/meta/add', quoteView, ctrl.getAddQuotationMeta);
router.get('/quotations', quoteView, ctrl.listQuotations);
router.get('/quotations/:quotationNumber', quoteView, ctrl.getQuotation);
router.post('/quotations/:quotationNumber/pdf', quoteView, ctrl.regenerateQuotationPdf);
router.post('/quotations', quoteCreate, ctrl.storeQuotation);
router.patch('/quotations/:quotationNumber/status', quoteEdit, ctrl.updateQuotationStatus);

router.get('/sales-orders/meta/add', soView, ctrl.getAddSalesOrderMeta);
router.get('/sales-orders', soView, ctrl.listSalesOrders);
router.get(...soRoute('/activities', checkSoViewOrAssignedDispatch, ctrl.listSalesOrderActivities));
router.post(...soRoute('/activities', checkSoViewOrAssignedDispatch, ctrl.logSalesOrderDocumentActivity));
router.get(...soRoute('/full', checkSoViewOrAssignedDispatch, ctrl.getSoWithPayments));
router.get(...soRoute('/payments', payView, ctrl.listPayments));
router.post(...soRoute('/payments', payCreate, ctrl.recordPayment));
router.post(...soRoute('/pdf', soView, ctrl.regenerateSalesOrderPdf));
router.patch(...soRoute('/cancel', soEdit, ctrl.cancelSalesOrder));
router.get(/^\/sales-orders\/(.+)$/, bindSoNumber, checkSoViewOrAssignedDispatch, ctrl.getSalesOrder);
router.post('/sales-orders', soCreate, ctrl.storeSalesOrder);

router.get('/delivery-challans/meta/add', soDcView, ctrl.getAddDeliveryChallanMeta);
router.get('/delivery-challans', dcView, ctrl.listDeliveryChallans);
router.post(...dcRoute('/pdf', soDcView, ctrl.regenerateDcPdf));
router.post('/delivery-challans', soDcCreate, ctrl.storeDeliveryChallan);
// Phase 15 — create one DC per delivery-address group from QC-passed serials
router.post('/create-dcs-by-address', soDcCreate, ctrl.createDcsByAddress);
router.post(...dcRoute('/send-otp', dcEdit, ctrl.sendDeliveryOtp));
router.post(...dcRoute('/verify-otp', dcEdit, ctrl.verifyDeliveryOtp));
router.post(...dcRoute('/delivery-register', dcEdit, ctrl.submitDeliveryRegister));
router.post(...dcRoute('/qc-ticket', dcEdit, ctrl.createPreDispatchQcTicket));
router.get(...dcRoute('/qc-status', soDcView, ctrl.getDcQcStatus));
router.patch(...dcRoute('/assignment', soDcEdit, ctrl.updateDcAssignment));
router.patch(...dcRoute('/dispatch', soDcEdit, ctrl.updateDcDispatch));
router.patch(...dcRoute('/cancel', checkRole('super_admin'), ctrl.cancelDeliveryChallan));
router.post(
  ...dcRoute(
    '/sale-compliance',
    saleComplianceCtrl.checkSaleDcComplianceUpload,
    wrapMulter(uploadSaleCompliance.fields([
      { name: 'einvoice_pdf', maxCount: 1 },
      { name: 'eway_bill_pdf', maxCount: 1 },
    ])),
    saleComplianceCtrl.uploadSaleDcCompliance
  )
);
router.patch(...dcRoute('/delivered', soDcEdit, ctrl.markDcDelivered));
router.patch(...dcRoute('/rejected', soDcEdit, ctrl.markDcRejected));
router.patch(...dcRoute('/customer-rejected', tbEdit, flowCtrl.markCustomerRejected));
router.post(...dcRoute('/warehouse-return-otp', whReturnEdit, flowCtrl.sendWarehouseReturnOtp));
router.post(...dcRoute('/warehouse-return-otp/verify', whReturnEdit, flowCtrl.verifyWarehouseReturnOtp));
router.patch(...dcRoute('/courier-rejected', soDcEdit, flowCtrl.markCourierRejected));
router.patch(...dcRoute('/hsn', checkRole('admin', 'super_admin'), ctrl.updateDcHsn));
// Catch-all DC routes MUST be registered last: their greedy (.+) pattern would
// otherwise swallow specific sub-paths like /qc-status, /dispatch, /delivered.
router.get(/^\/delivery-challans\/(.+)$/, bindDcNumber, soDcView, ctrl.getDeliveryChallan);
// Edit an existing DC in place — Super Admin only.
router.patch(/^\/delivery-challans\/(.+)$/, rejectDcActionSuffix, bindDcNumber, checkRole('super_admin'), ctrl.updateDeliveryChallan);

router.get('/return-dc', rdcView, ctrl.listReturnDeliveryChallans);
router.get('/return-dc/:rdcNumber/detail', rdcView, ctrl.getReturnDcDetail);
router.get('/return-dc/:rdcNumber/download-pdf', rdcView, ctrl.downloadReturnDcPdf);
router.post('/return-dc/:rdcNumber/pdf', rdcView, ctrl.regenerateReturnDcPdf);
router.post('/return-dc/:rdcNumber/warehouse-confirm', rdcEdit, supportCtrl.confirmReturnDcWarehouseReceipt);
router.post('/return-dc/tickets/:ticketId/assign-number', rdcEdit, ctrl.assignReturnDcNumber);
router.post('/return-dc/tickets/:ticketId/generate', rdcEdit, ctrl.generateReturnDc);

router.post('/customers/:customerId/shipping-address', cp('customers', 'edit'), ctrl.storeCustomerShippingAddress);

module.exports = router;
