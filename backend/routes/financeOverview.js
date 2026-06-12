const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middleware/auth');
const ctrl = require('../controllers/financeOverviewController');

const roles = ['admin', 'manager', 'accounts'];

router.use(authMiddleware);

router.get('/counts', checkRole(...roles), ctrl.getCounts);
router.get('/dashboard', checkRole(...roles), ctrl.getDashboard);
router.get('/einvoice-queue', checkRole(...roles), ctrl.getEinvoiceQueue);

module.exports = router;
