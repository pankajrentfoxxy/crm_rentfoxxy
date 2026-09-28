const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { legacyOrSection, hasLegacyPermission } = require('../middleware/legacyOrSection');
const { getWarehouseItems, markReady, replaceMachine } = require('../controllers/warehouseController');

// CT1: role / legacy permissions[] as before, OR the warehouse grant in Roles & Permissions.
const requireWarehouseAccess = legacyOrSection(
  (u) => ['admin', 'manager', 'warehouse'].includes(u.role) || hasLegacyPermission(u, 'warehouse_access'),
  'warehouse', 'edit',
  { message: 'Access denied: Warehouse access required' },
);

router.use(authMiddleware);

router.get('/', requireWarehouseAccess, getWarehouseItems);
router.post('/items/:item_id/ready', requireWarehouseAccess, markReady);
router.post('/items/:item_id/replace', requireWarehouseAccess, replaceMachine);

module.exports = router;
