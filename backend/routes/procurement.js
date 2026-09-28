const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { legacyOrSection, hasLegacyPermission } = require('../middleware/legacyOrSection');
const { getRequests, updateRequestStatus, receiveItem, assignExistingInventory } = require('../controllers/procurementController');

// CT1: role / legacy permissions[] as before, OR the procurement grant in Roles & Permissions.
const requireProcurementAccess = legacyOrSection(
  (u) => ['admin', 'manager', 'procurement'].includes(u.role) || hasLegacyPermission(u, 'procurement_access'),
  'procurement', 'edit',
  { message: 'Access denied: Procurement access required' },
);

router.use(authMiddleware);

router.get('/', requireProcurementAccess, getRequests);
router.put('/:request_id', requireProcurementAccess, updateRequestStatus);
router.post('/receive', requireProcurementAccess, receiveItem);
router.post('/assign', requireProcurementAccess, assignExistingInventory);

module.exports = router;

