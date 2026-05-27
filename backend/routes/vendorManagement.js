/**
 * Vendor Management REST API — ported from Laravel admin VendorManagement routes.
 * Base path: /api/vendor-management (mounted from server.js)
 */
const express = require('express');
const { authMiddleware, checkRoleOrPermission } = require('../middleware/auth');
const vendors = require('../controllers/vendorManagement/vendors.controller');
const purchaseOrders = require('../controllers/vendorManagement/purchaseOrders.controller');
const sparePo = require('../controllers/vendorManagement/sparePartsOrders.controller');
const serials = require('../controllers/vendorManagement/serialNumbers.controller');
const billing = require('../controllers/vendorManagement/billing.controller');
const replaced = require('../controllers/vendorManagement/replacedProducts.controller');

const router = express.Router();

const authorize = [
  authMiddleware,
  checkRoleOrPermission(['admin', 'manager', 'procurement'], ['vendor_management_access'])
];

const upload = vendors.buildMulter();
const vendorFiles = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'licenses_and_permits', maxCount: 1 },
  { name: 'logo', maxCount: 1 },
  { name: 'banner', maxCount: 1 }
]);

// ---------- Vendors (Laravel VendorController equivalents) ----------------------------
router.get('/vendors/info', authorize, vendors.lookupValidators, vendors.lookupVendor);
router.get('/vendors', authorize, vendors.listValidators, vendors.listVendors);
router.get('/vendors/:id', authorize, vendors.getValidators, vendors.getVendor);
router.post(
  '/vendors',
  authorize,
  vendorFiles,
  ...vendors.createValidators(),
  vendors.createVendor
);
router.put(
  '/vendors/:id',
  authorize,
  vendorFiles,
  ...vendors.updateValidatorsFixed(),
  vendors.updateVendor
);
router.delete('/vendors/:id', authorize, vendors.getValidators, vendors.deleteVendor);
router.post('/vendors/login-as', authorize, vendors.loginAsVendor);

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
  poBillsUpload.array('files', 25),
  purchaseOrders.uploadBills
);

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
router.get('/spare-parts-orders/next-number', authorize, sparePo.nextNumber);
router.get('/spare-parts-orders/form-meta', authorize, sparePo.formMeta);
router.patch('/spare-parts-orders/:id/status', authorize, sparePo.statusValidators, sparePo.updateStatus);
const spoBillsUpload = sparePo.createSpoBillsUpload();
router.post(
  '/spare-parts-orders/:id/bills',
  authorize,
  spoBillsUpload.array('files', 25),
  sparePo.uploadBills
);
router.get(
  '/spare-parts-orders/:spoId/product-received',
  authorize,
  ...sparePo.spareProductReceivedValidators,
  sparePo.getSpareProductReceivedContext
);
router.post(
  '/spare-parts-orders/:spoId/product-received/receive',
  authorize,
  ...sparePo.receiveSpareSerialValidators,
  sparePo.receiveSpareLineSerial
);
router.post(
  '/spare-parts-orders/:spoId/product-received/receive-bulk',
  authorize,
  ...sparePo.receiveSpareLineBulkValidators,
  sparePo.receiveSpareLineBulk
);
router.get(
  '/spare-parts-orders/:spoId/generated-grn',
  authorize,
  ...sparePo.spareGeneratedGrnValidators,
  sparePo.getSpareGeneratedGrnOverview
);
router.get(
  '/spare-parts-orders/:spoId/grns/:grnId/received-products',
  authorize,
  ...sparePo.spareGrnReceivedProductsValidators,
  sparePo.getSpareGrnReceivedProducts
);
router.post(
  '/spare-parts-orders/:spoId/grns',
  authorize,
  ...sparePo.spareGrnPoParam,
  ...sparePo.spareGrnCreateValidators,
  sparePo.createSpareGrn
);
router.get('/spare-parts-orders', authorize, sparePo.listValidators, sparePo.list);
router.get('/spare-parts-orders/:id', authorize, sparePo.getValidators, sparePo.getOne);
router.post('/spare-parts-orders', authorize, ...sparePo.createValidators(), sparePo.create);
router.put('/spare-parts-orders/:id', authorize, sparePo.updateValidators, sparePo.update);
router.delete('/spare-parts-orders/:id', authorize, sparePo.getValidators, sparePo.remove);

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
