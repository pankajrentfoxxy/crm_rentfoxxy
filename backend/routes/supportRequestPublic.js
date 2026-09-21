const express = require('express');
const ctrl = require('../controllers/supportRequestController');
const { publicLookupLimiter, publicIntakeLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Public — no auth. QR / universal link intake.
//
// Part 6.3 (finding U24): these three had no rate limit of any kind, and the
// TTSPL lookup returned a customer id and company name for any valid code.
// TTSPL codes are sequential, so the whole fleet was walkable with a for-loop.
router.post('/request', publicIntakeLimiter, ctrl.createPublicRequest);
router.get('/pincode/:pin', publicLookupLimiter, ctrl.lookupPublicPincode);
router.get('/ttspl/:code', publicLookupLimiter, ctrl.lookupPublicTtspl);

module.exports = router;
