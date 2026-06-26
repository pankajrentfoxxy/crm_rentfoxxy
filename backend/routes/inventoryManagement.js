/**
 * Inventory Management REST API — Laravel admin/inventory routes parity.
 */
const express = require('express');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const inventoryList = require('../controllers/inventoryManagement/inventoryList.controller');
const serialStatus = require('../controllers/inventoryManagement/serialStatus.controller');
const universalSearch = require('../controllers/inventoryManagement/universalSearch.controller');

const router = express.Router();

const invView = [authMiddleware, checkSectionPermission('inventory_management', 'view')];
const custInvView = [authMiddleware, checkSectionPermission('customer_inventory', 'view')];
const moduleEntry = [
  authMiddleware,
  checkAnySectionPermission(
    ['inventory', 'inventory_management', 'parts', 'parts_inventory', 'customer_inventory', 'ttspl_history'],
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
      '/ready-to-rent-action'
    ]
  })
);

router.get('/lists/counts', invView, inventoryList.getListCounts);
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
router.get('/lists/:segment', invView, inventoryList.listValidators, inventoryList.listInventory);
router.get('/serial-number-status', invView, serialStatus.searchValidators, serialStatus.serialNumberStatus);
router.get('/universal-search', invView, universalSearch.searchValidators, universalSearch.universalSearch);

router.get('/spare-parts', invView, (req, res) => {
  req.params.segment = 'spare_parts';
  return inventoryList.listInventory(req, res);
});

router.patch(
  '/:id/tag',
  invView,
  inventoryList.tagInventoryValidators,
  inventoryList.tagInventoryItem
);

module.exports = router;
