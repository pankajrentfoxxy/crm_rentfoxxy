/**
 * Vendor Management REST API — ported from Laravel admin VendorManagement routes.
 * Base path: /api/vendor-management (mounted from server.js)
 */
const express = require('express');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission, checkRole } = require('../middleware/auth');
const { wrapMulter } = require('../config/uploadLimits');
const vendors = require('../controllers/vendorManagement/vendors.controller');
const purchaseOrders = require('../controllers/vendorManagement/purchaseOrders.controller');
const sparePo = require('../controllers/vendorManagement/sparePartsOrders.controller');
const spareCatalog = require('../controllers/vendorManagement/sparePartsCatalog.controller');
const serials = require('../controllers/vendorManagement/serialNumbers.controller');
const billing = require('../controllers/vendorManagement/billing.controller');
const replaced = require('../controllers/vendorManagement/replacedProducts.controller');
const vendorReturn = require('../controllers/vendorManagement/vendorReturnToVendor.controller');
const vendorReturnTicket = require('../controllers/vendorManagement/vendorReturnTicket.controller');
const { prefixedDcRoute } = require('../middleware/dcNumberRoutes');

const router = express.Router();

// Part 6.1 (findings P1, BL14) — the highest-severity permission item in the audit.
//
// `authorize` used to be checkSectionPermission('vendor_management', 'view') and
// it gated create, edit and delete on purchase orders AND on vendor billing. The
// comment that stood here said write actions were "gated by the UI's
// can_create/can_edit flags", which is not a gate: the UI hides a button, the
// API answers anyone who asks. A vendor_management:view role could delete a
// vendor bill with one curl.
//
// Now every verb declares its own action. `authorize` is reads only, and a write
// route that reaches for it is a mistake the name no longer hides.
const authorize = [
  authMiddleware,
  checkSectionPermission('vendor_management', 'view')
];
const authorizeCreate = [authMiddleware, checkSectionPermission('vendor_management', 'create')];
const authorizeEdit   = [authMiddleware, checkSectionPermission('vendor_management', 'edit')];
const authorizeDelete = [authMiddleware, checkSectionPermission('vendor_management', 'delete')];

/** Vendor billing is money. It gets its own section, and its own three actions. */
const billingRead   = [authMiddleware, checkAnySectionPermission(['vendor_billing_mgmt', 'vendor_management'], 'view')];
const billingCreate = [authMiddleware, checkAnySectionPermission(['vendor_billing_mgmt', 'vendor_management'], 'create')];
const billingEdit   = [authMiddleware, checkAnySectionPermission(['vendor_billing_mgmt', 'vendor_management'], 'edit')];
const billingDelete = [authMiddleware, checkAnySectionPermission(['vendor_billing_mgmt', 'vendor_management'], 'delete')];

/** Read-only vendor lookup for Out-for-Repair / Vendor Repair DC (no full Vendor Management). */
const authorizeVendorRead = [
  authMiddleware,
  checkAnySectionPermission(
    ['vendor_management', 'vendor_repair_dc', 'vendor_repair_dc_dispatch', 'diagnosis_failed', 'vendor_billing_mgmt', 'debit_notes'],
    'view'
  ),
];

/** Spare Parts PO — Part Management RBAC (parts_procurement) or legacy vendor_management. */
const authorizeSpareParts = [
  authMiddleware,
  checkAnySectionPermission(['parts_procurement', 'vendor_management'], 'view'),
];
const spareCreate = [authMiddleware, checkAnySectionPermission(['parts_procurement', 'vendor_management'], 'create')];
const spareEdit   = [authMiddleware, checkAnySectionPermission(['parts_procurement', 'vendor_management'], 'edit')];
const spareDelete = [authMiddleware, checkAnySectionPermission(['parts_procurement', 'vendor_management'], 'delete')];

const upload = vendors.buildMulter();
const vendorFiles = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'licenses_and_permits', maxCount: 1 },
  { name: 'gst_certificate', maxCount: 1 },
  { name: 'logo', maxCount: 1 },
  { name: 'banner', maxCount: 1 }
]);

// ---------- Vendors (Laravel VendorController equivalents) ----------------------------
router.get('/vendors/info', authorizeVendorRead, vendors.lookupValidators, vendors.lookupVendor);
router.get('/vendors', authorizeVendorRead, vendors.listValidators, vendors.listVendors);
router.get('/vendors/:id/laptops/export.xlsx', authorize, vendors.laptopsExportValidators, vendors.exportVendorLaptopsExcel);
router.get('/vendors/:id/laptops', authorize, vendors.laptopsValidators, vendors.listVendorLaptops);
router.get('/vendors/:id/activity', authorize, vendors.getValidators, vendors.listVendorActivity);
router.get('/vendors/:id', authorizeVendorRead, vendors.getValidators, vendors.getVendor);
router.post(
  '/vendors',
  authorizeCreate,
  wrapMulter(vendorFiles),
  ...vendors.createValidators(),
  vendors.createVendor
);
router.put(
  '/vendors/:id',
  authorizeEdit,
  wrapMulter(vendorFiles),
  ...vendors.updateValidatorsFixed(),
  vendors.updateVendor
);
router.delete('/vendors/:id', authorizeDelete, vendors.getValidators, vendors.deleteVendor);
router.post('/vendors/login-as', authorizeEdit, vendors.loginAsVendor);
router.patch('/vendors/:id/portal-access', authorizeEdit, vendors.portalAccessValidators, vendors.updatePortalAccess);

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
// Procure safety B: one way to receive a laptop. The single-serial and bulk
// receive paths skipped TTSPL allocation, the received condition, missing
// parts and token bookkeeping; no screen used them. They now answer 410 and
// point at receive-unit, which runs the configuration check.
const retiredReceive = (req, res) => res.status(410).json({
  success: false,
  code: 'RECEIVE_PATH_RETIRED',
  message: 'This receive path is retired. Receive each laptop through /product-received/receive-unit, which checks its configuration.',
});
router.post('/purchase-orders/:poId/product-received/receive', authorizeEdit, retiredReceive);
router.post('/purchase-orders/:poId/product-received/receive-bulk', authorizeEdit, retiredReceive);
router.post(
  '/purchase-orders/:poId/product-received/receive-unit',
  authorizeEdit,
  ...purchaseOrders.receivePoLineUnitValidators,
  purchaseOrders.receivePoLineUnit
);
const grnCapture = require('../controllers/grnSerialCapture.controller');
router.post(
  '/purchase-orders/:poId/grn-capture-tokens',
  authorizeEdit,
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
// Procure → To buy: laptop shortfalls from sales orders + floor part requests.
const toBuy = require('../controllers/vendorManagement/toBuy.controller');
router.get('/to-buy', authorize, toBuy.list);
router.get('/to-buy/link-options', authorize, toBuy.linkOptions);
router.patch('/to-buy/laptop-requests/:id/link', authorizeEdit, toBuy.linkLaptop);
router.patch('/to-buy/part-requests/:id/link', authorizeEdit, toBuy.linkPart);
router.post('/to-buy/move-on', authorizeEdit, toBuy.moveOn);

router.get('/purchase-orders', authorize, purchaseOrders.listValidators, purchaseOrders.list);

const poBillsUpload = purchaseOrders.createBillsUpload();
router.patch('/purchase-orders/:id/status', authorizeEdit, purchaseOrders.statusValidators, purchaseOrders.updateStatus);
router.post(
  '/purchase-orders/:id/bills',
  authorizeEdit,
  wrapMulter(poBillsUpload.array('files', 25)),
  purchaseOrders.uploadBills
);
router.delete(
  '/purchase-orders/:id/bills/:fileIndex',
  ...authorizeDelete,
  purchaseOrders.deletePoBillFileValidators,
  purchaseOrders.deletePoBillFile
);
router.delete(
  '/purchase-orders/:id/bills',
  ...authorizeDelete,
  purchaseOrders.removePoBillValidators,
  purchaseOrders.removePoBill
);
const grnBillsUpload = purchaseOrders.createGrnBillsUpload();
router.post(
  '/purchase-orders/:poId/grns/:grnId/bills',
  authorizeEdit,
  wrapMulter(grnBillsUpload.array('files', 10)),
  purchaseOrders.grnBillParamValidators,
  purchaseOrders.uploadGrnBill
);

router.get('/purchase-orders/:poId/activities', authorize, purchaseOrders.listPurchaseOrderActivities);
router.post('/purchase-orders/:poId/activities', authorizeEdit, purchaseOrders.logPurchaseOrderDocumentActivity);
router.get('/purchase-orders/:id', authorize, purchaseOrders.getValidators, purchaseOrders.getOne);
router.post('/purchase-orders', authorizeCreate, ...purchaseOrders.createValidators(), purchaseOrders.create);
router.put('/purchase-orders/:id', authorizeEdit, purchaseOrders.updateValidators, purchaseOrders.update);
router.patch(
  '/purchase-orders/:id/line-items/:lineIndex/specs',
  authMiddleware,
  checkRole('super_admin'),
  purchaseOrders.updateLineItemSpecsValidators,
  purchaseOrders.updateLineItemSpecs
);
router.delete('/purchase-orders/:id', authorizeDelete, purchaseOrders.getValidators, purchaseOrders.remove);

// GRN + serial numbers (Laravel PurchaseOrderController + serial_numbers table)
router.get('/purchase-orders/:poId/grns', authorize, serials.grnPoParam, serials.listGrnForPo);
router.post('/purchase-orders/:poId/grns', authorizeCreate, serials.grnPoParam, serials.grnCreateValidators, serials.createGrn);
router.get(
  '/grns/:grnId/purchase-orders/:poId/serial-numbers',
  authorize,
  serials.serialParams,
  serials.listSerials
);
// Inserted a laptop with no PO check, no TTSPL, no status and no check at all.
router.post('/serial-numbers', authorizeCreate, retiredReceive);
router.put('/serial-numbers/update', authorizeEdit, serials.serialUpdateValidators, serials.checkAndUpdate);

// Vendor buyout of a rented unit sold in place (PHASE 21). Per-serial only:
// the PO is shared with hundreds of serials and must never be retyped.
router.post(
  '/serials/:serialId/buyout',
  authMiddleware,
  // Procurement (vendor_management) or Accounts, who receive the vendor's buyout bill.
  checkAnySectionPermission(['vendor_management', 'sale_in_place'], 'edit'),
  serials.buyoutValidators,
  serials.recordVendorBuyout
);

// ---------- Spare parts PO ---------------------------------------------------------
router.get('/spare-parts-orders/next-number', authorizeSpareParts, sparePo.nextNumber);
router.get('/spare-parts-orders/form-meta', authorizeSpareParts, sparePo.formMeta);
router.get('/spare-parts-catalog', authorizeSpareParts, spareCatalog.listCatalog);
router.post('/spare-parts-catalog', spareCreate, spareCatalog.createValidators, spareCatalog.createCatalogItem);
router.patch('/spare-parts-catalog/:id', spareEdit, spareCatalog.updateValidators, spareCatalog.updateCatalogItem);
router.patch('/spare-parts-orders/:id/status', spareEdit, sparePo.statusValidators, sparePo.updateStatus);
const spoBillsUpload = sparePo.createSpoBillsUpload();
router.post(
  '/spare-parts-orders/:id/bills',
  spareEdit,
  wrapMulter(spoBillsUpload.array('files', 25)),
  sparePo.uploadBills
);
router.delete(
  '/spare-parts-orders/:id/bills/:fileIndex',
  ...spareDelete,
  sparePo.deleteSpoBillFileValidators,
  sparePo.deleteSpoBillFile
);
router.delete(
  '/spare-parts-orders/:id/bills',
  ...spareDelete,
  sparePo.removeSpoBillValidators,
  sparePo.removeSpoBill
);
router.get(
  '/spare-parts-orders/:spoId/product-received',
  authorizeSpareParts,
  ...sparePo.spareProductReceivedValidators,
  sparePo.getSpareProductReceivedContext
);
router.post(
  '/spare-parts-orders/:spoId/product-received/receive',
  spareEdit,
  ...sparePo.receiveSpareSerialValidators,
  sparePo.receiveSpareLineSerial
);
router.post(
  '/spare-parts-orders/:spoId/product-received/receive-bulk',
  spareEdit,
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
  spareCreate,
  ...sparePo.spareGrnPoParam,
  ...sparePo.spareGrnCreateValidators,
  sparePo.createSpareGrn
);
router.get('/spare-parts-orders', authorizeSpareParts, sparePo.listValidators, sparePo.list);
router.get('/spare-parts-orders/:id', authorizeSpareParts, sparePo.getValidators, sparePo.getOne);
router.post('/spare-parts-orders', spareCreate, ...sparePo.createValidators(), sparePo.create);
router.put('/spare-parts-orders/:id', spareEdit, sparePo.updateValidators, sparePo.update);
router.delete('/spare-parts-orders/:id', spareDelete, sparePo.getValidators, sparePo.remove);

// ---------- Billing (monthly views map to status + period filters) ----------------
router.get('/billing', billingRead, billing.listValidators, billing.list);
router.get('/billing/:id', billingRead, billing.getValidators, billing.getOne);
router.post('/billing', billingCreate, ...billing.createValidators(), billing.create);
router.put('/billing/:id', billingEdit, billing.updateValidators, billing.update);
router.delete('/billing/:id', billingDelete, billing.getValidators, billing.remove);

// ---------- Returns / replacements --------------------------------------------------
router.get('/replaced-products', authorize, replaced.listValidators, replaced.list);
router.get(
  '/replaced-products/inventory-serials',
  authorize,
  replaced.listInventoryValidators,
  replaced.listInventorySerials
);
router.get('/replaced-products/:id', authorize, replaced.getValidators, replaced.getOne);
router.post('/replaced-products', authorizeCreate, ...replaced.createValidators, replaced.create);
router.put('/replaced-products/:id', authorizeEdit, replaced.updateValidators, replaced.update);
router.delete('/replaced-products/:id', authorizeDelete, replaced.getValidators, replaced.remove);

// ---------- Return laptop to vendor (warehouse → original supplier) -----------------
// Procure safety C: VRTDC / VRT numbers contain slashes, so the prefixed routes
// below are the ones that match — and every write among them was guarded by
// VIEW (the edit-guarded :dcNumber routes further down were never reached).
// Writes now require edit; reads stay view.
const authorizeReturnToVendor = [
  authMiddleware,
  checkAnySectionPermission(['vendor_return_to_vendor', 'vendor_management'], 'view'),
];
const rtvCreate = [authMiddleware, checkAnySectionPermission(['vendor_return_to_vendor', 'vendor_management'], 'create')];
const rtvEdit   = [authMiddleware, checkAnySectionPermission(['vendor_return_to_vendor', 'vendor_management'], 'edit')];

router.get('/return-to-vendor/eligible-vendors', authorizeReturnToVendor, vendorReturn.listEligibleVendors);
router.get('/return-to-vendor/eligible-laptops', authorizeReturnToVendor, vendorReturn.listEligible);
router.get('/return-to-vendor/dc', authorizeReturnToVendor, vendorReturn.listDcs);
router.post('/return-to-vendor/dc', rtvCreate, vendorReturn.createDc);
const vrtdcBase = '/return-to-vendor/dc';
router.get(...prefixedDcRoute(vrtdcBase, '/pdf', ...authorizeReturnToVendor, vendorReturn.downloadPdf));
router.post(...prefixedDcRoute(vrtdcBase, '/dispatch', ...rtvEdit, vendorReturn.dispatchDc));
router.post(...prefixedDcRoute(vrtdcBase, '/complete', ...rtvEdit, vendorReturn.completeDc));
router.post(...prefixedDcRoute(vrtdcBase, '/cancel', ...rtvEdit, vendorReturn.cancelDc));

// ---------- VRTDC E-way Bill ----------
// MUST be registered before the catch-all getDc below. A VRTDC number contains
// slashes (VRTDC/26-27/0001), so these use prefixedDcRoute's `^/dc/(.+)/eway$`
// form; a plain :dcNumber route only matches one path segment and the catch-all
// then swallows the whole thing, handing getDc the DC number with "/eway" still
// glued on. `/eway` and `/request-eway` are also in DC_ACTION_SUFFIXES so that
// normalizeDcNumber strips them if anything else ever falls through to here.
//
// The document lands in backend/uploads/vendor-return-eway/<dc>/, behind
// uploadsAuth like the rest of /uploads, so it is not world-readable. Saving is
// NOT gated on vendor_return_to_vendor — it is the Accounts team's job, and the
// controller checks the dc_eway_bill permission itself.
const vrtdcEwayUpload = vendorReturn.createEwayUpload();
router.get(...prefixedDcRoute(vrtdcBase, '/eway', ...authorizeReturnToVendor, vendorReturn.getEwayCompliance));
router.post(...prefixedDcRoute(vrtdcBase, '/request-eway', ...rtvEdit, vendorReturn.requestEwayBill));
router.post(...prefixedDcRoute(
  vrtdcBase,
  '/eway',
  authMiddleware,
  vendorReturn.requireEwayUploader,
  wrapMulter(vrtdcEwayUpload.single('eway_bill_pdf')),
  vendorReturn.saveEwayBill
));
router.post(...prefixedDcRoute(vrtdcBase, '/item-values', ...rtvEdit, vendorReturn.setItemValues));
router.get(...prefixedDcRoute(vrtdcBase, '/eway-pdf', ...authorizeReturnToVendor, vendorReturn.downloadEwayPdf));

router.get(...prefixedDcRoute(vrtdcBase, '', ...authorizeReturnToVendor, vendorReturn.getDc));
router.get('/return-to-vendor/dc/:dcNumber', authorizeReturnToVendor, vendorReturn.getDc);
router.post('/return-to-vendor/dc/:dcNumber/dispatch', rtvEdit, vendorReturn.dispatchDc);
router.post('/return-to-vendor/dc/:dcNumber/complete', rtvEdit, vendorReturn.completeDc);
router.post('/return-to-vendor/dc/:dcNumber/cancel', rtvEdit, vendorReturn.cancelDc);

// ---------- Vendor rental return ticket (wraps VRTDC; rent stops on notify) ----------
const authorizeReturnTicket = [
  authMiddleware,
  checkAnySectionPermission(['vendor_return_ticket', 'vendor_return_to_vendor', 'vendor_management'], 'view'),
];
const vrtSections = ['vendor_return_ticket', 'vendor_return_to_vendor', 'vendor_management'];
const vrtCreate = [authMiddleware, checkAnySectionPermission(vrtSections, 'create')];
const vrtEdit   = [authMiddleware, checkAnySectionPermission(vrtSections, 'edit')];
router.get('/return-ticket/eligible-vendors', authorizeReturnTicket, vendorReturnTicket.listEligibleVendors);
router.get('/return-ticket/eligible-laptops', authorizeReturnTicket, vendorReturnTicket.listEligible);
router.get('/return-ticket', authorizeReturnTicket, vendorReturnTicket.listTickets);
router.post('/return-ticket', vrtCreate, vendorReturnTicket.createTicket);
const vrtBase = '/return-ticket';
router.post(...prefixedDcRoute(vrtBase, '/notify', ...vrtEdit, vendorReturnTicket.notifyVendor));
router.post(...prefixedDcRoute(vrtBase, '/dc', ...vrtEdit, vendorReturnTicket.createDc));
router.post(...prefixedDcRoute(vrtBase, '/items/cancel', ...vrtEdit, vendorReturnTicket.cancelItems));
router.post(...prefixedDcRoute(vrtBase, '/cancel', ...vrtEdit, vendorReturnTicket.cancelTicket));
router.get(...prefixedDcRoute(vrtBase, '', ...authorizeReturnTicket, vendorReturnTicket.getTicket));
router.get('/return-ticket/:ticketNumber', authorizeReturnTicket, vendorReturnTicket.getTicket);
router.post('/return-ticket/:ticketNumber/notify', vrtEdit, vendorReturnTicket.notifyVendor);
router.post('/return-ticket/:ticketNumber/dc', vrtEdit, vendorReturnTicket.createDc);
router.post('/return-ticket/:ticketNumber/items/cancel', vrtEdit, vendorReturnTicket.cancelItems);
router.post('/return-ticket/:ticketNumber/cancel', vrtEdit, vendorReturnTicket.cancelTicket);

module.exports = router;
