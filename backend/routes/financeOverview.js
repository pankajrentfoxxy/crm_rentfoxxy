const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/financeOverviewController');
const gstDocs = require('../controllers/gstDocumentsController');

const cp = checkSectionPermission;

router.use(authMiddleware);

router.get('/counts', cp('billing_dashboard', 'view'), ctrl.getCounts);
router.get('/dashboard', cp('billing_dashboard', 'view'), ctrl.getDashboard);
router.get('/einvoice-queue', cp('einvoice_ewb', 'view'), ctrl.getEinvoiceQueue);
router.get('/dc-invoice-queue', cp('einvoice_ewb', 'view'), ctrl.getDcInvoiceQueue);
// Sale-in-place orders produce no DC, so they need their own accounts queue (PHASE 21).
router.get('/sale-invoice-queue', cp('einvoice_ewb', 'view'), ctrl.getSaleInvoiceQueue);
// GST & e-way (MD7): read-only e-way register across DC / demo DC / VRDC / VRTDC /
// scrap challans, and the attach/replace audit of one document's numbers.
// Same section as the queues above.
router.get('/eway-bills', cp('einvoice_ewb', 'view'), gstDocs.getEwayRegister);
router.get('/number-changes', cp('einvoice_ewb', 'view'), gstDocs.getNumberChanges);

module.exports = router;
