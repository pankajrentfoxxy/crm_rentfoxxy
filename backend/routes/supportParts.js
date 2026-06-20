'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/supportPartsController');
const { authMiddleware } = require('../middleware/auth');

const requireWarehouse = (req, res, next) => {
  if (!['warehouse', 'admin', 'support_lead', 'manager', 'super_admin'].includes(req.user?.role))
    return res.status(403).json({ success: false, message: 'Warehouse access required' });
  next();
};
const requireSupportOrWarehouse = (req, res, next) => {
  if (!['support_tech', 'support_lead', 'warehouse', 'admin', 'manager', 'super_admin'].includes(req.user?.role))
    return res.status(403).json({ success: false, message: 'Not authorised' });
  next();
};

router.use(authMiddleware);

// Part requests
router.post('/requests',                          requireSupportOrWarehouse, ctrl.raiseSupportPartRequest);
router.get('/requests',                           requireSupportOrWarehouse, ctrl.listSupportPartRequests);
router.post('/requests/approve-and-challan',      requireWarehouse,          ctrl.approveAndGenerateChallan);
router.patch('/requests/:requestId/mark-used',    requireSupportOrWarehouse, ctrl.markPartUsed);
router.post('/requests/:requestId/return',        requireSupportOrWarehouse, ctrl.returnPart);
router.patch('/requests/:requestId/accept-return', requireWarehouse,         ctrl.acceptReturn);
router.post('/requests/:requestId/request-reassign', requireSupportOrWarehouse, ctrl.requestReassign);
router.patch('/requests/:requestId/resolve-reassign', requireWarehouse,        ctrl.resolveReassign);

// Parts movement history (inventory ledger)
router.get('/history',                             requireWarehouse, ctrl.getPartsHistory);

// Challans
router.get('/challans/:challanId',                 ctrl.getChallan);
router.post('/challans/:challanId/sign-and-issue', requireSupportOrWarehouse, ctrl.signAndIssueChallan);

// Bucket
router.get('/bucket',                              ctrl.getTechnicianBucket);

// Warehouse queue
router.get('/warehouse-queue',                     requireWarehouse, ctrl.getWarehouseQueue);

module.exports = router;
