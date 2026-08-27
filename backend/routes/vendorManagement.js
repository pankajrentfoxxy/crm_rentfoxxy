/**
 * Vendor Management REST API — ported from Laravel admin VendorManagement routes.
 * Base path: /api/vendor-management (mounted from server.js)
 */
const express = require('express');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const { wrapMulter } = require('../config/uploadLimits');
const vendors = require('../controllers/vendorManagement/vendors.controller');
const purchaseOrders = require('../controllers/vendorManagement/purchaseOrders.controller');
const sparePo = require('../controllers/vendorManagement/sparePartsOrders.controller');
const spareCatalog = require('../controllers/vendorManagement/sparePartsCatalog.controller');
const serials = require('../controllers/vendorManagement/serialNumbers.controller');
const billing = require('../controllers/vendorManagement/billing.controller');
const replaced = require('../controllers/vendorManagement/replacedProducts.controller');

const router = express.Router();

// RBAC driven by the role_permissions matrix (single source of truth) — view
// access to the Vendor Management module. Write actions are gated by the UI's
// can_create/can_edit flags; tighten per-action here later if needed.
const authorize = [
  authMiddleware,
  checkSectionPermission('vendor_management', 'view')
];

/** Read-only vendor lookup for Out-for-Repair / Vendor Repair DC (no full Vendor Management). */
const authorizeVendorRead = [
  authMiddleware,
  checkAnySectionPermission(
    ['vendor_management', 'vendor_repair_dc', 'vendor_repair_dc_dispatch', 'diagnosis_failed'],
    'view'
  ),
];

/** Spare Parts PO — Part Management RBAC (parts_procurement) or legacy vendor_management. */
const authorizeSpareParts = [
  authMiddleware,
  checkAnySectionPermission(['parts_procurement', 'vendor_management'], 'view'),
];

const upload = vendors.buildMulter();
const vendorFiles = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'licenses_and_permits', maxCount: 1 },
  { name: 'logo', maxCount: 1 },
  { name: 'banner', maxCount: 1 }
]);

// ---------- Vendors (Laravel VendorController equivalents) ----------------------------
router.get('/vendors/info', authorizeVendorRead, vendors.lookupValidators, vendors.lookupVendor);
router.get('/vendors', authorizeVendorRead, vendors.listValidators, vendors.listVendors);
router.get('/vendors/:id/laptops', authorize, vendors.laptopsValidators, vendors.listVendorLaptops);
router.get('/vendors/:id', authorizeVendorRead, vendors.getValidators, vendors.getVendor);
router.post(
  '/vendors',
  authorize,
  wrapMulter(vendorFiles),
  ...vendors.createValidators(),
  vendors.createVendor
);
router.put(
  '/vendors/:id',
  authorize,
  wrapMulter(vendorFiles),
  ...vendors.updateValidatorsFixed(),
  vendors.updateVendor
);
router.delete('/vendors/:id', authorize, vendors.getValidators, vendors.deleteVendor);
router.post('/vendors/login-as', authorize, vendors.loginAsVendor);
router.patch('/vendors/:id/portal-access', authorize, vendors.portalAccessValidators, vendors.updatePortalAccess);

// Convenience REST aliases (explicit user requirement)
router.get('/', authorize, (req, res) =>
  res.json({
    success: true,
    module: 'Vendor Management',
    endpoints: ['/vendors', '/purchase-orders', '/spare-parts-orders', '/billing', '/replaced-products', '/replaced-products/inventory-serials']
  })
);

// ---------- Purchase orders -------------------------------------------------------
router.get('/purchase-orders/next-number', authorize, purchaseOrders.nextNumber);
router.get('/purchase-orders/form-meta', authorize, purchaseOrders.formMeta);
router.get(
  '/purchase-orders/:poId/product-received',
  authorize,
  purchaseOrders.productReceivedValidators,
  purchaseOrders.getProductReceivedContext
);
router.post(
  '/purchase-orders/:poId/product-received/receive',
  authorize,
  ...purchaseOrders.receiveSerialValidators,
  purchaseOrders.receiveProductSerial
);
router.post(
  '/purchase-orders/:poId/product-received/receive-bulk',
  authorize,
  ...purchaseOrders.receivePoLineBulkValidators,
  purchaseOrders.receivePoLineBulk
);
router.post(
  '/purchase-orders/:poId/product-received/receive-unit',
  authorize,
  ...purchaseOrders.receivePoLineUnitValidators,
  purchaseOrders.receivePoLineUnit
);
const grnCapture = require('../controllers/grnSerialCapture.controller');
router.post(
  '/purchase-orders/:poId/grn-capture-tokens',
  authorize,
  ...grnCapture.createTokenValidators,
  grnCapture.createGrnCaptureToken
);
router.get(
  '/grn-capture-tokens/:token',
  authorize,
  grnCapture.getGrnCaptureTokenStatus
);
router.get(
  '/purchase-orders/:poId/generated-grn',
  authorize,
  purchaseOrders.generatedGrnValidators,
  purchaseOrders.getGeneratedGrnOverview
);
router.get(
  '/purchase-orders/:poId/grns/:grnId/received-products',
  authorize,
  purchaseOrders.grnReceivedProductsValidators,
  purchaseOrders.getGrnReceivedProducts
);
router.get('/purchase-orders/details', authorize, purchaseOrders.getByNumber);
router.get('/purchase-orders', authorize, purchaseOrders.listValidators, purchaseOrders.list);

const poBillsUpload = purchaseOrders.createBillsUpload();
router.patch('/purchase-orders/:id/status', authorize, purchaseOrders.statusValidators, purchaseOrders.updateStatus);
router.post(
  '/purchase-orders/:id/bills',
  authorize,
  wrapMulter(poBillsUpload.array('files', 25)),
  purchaseOrders.uploadBills
);
const grnBillsUpload = purchaseOrders.createGrnBillsUpload();
router.post(
  '/purchase-orders/:poId/grns/:grnId/bills',
  authorize,
  wrapMulter(grnBillsUpload.array('files', 10)),
  purchaseOrders.grnBillParamValidators,
  purchaseOrders.uploadGrnBill
);

router.get('/purchase-orders/:poId/activities', authorize, purchaseOrders.listPurchaseOrderActivities);
router.post('/purchase-orders/:poId/activities', authorize, purchaseOrders.logPurchaseOrderDocumentActivity);
router.get('/purchase-orders/:id', authorize, purchaseOrders.getValidators, purchaseOrders.getOne);
router.post('/purchase-orders', authorize, ...purchaseOrders.createValidators(), purchaseOrders.create);
router.put('/purchase-orders/:id', authorize, purchaseOrders.updateValidators, purchaseOrders.update);
router.delete('/purchase-orders/:id', authorize, purchaseOrders.getValidators, purchaseOrders.remove);

// GRN + serial numbers (Laravel PurchaseOrderController + serial_numbers table)
router.get('/purchase-orders/:poId/grns', authorize, serials.grnPoParam, serials.listGrnForPo);
router.post('/purchase-orders/:poId/grns', authorize, serials.grnPoParam, serials.grnCreateValidators, serials.createGrn);
router.get(
  '/grns/:grnId/purchase-orders/:poId/serial-numbers',
  authorize,
  serials.serialParams,
  serials.listSerials
);
router.post('/serial-numbers', authorize, serials.createSerial);
router.put('/serial-numbers/update', authorize, serials.serialUpdateValidators, serials.checkAndUpdate);

// ---------- Spare parts PO ---------------------------------------------------------
router.get('/spare-parts-orders/next-number', authorizeSpareParts, sparePo.nextNumber);
router.get('/spare-parts-orders/form-meta', authorizeSpareParts, sparePo.formMeta);
router.get('/spare-parts-catalog', authorizeSpareParts, spareCatalog.listCatalog);
router.post('/spare-parts-catalog', authorizeSpareParts, spareCatalog.createValidators, spareCatalog.createCatalogItem);
router.patch('/spare-parts-catalog/:id', authorizeSpareParts, spareCatalog.updateValidators, spareCatalog.updateCatalogItem);
router.patch('/spare-parts-orders/:id/status', authorizeSpareParts, sparePo.statusValidators, sparePo.updateStatus);
const spoBillsUpload = sparePo.createSpoBillsUpload();
router.post(
  '/spare-parts-orders/:id/bills',
  authorizeSpareParts,
  wrapMulter(spoBillsUpload.array('files', 25)),
  sparePo.uploadBills
);
router.get(
  '/spare-parts-orders/:spoId/product-received',
  authorizeSpareParts,
  ...sparePo.spareProductReceivedValidators,
  sparePo.getSpareProductReceivedContext
);
router.post(
  '/spare-parts-orders/:spoId/product-received/receive',
  authorizeSpareParts,
  ...sparePo.receiveSpareSerialValidators,
  sparePo.receiveSpareLineSerial
);
router.post(
  '/spare-parts-orders/:spoId/product-received/receive-bulk',
  authorizeSpareParts,
  ...sparePo.receiveSpareLineBulkValidators,
  sparePo.receiveSpareLineBulk
);
router.get(
  '/spare-parts-orders/:spoId/generated-grn',
  authorizeSpareParts,
  ...sparePo.spareGeneratedGrnValidators,
  sparePo.getSpareGeneratedGrnOverview
);
router.get(
  '/spare-parts-orders/:spoId/grns/:grnId/received-products',
  authorizeSpareParts,
  ...sparePo.spareGrnReceivedProductsValidators,
  sparePo.getSpareGrnReceivedProducts
);
router.post(
  '/spare-parts-orders/:spoId/grns',
  authorizeSpareParts,
  ...sparePo.spareGrnPoParam,
  ...sparePo.spareGrnCreateValidators,
  sparePo.createSpareGrn
);
router.get('/spare-parts-orders', authorizeSpareParts, sparePo.listValidators, sparePo.list);
router.get('/spare-parts-orders/:id', authorizeSpareParts, sparePo.getValidators, sparePo.getOne);
router.post('/spare-parts-orders', authorizeSpareParts, ...sparePo.createValidators(), sparePo.create);
router.put('/spare-parts-orders/:id', authorizeSpareParts, sparePo.updateValidators, sparePo.update);
router.delete('/spare-parts-orders/:id', authorizeSpareParts, sparePo.getValidators, sparePo.remove);

// ---------- Billing (monthly views map to status + period filters) ----------------
router.get('/billing', authorize, billing.listValidators, billing.list);
router.get('/billing/:id', authorize, billing.getValidators, billing.getOne);
router.post('/billing', authorize, ...billing.createValidators(), billing.create);
router.put('/billing/:id', authorize, billing.updateValidators, billing.update);
router.delete('/billing/:id', authorize, billing.getValidators, billing.remove);

// ---------- Returns / replacements --------------------------------------------------
router.get('/replaced-products', authorize, replaced.listValidators, replaced.list);
router.get(
  '/replaced-products/inventory-serials',
  authorize,
  replaced.listInventoryValidators,
  replaced.listInventorySerials
);
router.get('/replaced-products/:id', authorize, replaced.getValidators, replaced.getOne);
router.post('/replaced-products', authorize, ...replaced.createValidators, replaced.create);
router.put('/replaced-products/:id', authorize, replaced.updateValidators, replaced.update);
router.delete('/replaced-products/:id', authorize, replaced.getValidators, replaced.remove);

module.exports = router;
