const express = require('express');
const ctrl = require('../controllers/supportRequestController');

const router = express.Router();

// Public — no auth. QR / universal link intake.
router.post('/request', ctrl.createPublicRequest);
router.get('/pincode/:pin', ctrl.lookupPublicPincode);
router.get('/ttspl/:code', ctrl.lookupPublicTtspl);

module.exports = router;
