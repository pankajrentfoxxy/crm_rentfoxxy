const express = require('express');
const grnCapture = require('../controllers/grnSerialCapture.controller');

const router = express.Router();

router.get('/:token/windows-exe', grnCapture.downloadWindowsExe);
router.get('/:token', grnCapture.getPublicCaptureSession);
router.post('/:token/verify-configuration', ...grnCapture.verifyConfigValidators, grnCapture.verifyCaptureConfiguration);
router.post('/:token', ...grnCapture.submitCaptureValidators, grnCapture.submitPublicCaptureSerial);

module.exports = router;
