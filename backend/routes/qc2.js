const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const ctrl = require('../controllers/qc2Capture.controller');

const router = express.Router();

router.use(authMiddleware);

router.post('/tickets/:ticketId/capture-token', ctrl.createTicketCaptureToken);
router.get('/tickets/:ticketId/capture-status', ctrl.getTicketCaptureStatus);

module.exports = router;
