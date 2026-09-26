const express = require('express');
const { authMiddleware, checkAnySectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/qc2Capture.controller');
const dispatchQcCtrl = require('../controllers/dispatchQcCapture.controller');

const router = express.Router();

router.use(authMiddleware);
// Q16: minting a check link needed only a login.
const floorEdit = checkAnySectionPermission(['floor_tickets', 'floor_pipeline', 'dispatch_qc'], 'edit');

router.post('/tickets/:ticketId/capture-token', floorEdit, ctrl.createTicketCaptureToken);
router.get('/tickets/:ticketId/capture-status', ctrl.getTicketCaptureStatus);

router.post('/dispatch/tickets/:ticketId/capture-token', floorEdit, dispatchQcCtrl.createTicketCaptureToken);
router.get('/dispatch/tickets/:ticketId/capture-status', dispatchQcCtrl.getTicketCaptureStatus);

module.exports = router;
