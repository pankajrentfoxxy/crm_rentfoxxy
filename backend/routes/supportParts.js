'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/supportPartsController');
const { authMiddleware } = require('../middleware/auth');
const { hasPermission } = require('../services/permissionService');

const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'support_lead', 'manager', 'super_admin']);

async function userHasSupportPartChallanAccess(req, action = 'can_view') {
  if (!req.user) return false;
  if (req.user.role === 'super_admin') return true;
  if (WAREHOUSE_ROLES.has(req.user.role)) return true;
  if (!req.permissionCache) req.permissionCache = {};
  return hasPermission(
    req.user.user_id,
    req.user.role,
    'support_part_challan',
    action,
    req.permissionCache
  );
}

const requireWarehouse = (req, res, next) => {
  (async () => {
    const allowed = await userHasSupportPartChallanAccess(req, 'can_view');
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Support part queue access required' });
    }
    return next();
  })().catch((err) => {
    console.error('requireWarehouse:', err);
    return res.status(500).json({ success: false, message: 'Server error checking permissions' });
  });
};

const requireWarehouseEdit = (req, res, next) => {
  (async () => {
    const allowed = await userHasSupportPartChallanAccess(req, 'can_edit');
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Support part queue edit access required' });
    }
    return next();
  })().catch((err) => {
    console.error('requireWarehouseEdit:', err);
    return res.status(500).json({ success: false, message: 'Server error checking permissions' });
  });
};

const SUPPORT_PARTS_ROLES = new Set([
  'support_tech', 'support_lead', 'warehouse', 'admin', 'manager', 'super_admin',
]);

async function userHasSupportPartRequestAccess(req, action = 'can_view') {
  if (!req.user) return false;
  if (req.user.role === 'super_admin') return true;
  if (SUPPORT_PARTS_ROLES.has(req.user.role)) return true;
  if (!req.permissionCache) req.permissionCache = {};
  return hasPermission(
    req.user.user_id,
    req.user.role,
    'support_part_requests',
    action,
    req.permissionCache
  );
}

const requireSupportOrWarehouse = (req, res, next) => {
  (async () => {
    const challan = await userHasSupportPartChallanAccess(req, 'can_view');
    const requests = await userHasSupportPartRequestAccess(req, 'can_view');
    if (!challan && !requests) {
      return res.status(403).json({ success: false, message: 'Not authorised' });
    }
    return next();
  })().catch((err) => {
    console.error('requireSupportOrWarehouse:', err);
    return res.status(500).json({ success: false, message: 'Server error checking permissions' });
  });
};

router.use(authMiddleware);

// Part requests
router.post('/requests',                          requireSupportOrWarehouse, ctrl.raiseSupportPartRequest);
router.get('/requests',                           requireSupportOrWarehouse, ctrl.listSupportPartRequests);
router.patch('/requests/:requestId/cancel',       requireSupportOrWarehouse, ctrl.cancelSupportPartRequest);
router.post('/requests/approve-and-challan',      requireWarehouseEdit,      ctrl.approveAndGenerateChallan);
router.post('/requests/approve-and-customer-dc',  requireWarehouseEdit,      ctrl.approveAndGenerateCustomerDc);
router.get('/part-dcs/:dcNumber',                 requireSupportOrWarehouse, ctrl.getPartCustomerDc);
router.patch('/part-dcs/:dcNumber/delivered',     requireWarehouseEdit,      ctrl.markPartCustomerDcDelivered);
router.patch('/part-dcs/:dcNumber/courier',       requireWarehouseEdit,      ctrl.updatePartCustomerDcCourier);
router.get('/part-dcs-awaiting-courier',          requireWarehouse,          ctrl.listPartCustomerDcsAwaitingCourier);
router.post('/old-parts/submit-rpdc',             requireSupportOrWarehouse, ctrl.submitOldPartRpdc);
router.get('/part-return-dcs/:dcNumber',         requireSupportOrWarehouse, ctrl.getPartReturnDc);
router.patch('/part-return-dcs/:dcNumber/receive', requireWarehouseEdit,     ctrl.receivePartReturnDc);
router.patch('/part-return-dcs/:dcNumber/courier', requireWarehouseEdit,    ctrl.updatePartReturnDcCourier);
router.get('/part-return-dcs-pending',            requireWarehouse,          ctrl.listPartReturnDcsPendingReceive);
router.patch('/requests/:requestId/mark-used',    requireSupportOrWarehouse, ctrl.markPartUsed);
router.post('/requests/:requestId/return',        requireSupportOrWarehouse, ctrl.returnPart);
router.patch('/requests/:requestId/accept-return', requireWarehouseEdit,         ctrl.acceptReturn);
router.post('/requests/:requestId/request-reassign', requireSupportOrWarehouse, ctrl.requestReassign);
router.patch('/requests/:requestId/resolve-reassign', requireWarehouseEdit,        ctrl.resolveReassign);

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
