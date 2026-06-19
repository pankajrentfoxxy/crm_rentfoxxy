const { body, param, validationResult } = require('express-validator');
const grnAccessService = require('../services/grnAccessService');

const ERROR_MESSAGES = {
  invalid: 'Invalid Access Number',
  used: 'Access Number Already Used',
  expired: 'Access Number Expired',
};
const ERROR_CODES = { invalid: 404, used: 409, expired: 410 };

/** Public — validate an access number and return the capture link. */
const resolveValidators = [
  body('access_number').notEmpty().withMessage('Access number is required'),
];

async function resolveAccessNumber(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Enter an access number' });
  }
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const result = await grnAccessService.resolveAccessNumber(req.body.access_number, {
      ip,
      userAgent: req.headers['user-agent'],
    });
    if (!result.ok) {
      return res.status(ERROR_CODES[result.code] || 400).json({
        success: false,
        code: result.code,
        message: ERROR_MESSAGES[result.code] || 'Invalid Access Number',
      });
    }
    return res.json({
      success: true,
      data: { capture_url: result.capture_url, access_number: result.access_number },
    });
  } catch (e) {
    console.error('resolveAccessNumber:', e);
    return res.status(500).json({ success: false, message: 'Could not validate access number' });
  }
}

// ── Admin ────────────────────────────────────────────────────────
async function listAccessNumbers(req, res) {
  try {
    const rows = await grnAccessService.listAccessNumbers({ status: req.query.status });
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('listAccessNumbers:', e);
    res.status(500).json({ success: false, message: e.message });
  }
}

async function listAttempts(req, res) {
  try {
    const rows = await grnAccessService.listAttempts({ limit: req.query.limit });
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('listAttempts:', e);
    res.status(500).json({ success: false, message: e.message });
  }
}

const idValidators = [param('id').isInt().toInt()];

async function expireAccessNumber(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const ok = await grnAccessService.expireAccessNumber(req.params.id);
    if (!ok) return res.status(400).json({ success: false, message: 'Only pending access numbers can be expired' });
    res.json({ success: true });
  } catch (e) {
    console.error('expireAccessNumber:', e);
    res.status(500).json({ success: false, message: e.message });
  }
}

async function removeAccessNumber(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    await grnAccessService.removeAccessNumber(req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('removeAccessNumber:', e);
    res.status(500).json({ success: false, message: e.message });
  }
}

module.exports = {
  resolveValidators,
  resolveAccessNumber,
  listAccessNumbers,
  listAttempts,
  idValidators,
  expireAccessNumber,
  removeAccessNumber,
};
