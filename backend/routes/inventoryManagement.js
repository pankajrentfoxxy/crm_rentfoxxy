/**
 * Inventory Management REST API — Laravel admin/inventory routes parity.
 */
const express = require('express');
const { authMiddleware, checkRoleOrPermission } = require('../middleware/auth');
const inventoryList = require('../controllers/inventoryManagement/inventoryList.controller');
const serialStatus = require('../controllers/inventoryManagement/serialStatus.controller');
const universalSearch = require('../controllers/inventoryManagement/universalSearch.controller');

const router = express.Router();

const authorize = [
  authMiddleware,
  checkRoleOrPermission(
    ['admin', 'manager', 'floor_manager'],
    ['inventory_read', 'inventory_write', 'inventory_access', 'inventory_management_access']
  )
];

router.get('/', authorize, (req, res) =>
  res.json({
    success: true,
    module: 'Inventory Management',
    endpoints: [
      '/lists/counts',
      '/lists/:segment',
      '/serial-number-status',
      '/universal-search',
      '/spare-parts',
      '/spare-parts/change-status',
      '/ready-to-rent-action'
    ]
  })
);

router.get('/lists/counts', authorize, inventoryList.getListCounts);
router.post(
  '/spare-parts/change-status',
  authorize,
  inventoryList.changeSparePartStatusValidators,
  inventoryList.changeSparePartStatus
);
router.post(
  '/ready-to-rent-action',
  authorize,
  inventoryList.readyToRentActionValidators,
  inventoryList.updateReadyToRentAction
);
router.get('/lists/:segment', authorize, inventoryList.listValidators, inventoryList.listInventory);
router.get('/serial-number-status', authorize, serialStatus.searchValidators, serialStatus.serialNumberStatus);
router.get('/universal-search', authorize, universalSearch.searchValidators, universalSearch.universalSearch);

router.get('/spare-parts', authorize, (req, res) => {
  req.params.segment = 'spare_parts';
  return inventoryList.listInventory(req, res);
});

router.patch(
  '/:id/tag',
  authorize,
  inventoryList.tagInventoryValidators,
  inventoryList.tagInventoryItem
);

module.exports = router;
