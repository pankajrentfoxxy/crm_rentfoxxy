const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/dispatchQcCapture.controller');
const { wrapMulter } = require('../config/uploadLimits');
const { PRAMAN_DIR } = require('../services/dispatchQcPramanService');

const router = express.Router();

// Praman report PDF from the tested laptop (migration 429). Public, so: one
// PDF, at most 15 MB, random file name, private folder; the controller checks
// the link has matched and the ticket is still at Dispatch QC.
const pramanFromDevice = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { fs.mkdirSync(PRAMAN_DIR, { recursive: true }); cb(null, PRAMAN_DIR); },
    filename: (_req, _file, cb) => cb(null, `praman-dev-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    return isPdf ? cb(null, true) : cb(new Error('The Praman report must be a PDF'));
  },
});

router.post('/resolve', ...ctrl.resolveValidators, ctrl.resolveAccessNumber);
router.get('/:token/windows-exe', ctrl.downloadWindowsExe);
router.get('/:token', ctrl.getPublicSession);
router.post('/:token/verify-configuration', ...ctrl.verifyValidators, ctrl.verifyConfiguration);
router.post('/:token/praman-report', ...ctrl.verifyValidators, wrapMulter(pramanFromDevice.single('praman_report')), ctrl.uploadPramanReport);
router.post('/:token', ...ctrl.submitSerialValidators, ctrl.submitSerial);

module.exports = router;
