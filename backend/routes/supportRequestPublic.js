const express = require('express');
const ctrl = require('../controllers/supportRequestController');

const router = express.Router();

// Public — no auth. QR / universal link intake.
router.post('/request', ctrl.createPublicRequest);

module.exports = router;
