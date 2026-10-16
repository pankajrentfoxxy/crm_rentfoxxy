const express = require('express');
const { authMiddleware, checkAnySectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/challanChargerController');

// Charger with / without on DC, Service DC, Replacement DC, Return DC and Repair DC (migration 430).
const SECTIONS = ['delivery_challans', 'return_dc', 'vendor_repair_dc', 'vendor_management', 'support_tickets', 'dispatch_charger', 'sales_orders'];
const router = express.Router();
router.use(authMiddleware);
router.get('/', checkAnySectionPermission(SECTIONS, 'view'), ctrl.get);
router.post('/mark', checkAnySectionPermission(SECTIONS, 'edit'), ctrl.mark);
module.exports = router;
