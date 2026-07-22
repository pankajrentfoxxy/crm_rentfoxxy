const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { lookupPincode, sanitizePincode } = require('../services/pincodeLookupService');

router.use(authMiddleware);

router.get('/pincode/:pin', async (req, res) => {
  try {
    const pin = sanitizePincode(req.params.pin);
    if (pin.length !== 6) {
      return res.status(400).json({ success: false, message: 'Pincode must be 6 digits' });
    }
    const info = await lookupPincode(pin);
    if (!info?.city && !info?.state) {
      return res.json({ success: false, pincode: pin, message: 'No location found for this pincode' });
    }
    return res.json({
      success: true,
      pincode: pin,
      city: info.city || '',
      state: info.state || '',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Pincode lookup failed' });
  }
});

module.exports = router;
