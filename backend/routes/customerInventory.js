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
router.post('/sync', cp('inventory_management', 'edit'), triggerFullSync);
router.post('/sync/:customerId', cp('inventory_management', 'edit'), triggerCustomerSync);

module.exports = router;
