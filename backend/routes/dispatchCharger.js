const express = require('express');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/dispatchChargerController');

const router = express.Router();
router.use(authMiddleware);

const qcAccess = checkAnySectionPermission(
  ['dispatch_charger', 'dispatch_qc', 'floor_tickets'],
  'view'
);
const qcWrite = checkAnySectionPermission(
  ['dispatch_charger', 'dispatch_qc', 'floor_tickets'],
  'edit'
);
const warehouseView = checkSectionPermission('dispatch_charger_warehouse', 'view');
const warehouseEdit = checkSectionPermission('dispatch_charger_warehouse', 'edit');
const pickupAccess = checkAnySectionPermission(
  ['dispatch_charger', 'support_tickets', 'delivery_my_deliveries'],
  'view'
);

router.get('/ticket/:ticketId', qcAccess, ctrl.getTicketCharger);
router.post('/ticket/:ticketId/already-with-customer', qcWrite, ctrl.markAlreadyWithCustomer);
router.post('/ticket/:ticketId/request', qcWrite, ctrl.raiseRequest);
router.post('/ticket/:ticketId/qc-scan', qcWrite, ctrl.qcScan);
router.post('/:requestId/cancel', qcWrite, ctrl.cancelRequest);
router.post('/:requestId/attach', qcWrite, ctrl.attach);

router.get('/warehouse-queue', warehouseView, ctrl.warehouseQueue);
router.get('/available-units', warehouseView, ctrl.availableUnits);
router.post('/:requestId/approve-handover', warehouseEdit, ctrl.approveHandover);

router.get('/pickup/:itemId', pickupAccess, ctrl.getPickupCharger);
router.post('/pickup/:itemId/scan', pickupAccess, ctrl.pickupScan);
router.get('/return-dc/:rdcNumber', pickupAccess, ctrl.getReturnDcChargers);
router.post('/return-dc/:rdcNumber/scan', pickupAccess, ctrl.returnDcScan);

module.exports = router;
