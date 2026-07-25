const express = require('express');
const router = express.Router();
const { getAllParts, createPart, updatePartQuantity, updatePart, getPartUsage } = require('../controllers/partController');
const { getPartsGrouped } = require('../controllers/partsDropdownController');
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
