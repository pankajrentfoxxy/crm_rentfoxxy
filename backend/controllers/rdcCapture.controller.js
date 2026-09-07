const { validationResult, body, param } = require('express-validator');
const rdcCapture = require('../services/rdcCaptureService');
const { buildSessionExe } = require('../services/hwCaptureExeService');

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
}

function parseActual(body = {}) {
  return {
    manufacturer: body.manufacturer ?? body.brand ?? '',
    model: body.model ?? '',
    model_version: body.model_version ?? '',
    system_family: body.system_family ?? '',
    processor: body.processor ?? '',
    generation: body.generation ?? '',
    ram: body.ram ?? '',
    ssd: body.ssd ?? body.storage ?? '',
    gpu: body.gpu ?? '',
  };
}

const resolveValidators = [
  body('access_number').isString().trim().isLength({ min: 4, max: 8 }),
];

async function resolveAccessNumber(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Invalid access number', errors: errors.array() });
  }
  try {
    const result = await rdcCapture.resolveByAccessNumber(req.body.access_number);
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({
      success: true,
      data: {
        token: result.token,
        expires_at: result.expires_at,
        ticket_id: result.ticket_id,
        dc_number: result.dc_number,
        expected_config: result.expected_config,
        ttspl_id: result.ttspl_id,
        api_base_url: rdcCapture.apiBaseUrl(req),
      },
    });
  } catch (e) {
    console.error('resolveAccessNumber rdc:', e);
    res.status(500).json({ success: false, message: e.message || 'Resolve failed' });
  }
}

async function getPublicSession(req, res) {
  try {
    const session = await rdcCapture.getPublicSession(req.params.token);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Link not found or expired' });
    }
    res.json({ success: true, data: session });
  } catch (e) {
    console.error('getPublicSession rdc:', e);
    res.status(500).json({ success: false, message: e.message });
  }
}

async function downloadWindowsExe(req, res) {
  try {
    const session = await rdcCapture.getPublicSession(req.params.token);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Link not found or expired' });
    }
    const { buffer, filename } = buildSessionExe({
      apiBase: rdcCapture.apiBaseUrl(req),
      token: req.params.token,
      apiPrefix: 'rdc-capture',
      brand: 'Return DC',
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (e) {
    console.error('downloadWindowsExe rdc:', e);
    res.status(e.status || 500).json({ success: false, message: e.message || 'EXE build failed' });
  }
}

const verifyValidators = [param('token').isUUID()];

async function verifyConfiguration(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  try {
    const actual = parseActual(req.body);
    const result = await rdcCapture.verifyRdcConfiguration(
      req.params.token,
      actual,
      clientIp(req)
    );
    if (!result.ok && result.code) {
      return res.status(result.code).json({
        success: false,
        configurationMatched: false,
        message: result.message,
      });
    }
    return res.json({
      success: result.configurationMatched,
      configurationMatched: result.configurationMatched,
      checks: result.checks,
      errors: result.errors,
      expected: result.expected,
      retry_access_number: result.retry_access_number || null,
    });
  } catch (e) {
    console.error('verifyConfiguration rdc:', e);
    res.status(500).json({ success: false, message: e.message || 'Verify failed' });
  }
}

const submitSerialValidators = [
  param('token').isUUID(),
  body('serial_number').isString().trim().isLength({ min: 3, max: 120 }),
];

async function submitSerial(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  try {
    const result = await rdcCapture.submitRdcSerial(req.params.token, req.body.serial_number);
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, serial_number: result.serial_number });
  } catch (e) {
    console.error('submitSerial rdc:', e);
    res.status(500).json({ success: false, message: e.message || 'Submit failed' });
  }
}

module.exports = {
  resolveValidators,
  resolveAccessNumber,
  getPublicSession,
  downloadWindowsExe,
  verifyValidators,
  verifyConfiguration,
  submitSerialValidators,
  submitSerial,
};
