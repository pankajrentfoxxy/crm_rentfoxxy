const express = require('express');
const router = express.Router();
const { getAllParts, createPart, updatePartQuantity, updatePart, getPartUsage } = require('../controllers/partController');
const { getPartsGrouped } = require('../controllers/partsDropdownController');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const cp = checkSectionPermission;

router.use(authMiddleware);

// @route   GET /api/parts
// @desc    Get all parts
// @access  Private
router.get('/', getAllParts);

// @route   GET /api/parts/grouped
// @desc    Get parts grouped by category
router.get('/grouped', getPartsGrouped);

// @route   POST /api/parts
// @desc    Create a new part
// @access  Private (Manager, Admin)
router.post('/', cp('parts_inventory', 'create'), createPart);

router.get('/:id/usage', getPartUsage);

// @route   PUT /api/parts/:id
// @desc    Update part details
// @access  Private (Manager, Admin)
router.put('/:id', cp('parts_inventory', 'edit'), updatePart);

// @route   PUT /api/parts/:id/quantity
// @desc    Update part quantity
// @access  Private (Manager, Admin)
router.put('/:id/quantity', cp('parts_inventory', 'edit'), updatePartQuantity);

module.exports = router;
