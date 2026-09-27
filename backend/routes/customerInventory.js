const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const {
    listCustomers,
    getCustomerDetail,
    triggerFullSync,
    triggerCustomerSync
} = require('../controllers/customerInventoryController');

// NOTE: customer_inventory is deprecated (see migration 074). These endpoints
// remain for historical reads only; gated via the matrix.
const cp = checkSectionPermission;

router.use(authMiddleware);

router.get('/customers', cp('customer_assets', 'view'), listCustomers);
router.get('/customers/:customerId', cp('customer_assets', 'view'), getCustomerDetail);
// The ERP re-sync DELETEs and re-inserts customer_inventory, which support
// still reads for old rates. The periodic worker is off (server.js); anyone
// with inventory edit could still wipe it by hand. Super admin only now.
const { checkRole } = require('../middleware/auth');
router.post('/sync', checkRole('super_admin'), triggerFullSync);
router.post('/sync/:customerId', checkRole('super_admin'), triggerCustomerSync);

module.exports = router;
