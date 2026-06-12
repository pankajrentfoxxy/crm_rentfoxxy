const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middleware/auth');
const ctrl = require('../controllers/einvoiceController');

const viewRoles = ['admin', 'manager', 'accounts', 'sales', 'dispatch', 'warehouse'];
const einvoiceRoles = ['admin', 'manager', 'accounts'];
const ewbRoles = ['admin', 'manager', 'accounts', 'dispatch'];

router.use(authMiddleware);

router.get('/dc/:dcNumber/status', checkRole(...viewRoles), ctrl.getDcEInvoiceStatus);
router.post('/dc/:dcNumber/generate', checkRole(...einvoiceRoles), ctrl.generateDcEInvoice);
router.post('/dc/:dcNumber/cancel', checkRole(...einvoiceRoles), ctrl.cancelDcEInvoice);
router.post('/dc/:dcNumber/ewb', checkRole(...ewbRoles), ctrl.generateDcEWayBill);
router.post('/dc/:dcNumber/send-email', checkRole(...einvoiceRoles), ctrl.sendEInvoiceEmail);

module.exports = router;
