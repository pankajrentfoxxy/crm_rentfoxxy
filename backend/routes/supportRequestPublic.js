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

// Customer feedback after a ticket closes (claude/carret-support.md S6). The
// token is 32 random hex characters; the page shows only the ticket number.
const csat = require('../services/supportCsatService');
router.get('/feedback/:token', publicLookupLimiter, async (req, res) => {
  try {
    if (!/^[a-f0-9]{32}$/.test(String(req.params.token || ''))) return res.status(404).json({ success: false, message: 'Link not found' });
    const data = await csat.getPublicFeedback(req.params.token);
    if (!data) return res.status(404).json({ success: false, message: 'Link not found' });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Could not load' });
  }
});
router.post('/feedback/:token', publicIntakeLimiter, async (req, res) => {
  try {
    if (!/^[a-f0-9]{32}$/.test(String(req.params.token || ''))) return res.status(404).json({ success: false, message: 'Link not found' });
    await csat.submitFeedback(req.params.token, { rating: req.body?.rating, comment: req.body?.comment });
    res.json({ success: true, message: 'Thank you for your feedback' });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.status ? e.message : 'Could not save' });
  }
});

module.exports = router;
