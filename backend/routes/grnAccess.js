const express = require('express');
const ctrl = require('../controllers/grnAccessController');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/', checkSectionPermission('vendor_management', 'view'), ctrl.listAccessNumbers);
router.get('/attempts', checkSectionPermission('vendor_management', 'view'), ctrl.listAttempts);
router.patch('/:id/expire', checkSectionPermission('vendor_management', 'edit'), ...ctrl.idValidators, ctrl.expireAccessNumber);
router.delete('/:id', checkSectionPermission('vendor_management', 'edit'), ...ctrl.idValidators, ctrl.removeAccessNumber);

module.exports = router;
