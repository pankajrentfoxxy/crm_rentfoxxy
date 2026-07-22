const express = require('express');
const ctrl = require('../controllers/qc2Capture.controller');

const router = express.Router();

router.post('/resolve', ...ctrl.resolveValidators, ctrl.resolveAccessNumber);
router.get('/:token/windows-exe', ctrl.downloadWindowsExe);
router.get('/:token', ctrl.getPublicSession);
router.post('/:token/verify-configuration', ...ctrl.verifyValidators, ctrl.verifyConfiguration);
router.post('/:token', ...ctrl.submitSerialValidators, ctrl.submitSerial);

module.exports = router;
