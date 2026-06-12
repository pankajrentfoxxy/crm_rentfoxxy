const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/financeOverviewController');

const cp = checkSectionPermission;

router.use(authMiddleware);

router.get('/counts', cp('billing_dashboard', 'view'), ctrl.getCounts);
router.get('/dashboard', cp('billing_dashboard', 'view'), ctrl.getDashboard);
router.get('/einvoice-queue', cp('einvoice_ewb', 'view'), ctrl.getEinvoiceQueue);

module.exports = router;
