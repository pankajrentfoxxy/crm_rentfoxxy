const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/einvoiceController');

const cp = checkSectionPermission;

router.use(authMiddleware);

router.get('/dc/:dcNumber/status', cp('einvoice_ewb', 'view'), ctrl.getDcEInvoiceStatus);
router.post('/dc/:dcNumber/generate', cp('einvoice_ewb', 'create'), ctrl.generateDcEInvoice);
router.post('/dc/:dcNumber/cancel', cp('einvoice_ewb', 'edit'), ctrl.cancelDcEInvoice);
router.post('/dc/:dcNumber/ewb', cp('einvoice_ewb', 'create'), ctrl.generateDcEWayBill);
router.post('/dc/:dcNumber/send-email', cp('einvoice_ewb', 'edit'), ctrl.sendEInvoiceEmail);

module.exports = router;
