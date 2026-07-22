const express = require('express');
const ctrl = require('../controllers/grnAccessController');

const router = express.Router();

// Public — no auth. The access number itself is the credential.
router.post('/resolve', ...ctrl.resolveValidators, ctrl.resolveAccessNumber);

module.exports = router;
