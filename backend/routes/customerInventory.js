const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middleware/auth');
const {
    listCustomers,
    getCustomerDetail,
    triggerFullSync,
    triggerCustomerSync
} = require('../controllers/customerInventoryController');

router.use(authMiddleware);

// Support / ops: admin & manager (same scope as reports-style tools)
router.get('/customers', checkRole('admin', 'manager', 'floor_manager'), listCustomers);
router.get('/customers/:customerId', checkRole('admin', 'manager', 'floor_manager'), getCustomerDetail);
router.post('/sync', checkRole('admin', 'manager'), triggerFullSync);
router.post('/sync/:customerId', checkRole('admin', 'manager'), triggerCustomerSync);

module.exports = router;
