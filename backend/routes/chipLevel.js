const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const {
  getChipRepair,
  saveChipRepair,
  submitChipRepair
} = require('../controllers/chipLevelController');

router.use(authMiddleware);

// F12: these needed only a login.
router.get('/ticket/:id', checkSectionPermission('chip_level_repair', 'view'), getChipRepair);
router.post('/ticket/:id', checkSectionPermission('chip_level_repair', 'edit'), saveChipRepair);
router.post('/ticket/:id/submit', checkSectionPermission('chip_level_repair', 'edit'), submitChipRepair);

module.exports = router;
