const express = require('express');
const grnCapture = require('../controllers/grnSerialCapture.controller');

const router = express.Router();

router.get('/:token', grnCapture.getPublicCaptureSession);
router.post('/:token', ...grnCapture.submitCaptureValidators, grnCapture.submitPublicCaptureSerial);

module.exports = router;
