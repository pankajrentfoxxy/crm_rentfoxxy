const express = require('express');
const router = express.Router();
const { getAllParts, createPart, updatePartQuantity, updatePart, getPartUsage } = require('../controllers/partController');
const { getPartsGrouped } = require('../controllers/partsDropdownController');
const {
  lookupPartUnit, searchPartUnits, getUnitQrPng, printPartLabels,
} = require('../controllers/partUnitController');
const {
  getPartsDashboard, getPartsDashboardDrilldown,
} = require('../controllers/partsDashboardController');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const { SUPPORT_PARTS_CATALOG_SECTIONS } = require('../middleware/supportAccess');
const cp = checkSectionPermission;

router.use(authMiddleware);

// Floor technicians and support staff need the parts catalog during diagnosis / ticket visits.
const partsCatalogView = checkAnySectionPermission(
  [
    'parts_inventory',
    'parts',
    'floor_tickets',
    'floor_pipeline',
    'tickets',
    'parts_requests',
    ...SUPPORT_PARTS_CATALOG_SECTIONS,
  ],
  'view'
);

// Physical units: scanning a QR label and reprinting labels. Registered before
// the `/:id` routes so "units" is never read as a part id.
router.get('/units/lookup', partsCatalogView, lookupPartUnit);
router.get('/units', partsCatalogView, searchPartUnits);
router.get('/units/:code/qr.png', partsCatalogView, getUnitQrPng);
router.post('/labels/print', partsCatalogView, printPartLabels);

// Parts tracking dashboard.
router.get('/dashboard', checkAnySectionPermission(['parts_dashboard', 'parts_inventory'], 'view'), getPartsDashboard);
router.get('/dashboard/drilldown', checkAnySectionPermission(['parts_dashboard', 'parts_inventory'], 'view'), getPartsDashboardDrilldown);

// @route   GET /api/parts
// @desc    Get / search parts by part_name (?search=)
// @access  Private (inventory OR floor catalog viewers)
router.get('/', partsCatalogView, getAllParts);

// @route   GET /api/parts/grouped
// @desc    Get parts grouped by category (diagnosis dropdown + inventory)
router.get('/grouped', partsCatalogView, getPartsGrouped);

// @route   POST /api/parts
// @desc    Create a new part
// @access  Private (Manager, Admin)
router.post('/', cp('parts_inventory', 'create'), createPart);

router.get('/:id/usage', cp('parts_inventory', 'view'), getPartUsage);

// @route   PUT /api/parts/:id
// @desc    Update part details
// @access  Private (Manager, Admin)
router.put('/:id', cp('parts_inventory', 'edit'), updatePart);

// @route   PUT /api/parts/:id/quantity
// @desc    Update part quantity
// @access  Private (Manager, Admin)
router.put('/:id/quantity', cp('parts_inventory', 'edit'), updatePartQuantity);

module.exports = router;
