const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const { vrdcRoute } = require('../middleware/dcNumberRoutes');
const ctrl = require('../controllers/vendorRepairController');

const invView = checkSectionPermission('inventory_management', 'view');
/** Laptop Vendor Repair DC list/detail/PDF — dedicated RBAC (+ legacy floor viewers). */
const vendorRepairView = checkAnySectionPermission(
  ['vendor_repair_dc', 'vendor_repair_dc_dispatch', 'floor_pipeline', 'vendor_management'],
  'view'
);
const diagnosisFailedView = checkAnySectionPermission(
  ['diagnosis_failed', 'floor_pipeline'],
  'view'
);

router.use(authMiddleware);

router.get('/company-defaults', checkAnySectionPermission(['vendor_repair_dc', 'floor_pipeline', 'diagnosis_failed'], 'view'), ctrl.getCompanyDefaults);
router.get('/dc', vendorRepairView, ctrl.listVendorRepairDcs);
router.get('/diagnosis-failed', diagnosisFailedView, ctrl.listDiagnosisFailed);
router.get('/inventory', invView, ctrl.listOutForRepairInventory);
router.get('/inventory/count', invView, ctrl.getOutForRepairInventoryCount);
router.get('/inventory/export.xlsx', invView, ctrl.exportOutForRepairExcel);
router.get('/inventory/export.pdf', invView, ctrl.exportOutForRepairPdf);

router.post('/out-for-repair', ctrl.requireDiagnosisFailedProcess, ctrl.createOutForRepair);
router.get(...vrdcRoute('/pdf', vendorRepairView, ctrl.downloadPdf));
router.get(...vrdcRoute('/receive-pdf', vendorRepairView, ctrl.downloadReceivePdf));
router.patch(...vrdcRoute('/dispatch-details', ctrl.requireVendorRepairDispatch, ctrl.updateDispatchDetails));
router.patch(...vrdcRoute('/commercial-details', ctrl.requireWarehouse, ctrl.updateCommercialDetails));
router.post(...vrdcRoute('/mark-delivered-to-vendor', ctrl.requireVendorRepairDispatch, ctrl.markDeliveredToVendor));
router.post(...vrdcRoute('/dispatch-sign', ctrl.requireVendorRepairDispatch, ctrl.signDispatch));
router.post(...vrdcRoute('/receive-back', ctrl.requireWarehouse, ctrl.receiveBack));
router.post(...vrdcRoute('/send-accounts-eway-mail', vendorRepairView, ctrl.sendAccountsVrdcEwayMail));
router.post(...vrdcRoute('/vrdc-eway', ctrl.requireVrdcEwayUpload, ctrl.uploadVrdcEway));
router.get(...vrdcRoute('', vendorRepairView, ctrl.getVendorRepairDc));

router.post('/inventory/erp/:serialId/receive-back', ctrl.requireWarehouse, ctrl.receiveErpRepairBack);

module.exports = router;
