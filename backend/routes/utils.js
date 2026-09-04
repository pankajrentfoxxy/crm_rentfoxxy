const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { lookupPincode, sanitizePincode } = require('../services/pincodeLookupService');
const {
  lookupGstin,
  sanitizeGstin,
  isValidGstin,
} = require('../services/gstinLookupService');

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
      area: info.area || '',
      address: info.address || '',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Pincode lookup failed' });
  }
});

router.get('/gstin/:gstin', async (req, res) => {
  try {
    const gstin = sanitizeGstin(req.params.gstin);
    if (!isValidGstin(gstin)) {
      return res.status(400).json({ success: false, message: 'GSTIN must be a valid 15-character number' });
    }
    const data = await lookupGstin(gstin);
    return res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ success: false, message: err.message || 'GSTIN lookup failed' });
  }
});

/** Download TaskFlow CSV of completed CRM tasks for a given date (YYYY-MM-DD). */
router.get('/tasks-done/:date.csv', (req, res) => {
  const date = String(req.params.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: 'Date must be YYYY-MM-DD' });
  }
  const filePath = path.join(__dirname, '..', '..', 'reports', `tasks-done-${date}.csv`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: `No tasks export for ${date}` });
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tasks-done-${date}.csv"`);
  return res.sendFile(filePath);
});

module.exports = router;
