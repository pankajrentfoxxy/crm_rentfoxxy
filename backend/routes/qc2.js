const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const ctrl = require('../controllers/qc2Capture.controller');
const dispatchQcCtrl = require('../controllers/dispatchQcCapture.controller');

const router = express.Router();

router.use(authMiddleware);

router.post('/tickets/:ticketId/capture-token', ctrl.createTicketCaptureToken);
router.get('/tickets/:ticketId/capture-status', ctrl.getTicketCaptureStatus);

router.post('/dispatch/tickets/:ticketId/capture-token', dispatchQcCtrl.createTicketCaptureToken);
router.get('/dispatch/tickets/:ticketId/capture-status', dispatchQcCtrl.getTicketCaptureStatus);

module.exports = router;
