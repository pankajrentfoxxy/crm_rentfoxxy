const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const cp = checkSectionPermission;
const invView = cp('inventory_management', 'view');
const invCreate = cp('inventory_management', 'create');
const invEdit = cp('inventory_management', 'edit');
const {
    addInventory,
    updateInventory,
    triggerErpSync,
    triggerSingleErpSync,
    getInventory,
    searchByMachineOrSerial,
    uploadBulk,
    getSpecs,
    searchAvailableInventory,
    uploadLaptopCatalogCsv,
    getLaptopCatalogOptions,
    traceMachineNumber,
    getMachineLifecycleHistory
} = require('../controllers/inventoryController');
const { getInventoryStockSummary } = require('../controllers/inventoryStockSummary');

const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// Debug: trace model/source for a machine number (ERP sync investigation)
router.get('/trace/:machineNumber', authMiddleware, traceMachineNumber);

router.use(authMiddleware);

// List inventory (same access as search: core roles + granular inventory_* permissions)
router.get('/', invView, getInventory);

router.get('/summary', invView, getInventoryStockSummary);

// Get unique specs for dropdowns (Sales & All)
router.get('/specs', getSpecs);

// Search available inventory by specs (Sales)
router.get('/available', searchAvailableInventory);
router.get('/catalog/options', getLaptopCatalogOptions);

router.get('/search', invView, searchByMachineOrSerial);

router.post('/', invCreate, addInventory);

router.get('/:identifier/history', invView, getMachineLifecycleHistory);

router.put('/:identifier', invEdit, updateInventory);

// Trigger ERP sync
router.post('/sync', invEdit, triggerErpSync);
router.post('/sync/:identifier', invEdit, triggerSingleErpSync);

// Bulk Upload
router.post('/upload', invCreate, upload.single('file'), uploadBulk);
router.post('/catalog/upload', invCreate, upload.single('file'), uploadLaptopCatalogCsv);
// Note: team_member should technically be filtered by 'Warehouse Team' in logic or here, but keeping broad for now based on 'Access by Warehouse and admin' request. 
// Ideally we check if team_name is Warehouse. For now, role check is basic.

module.exports = router;
