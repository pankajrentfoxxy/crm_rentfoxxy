const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/vendorRepairController');

const floorView = checkSectionPermission('floor_pipeline', 'view');
const invView = checkSectionPermission('inventory_management', 'view');

router.use(authMiddleware);

router.get('/company-defaults', floorView, ctrl.getCompanyDefaults);
router.get('/dc', floorView, ctrl.listVendorRepairDcs);
router.get('/diagnosis-failed', floorView, ctrl.listDiagnosisFailed);
router.get('/inventory', invView, ctrl.listOutForRepairInventory);
router.get('/inventory/count', invView, ctrl.getOutForRepairInventoryCount);
router.get('/inventory/export.xlsx', invView, ctrl.exportOutForRepairExcel);
router.get('/inventory/export.pdf', invView, ctrl.exportOutForRepairPdf);
router.get('/dc/:dcNumber', floorView, ctrl.getVendorRepairDc);
router.get('/dc/:dcNumber/pdf', floorView, ctrl.downloadPdf);

router.post('/out-for-repair', ctrl.requireWarehouse, ctrl.createOutForRepair);
router.post('/dc/:dcNumber/dispatch-sign', ctrl.requireWarehouse, ctrl.signDispatch);
router.post('/dc/:dcNumber/receive-back', ctrl.requireWarehouse, ctrl.receiveBack);
router.get('/dc/:dcNumber/receive-pdf', floorView, ctrl.downloadReceivePdf);
router.post('/inventory/erp/:serialId/receive-back', ctrl.requireWarehouse, ctrl.receiveErpRepairBack);

module.exports = router;
