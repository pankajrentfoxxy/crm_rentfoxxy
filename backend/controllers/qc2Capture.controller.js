const { validationResult, body, param } = require('express-validator');
const qc2Capture = require('../services/qc2CaptureService');

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

/** Auth — mint access number for QC2 ticket */
async function createTicketCaptureToken(req, res) {
  try {
    const ticketId = parseInt(req.params.ticketId, 10);
    if (!ticketId) {
      return res.status(400).json({ success: false, message: 'Invalid ticket id' });
    }
    const data = await qc2Capture.createQc2Token({
      ticketId,
      createdBy: req.user?.user_id,
      req,
    });
    res.json({ success: true, data });
  } catch (e) {
    console.error('createTicketCaptureToken:', e);
    res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to create token' });
  }
}

/** Auth — poll latest token status for QC2 screen */
async function getTicketCaptureStatus(req, res) {
  try {
    const ticketId = parseInt(req.params.ticketId, 10);
    const row = await qc2Capture.getLatestTokenForTicket(ticketId);
    if (!row) {
      return res.json({ success: true, data: null });
    }
    res.json({
      success: true,
      data: {
        token: row.token_id,
        access_number: row.access_number,
        status: row.status,
        expires_at: row.expires_at,
        matched_at: row.matched_at,
        match_result: row.match_result,
        actual_config: row.actual_config,
        serial_number: row.serial_number,
        configurationMatched: row.status === 'matched',
      },
    });
  } catch (e) {
    console.error('getTicketCaptureStatus:', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load status' });
  }
}

/** Public — resolve access number → session (reveal script) */
const resolveValidators = [
  body('access_number').isString().trim().isLength({ min: 4, max: 8 }),
];

async function resolveAccessNumber(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Invalid access number', errors: errors.array() });
  }
  try {
    const result = await qc2Capture.resolveByAccessNumber(req.body.access_number);
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({
      success: true,
      data: {
        token: result.token,
        expires_at: result.expires_at,
        ticket_id: result.ticket_id,
        expected_config: result.expected_config,
        ttspl_id: result.ttspl_id,
        api_base_url: qc2Capture.apiBaseUrl(req),
      },
    });
  } catch (e) {
    console.error('resolveAccessNumber:', e);
    res.status(500).json({ success: false, message: e.message || 'Resolve failed' });
  }
}

/** Public — session by token UUID */
async function getPublicSession(req, res) {
  try {
    const session = await qc2Capture.getPublicSession(req.params.token);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Link not found or expired' });
    }
    res.json({ success: true, data: session });
  } catch (e) {
    console.error('getPublicSession qc2:', e);
    res.status(500).json({ success: false, message: e.message });
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
    const result = await qc2Capture.verifyQc2Configuration(
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
      qc2_failed: result.qc2_failed || false,
      remarks: result.remarks || null,
    });
  } catch (e) {
    console.error('verifyConfiguration qc2:', e);
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
    const result = await qc2Capture.submitQc2Serial(req.params.token, req.body.serial_number);
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, serial_number: result.serial_number });
  } catch (e) {
    console.error('submitSerial qc2:', e);
    res.status(500).json({ success: false, message: e.message || 'Submit failed' });
  }
}

module.exports = {
  createTicketCaptureToken,
  getTicketCaptureStatus,
  resolveValidators,
  resolveAccessNumber,
  getPublicSession,
  verifyValidators,
  verifyConfiguration,
  submitSerialValidators,
  submitSerial,
};
