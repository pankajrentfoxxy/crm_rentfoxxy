/**
 * Inventory Management REST API — Laravel admin/inventory routes parity.
 */
const express = require('express');
const { authMiddleware, checkRole, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const inventoryList = require('../controllers/inventoryManagement/inventoryList.controller');
const qcProcess = require('../controllers/inventoryManagement/qcProcess.controller');
const serialStatus = require('../controllers/inventoryManagement/serialStatus.controller');
const universalSearch = require('../controllers/inventoryManagement/universalSearch.controller');
const assetMovement = require('../controllers/inventoryManagement/assetMovement.controller');
const masterData = require('../controllers/inventoryManagement/masterData.controller');
const vendorMasterData = require('../controllers/inventoryManagement/vendorMasterData.controller');
const returnMasterData = require('../controllers/inventoryManagement/returnMasterData.controller');

const router = express.Router();

const invView = [authMiddleware, checkSectionPermission('inventory_management', 'view')];
const masterDataView = [authMiddleware, checkSectionPermission('inventory_master_data', 'view')];
const vendorMasterDataView = [
  authMiddleware,
  checkRole('admin', 'super_admin'),
  checkSectionPermission('inventory_vendor_master_data', 'view'),
];
const returnMasterDataView = [
  authMiddleware,
  checkRole('admin', 'super_admin'),
  checkSectionPermission('inventory_return_master_data', 'view'),
];
const invEdit = [authMiddleware, checkSectionPermission('inventory_management', 'edit')];
const invAdmin = [
  authMiddleware,
  checkRole('admin', 'super_admin'),
  checkSectionPermission('inventory_management', 'edit')
];
const invSpecEdit = [
  authMiddleware,
  checkAnySectionPermission(['inventory_management', 'qc_management'], 'edit')
];
const assetMovementAccess = [
  authMiddleware,
  checkAnySectionPermission(['inventory_asset_movement'], 'edit')
];
const superAdminOnly = [authMiddleware, checkRole('super_admin')];
const custInvView = [authMiddleware, checkSectionPermission('customer_inventory', 'view')];
const moduleEntry = [
  authMiddleware,
  checkAnySectionPermission(
    ['inventory', 'inventory_management', 'inventory_master_data', 'inventory_vendor_master_data', 'inventory_return_master_data', 'inventory_asset_movement', 'parts', 'parts_dashboard', 'parts_inventory', 'parts_approval', 'parts_history', 'parts_discarded', 'scrap_challans', 'part_vendor_repair', 'customer_inventory', 'ttspl_history'],
    'view'
  ),
];

router.get('/', moduleEntry, (req, res) =>
  res.json({
    success: true,
    module: 'Inventory Management',
    endpoints: [
      '/lists/counts',
      '/lists/:segment',
      '/serial-number-status',
      '/universal-search',
      '/spare-parts',
      '/ready-to-rent-action',
      '/qc-process/add-laptop',
      '/qc-process/move-from-passed',
      '/qc-process/move-from-qc-pending',
      '/qc-process/create-production-ticket',
      '/asset-movement/search',
      '/asset-movement/bulk-move',
      '/:id/remark'
    ]
  })
);

router.post(
  '/qc-process/add-laptop',
  invAdmin,
  qcProcess.addLaptopValidators,
  qcProcess.addLaptop
);
router.post(
  '/qc-process/move-from-passed',
  invEdit,
  qcProcess.moveToQcValidators,
  qcProcess.moveToQcProcess
);
router.post(
  '/qc-process/move-from-qc-pending',
  invAdmin,
  qcProcess.moveFromQcPendingValidators,
  qcProcess.moveFromQcPending
);
router.post(
  '/qc-process/move-dead-to-qc-process',
  invAdmin,
  qcProcess.moveDeadToQcValidators,
  qcProcess.moveDeadToQcProcess
);
router.post(
  '/qc-process/create-production-ticket',
  invView,
  qcProcess.createProductionTicketValidators,
  qcProcess.createProductionTicket
);

router.get('/asset-movement/search', assetMovementAccess, assetMovement.searchValidators, assetMovement.searchAssets);
router.post(
  '/asset-movement/bulk-move',
  assetMovementAccess,
  assetMovement.bulkMoveValidators,
  assetMovement.bulkMove
);

router.get('/lists/counts', invView, inventoryList.getListCounts);
router.get('/master-data/kpis', masterDataView, masterData.getMasterDataKpis);
router.get('/master-data/export.xlsx', masterDataView, masterData.exportMasterDataExcel);
router.patch(
  '/master-data/vendors/:vendorId/exclude-from-vendor-po',
  masterDataView,
  masterData.setVendorExcludeValidators,
  masterData.setVendorExcludeFromVendorPo
);
router.get('/master-data', masterDataView, masterData.getMasterDataDashboard);
router.get('/vendor-master-data/overview', vendorMasterDataView, vendorMasterData.getOverview);
router.get('/vendor-master-data/export.xlsx', vendorMasterDataView, vendorMasterData.exportExcel);
router.get('/vendor-master-data/laptops', vendorMasterDataView, vendorMasterData.listLaptops);
router.get('/return-master-data/overview', returnMasterDataView, returnMasterData.getOverview);
router.get('/return-master-data/export.xlsx', returnMasterDataView, returnMasterData.exportExcel);
router.get('/return-master-data/laptops', returnMasterDataView, returnMasterData.listLaptops);
router.get('/customer-assets', custInvView, inventoryList.customerAssetsValidators, inventoryList.customerAssets);
router.post(
  '/spare-parts/change-status',
  invView,
  inventoryList.changeSparePartStatusValidators,
  inventoryList.changeSparePartStatus
);
router.post(
  '/ready-to-rent-action',
  invView,
  inventoryList.readyToRentActionValidators,
  inventoryList.updateReadyToRentAction
);
router.get('/lists/:segment/export.xlsx', invView, inventoryList.listValidators, inventoryList.exportInventoryExcel);
router.get('/lists/:segment', invView, inventoryList.listValidators, inventoryList.listInventory);
router.get('/serial-number-status', invView, serialStatus.searchValidators, serialStatus.serialNumberStatus);
router.get('/universal-search', invView, universalSearch.searchValidators, universalSearch.universalSearch);

router.get('/spare-parts', invView, (req, res) => {
  req.params.segment = 'spare_parts';
  return inventoryList.listInventory(req, res);
});

router.patch(
  '/:id/remark',
  invAdmin,
  inventoryList.remarkValidators,
  inventoryList.updateSerialRemark
);
router.patch(
  '/:id/tag',
  invView,
  inventoryList.tagInventoryValidators,
  inventoryList.tagInventoryItem
);
router.patch(
  '/:id/item-description',
  invSpecEdit,
  inventoryList.itemDescriptionValidators,
  inventoryList.updateItemDescription
);
router.patch(
  '/:id/qc-status',
  superAdminOnly,
  inventoryList.qcStatusValidators,
  inventoryList.updateSerialQcStatus
);

module.exports = router;
