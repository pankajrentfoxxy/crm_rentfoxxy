/**
 * Vendor portal API — separate auth from internal CRM users.
 * Base path: /api/vendor-portal
 */
const express = require('express');
const portal = require('../controllers/vendorPortalController');
const { vendorPortalAuth } = require('../middleware/vendorPortalAuth');
const { wrapMulter } = require('../config/uploadLimits');

const router = express.Router();

router.post('/login', portal.loginValidators, portal.login);
router.post('/logout', vendorPortalAuth, portal.logout);
router.get('/me', vendorPortalAuth, portal.me);
router.get('/dashboard', vendorPortalAuth, portal.dashboardStats);

router.get('/purchase-orders', vendorPortalAuth, portal.listPoValidators, portal.listPurchaseOrders);
router.get('/purchase-orders/:poId', vendorPortalAuth, portal.poIdParam, portal.getPurchaseOrder);
router.get('/purchase-orders/:poId/pdf', vendorPortalAuth, portal.poIdParam, portal.downloadPurchaseOrderPdf);
router.post('/purchase-orders/:poId/accept', vendorPortalAuth, portal.poIdParam, portal.acceptPurchaseOrder);
router.post('/purchase-orders/:poId/reject', vendorPortalAuth, portal.rejectPoValidators, portal.rejectPurchaseOrder);
router.post(
  '/purchase-orders/:poId/upload-invoice',
  vendorPortalAuth,
  portal.poIdParam,
  wrapMulter(portal.createVendorInvoiceUpload().single('file')),
  portal.uploadPurchaseOrderInvoice
);

router.get('/serial-numbers', vendorPortalAuth, portal.listSerialValidators, portal.listSerialNumbers);
router.get('/bills', vendorPortalAuth, portal.listBillsValidators, portal.listVendorBills);
router.get('/bills/:billId', vendorPortalAuth, portal.billIdParam, portal.getBillDetail);
router.get('/debit-notes', vendorPortalAuth, portal.listVendorDebitNotes);
router.get('/returns', vendorPortalAuth, portal.listReturnsValidators, portal.listVendorReturns);

module.exports = router;
