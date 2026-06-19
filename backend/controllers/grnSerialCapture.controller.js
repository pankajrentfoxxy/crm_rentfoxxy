const { validationResult, body, param } = require('express-validator');
const {
  createCaptureToken,
  getTokenStatus,
  getTokenRow,
  submitCapturedSerial,
  apiBaseUrl,
} = require('../services/grnSerialCaptureService');
const grnAccessService = require('../services/grnAccessService');
const grnConfigService = require('../services/grnConfigService');

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

    // Mint a short numeric Access Number that maps to this capture URL so the
    // receiver can authenticate from the public /access page without a password.
    let accessNumber = null;
    try {
      const access = await grnAccessService.createAccessNumber({
        captureUrl: data.capture_url,
        captureToken: token,
        poId: Number(req.params.poId),
        createdBy: req.user?.user_id,
        expiresAt: data.expires_at,
      });
      accessNumber = access.access_number;
    } catch (accessErr) {
      console.error('createAccessNumber:', accessErr.message);
    }

    res.json({
      success: true,
      data: {
        ...data,
        api_base_url: api,
        ps_command: psCommand,
        access_number: accessNumber,
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
    let expectedConfig = null;
    try {
      expectedConfig = await grnConfigService.loadExpectedConfig(status.po_id, status.line_index);
    } catch (_) { /* expected config is best-effort */ }
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
        config_verified: status.config_verified,
        config_check: status.config_check,
        actual_config: status.actual_config,
        expected_config: expectedConfig,
      },
    });
  } catch (e) {
    console.error('getPublicCaptureSession:', e);
    res.status(500).json({ success: false, message: e.message });
  }
}

/** Public — verify the actual laptop config matches the expected GRN item config */
const verifyConfigValidators = [param('token').isUUID()];

async function verifyCaptureConfiguration(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const tokenRow = await getTokenRow(req.params.token);
    if (!tokenRow) {
      return res.status(404).json({ success: false, message: 'Capture link not found or expired' });
    }
    if (tokenRow.status !== 'pending') {
      return res.status(409).json({ success: false, message: 'This capture link is no longer active' });
    }
    if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
      return res.status(410).json({ success: false, message: 'Capture link expired — ask the receiver to generate a new link' });
    }

    const body = req.body || {};
    const actual = {
      manufacturer: body.manufacturer ?? body.brand ?? '',
      model: body.model ?? '',
      processor: body.processor ?? '',
      generation: body.generation ?? '',
      ram: body.ram ?? '',
      ssd: body.ssd ?? body.storage ?? '',
      gpu: body.gpu ?? '',
    };

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const result = await grnConfigService.verifyConfiguration({ tokenRow, actual, ip });

    return res.json({
      success: result.configurationMatched,
      configurationMatched: result.configurationMatched,
      checks: result.checks,
      errors: result.errors,
      expected: result.expected,
    });
  } catch (e) {
    console.error('verifyCaptureConfiguration:', e);
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
  verifyConfigValidators,
  verifyCaptureConfiguration,
  submitCaptureValidators,
  submitPublicCaptureSerial,
};
