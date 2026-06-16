const { validationResult, body, param } = require('express-validator');
const {
  createCaptureToken,
  getTokenStatus,
  submitCapturedSerial,
  apiBaseUrl,
} = require('../services/grnSerialCaptureService');

/** Authenticated — create a capture link for one unit in a GRN receive batch */
const createTokenValidators = [
  param('poId').isInt().toInt(),
  body('line_index').isInt({ min: 0 }).toInt(),
  body('unit_index').isInt({ min: 0 }).toInt(),
  body('total_units').isInt({ min: 1, max: 250 }).toInt(),
];

async function createGrnCaptureToken(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const api = apiBaseUrl(req);
    const data = await createCaptureToken({
      poId: Number(req.params.poId),
      lineIndex: Number(req.body.line_index),
      unitIndex: Number(req.body.unit_index),
      totalUnits: Number(req.body.total_units),
      createdBy: req.user?.user_id,
      req,
    });
    const token = data.token;
    const psCommand = `$s=(Get-CimInstance Win32_BIOS).SerialNumber.Trim().ToUpper(); Invoke-RestMethod -Uri "${api}/grn-capture/${token}" -Method Post -Body (@{serial_number=$s}|ConvertTo-Json) -ContentType "application/json"`;
    res.json({
      success: true,
      data: {
        ...data,
        api_base_url: api,
        ps_command: psCommand,
      },
    });
  } catch (e) {
    console.error('createGrnCaptureToken:', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to create capture link' });
  }
}

/** Authenticated — poll capture status from the receive wizard */
async function getGrnCaptureTokenStatus(req, res) {
  try {
    const status = await getTokenStatus(req.params.token);
    if (!status) return res.status(404).json({ success: false, message: 'Token not found' });
    res.json({ success: true, data: status });
  } catch (e) {
    console.error('getGrnCaptureTokenStatus:', e);
    res.status(500).json({ success: false, message: e.message });
  }
}

/** Public — laptop capture page loads session info */
async function getPublicCaptureSession(req, res) {
  try {
    const status = await getTokenStatus(req.params.token);
    if (!status) return res.status(404).json({ success: false, message: 'Link not found or expired' });
    res.json({
      success: true,
      data: {
        token: status.token,
        status: status.status,
        serial_number: status.serial_number,
        unit_index: status.unit_index,
        total_units: status.total_units,
        po_id: status.po_id,
        expires_at: status.expires_at,
      },
    });
  } catch (e) {
    console.error('getPublicCaptureSession:', e);
    res.status(500).json({ success: false, message: e.message });
  }
}

/** Public — submit serial from laptop (capture page or PowerShell one-liner) */
const submitCaptureValidators = [
  param('token').isUUID(),
  body('serial_number').trim().notEmpty().isLength({ min: 3, max: 128 }),
];

async function submitPublicCaptureSerial(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const result = await submitCapturedSerial(req.params.token, req.body.serial_number);
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({
      success: true,
      message: 'Serial number captured successfully. You can close this tab.',
      data: result,
    });
  } catch (e) {
    console.error('submitPublicCaptureSerial:', e);
    res.status(500).json({ success: false, message: e.message });
  }
}

module.exports = {
  createTokenValidators,
  createGrnCaptureToken,
  getGrnCaptureTokenStatus,
  getPublicCaptureSession,
  submitCaptureValidators,
  submitPublicCaptureSerial,
};
